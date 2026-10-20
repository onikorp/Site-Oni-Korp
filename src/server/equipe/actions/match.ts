// Actions d'Inside · Matchs et préparation : notes, drafts LoL, lineups Valorant, stats saisies, VOD, replays, scouting, compo.
// Appelées par POST /api/equipe/outils (outils.ts) selon le champ « action ». Chaque action vérifie elle-même les droits.
import { exec, rows } from '../../db';
import { canLead } from '../access';
import { clip, num, riotIds, type Action } from './base';

export const actions: Record<string, Action> = {
  'note': async ({ f, user, back, redirect, canRoster }) => {
    const id = Number(f.get('match'));
    const [m] = await rows<{ roster_id: number }>('SELECT roster_id FROM matches WHERE id = ?', id);
    if (!m || !canRoster(Number(m.roster_id))) return redirect(back);
    const rating = Math.min(10, Math.max(1, Number(f.get('rating')) || 5));
    await exec(`INSERT INTO match_notes VALUES (?,?,?,?,?,?) ON CONFLICT(match_id, user_id) DO UPDATE SET good = excluded.good, work = excluded.work, rating = excluded.rating, at = excluded.at`,
      id, user.id, clip(f.get('good'), 1000), clip(f.get('work'), 1000), rating, Date.now());
    return redirect(`${back}#match-${id}`);
  },
  'draft': async ({ f, user, back, redirect, canRoster }) => {
    const roster = Number(f.get('roster'));
    if (!canRoster(roster)) return redirect(back);
    const data = clip(f.get('data'), 4000);
    try { const d = JSON.parse(data); if (!d || typeof d !== 'object' || Array.isArray(d)) return redirect(back); } catch { return redirect(back); }
    await exec('INSERT INTO drafts (roster_id, title, data, author, at) VALUES (?,?,?,?,?)', roster, clip(f.get('title'), 80) || 'Draft', data, user.id, Date.now());
    return redirect(back);
  },
  'lineup': async ({ f, user, back, redirect, canRoster }) => {
    const roster = Number(f.get('roster'));
    if (!canRoster(roster)) return redirect(back);
    const [x, y, tx, ty] = ['x', 'y', 'tx', 'ty'].map((k) => num(f.get(k)));
    const url = clip(f.get('url'), 300);
    if (x === null || y === null || !clip(f.get('title'), 80)) return redirect(back);
    const imgs = ['img1', 'img2', 'img3'].map((k) => clip(f.get(k), 300)).map((u) => (/^https:\/\//.test(u) ? u : ''));
    await exec('INSERT INTO lineups (roster_id, map, agent, side, title, x, y, tx, ty, url, note, author, at, ability, kind, imgs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      roster, clip(f.get('map'), 40), clip(f.get('agent'), 40), clip(f.get('side'), 10), clip(f.get('title'), 80), x, y, tx, ty,
      /^https?:\/\//.test(url) ? url : null, clip(f.get('note'), 500), user.id, Date.now(),
      clip(f.get('ability'), 40) || null, f.get('kind') === 'setup' ? 'setup' : 'lineup', imgs.some(Boolean) ? JSON.stringify(imgs) : null);
    return redirect(back);
  },
  'stats': async ({ f, user, me, back, redirect, canRoster }) => {
    const id = Number(f.get('match'));
    const [m] = await rows<{ roster_id: number }>('SELECT roster_id FROM matches WHERE id = ?', id);
    if (!m || !canRoster(Number(m.roster_id))) return redirect(back);
    const target = canLead(me, m.roster_id) && clip(f.get('user'), 25) ? clip(f.get('user'), 25) : user.id;
    const data: Record<string, number | string> = {};
    for (const k of ['acs', 'k', 'd', 'a', 'adr', 'hs', 'fb', 'kast', 'score', 'buts', 'passes', 'arrets', 'tirs', 'demos']) {
      const v = Number(String(f.get(k) ?? '').replace(',', '.'));
      if (String(f.get(k) ?? '').trim() !== '' && Number.isFinite(v) && v >= 0 && v < 100000) data[k] = v;
    }
    if (clip(f.get('agent'), 20)) data.agent = clip(f.get('agent'), 20);
    if (Object.keys(data).length) await exec(`INSERT INTO match_stats VALUES (?,?,?,?) ON CONFLICT(match_id, user_id) DO UPDATE SET data = excluded.data, at = excluded.at`, id, target, JSON.stringify(data), Date.now());
    return redirect(back);
  },
  'vod': async ({ f, user, back, redirect, canRoster }) => {
    const roster = Number(f.get('roster'));
    const url = clip(f.get('url'), 300);
    if (!canRoster(roster) || !/^https?:\/\//.test(url)) return redirect(back);
    // Le match doit appartenir au même roster
    const [m] = Number(f.get('match')) ? await rows<{ id: number }>('SELECT id FROM matches WHERE id = ? AND roster_id = ?', Number(f.get('match')), roster) : [];
    await exec('INSERT INTO vods (roster_id, title, url, match_id, added_by, at) VALUES (?,?,?,?,?,?)', roster, clip(f.get('title'), 100) || 'VOD', url, m ? Number(m.id) : null, user.id, Date.now());
    return redirect(back);
  },
  'vod-mark': async ({ f, user, back, redirect, canRoster }) => {
    const vod = Number(f.get('vod'));
    const [v] = await rows<{ roster_id: number }>('SELECT roster_id FROM vods WHERE id = ?', vod);
    if (!v || !canRoster(Number(v.roster_id))) return redirect(back);
    // « 1:23 », « 12:05 » ou « 1:02:03 » → secondes
    const t = clip(f.get('t'), 10).split(':').map(Number).reduce((s, x) => s * 60 + (Number.isFinite(x) ? x : 0), 0);
    const kind = ['bien', 'erreur', 'revoir', 'info'].includes(clip(f.get('kind'), 8)) ? clip(f.get('kind'), 8) : 'info';
    if (clip(f.get('text'), 400)) await exec('INSERT INTO vod_marks (vod_id, t, text, kind, author, at) VALUES (?,?,?,?,?,?)', vod, t, clip(f.get('text'), 400), kind, user.id, Date.now());
    return redirect(back);
  },
  'replay': async ({ f, back, redirect, canRoster }) => {
    const id = Number(f.get('match'));
    const [m] = await rows<{ roster_id: number }>('SELECT roster_id FROM matches WHERE id = ?', id);
    if (!m || !canRoster(Number(m.roster_id))) return redirect(back);
    await exec(`CREATE TABLE IF NOT EXISTS match_replays (match_id INTEGER, replay TEXT, status TEXT DEFAULT 'attente', at INTEGER, PRIMARY KEY (match_id, replay))`).catch(() => {});
    // Liens ballchasing.com/replay/<uuid> : Oni Bot importe les stats dans la minute
    const ids = [...String(f.get('replays') ?? '').matchAll(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)].map((x) => x[1].toLowerCase()).slice(0, 7);
    for (const r of ids) await exec(`INSERT OR IGNORE INTO match_replays (match_id, replay, status, at) VALUES (?,?, 'attente', ?)`, id, r, Date.now());
    return redirect(back);
  },
  // Scouting LoL (20/10) : Oni Bot analyse chaque Riot ID dans la minute ; une analyse de moins de 6 h n'est pas refaite
  'scout': async ({ f, user, me, back, redirect }) => {
    if (!me.staff && !me.rosters.some((r) => r.game === 'lol')) return redirect(back);
    const region = ['euw', 'eune', 'na', 'kr'].includes(clip(f.get('region'), 6)) ? clip(f.get('region'), 6) : 'euw';
    const now = Date.now();
    for (const id of riotIds(f.get('ids'))) {
      await exec(`INSERT INTO scout_lol (ident, region, name, status, requested_by, at) VALUES (?,?,?, 'attente', ?, ?)
        ON CONFLICT(ident, region) DO UPDATE SET status = 'attente', name = excluded.name, requested_by = excluded.requested_by, at = excluded.at
        WHERE scout_lol.status IN ('ok', 'erreur') AND (scout_lol.done_at IS NULL OR scout_lol.done_at < ?)`, id.toLowerCase(), region, id, user.id, now, now - 6 * 3600_000);
    }
    return redirect(back);
  },
  'adversaire': async ({ f, user, back, redirect, canRoster }) => {
    const id = Number(f.get('id'));
    const fields = ['players', 'style', 'forces', 'faiblesses', 'plan', 'links'].map((k) => String(f.get(k) ?? '').slice(0, 4000));
    const name = clip(f.get('name'), 80);
    if (!name) return redirect(back);
    await exec(`CREATE TABLE IF NOT EXISTS opponents (id INTEGER PRIMARY KEY, roster_id INTEGER, name TEXT, players TEXT, style TEXT, forces TEXT, faiblesses TEXT, plan TEXT, links TEXT, author TEXT, updated_at INTEGER)`).catch(() => {});
    for (const c of ['niveau TEXT', 'contact TEXT', 'soirs TEXT', 'statut TEXT']) await exec(`ALTER TABLE opponents ADD COLUMN ${c}`).catch(() => {});
    // Annuaire des scrims (07/10) : niveau, contact, soirs habituels, statut (à contacter, contacté, partenaire, pas intéressé)
    const extra = [clip(f.get('niveau'), 80), clip(f.get('contact'), 200), clip(f.get('soirs'), 120), ['a-contacter', 'contacte', 'partenaire', 'non'].includes(clip(f.get('statut'), 15)) ? clip(f.get('statut'), 15) : ''];
    const qs = back.includes('?') ? `&${back.split('?')[1]}` : '';
    if (id) {
      const [o] = await rows<{ roster_id: number }>('SELECT roster_id FROM opponents WHERE id = ?', id);
      if (!o || !canRoster(Number(o.roster_id))) return redirect(back);
      await exec('UPDATE opponents SET name = ?, players = ?, style = ?, forces = ?, faiblesses = ?, plan = ?, links = ?, author = ?, updated_at = ?, niveau = ?, contact = ?, soirs = ?, statut = ? WHERE id = ?', name, ...fields, user.id, Date.now(), ...extra, id);
      return redirect(`/equipe/scouting/?o=${id}${qs}`);
    }
    const roster = Number(f.get('roster'));
    if (!canRoster(roster)) return redirect(back);
    const [n] = await rows<{ id: number }>('INSERT INTO opponents (roster_id, name, players, style, forces, faiblesses, plan, links, author, updated_at, niveau, contact, soirs, statut) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id', roster, name, ...fields, user.id, Date.now(), ...extra);
    return redirect(n ? `/equipe/scouting/?o=${n.id}${qs}` : back);
  },
  'compo': async ({ f, me, back, redirect }) => {
    const id = Number(f.get('match'));
    const [m] = await rows<{ roster_id: number }>('SELECT roster_id FROM matches WHERE id = ?', id);
    if (!m || !canLead(me, m.roster_id)) return redirect(back);
    const name = async (uid: string) => (await rows<{ name: string }>('SELECT name FROM guild_members WHERE id = ?', uid))[0]?.name ?? 'Joueur';
    const tit = f.getAll('titulaires').map(String).slice(0, 7);
    const sub = clip(f.get('remplacant'), 25);
    const lineup = { titulaires: await Promise.all(tit.map(async (u) => ({ id: u, nom: await name(u) }))), remplacant: sub ? { id: sub, nom: await name(sub) } : null, coach: null };
    await exec('UPDATE matches SET lineup = ? WHERE id = ?', tit.length ? JSON.stringify(lineup) : null, id);
    return redirect(back);
  },
};
