// Drafter LoL : draft dans l’ordre de tournoi, fearless, analyse lolalytics (côté navigateur).
// Sorti de lol.astro (refacto du 06/10/2026) : chargé par <script src="./lol.client.ts">.
type Champ = { id: string; key: string; name: string; tags: string[]; info: { attack: number; defense: number; magic: number; difficulty: number }; sprite: [string, number, number] };
type PoolPlayer = { name: string; poste: string | null; champs: Record<string, { g: number; w: number; vs: Record<string, [number, number]> }> };
type Side = 'blue' | 'red';
// Ordre de draft de tournoi : 3 bans chacun, 6 picks, 2 bans chacun, 4 picks
const ORDER: [Side, 'ban' | 'pick', number][] = [
  ['blue', 'ban', 0], ['red', 'ban', 0], ['blue', 'ban', 1], ['red', 'ban', 1], ['blue', 'ban', 2], ['red', 'ban', 2],
  ['blue', 'pick', 0], ['red', 'pick', 0], ['red', 'pick', 1], ['blue', 'pick', 1], ['blue', 'pick', 2], ['red', 'pick', 2],
  ['red', 'ban', 3], ['blue', 'ban', 3], ['red', 'ban', 4], ['blue', 'ban', 4],
  ['red', 'pick', 3], ['blue', 'pick', 3], ['blue', 'pick', 4], ['red', 'pick', 4],
];
const root = document.querySelector<HTMLElement>('[data-drafter]')!;
const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
let version = '';
let champs: Champ[] = [];
let steps: (string | null)[] = []; // champion choisi à chaque étape (null = pas de ban)
let locked = new Set<string>();    // fearless : champions des parties précédentes
let tag = '';
// Préparation : notre côté, rôle / note / variantes par pick, bans proposés, plan de jeu
let ours: Side = 'blue', mode: 'draft' | 'plan' | 'variant' = 'draft', slot: number | null = null;
// opp / region : l'équipe d'en face analysée (gardée avec le draft)
let prep: { roles: Record<number, string>; notes: Record<number, string>; variants: Record<number, string[]>; bans: string[]; plan: string; opp?: string[]; region?: string } = { roles: {}, notes: {}, variants: {}, bans: [], plan: '' };
const pool: PoolPlayer[] = JSON.parse(root.dataset.pool || '[]');
const faced: Record<string, [number, number]> = JSON.parse(root.dataset.faced || '{}');
const pct = (w: number, g: number) => `${Math.round((w / g) * 100)} %`;

// ---------- Équipe d'en face (scouting par Oni Bot, table scout_lol) ----------
type ScoutData = { name: string; solo: { tier: string; rank: string; lp: number; wins: number; losses: number } | null; games: number; main: string | null; roles: Record<string, number>;
  champs: { c: string; g: number; w: number; k: number; d: number; a: number }[]; mastery: { key: string; lvl: number; pts: number }[] };
type Scout = { ident: string; name: string | null; status: string; error: string | null; at: number | null; data: ScoutData | null };
type OppChamp = { g: number; w: number; pts: number; lvl: number };
type OppPlayer = { name: string; main: string | null; lane: string | null; pool: Map<string, OppChamp> };
let scouts: Scout[] = [];
const TIER_FR: Record<string, string> = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand maître', CHALLENGER: 'Challenger' };
const cid = (c: string) => champs.find((x) => x.id.toLowerCase() === c.toLowerCase())?.id ?? null;
const kpts = (n: number) => (n >= 1e6 ? `${num(n / 1e6)} M` : `${Math.round(n / 1000)} k`);
/** Joueurs analysés : champions des dernières classées et maîtrise, rapportés aux identifiants Data Dragon. */
function oppPlayers(): OppPlayer[] {
  return scouts.filter((s) => s.data).map((s) => {
    const d = s.data!, pool = new Map<string, OppChamp>();
    for (const c of d.champs) { const id = cid(c.c); if (id) pool.set(id, { g: c.g, w: c.w, pts: 0, lvl: 0 }); }
    for (const m of d.mastery) { const id = champs.find((x) => x.key === m.key)?.id; if (!id) continue; const x = pool.get(id) ?? { g: 0, w: 0, pts: 0, lvl: 0 }; x.pts = m.pts; x.lvl = m.lvl; pool.set(id, x); }
    return { name: d.name.split('#')[0], main: d.main, lane: d.main ? ROLE_LANE[d.main] ?? null : null, pool };
  });
}
/** Poids d'un champion dans le jeu d'un adversaire : parties récentes, réussite, maîtrise. */
const oppWeight = (c: OppChamp) => Math.min(c.g, 8) * .35 + (c.g >= 3 ? (c.w / c.g - .5) * 3 : 0) + (c.pts >= 50_000 ? Math.log10(c.pts / 50_000) * 1.5 + .5 : 0);
const oppWhy = (p: OppPlayer, c: OppChamp) => [c.g ? `${c.g} partie${c.g > 1 ? 's' : ''}, ${pct(c.w, c.g)}` : '', c.pts ? `maîtrise ${kpts(c.pts)}` : ''].filter(Boolean).join(', ');
/** Le joueur d'en face qui joue le plus ce champion. */
function oppOwner(id: string) {
  let best: { p: OppPlayer; c: OppChamp; w: number } | null = null;
  for (const p of oppPlayers()) { const c = p.pool.get(id); if (c && (!best || oppWeight(c) > best.w)) best = { p, c, w: oppWeight(c) }; }
  return best;
}
const oppIds = () => $<HTMLTextAreaElement>('[data-opp]').value.split(/[\n,]+/).map((x) => x.trim()).filter((x) => /^.{3,}#.{2,5}$/.test(x)).slice(0, 10);
let scoutTimer = 0;
async function loadScouts(poll = 0) {
  clearTimeout(scoutTimer);
  const ids = oppIds(), region = $<HTMLSelectElement>('[data-opp-region]').value;
  prep.opp = ids; prep.region = region;
  if (!ids.length) { scouts = []; renderOpp(); render(); return; }
  const r = await getJSON(`/api/equipe/outils?type=scout&region=${region}&ids=${encodeURIComponent(ids.map((x) => x.toLowerCase()).join(','))}`);
  scouts = Array.isArray(r) ? r : [];
  renderOpp(); render();
  // Analyses en attente : on relit toutes les 20 s, 10 minutes au plus
  if (scouts.some((s) => s.status === 'attente' || s.status === 'cours') && poll < 30) scoutTimer = window.setTimeout(() => loadScouts(poll + 1), 20_000);
}
function renderOpp() {
  const ids = oppIds(), list = $('[data-opp-list]'), used = new Set([...steps.filter(Boolean) as string[], ...locked]);
  const region = $<HTMLSelectElement>('[data-opp-region]').value;
  if (!ids.length) { list.innerHTML = '<li class="eq-note">Aucun adversaire analysé pour ce draft.</li>'; $('[data-opp-status]').textContent = ''; return; }
  const waiting = scouts.filter((s) => s.status === 'attente' || s.status === 'cours').length, missing = ids.filter((i) => !scouts.some((s) => s.ident === i.toLowerCase())).length;
  $('[data-opp-status]').textContent = missing ? `${missing} joueur${missing > 1 ? 's' : ''} pas encore analysé${missing > 1 ? 's' : ''} : bouton « Analyser ».` : waiting ? `Analyse en cours (${waiting}) : Oni Bot s'en occupe, la page se met à jour seule.` : '';
  list.innerHTML = ids.map((i) => {
    const s = scouts.find((x) => x.ident === i.toLowerCase());
    const op = `https://www.op.gg/summoners/${region}/${encodeURIComponent(i.replace('#', '-'))}`;
    if (!s || !s.data) return `<li class="dr-oc is-wait"><header><strong>${esc(i)}</strong><small>${!s ? 'Pas encore demandé' : s.status === 'erreur' ? esc(s.error ?? 'Analyse impossible') : 'Analyse en cours…'}</small></header><a href="${op}" target="_blank" rel="noopener">op.gg</a></li>`;
    const d = s.data, solo = d.solo;
    const rank = solo ? `${TIER_FR[solo.tier] ?? solo.tier}${['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(solo.tier) ? '' : ` ${solo.rank}`} · ${solo.lp} LP · ${pct(solo.wins, solo.wins + solo.losses)}` : 'Non classé en solo';
    const roles = Object.entries(d.roles).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ');
    const top = d.champs.slice(0, 6).map((c) => { const id = cid(c.c); return id ? `<span class="${used.has(id) ? 'is-gone' : ''}" title="${esc(name(id))} : ${c.g} partie${c.g > 1 ? 's' : ''}, ${pct(c.w, c.g)}, KDA ${num((c.k + c.a) / Math.max(1, c.d))}"><img src="${icon(id)}" alt="${esc(name(id))}" width="32" height="32" />${c.g} · ${pct(c.w, c.g)}</span>` : ''; }).join('');
    const mast = d.mastery.slice(0, 3).map((m) => { const c = champs.find((x) => x.key === m.key); return c ? `${esc(c.name)} ${kpts(m.pts)}` : ''; }).filter(Boolean).join(' · ');
    return `<li class="dr-oc"><header><strong>${esc(d.name)}</strong><small>${d.main ? `${esc(d.main)} · ` : ''}${esc(rank)}</small><small>${d.games} classées récentes${roles ? ` (${esc(roles)})` : ''}</small></header>
      ${top ? `<div class="dr-oc__champs">${top}</div>` : '<p class="eq-note">Aucune classée récente.</p>'}${mast ? `<p class="dr-oc__mast">Maîtrise : ${mast}</p>` : ''}<a href="${op}" target="_blank" rel="noopener">op.gg</a></li>`;
  }).join('');
}
const POSTE_ROLE: Record<string, string> = { Top: 'Top', Jungle: 'Jungle', Mid: 'Mid', ADC: 'ADC', Support: 'Support' };
const icon = (id: string) => `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${id}.png`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const state = () => {
  const s = { blue: { ban: Array(5).fill(null), pick: Array(5).fill(null) }, red: { ban: Array(5).fill(null), pick: Array(5).fill(null) } } as Record<Side, Record<'ban' | 'pick', (string | null)[]>>;
  steps.forEach((c, i) => { const [side, kind, n] = ORDER[i]; s[side][kind][n] = c; });
  return s;
};
const name = (id: string | null) => champs.find((c) => c.id === id)?.name ?? '';

function render() {
  const s = state();
  const cur = ORDER[steps.length];
  for (const side of ['blue', 'red'] as Side[]) {
    $(`[data-bans="${side}"]`).innerHTML = s[side].ban.map((c, n) => {
      const active = cur && cur[0] === side && cur[1] === 'ban' && cur[2] === n;
      return `<li class="${active ? 'is-active' : ''}">${c ? `<img src="${icon(c)}" alt="${esc(name(c))}" width="40" height="40" />` : ''}</li>`;
    }).join('');
    $(`[data-picks="${side}"]`).innerHTML = s[side].pick.map((c, n) => {
      const active = cur && cur[0] === side && cur[1] === 'pick' && cur[2] === n;
      const mine = side === ours, extra = mine ? `${prep.roles[n] ? `<em>${esc(prep.roles[n])}</em>` : ''}${prep.variants[n]?.length ? `<small>+${prep.variants[n].length} variante${prep.variants[n].length > 1 ? 's' : ''}</small>` : ''}` : '';
      const inner = c ? `<img src="${icon(c)}" alt="" width="56" height="56" /><span>${esc(name(c))}${extra}</span>` : `<span class="dr-empty">${side === 'blue' ? 'B' : 'R'}${n + 1}${extra}</span>`;
      return `<li class="${active ? 'is-active' : ''}${mine ? ' is-mine' : ''}${mine && slot === n ? ' is-slot' : ''}">${mine ? `<button type="button" data-slot="${n}">${inner}</button>` : inner}</li>`;
    }).join('');
  }
  $('[data-step]').textContent = cur ? `${cur[0] === 'blue' ? 'Bleu' : 'Rouge'} · ${cur[1] === 'ban' ? 'ban' : 'pick'} ${cur[2] + 1}` : 'Draft terminé';
  const used = new Set(steps.filter(Boolean) as string[]);
  const q = ($<HTMLInputElement>('[data-search]').value || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  $('[data-grid]').innerHTML = champs
    .filter((c) => (!tag || c.tags.includes(tag)) && (!q || c.name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q)))
    .map((c) => {
      const off = used.has(c.id) || locked.has(c.id);
      return `<li><button type="button" data-champ="${c.id}" ${mode === 'draft' && (off || !cur) ? 'disabled' : ''} title="${esc(c.name)}"><i class="dr-spr dr-spr--${c.id}"></i><span>${esc(c.name)}</span></button></li>`;
    }).join('');
  const l = $('[data-locked]');
  l.hidden = !locked.size;
  l.textContent = locked.size ? `Fearless : ${locked.size} champions déjà joués dans la série sont bloqués.` : '';
  $<HTMLInputElement>('[data-json]').value = JSON.stringify({ steps, locked: [...locked], v: version, ours, prep });
  renderPrep(s); renderRead(s); renderLL(s);
}

// ---------- Analyse lolalytics (Émeraude+, patch en cours) ----------
type LLMeta = { patch: string; avgWr: number; lanes: Record<string, Record<string, number[]>> };
type LLChamp = { wr: number; vs: Record<string, Record<string, number[]>>; team: Record<string, Record<string, number[]>> };
type Placed = { id: string; lane: string; d: LLChamp | null };
type Rate = { wr: number; n: number; d1: number };
const LANES = ['top', 'jungle', 'middle', 'bottom', 'support'];
const LANE_FR: Record<string, string> = { top: 'Top', jungle: 'Jungle', middle: 'Mid', bottom: 'ADC', support: 'Support' };
const ROLE_LANE: Record<string, string> = { Top: 'top', Jungle: 'jungle', Mid: 'middle', ADC: 'bottom', Support: 'support' };
const N_MIN = 100; // en dessous, un matchup ou une synergie n'est pas assez joué pour compter
const slugOf = (id: string) => (id === 'MonkeyKing' ? 'wukong' : id.toLowerCase());
const keyOf = (id: string) => champ(id)?.key ?? '';
const byKey = (k: string) => champs.find((c) => c.key === k);
const num = (x: number, d = 1) => x.toFixed(d).replace('.', ',');
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${num(Math.abs(x))}`;
const games = (n: number) => `${n.toLocaleString('fr-FR')} parties`;
const getJSON = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
let metaP: Promise<LLMeta | null> | null = null;
const meta = () => (metaP ??= getJSON('/api/equipe/outils?type=ll'));
const cMemo = new Map<string, Promise<LLChamp | null>>();
const llc = (id: string, lane: string) => { const k = `${id}:${lane}`; if (!cMemo.has(k)) cMemo.set(k, getJSON(`/api/equipe/outils?type=ll&v=2&c=${slugOf(id)}&lane=${lane}`)); return cMemo.get(k)!; };
const laneStat = (m: LLMeta, id: string, lane: string) => m.lanes[lane]?.[keyOf(id)];

// Postes : on respecte les rôles donnés à nos picks, sinon la répartition la plus probable (part des parties de chaque champion par poste)
function assign(ids: (string | null)[], fixed: Record<number, string>, m: LLMeta) {
  const slots = ids.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  let best: Record<number, string> = {}, bestScore = -1;
  const cur: Record<number, string> = {}, taken = new Set<string>();
  const rec = (k: number, sc: number) => {
    if (k === slots.length) { if (sc > bestScore) { bestScore = sc; best = { ...cur }; } return; }
    const i = slots[k], f = fixed[i] ? ROLE_LANE[fixed[i]] : null;
    for (const l of f && !taken.has(f) ? [f] : LANES) {
      if (taken.has(l)) continue;
      taken.add(l); cur[i] = l;
      rec(k + 1, sc + (l === f ? 1000 : 0) + (laneStat(m, ids[i]!, l)?.[6] ?? 0));
      taken.delete(l); delete cur[i];
    }
  };
  rec(0, 0);
  return best;
}
// Notre champion a contre leur champion b, vu de chez nous ; à défaut, l'inverse de leurs données
const vsOf = (a: Placed, b: Placed): Rate | null => {
  const x = a.d?.vs[b.lane]?.[keyOf(b.id)]; if (x && x[1] >= N_MIN) return { wr: x[0], n: x[1], d1: x[2] };
  const y = b.d?.vs[a.lane]?.[keyOf(a.id)]; if (y && y[1] >= N_MIN) return { wr: 100 - y[0], n: y[1], d1: -y[2] };
  return null;
};
const synOf = (a: Placed, b: Placed): Rate | null => {
  const x = a.d?.team[b.lane]?.[keyOf(b.id)] ?? b.d?.team[a.lane]?.[keyOf(a.id)];
  return x && x[1] >= N_MIN ? { wr: x[0], n: x[1], d1: x[2] } : null;
};
const face = (id: string) => `<img src="${icon(id)}" alt="" width="24" height="24" />${esc(name(id))}`;
const tone = (d: number) => (d >= 1 ? 'is-good' : d <= -1 ? 'is-bad' : '');
// Une ligne « champion · séparateur · champion · écart (taux) », le détail au survol
const row = (a: Placed, sep: string, b: Placed, r: Rate, cls: string, lanes = true) => `<li class="ll-row ${cls}" title="${esc(`${name(a.id)} ${sep} ${name(b.id)} : ${num(r.wr)} % de victoires sur ${games(r.n)}, ${signed(r.d1)} pt par rapport à l'attendu`)}">
  <span class="ll-c"><img src="${icon(a.id)}" alt="" width="28" height="28" /><span>${esc(name(a.id))}${lanes ? `<i>${LANE_FR[a.lane]}</i>` : ''}</span></span><span class="ll-sep">${sep}</span>
  <span class="ll-c"><img src="${icon(b.id)}" alt="" width="28" height="28" /><span>${esc(name(b.id))}${lanes ? `<i>${LANE_FR[b.lane]}</i>` : ''}</span></span>
  <span class="ll-v"><b>${signed(r.d1)}</b><small>${num(r.wr)} %</small></span></li>`;
const pickBtn = (id: string, why: string, label: string) => `<button type="button" data-champ="${id}" title="${esc(why)}"><img src="${icon(id)}" alt="" width="36" height="36" /><span>${esc(name(id))}</span><small>${esc(label)}</small></button>`;

let llTok = 0;
async function renderLL(s: ReturnType<typeof state>) {
  const tok = ++llTok, box = $('[data-ll]');
  const theirSide: Side = ours === 'blue' ? 'red' : 'blue';
  const m: LLMeta | null = await meta();
  if (tok !== llTok) return;
  if (!m) { box.innerHTML = '<p class="eq-note">Données lolalytics indisponibles pour le moment.</p>'; advise(s, [], oppBans(new Set([...steps.filter(Boolean) as string[], ...locked]), null)); return; }
  const usLane = assign(s[ours].pick, prep.roles, m), themLane = assign(s[theirSide].pick, {}, m);
  const place = (ids: (string | null)[], lanes: Record<number, string>): Placed[] => ids.flatMap((id, i) => (id && lanes[i] ? [{ id, lane: lanes[i], d: null }] : []));
  const us = place(s[ours].pick, usLane), them = place(s[theirSide].pick, themLane);
  // Probables en face : pour chaque poste qu'ils n'ont pas encore rempli, les 2 champions favoris du joueur analysé à ce poste
  const usedNow = new Set([...steps.filter(Boolean) as string[], ...locked]);
  const pred: (Placed & { who: string; wgt: number })[] = [];
  for (const p of oppPlayers()) {
    if (!p.lane || them.some((x) => x.lane === p.lane)) continue;
    const fav = [...p.pool.entries()].filter(([id, c]) => c.g && !usedNow.has(id)).sort((a, b) => oppWeight(b[1]) - oppWeight(a[1])).slice(0, 2);
    const tot = fav.reduce((t, [, c]) => t + c.g, 0) || 1;
    for (const [id, c] of fav) pred.push({ id, lane: p.lane, d: null, who: p.name, wgt: c.g / tot });
  }
  if (us.length + them.length && !box.innerHTML) box.innerHTML = '<p class="eq-note">Chargement des données lolalytics…</p>';
  await Promise.all([...us, ...them, ...pred].map(async (p) => { p.d = await llc(p.id, p.lane); }));
  if (tok !== llTok) return;

  const avg = m.avgWr, used = new Set([...steps.filter(Boolean) as string[], ...locked]);
  const power = (p: Placed) => { const st = laneStat(m, p.id, p.lane); return st && st[5] >= 500 ? st[1] - avg : 0; };
  const usOpen = LANES.filter((l) => !us.some((p) => p.lane === l)), themOpen = LANES.filter((l) => !them.some((p) => p.lane === l));
  const cards: string[] = [];

  // Postes déduits (et champions flex, qui cachent leur poste)
  const laneRow = (list: Placed[], who: string) => `<tr><th scope="row">${who}</th>${LANES.map((l) => {
    const p = list.find((x) => x.lane === l); if (!p) return '<td><span class="ll-empty"></span></td>';
    const flex = LANES.filter((o) => o !== l && (laneStat(m, p.id, o)?.[6] ?? 0) >= 20).map((o) => LANE_FR[o]);
    return `<td><img src="${icon(p.id)}" alt="" width="40" height="40" /><span>${esc(name(p.id))}</span>${flex.length ? `<small title="Joué aussi ${flex.join(', ')} par plus de 20 % des joueurs">flex ${flex.join('/')}</small>` : ''}</td>`;
  }).join('')}</tr>`;
  if (us.length + them.length) cards.push(`<section class="ll-wide"><h4>Postes</h4><table class="ll-lanes"><thead><tr><th></th>${LANES.map((l) => `<th scope="col">${LANE_FR[l]}</th>`).join('')}</tr></thead><tbody>${laneRow(us, 'Nous')}${laneRow(them, 'Eux')}</tbody></table><p class="eq-note">Pour nous, le rôle donné dans la préparation, sinon le poste le plus joué. Pour eux, la répartition la plus probable : un champion « flex » peut cacher son vrai poste.</p></section>`);

  // Matchups : lane contre lane, puis menaces et atouts hors lane (ganks, roams, combats)
  const lane: string[] = [], cross: { a: Placed; b: Placed; r: Rate }[] = [];
  let sMatch = 0;
  for (const a of us) for (const b of them) {
    const r = vsOf(a, b); if (!r) continue;
    sMatch += r.d1 / 2;
    if (a.lane === b.lane) lane.push(row(a, 'vs', b, r, tone(r.d1), false).replace('<span class="ll-sep">vs</span>', `<span class="ll-sep">${LANE_FR[a.lane]}</span>`));
    else cross.push({ a, b, r });
  }
  if (lane.length) cards.push(`<section><h4>Matchups de lane</h4><ul class="ll-rows">${lane.join('')}</ul></section>`);
  const threats = cross.filter((x) => x.r.d1 <= -1.5).sort((x, y) => x.r.d1 - y.r.d1).slice(0, 4);
  const edges = cross.filter((x) => x.r.d1 >= 1.5).sort((x, y) => y.r.d1 - x.r.d1).slice(0, 4);
  if (threats.length || edges.length) cards.push(`<section><h4>Hors lane</h4><ul class="ll-rows">${[...threats, ...edges].map((x) => row(x.a, 'vs', x.b, x.r, tone(x.r.d1))).join('')}</ul><p class="eq-note">Quand ces deux champions se retrouvent dans la même partie à des postes différents : ganks, roams, combats d'équipe.</p></section>`);

  // Synergies des deux côtés
  const pairs = (list: Placed[]) => list.flatMap((a, i) => list.slice(i + 1).map((b) => ({ a, b, r: synOf(a, b) }))).filter((x): x is { a: Placed; b: Placed; r: Rate } => !!x.r);
  const sUs = pairs(us).sort((x, y) => y.r.d1 - x.r.d1), sThem = pairs(them);
  const sSyn = (sUs.reduce((t, x) => t + x.r.d1, 0) - sThem.reduce((t, x) => t + x.r.d1, 0)) / 2;
  const synThem = sThem.filter((x) => x.r.d1 >= 1).sort((x, y) => y.r.d1 - x.r.d1).slice(0, 3);
  const synMain = sUs.filter((x) => Math.abs(x.r.d1) >= 1), synFlat = sUs.filter((x) => Math.abs(x.r.d1) < 1);
  if (sUs.length || synThem.length) cards.push(`<section><h4>Synergies</h4>${sUs.length ? `<p class="dr-sub">Nos paires</p>${synMain.length ? `<ul class="ll-rows">${synMain.map((x) => row(x.a, '+', x.b, x.r, tone(x.r.d1))).join('')}</ul>` : ''}${synFlat.length ? `<p class="ll-flat">Neutres (moins d'1 pt) : ${synFlat.map((x) => `${esc(name(x.a.id))} + ${esc(name(x.b.id))}`).join(' · ')}</p>` : ''}` : ''}${synThem.length ? `<p class="dr-sub">Leurs paires fortes</p><ul class="ll-rows">${synThem.map((x) => row(x.a, '+', x.b, x.r, 'is-bad')).join('')}</ul>` : ''}</section>`);

  // Nos picks encore contrables : leur adversaire direct n'est pas encore choisi
  const risk = us.filter((p) => themOpen.includes(p.lane)).map((p) => {
    const c = Object.entries(p.d?.vs[p.lane] ?? {}).filter(([k, r]) => r[1] >= 2 * N_MIN && r[0] < 47.5 && (m.lanes[p.lane]?.[k]?.[6] ?? 0) >= 8 && byKey(k) && !used.has(byKey(k)!.id)).sort((x, y) => x[1][0] - y[1][0]).slice(0, 4);
    return c.length ? `<li class="ll-row"><span class="ll-c">${face(p.id)}</span> <span class="ll-sep">peut tomber sur</span> ${c.map(([k, r]) => `<span class="ll-tag">${esc(byKey(k)!.name)} ${num(r[0])} %</span>`).join(' ')}</li>` : '';
  }).filter(Boolean);
  if (risk.length) cards.push(`<section><h4>Encore contrables</h4><ul class="ll-rows ll-risk">${risk.join('')}</ul><p class="eq-note">Leur adversaire direct n'est pas encore choisi : candidats au ban, ou pick à garder pour plus tard dans la draft.</p></section>`);

  // Picks conseillés pour nos postes libres : force sur le patch, matchups contre leurs picks, synergies avec les nôtres, maîtrise du joueur
  let bestPicks: { id: string; sc: number; L: string; why: string[] }[] = [];
  if (us.length < 5 && steps.length < ORDER.length) {
    const rows = usOpen.map((L) => {
      const player = pool.find((pl) => pl.poste && ROLE_LANE[POSTE_ROLE[pl.poste] ?? ''] === L);
      const cand = new Set(Object.entries(m.lanes[L] ?? {}).filter(([, st]) => st[2] >= .8 && st[6] >= 10).map(([k]) => byKey(k)?.id).filter(Boolean) as string[]);
      Object.keys(player?.champs ?? {}).forEach((id) => champ(id) && cand.add(id));
      const scored = [...cand].filter((id) => !used.has(id)).map((id) => {
        const st = m.lanes[L]?.[keyOf(id)], why: string[] = [];
        let sc = st && st[5] >= 500 ? st[1] - avg : -1;
        for (const b of them) { const y = b.d?.vs[L]?.[keyOf(id)]; if (y && y[1] >= N_MIN) { sc -= y[2] / 2; if (Math.abs(y[2]) >= 1.5) why.push(`${signed(-y[2])} contre ${name(b.id)}`); } }
        for (const a of us) { const x = a.d?.team[L]?.[keyOf(id)]; if (x && x[1] >= N_MIN) { sc += x[2] / 2; if (x[2] >= 1.5) why.push(`duo avec ${name(a.id)} ${signed(x[2])}`); } }
        const mine = player?.champs[id];
        if (mine && mine.g >= 3) { sc += Math.min(mine.g, 20) / 10 + (mine.w / mine.g - .5) * 4; why.unshift(`${player!.name} : ${mine.g} parties, ${pct(mine.w, mine.g)}`); }
        // Nos propres parties : ce champion contre leur pick de la même lane
        for (const b of them.filter((x) => x.lane === L)) {
          const v = mine?.vs?.[b.id];
          if (v && v[0] >= 2) { sc += (v[1] / v[0] - .5) * Math.min(v[0], 6) / 2; why.push(`chez nous contre ${name(b.id)} : ${v[0]} parties, ${pct(v[1], v[0])}`); }
        }
        // Leur joueur de cette lane n'a pas encore choisi : matchups contre ses champions favoris (scouting)
        for (const b of pred.filter((x) => x.lane === L)) {
          const y = b.d?.vs[L]?.[keyOf(id)];
          if (y && y[1] >= N_MIN) { sc -= (y[2] / 2) * b.wgt; if (Math.abs(y[2]) >= 1.5) why.push(`${signed(-y[2])} contre ${name(b.id)} (favori de ${b.who})`); }
        }
        return { id, sc, why };
      }).sort((a, b) => b.sc - a.sc).slice(0, 6);
      bestPicks.push(...scored.map((x) => ({ ...x, L })));
      return scored.length ? `<li><strong>${LANE_FR[L]}</strong>${player ? ` <small>${esc(player.name)}</small>` : ''}<span>${scored.map((x) => pickBtn(x.id, x.why.join(' · ') || 'Fort sur le patch à ce poste', signed(x.sc))).join('')}</span></li>` : '';
    }).filter(Boolean);
    if (rows.length) cards.push(`<section class="ll-wide"><h4>Picks conseillés par poste libre</h4><ul class="ll-picks">${rows.join('')}</ul><p class="eq-note">Score = force du champion à ce poste sur le patch + matchups contre leurs picks + synergies avec les nôtres + maîtrise de notre joueur (parties classées relevées par Oni Bot). Survole un champion pour le détail, un clic le choisit.</p></section>`);
  }

  // Bans conseillés : forts et disputés dans leurs postes encore libres, dangereux pour nos picks, ou en synergie avec les leurs
  const bansLeft = ORDER.slice(steps.length).some(([side, kind]) => side === ours && kind === 'ban');
  let banTop: { id: string; why: string; lane: string }[] = [];
  if (bansLeft && themOpen.length) {
    const cand = new Map<string, { sc: number; why: string[]; lane: string }>();
    for (const L of themOpen) for (const [k, st] of Object.entries(m.lanes[L] ?? {})) {
      const c = byKey(k); if (!c || used.has(c.id) || st[2] < .8 || st[6] < 10) continue;
      const why: string[] = [];
      let sc = (st[1] - avg) + st[4] / 8;
      if (st[0] && st[0] <= 3) why.push(`${['', 'S+', 'S', 'S-'][st[0]]} ${LANE_FR[L]} sur le patch`);
      if (st[3] >= 10) why.push(`banni dans ${num(st[3], 0)} % des parties`);
      for (const a of us) { const x = a.d?.vs[L]?.[k]; if (x && x[1] >= N_MIN && x[2] < 0) { sc -= x[2]; if (x[2] <= -1.5) why.push(`contre ${name(a.id)} : ${num(x[0])} % pour nous`); } }
      for (const b of them) { const y = b.d?.team[L]?.[k]; if (y && y[1] >= N_MIN && y[2] > 0) { sc += y[2] / 2; if (y[2] >= 1.5) why.push(`duo avec leur ${name(b.id)}`); } }
      const prev = cand.get(c.id); if (!prev || prev.sc < sc) cand.set(c.id, { sc, why, lane: L });
    }
    // Scouting : les champions favoris de leurs joueurs dont le poste est encore libre
    for (const [id, x] of oppBans(used, themOpen)) {
      const prev = cand.get(id);
      // Un champion de confort se bannit même s'il est moyen sur le patch : pas de malus lolalytics, poste du joueur
      if (prev) { prev.sc = Math.max(prev.sc, 0) + x.sc * 1.5; prev.why.unshift(x.why); prev.lane = x.lane; }
      else { const st = m.lanes[x.lane]?.[keyOf(id)]; cand.set(id, { sc: x.sc * 1.5 + (st && st[5] >= 500 ? Math.max(0, st[1] - avg) : 0), why: [x.why], lane: x.lane }); }
    }
    const top = [...cand.entries()].sort((a, b) => b[1].sc - a[1].sc).slice(0, 8);
    banTop = top.map(([id, x]) => ({ id, why: x.why.join(' · '), lane: x.lane }));
    const closed = LANES.filter((l) => !themOpen.includes(l)).map((l) => LANE_FR[l]);
    if (top.length) cards.push(`<section class="ll-wide"><h4>Bans conseillés</h4><div class="ll-bans">${top.map(([id, x]) => pickBtn(id, `${LANE_FR[x.lane]} · ${x.why.join(' · ') || 'fort et souvent choisi sur le patch'}`, LANE_FR[x.lane])).join('')}</div><p class="eq-note">Forts et disputés sur le patch, menaces pour nos picks, ou en synergie avec les leurs.${closed.length ? ` Inutile de bannir pour ${closed.join(', ')} : ils ont déjà leur pick.` : ''} Un clic bannit si c'est notre tour, ou l'ajoute aux bans proposés en mode « Ban proposé ».</p></section>`);
  }

  // Estimation globale : somme des écarts (force sur le patch, matchups, synergies), indicative
  let head = '';
  if (us.length && them.length) {
    const sForce = us.reduce((t, p) => t + power(p), 0) - them.reduce((t, p) => t + power(p), 0);
    const est = Math.max(30, Math.min(70, 50 + sForce + sMatch + sSyn));
    head = `<div class="ll-score ${est >= 51 ? 'is-good' : est <= 49 ? 'is-bad' : ''}"><b>${num(est)} %</b><span>estimation pour nous<small>force des champions ${signed(sForce)} · matchups ${signed(sMatch)} · synergies ${signed(sSyn)}</small></span></div>`;
  }
  advise(s, bestPicks, banTop, pred);
  box.innerHTML = cards.length ? `<div class="ll-top"><div><p class="dr-sub">Analyse lolalytics · patch ${esc(m.patch)} · Émeraude+ · Solo/Duo</p><p class="ll-legend">En gros : l'écart en points par rapport au taux de victoire attendu. En dessous : le taux réel. Détail au survol.</p></div>${head}</div><div class="ll-grid">${cards.join('')}</div><p class="eq-note">Données <a href="https://lolalytics.com/" rel="noopener" target="_blank">lolalytics</a>, mises à jour toutes les 12 h. Les écarts (pt) comparent au taux attendu d'après les deux champions. L'estimation additionne ces écarts (matchups et synergies comptés à moitié) : elle situe une draft, elle ne prédit pas un match, surtout entre équipes organisées.</p>` : '';
}

/** Bans ciblés d'après le scouting seul : favoris de leurs joueurs aux postes encore libres (lanes = null : tous). */
function oppBans(used: Set<string>, lanes: string[] | null) {
  const out = new Map<string, { sc: number; why: string; lane: string }>();
  for (const p of oppPlayers()) {
    if (lanes && p.lane && !lanes.includes(p.lane)) continue;
    for (const [id, c] of p.pool) {
      if (used.has(id) || (!c.g && c.pts < 100_000)) continue;
      const sc = oppWeight(c); if (sc < 1.2) continue;
      const prev = out.get(id);
      if (!prev || prev.sc < sc) out.set(id, { sc, why: `favori de ${p.name}${p.main ? ` (${p.main})` : ''} : ${oppWhy(p, c)}`, lane: p.lane ?? 'middle' });
    }
  }
  return [...out.entries()].sort((a, b) => b[1].sc - a[1].sc).slice(0, 8);
}
/** Conseil du moment, sous l'étape : quoi bannir ou choisir maintenant, ou à quoi s'attendre quand c'est à eux. */
function advise(s: ReturnType<typeof state>, picks: { id: string; sc: number; L: string; why: string[] }[], bans: { id: string; why: string; lane: string }[] | [string, { why: string; lane: string }][], pred: { id: string; who: string; lane: string }[] = []) {
  const box = $('[data-advice]'), cur = ORDER[steps.length];
  if (!cur) { box.innerHTML = ''; return; }
  const bl = (bans as any[]).map((b) => (Array.isArray(b) ? { id: b[0], why: b[1].why, lane: b[1].lane } : b)) as { id: string; why: string; lane: string }[];
  const btn = (id: string, why: string, small: string) => `<button type="button" data-champ="${id}" title="${esc(why)}"><img src="${icon(id)}" alt="" width="28" height="28" />${esc(name(id))}${small ? ` <small>${esc(small)}</small>` : ''}</button>`;
  if (cur[0] === ours && cur[1] === 'ban' && bl.length) { box.innerHTML = `<p><b>À nous de bannir</b>${bl.slice(0, 3).map((b) => btn(b.id, b.why, LANE_FR[b.lane] ?? '')).join('')}</p>`; return; }
  if (cur[0] === ours && cur[1] === 'pick' && picks.length) {
    const seen = new Set<string>(), best = [...picks].sort((a, b) => b.sc - a.sc).filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, 3);
    box.innerHTML = `<p><b>À nous de choisir</b>${best.map((x) => btn(x.id, x.why.join(' · ') || 'Fort sur le patch à ce poste', LANE_FR[x.L])).join('')}</p>`; return;
  }
  if (cur[0] !== ours && pred.length) {
    const left = pred.filter((x) => !s[cur[0]].pick.includes(x.id)).slice(0, 4);
    box.innerHTML = left.length ? `<p class="is-them"><b>À eux</b>probables : ${left.map((x) => `${esc(name(x.id))} (${esc(x.who)})`).join(', ')}</p>` : ''; return;
  }
  box.innerHTML = '';
}

// ---------- Préparation ----------
const chip = (id: string, attr: string) => `<li><img src="${icon(id)}" alt="" width="28" height="28" />${esc(name(id))}<button type="button" ${attr}="${id}" aria-label="Retirer ${esc(name(id))}">×</button></li>`;
function renderPrep(s: ReturnType<typeof state>) {
  root.querySelectorAll('[data-ours]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.ours === ours)));
  root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.mode === mode)));
  $<HTMLButtonElement>('[data-mode="variant"]').disabled = slot === null;
  $('[data-plan-bans]').innerHTML = prep.bans.length ? prep.bans.map((c) => chip(c, 'data-rm-plan')).join('') : '<li class="eq-note">Aucun pour l\'instant.</li>';
  if (document.activeElement !== $('[data-plan-notes]')) $<HTMLTextAreaElement>('[data-plan-notes]').value = prep.plan;
  $('[data-slot-empty]').hidden = slot !== null; $('[data-slot-body]').hidden = slot === null;
  if (slot === null) return;
  const c = s[ours].pick[slot];
  $('[data-slot-title]').textContent = `${ours === 'blue' ? 'B' : 'R'}${slot + 1}${c ? ` · ${name(c)}` : ' · pas encore choisi'}`;
  $<HTMLSelectElement>('[data-slot-role]').value = prep.roles[slot] ?? '';
  if (document.activeElement !== $('[data-slot-note]')) $<HTMLTextAreaElement>('[data-slot-note]').value = prep.notes[slot] ?? '';
  const v = prep.variants[slot] ?? [];
  $('[data-slot-variants]').innerHTML = v.length ? v.map((x) => chip(x, 'data-rm-variant')).join('') : '<li class="eq-note">Aucune variante.</li>';
}

// ---------- Lecture des compos (données Riot + nos parties) ----------
const champ = (id: string | null) => champs.find((c) => c.id === id);
function profile(ids: string[]) {
  const cs = ids.map(champ).filter(Boolean) as Champ[];
  const ap = cs.reduce((a, c) => a + c.info.magic, 0), ad = cs.reduce((a, c) => a + c.info.attack, 0);
  const front = cs.filter((c) => c.tags.includes('Tank') || (c.tags.includes('Fighter') && c.info.defense >= 5)).length;
  const engage = cs.filter((c) => c.tags.includes('Tank')).length;
  const picks = cs.filter((c) => c.tags.includes('Assassin')).length;
  const range = cs.filter((c) => c.tags.includes('Marksman') || (c.tags.includes('Mage') && c.info.defense <= 3)).length;
  const diff = cs.length ? cs.reduce((a, c) => a + c.info.difficulty, 0) / cs.length : 0;
  return { cs, apShare: ap + ad ? ap / (ap + ad) : 0, front, engage, picks, range, diff };
}
function renderRead(s: ReturnType<typeof state>) {
  for (const side of ['blue', 'red'] as Side[]) {
    const ids = s[side].pick.filter(Boolean) as string[];
    const p = profile(ids), box = $(`[data-read="${side}"]`);
    if (!ids.length) { box.innerHTML = `<h4 class="is-${side}">${side === 'blue' ? 'Bleu' : 'Rouge'}${side === ours ? ' (nous)' : ''}</h4><p class="eq-note">Pas encore de pick.</p>`; continue; }
    const warn: string[] = [];
    if (ids.length >= 3 && p.apShare < .25) warn.push('Presque tout en dégâts physiques : une armure suffit à les gêner.');
    if (ids.length >= 3 && p.apShare > .75) warn.push('Presque tout en dégâts magiques : la résistance magique suffit.');
    if (ids.length >= 4 && !p.front) warn.push('Aucune ligne de front : personne pour encaisser en combat.');
    if (ids.length >= 4 && !p.engage) warn.push('Pas d\'engage clair : il faudra un autre moyen de lancer les combats.');
    if (p.diff >= 7) warn.push(`Compo exigeante (difficulté moyenne ${p.diff.toFixed(1)}/10).`);
    // Nos picks : qui les a joués récemment ?
    const best = (id: string) => pool.map((pl) => ({ pl, c: pl.champs[id] })).filter((x) => x.c).sort((a, b) => b.c.g - a.c.g)[0];
    const unknown = side === ours ? ids.filter((id) => !best(id)) : [];
    const mineNotes = side === ours ? ids.filter((id) => best(id)).map((id) => {
      const who = best(id)!;
      return `<li><img src="${icon(id)}" alt="" width="24" height="24" />${esc(name(id))} · ${esc(who.pl.name)} : ${who.c.g} partie${who.c.g > 1 ? 's' : ''}, ${Math.round((who.c.w / who.c.g) * 100)} %</li>`;
    }).join('') + (unknown.length ? `<li class="is-warn"><span class="dr-icons">${unknown.map((id) => `<img src="${icon(id)}" alt="${esc(name(id))}" title="${esc(name(id))}" width="24" height="24" />`).join('')}</span>${unknown.length > 1 ? 'jamais joués' : 'jamais joué'} en classé par nos joueurs ces 90 jours</li>` : '') : '';
    // Leurs picks : qui les joue en face (scouting) ; un champion absent de leurs pools peut être une surprise préparée
    const theirs = side !== ours && scouts.some((x) => x.data) ? ids.map((id) => {
      const o = oppOwner(id);
      return o ? `<li><img src="${icon(id)}" alt="" width="24" height="24" />${esc(name(id))} · ${esc(o.p.name)}${o.p.main ? ` (${esc(o.p.main)})` : ''} : ${esc(oppWhy(o.p, o.c))}</li>`
        : `<li class="is-warn"><img src="${icon(id)}" alt="" width="24" height="24" />${esc(name(id))} : absent de leurs dernières classées, pick préparé ou joueur hors liste</li>`;
    }).join('') : '';
    const other = s[side === 'blue' ? 'red' : 'blue'].pick.filter(Boolean) as string[];
    const matchups = side === ours ? ids.flatMap((id) => pool.flatMap((pl) => other.filter((o) => pl.champs[id]?.vs?.[o]).map((o) => {
      const [g, w] = pl.champs[id].vs[o];
      return `<li><img src="${icon(id)}" alt="" width="24" height="24" />${esc(name(id))} contre <img src="${icon(o)}" alt="" width="24" height="24" />${esc(name(o))} · ${esc(pl.name)} : ${g} partie${g > 1 ? 's' : ''}, ${pct(w, g)}</li>`;
    }))).join('') : ids.filter((id) => faced[id]).map((id) => {
      const [g, w] = faced[id];
      return `<li class="${w / g < .45 ? 'is-warn' : ''}"><img src="${icon(id)}" alt="" width="24" height="24" />${esc(name(id))} en face : ${g} partie${g > 1 ? 's' : ''}, ${pct(w, g)} de victoires pour nous</li>`;
    }).join('');
    box.innerHTML = `<h4 class="is-${side}">${side === 'blue' ? 'Bleu' : 'Rouge'}${side === ours ? ' (nous)' : ''}</h4>
      <div class="dr-dmg" title="Part des dégâts magiques"><span style="width:${Math.round((1 - p.apShare) * 100)}%">Physique ${Math.round((1 - p.apShare) * 100)} %</span><span style="width:${Math.round(p.apShare * 100)}%">Magique ${Math.round(p.apShare * 100)} %</span></div>
      <ul class="dr-stats"><li><b>${p.front}</b> ligne de front</li><li><b>${p.engage}</b> engage</li><li><b>${p.picks}</b> assassin${p.picks > 1 ? 's' : ''}</li><li><b>${p.range}</b> à distance</li></ul>
      ${warn.length ? `<ul class="dr-warn">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>` : '<p class="dr-ok">Rien d\'alarmant dans l\'équilibre de la compo.</p>'}
      ${mineNotes ? `<ul class="dr-who">${mineNotes}</ul>` : ''}
      ${theirs ? `<p class="dr-sub">Qui le joue en face</p><ul class="dr-who">${theirs}</ul>` : ''}
      ${matchups ? `<p class="dr-sub">${side === ours ? 'Nos matchups déjà joués' : 'Quand on les a eus en face'}</p><ul class="dr-who">${matchups}</ul>` : ''}`;
  }
  // Suggestions pour notre prochain pick : les champions de nos joueurs dont le rôle n'est pas encore couvert
  const cur = ORDER[steps.length], sug = $('[data-suggest]');
  if (!cur || cur[0] !== ours || cur[1] !== 'pick' || !pool.length) { sug.innerHTML = ''; return; }
  const used = new Set([...steps.filter(Boolean) as string[], ...locked]);
  const taken = new Set(Object.entries(prep.roles).filter(([n]) => s[ours].pick[Number(n)]).map(([, r]) => r));
  const rows2 = pool.filter((pl) => !pl.poste || !taken.has(POSTE_ROLE[pl.poste] ?? '')).map((pl) => {
    const top = Object.entries(pl.champs).filter(([id]) => !used.has(id) && champ(id)).sort((a, b) => b[1].g - a[1].g || b[1].w / b[1].g - a[1].w / a[1].g).slice(0, 5);
    return top.length ? `<li><strong>${esc(pl.name)}</strong>${pl.poste ? ` <small>${esc(pl.poste)}</small>` : ''}<span>${top.map(([id, c]) => `<button type="button" data-champ="${id}" title="${c.g} parties, ${Math.round((c.w / c.g) * 100)} % de victoires"><img src="${icon(id)}" alt="" width="36" height="36" /><small>${c.g} · ${Math.round((c.w / c.g) * 100)} %</small></button>`).join('')}</span></li>` : '';
  }).filter(Boolean);
  sug.innerHTML = rows2.length ? `<h4>À nous de choisir : ce que nos joueurs maîtrisent</h4><ul>${rows2.join('')}</ul>` : '';
}

root.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const sl = t.closest<HTMLElement>('[data-slot]');
  if (sl) { slot = slot === Number(sl.dataset.slot) ? null : Number(sl.dataset.slot); if (slot === null && mode === 'variant') mode = 'draft'; render(); return; }
  const rp = t.closest<HTMLElement>('[data-rm-plan]'); if (rp) { prep.bans = prep.bans.filter((x) => x !== rp.dataset.rmPlan); render(); return; }
  const rv = t.closest<HTMLElement>('[data-rm-variant]'); if (rv && slot !== null) { prep.variants[slot] = (prep.variants[slot] ?? []).filter((x) => x !== rv.dataset.rmVariant); render(); return; }
  const b = t.closest<HTMLButtonElement>('[data-champ]');
  if (!b) return;
  const id = b.dataset.champ!;
  if (mode === 'plan') { if (!prep.bans.includes(id)) prep.bans.push(id); render(); return; }
  if (mode === 'variant' && slot !== null) { const v = (prep.variants[slot] ??= []); if (!v.includes(id)) v.push(id); render(); return; }
  if (steps.length < ORDER.length) { steps.push(id); render(); }
});
$('[data-undo]').addEventListener('click', () => { steps.pop(); render(); });
$('[data-reset]').addEventListener('click', () => { steps = []; locked.clear(); slot = null; prep = { roles: {}, notes: {}, variants: {}, bans: [], plan: '' }; render(); });
$('[data-next-game]').addEventListener('click', () => {
  const s = state();
  [...s.blue.pick, ...s.red.pick].forEach((c) => c && locked.add(c));
  steps = []; render();
});
$('[data-search]').addEventListener('input', render);
root.querySelectorAll<HTMLElement>('[data-ours]').forEach((b) => b.addEventListener('click', () => { ours = b.dataset.ours as Side; slot = null; render(); }));
root.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode as typeof mode; render(); }));
$('[data-slot-role]').addEventListener('change', (e) => { if (slot !== null) { prep.roles[slot] = (e.target as HTMLSelectElement).value; render(); } });
$('[data-slot-note]').addEventListener('input', (e) => { if (slot !== null) { prep.notes[slot] = (e.target as HTMLTextAreaElement).value; $<HTMLInputElement>('[data-json]').value = JSON.stringify({ steps, locked: [...locked], v: version, ours, prep }); } });
$('[data-plan-notes]').addEventListener('input', (e) => { prep.plan = (e.target as HTMLTextAreaElement).value; $<HTMLInputElement>('[data-json]').value = JSON.stringify({ steps, locked: [...locked], v: version, ours, prep }); });
$('[data-tags]').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tag]'); if (!b) return;
  tag = b.dataset.tag!; root.querySelectorAll('[data-tag]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render();
});
$('[data-opp-go]').addEventListener('click', () => {
  const ids = oppIds();
  if (ids.length) window.open(`https://www.op.gg/multisearch/${$<HTMLSelectElement>('[data-opp-region]').value}?summoners=${encodeURIComponent(ids.join(','))}`, '_blank', 'noopener');
});
// Analyser : la demande part à Oni Bot (action « scout »), puis la page relit les résultats
$('[data-opp-scan]').addEventListener('click', async () => {
  const ids = oppIds(), b = $<HTMLButtonElement>('[data-opp-scan]');
  if (!ids.length) { $('[data-opp-status]').textContent = 'Aucun Riot ID valide (format Pseudo#TAG).'; return; }
  b.disabled = true;
  const f = new FormData(); f.set('action', 'scout'); f.set('ids', ids.join('\n')); f.set('region', $<HTMLSelectElement>('[data-opp-region]').value); f.set('back', '/equipe/lol/');
  await fetch('/api/equipe/outils', { method: 'POST', body: f }).catch(() => null);
  b.disabled = false;
  loadScouts();
});
root.querySelector('[data-opp-fiche]')?.addEventListener('change', (e) => { const v = (e.target as HTMLSelectElement).value; if (v) { $<HTMLTextAreaElement>('[data-opp]').value = v; loadScouts(); } });
$('[data-opp]').addEventListener('change', () => loadScouts());
$('[data-opp-region]').addEventListener('change', () => loadScouts());
$('[data-save]').addEventListener('submit', (e) => { if (!steps.length && !prep.bans.length && !prep.plan) { e.preventDefault(); alert('Le draft est vide.'); } });

// Drafts sauvegardés du roster
async function loadSaved() {
  const sel = $<HTMLSelectElement>('[data-roster-select]');
  if (!sel?.value) return;
  const d = await fetch(`/api/equipe/outils?type=drafts&roster=${sel.value}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const list = $('[data-saved]');
  if (!d?.items?.length) { list.innerHTML = '<li class="eq-note">Aucun draft gardé pour ce roster.</li>'; return; }
  list.innerHTML = d.items.map((x: any) => `<li><button type="button" class="dr-load" data-load='${esc(x.data)}'>${esc(x.title)}</button>
    <span class="eq-note">${esc(x.author_name ?? '')} · ${new Date(Number(x.at)).toLocaleDateString('fr-FR')}</span>
    ${x.author === d.me || d.staff ? `<form method="post" action="/api/equipe/outils"><input type="hidden" name="action" value="suppr" /><input type="hidden" name="table" value="drafts" /><input type="hidden" name="id" value="${x.id}" /><input type="hidden" name="back" value="/equipe/lol/${location.search}" /><button class="dr-del" aria-label="Supprimer">×</button></form>` : ''}</li>`).join('');
}
$('[data-saved]').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-load]'); if (!b) return;
  try {
    const d = JSON.parse(b.dataset.load!); steps = d.steps ?? []; locked = new Set(d.locked ?? []); ours = d.ours ?? 'blue'; prep = { roles: {}, notes: {}, variants: {}, bans: [], plan: '', ...(d.prep ?? {}) }; slot = null;
    // Équipe d'en face gardée avec le draft
    if (prep.opp?.length) { $<HTMLTextAreaElement>('[data-opp]').value = prep.opp.join('\n'); if (prep.region) $<HTMLSelectElement>('[data-opp-region]').value = prep.region; loadScouts(); }
    render(); window.scrollTo({ top: root.offsetTop - 120, behavior: 'smooth' });
  } catch {}
});
root.querySelector('[data-roster-select]')?.addEventListener('change', loadSaved);

// Data Dragon : dernière version, champions en français
(async () => {
  version = (await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json()))[0];
  const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`).then((r) => r.json());
  // Grille : planches d'icônes de Data Dragon (6 images de 48 px pour 170 champions) au lieu d'une image par champion
  champs = Object.values<any>(data.data).map((c) => ({ id: c.id, key: c.key, name: c.name, tags: c.tags, info: c.info, sprite: [c.image.sprite, c.image.x, c.image.y] as [string, number, number] })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  // Une règle par champion, écrite une fois (la grille, redessinée à chaque choix, ne porte qu'une classe)
  const css = document.createElement('style');
  css.textContent = champs.map((c) => `.dr-spr--${c.id}{background-image:url(https://ddragon.leagueoflegends.com/cdn/${version}/img/sprite/${c.sprite[0]});background-position:-${c.sprite[1]}px -${c.sprite[2]}px}`).join('');
  document.head.append(css);
  render(); loadSaved();
  if (oppIds().length) loadScouts();
})().catch(() => { $('[data-step]').textContent = 'Impossible de charger les champions (Data Dragon). Réessaie plus tard.'; });

export {};
