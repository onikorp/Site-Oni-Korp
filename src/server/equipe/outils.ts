// Outils de l'espace équipe (Inside) : tables, accès, et le point d'entrée des formulaires.
// POST /api/equipe/outils (formulaire, champ « action ») → actions/*.ts, une action par geste (voir docs/03-inside.md)
// GET /api/equipe/outils?type=drafts|lineups&roster=ID (JSON) · type=ll|lv|vc : sources tierces (sources.ts)
import type { APIRoute, AstroCookies } from 'astro';
import { currentSession, sameOrigin } from '../session';
import { db, exec, rows } from '../db';
import { access, canSee, canLead } from './access';
import { GAMES_ACCOUNTS, clip, type Action } from './actions/base';
import { actions as compte } from './actions/compte';
import { actions as contenu } from './actions/contenu';
import { actions as roster } from './actions/roster';
import { actions as match } from './actions/match';
import { LL_LANES, llChamp, llMeta, lv, lvList, lvOne, vcList, type VC } from './sources';
export { canSee, canLead, canWriteDoc, rosterMembers } from './access';
export { GAMES_ACCOUNTS };

/** Les gestes d'Inside, par domaine (actions/*.ts). */
const ACTIONS: Record<string, Action> = { ...compte, ...contenu, ...roster, ...match };

let ready = false;
/** Tables des outils (créées au premier usage ; Oni Bot les crée aussi). */
export async function ensureTables() {
  if (ready) return;
  const statements = [
    // Statut dans un roster (06/10) : titulaire, remplaçant ou en essai (date de fin, retour écrit en fin d'essai)
    `CREATE TABLE IF NOT EXISTS roster_status (roster_id INTEGER, user_id TEXT, statut TEXT, essai_fin INTEGER, retour TEXT, by TEXT, at INTEGER, PRIMARY KEY (roster_id, user_id))`,
    // Page Staff publique (06/10) : chacun choisit d'y apparaître, avec une phrase
    `CREATE TABLE IF NOT EXISTS staff_public (user_id TEXT PRIMARY KEY, visible INTEGER DEFAULT 0, bio TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS accounts (user_id TEXT, game TEXT, ident TEXT, region TEXT, updated_at INTEGER, PRIMARY KEY (user_id, game))`,
    `CREATE TABLE IF NOT EXISTS match_notes (match_id INTEGER, user_id TEXT, good TEXT, work TEXT, rating INTEGER, at INTEGER, PRIMARY KEY (match_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY, roster_id INTEGER, title TEXT, data TEXT, author TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS lineups (id INTEGER PRIMARY KEY, roster_id INTEGER, map TEXT, agent TEXT, side TEXT, title TEXT, x REAL, y REAL, tx REAL, ty REAL, url TEXT, note TEXT, author TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS stats_cache (key TEXT PRIMARY KEY, value TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS perf (id TEXT PRIMARY KEY, user_id TEXT, game TEXT, at INTEGER, data TEXT)`,
    `CREATE TABLE IF NOT EXISTS rank_history (user_id TEXT, game TEXT, day TEXT, value TEXT, PRIMARY KEY (user_id, game, day))`,
    `CREATE TABLE IF NOT EXISTS match_stats (match_id INTEGER, user_id TEXT, data TEXT, at INTEGER, PRIMARY KEY (match_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS osu_maps (id INTEGER PRIMARY KEY, roster_id INTEGER, beatmap_id INTEGER, note TEXT, challenge INTEGER DEFAULT 0, ends INTEGER, meta TEXT, added_by TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS setups (user_id TEXT, game TEXT, data TEXT, updated_at INTEGER, PRIMARY KEY (user_id, game))`,
    `CREATE TABLE IF NOT EXISTS vods (id INTEGER PRIMARY KEY, roster_id INTEGER, title TEXT, url TEXT, match_id INTEGER, added_by TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS vod_marks (id INTEGER PRIMARY KEY, vod_id INTEGER, t INTEGER, text TEXT, kind TEXT, author TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, roster_id INTEGER, title TEXT, body TEXT, pinned INTEGER DEFAULT 0, author TEXT, updated_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS boards (id INTEGER PRIMARY KEY, roster_id INTEGER, game TEXT, map TEXT, title TEXT, state TEXT, updated_at INTEGER, updated_by TEXT)`,
    // Outils par jeu (07/10) : pools de champions et d'agents, compos Valorant par carte, packs d'entraînement RL, carnet perso
    `CREATE TABLE IF NOT EXISTS pools (roster_id INTEGER, user_id TEXT, game TEXT, item TEXT, tier TEXT, note TEXT, at INTEGER, PRIMARY KEY (roster_id, user_id, game, item))`,
    `CREATE TABLE IF NOT EXISTS comps (id INTEGER PRIMARY KEY, roster_id INTEGER, map TEXT, agents TEXT, note TEXT, author TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS rl_packs (id INTEGER PRIMARY KEY, roster_id INTEGER, code TEXT, title TEXT, kind TEXT, note TEXT, author TEXT, at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS carnet (user_id TEXT PRIMARY KEY, body TEXT, at INTEGER)`,
    // Smurfs (20/10) : comptes secondaires ; Oni Bot relève leurs parties au nom du joueur, sans courbe de rang
    `CREATE TABLE IF NOT EXISTS accounts_alt (user_id TEXT, game TEXT, ident TEXT, region TEXT, updated_at INTEGER, PRIMARY KEY (user_id, game, ident))`,
    // Scouting LoL (20/10) : joueurs adverses à analyser (statut attente → cours → ok / erreur), analysés par Oni Bot
    `CREATE TABLE IF NOT EXISTS scout_lol (ident TEXT, region TEXT, name TEXT, status TEXT DEFAULT 'attente', data TEXT, error TEXT, requested_by TEXT, at INTEGER, done_at INTEGER, PRIMARY KEY (ident, region))`,
    `CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY, roster_id INTEGER, user_id TEXT, title TEXT, detail TEXT, due INTEGER, status TEXT DEFAULT 'en-cours', progress INTEGER DEFAULT 0, created_by TEXT, at INTEGER, updated_at INTEGER)`,
  ];
  // Un seul aller-retour vers la base pour toutes les tables
  const c = db(); if (c) await c.batch(statements, 'write').catch(async () => { for (const sql of statements) await exec(sql).catch(() => {}); });
  // Lineups (07/10) : compétence utilisée, type (lineup ou setup) et captures (position, visée, impact)
  for (const col of ['ability TEXT', 'kind TEXT', 'imgs TEXT']) await exec(`ALTER TABLE lineups ADD COLUMN ${col}`).catch(() => {});
  // Docs à trois niveaux (07/10) : 'roster' (défaut), 'jeu' (game, tous les rosters du jeu), 'club' (tout Inside) ; roster_id nul hors roster
  for (const col of ['level TEXT', 'game TEXT']) await exec(`ALTER TABLE docs ADD COLUMN ${col}`).catch(() => {});
  // Objectifs individuels privés (07/10) : visibles du joueur et de l'encadrement du roster seulement
  await exec('ALTER TABLE goals ADD COLUMN private INTEGER DEFAULT 0').catch(() => {});
  await exec('ALTER TABLE osu_maps ADD COLUMN slot TEXT').catch(() => {});
  // Brouillon de tableau (07/10) : owner = la seule personne qui le voit, jusqu'à ce qu'elle le partage au roster
  await exec('ALTER TABLE boards ADD COLUMN owner TEXT').catch(() => {});
  // Plan de séance et relance groupée (07/10), aussi créées par Oni Bot
  for (const col of ['plan TEXT', 'plan_at INTEGER', 'relance_at INTEGER']) await exec(`ALTER TABLE trainings ADD COLUMN ${col}`).catch(() => {});
  // Accord d'image (07/10) : vignette et clips ; effacé au départ du serveur (purgeOld d'Oni Bot)
  await exec('CREATE TABLE IF NOT EXISTS consents (user_id TEXT PRIMARY KEY, image INTEGER DEFAULT 0, at INTEGER)').catch(() => {});
  ready = true;
}

/** Membre connecté avec accès à l'espace équipe, sinon null. */
export async function teamUser(cookies: AstroCookies) {
  const user = await currentSession(cookies);
  if (!user) return null;
  const me = await access(user.id);
  if (!me.member || !(me.staff || me.rosters.length || me.content.length || me.mod || me.community)) return null;
  await ensureTables();
  return { user, me };
}

/** Roster choisi dans la navigation (?r=slug) : on filtre dessus, sinon tous ceux de la personne. */
/**
 * Roster de travail d'un outil d'équipe : toujours UN seul (décision du 07/10 : pas de mélange entre rosters).
 * Celui de l'adresse (?r=), sinon le dernier ouvert (cookie oni_r), sinon le premier des miens, sinon le premier. `keep` limite aux rosters
 * concernés par l'outil (ex. le drafter : rosters LoL). Le choix est retenu pour la prochaine visite.
 */
export function scope<T extends { id: number; slug: string; game?: string }>(rosters: T[], url: URL, cookies?: AstroCookies, keep?: (r: T) => boolean, owner?: number | null) {
  const pool = keep ? rosters.filter(keep) : rosters;
  // Lien direct vers un élément (tableau, doc, VOD…) sans ?r= : on ouvre le roster auquel il appartient
  const asked = pool.find((x) => x.slug === url.searchParams.get('r')) ?? (owner ? pool.find((x) => Number(x.id) === Number(owner)) : undefined);
  const one = asked ?? pool.find((x) => x.slug === cookies?.get('oni_r')?.value) ?? pool.find((x) => (x as { mine?: boolean }).mine) ?? pool[0];
  if (asked && cookies) cookies.set('oni_r', asked.slug, { path: '/', maxAge: 365 * 86400, sameSite: 'lax', secure: url.protocol === 'https:' });
  return { active: one?.slug ?? null, list: one ? [one] : [] };
}
/** Roster propriétaire d'un élément ouvert par son identifiant (?b=, ?d=, ?v=…), si la page n'a pas de ?r=. */
export async function ownerOf(url: URL, table: 'boards' | 'docs' | 'vods' | 'opponents' | 'matches' | 'drafts', param: string) {
  const id = Number(url.searchParams.get(param));
  if (!id || url.searchParams.get('r')) return null;
  const [x] = await rows<{ roster_id: number }>(`SELECT roster_id FROM ${table} WHERE id = ?`, id).catch(() => []);
  return x ? Number(x.roster_id) : null;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  if (!sameOrigin(request)) return redirect('/equipe/');
  const t = await teamUser(cookies);
  if (!t) return redirect('/equipe/');
  const { user, me } = t;
  const f = await request.formData();
  const action = clip(f.get('action'), 30);
  const back = clip(f.get('back'), 100).startsWith('/equipe') ? clip(f.get('back'), 100) : '/equipe/';
  const canRoster = (id: number) => canSee(me, id);

  // Sécurité du compte : nouveau lien d'agenda perso ; déconnexion de tous les appareils
  // Aiguillage vers l'action (actions/*.ts) ; action inconnue : retour à la page
  const run = ACTIONS[action] ?? (action.startsWith('tache') ? ACTIONS.tache : undefined);
  return run ? run({ f, action, back, user, me, cookies, redirect, canRoster }) : redirect(back);
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const t = await teamUser(cookies);
  if (!t) return new Response('[]', { status: 401 });
  if (url.searchParams.get('type') === 'vc') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase().slice(0, 40), tag = url.searchParams.get('tag') ?? '', sort = url.searchParams.get('sort') ?? 'semaine';
    const all = await vcList().catch(() => [] as VC[]);
    const list = all.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!tag || (x.tags ?? '').split(',').includes(tag)))
      .sort((a, b) => (sort === 'total' ? b.copied - a.copied : b.weeklyCopies - a.weeklyCopies || b.copied - a.copied)).slice(0, 48)
      .map((x) => ({ id: x.id, name: x.name, code: x.code, team: (x.tags ?? '').includes('team'), copied: x.copied, weekly: x.weeklyCopies }));
    return new Response(JSON.stringify({ total: all.length, list }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=3600' } });
  }
  if (url.searchParams.get('type') === 'll') {
    const slug = (url.searchParams.get('c') ?? '').replace(/[^a-z]/g, '').slice(0, 30), lane = url.searchParams.get('lane') ?? '';
    const v = await (slug ? (LL_LANES.includes(lane as any) ? llChamp(slug, lane) : Promise.resolve(null)) : llMeta()).catch(() => null);
    return new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json', 'Cache-Control': v ? 'private, max-age=3600' : 'no-store' } });
  }
  // Scouting LoL : analyses des joueurs demandés (le drafter et la fiche adversaire relisent jusqu'à ce qu'elles soient prêtes)
  if (url.searchParams.get('type') === 'scout') {
    const region = (url.searchParams.get('region') ?? 'euw').replace(/[^a-z]/g, '').slice(0, 6) || 'euw';
    const ids = (url.searchParams.get('ids') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => x.includes('#')).slice(0, 10);
    const list = ids.length ? await rows<{ ident: string; name: string | null; status: string; data: string | null; error: string | null; done_at: number | null }>(
      `SELECT ident, name, status, data, error, done_at FROM scout_lol WHERE region = ? AND ident IN (${ids.map(() => '?').join(',')})`, region, ...ids).catch(() => []) : [];
    const out = list.map((x) => ({ ident: x.ident, name: x.name, status: x.status, error: x.error, at: x.done_at, data: x.data ? JSON.parse(String(x.data)) : null }));
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  if (url.searchParams.get('type') === 'lv') {
    const id = Number(url.searchParams.get('id'));
    const map = (url.searchParams.get('map') ?? '').slice(0, 30), agent = (url.searchParams.get('agent') ?? '').replace(/\W/g, '').slice(0, 30);
    const v = await lv(id ? `one:${id}` : `list:${map}:${agent}`, () => (id ? lvOne(id) : lvList(map, agent))).catch(() => null);
    return new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=600' } });
  }
  const roster = Number(url.searchParams.get('roster'));
  if (!canSee(t.me, roster)) return new Response('[]', { status: 403 });
  const type = url.searchParams.get('type');
  const names = `LEFT JOIN guild_members g ON g.id = x.author`;
  const data = type === 'lineups'
    ? await rows(`SELECT x.*, g.name AS author_name FROM lineups x ${names} WHERE x.roster_id = ? ORDER BY x.at DESC`, roster)
    : await rows(`SELECT x.id, x.title, x.data, x.at, x.author, g.name AS author_name FROM drafts x ${names} WHERE x.roster_id = ? ORDER BY x.at DESC LIMIT 50`, roster);
  return new Response(JSON.stringify({ me: t.user.id, staff: canLead(t.me, roster), items: data }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
};
