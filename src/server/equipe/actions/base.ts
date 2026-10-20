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
/** Riot ID trouvés dans un texte libre (« Pseudo#TAG », un par ligne ou séparés par des virgules), sans doublon, 10 au plus. */
export const riotIds = (v: unknown) => [...new Set([...String(v ?? '').matchAll(/([^\n,#]{3,22})#([\p{L}\p{N}]{2,5})/gu)]
  .map((m) => `${m[1].replace(/^[\s\-*·•:]+/, '').trim()}#${m[2]}`).filter((x) => x.split('#')[0].length >= 3))].slice(0, 10);
