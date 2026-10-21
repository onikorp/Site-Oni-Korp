// Actions d'Inside · le contrat commun : ce que reçoit chaque action, et les petits outils de lecture du formulaire.
import type { AstroCookies } from 'astro';
import type { SessionUser } from '../../session';
import type { Access } from '../access';

export type Ctx = {
  f: FormData; action: string; back: string;
  user: SessionUser; me: Access; cookies: AstroCookies;
  redirect: (path: string) => Response;
  /** Peut voir ce roster (membre, capitaine, responsable du jeu, encadrement). */
  canRoster: (id: number) => boolean;
};
export type Action = (c: Ctx) => Promise<Response>;

/** Texte du formulaire, sans espaces autour, coupé à n caractères. */
export const clip = (v: FormDataEntryValue | null, n: number) => String(v ?? '').trim().slice(0, n);
/** Nombre entre 0 et 1 (position sur une carte), sinon null. */
export const num = (v: FormDataEntryValue | null) => { const x = Number(v); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null; };
export const GAMES_ACCOUNTS = ['riot', 'rl', 'osu'] as const;
/** Liens op.gg remplacés par les Riot ID qu'ils contiennent : multi (…/multisearch/euw?summoners=A%23EUW,B%23EUW)
 *  ou profil (…/summoners/euw/Pseudo-TAG). Le reste du texte est gardé tel quel. */
export const opggExpand = (v: unknown) => String(v ?? '').replace(/https?:\/\/(?:[\w-]+\.)?op\.gg\/\S+/gi, (u) => {
  // Découpé avant décodage : un pseudo peut contenir des espaces (%20 ou +)
  const dec = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
  const multi = u.match(/summoners=([^&#\s]+)/i);
  const list = multi ? dec(multi[1]).split(/[,\n]/) : (u.match(/\/summoners\/[a-z0-9]+\/([^/?#\s]+)/i)?.slice(1).map(dec) ?? []);
  return `\n${list.map((s) => (s.includes('#') ? s : s.replace(/-([^-]+)$/, '#$1')).trim()).join('\n')}\n`;
});
/** Région d'un lien op.gg (euw, eune, na, kr), sinon null. */
export const opggRegion = (v: unknown) => { const r = String(v ?? '').match(/op\.gg\/\S*?(?:multisearch|summoners)\/([a-z]{2,4})\b/i)?.[1]?.toLowerCase(); return r && ['euw', 'eune', 'na', 'kr'].includes(r) ? r : null; };
/** Riot ID trouvés dans un texte libre (« Pseudo#TAG », un par ligne ou séparés par des virgules, ou liens op.gg), sans doublon, 10 au plus. */
export const riotIds = (v: unknown) => [...new Set([...opggExpand(v).matchAll(/([^\n,#]{3,22})#([\p{L}\p{N}]{2,5})/gu)]
  .map((m) => `${m[1].replace(/^[\s\-*·•:]+/, '').trim()}#${m[2]}`).filter((x) => x.split('#')[0].length >= 3))].slice(0, 10);
