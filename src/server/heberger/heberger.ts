// POST /api/heberger : une équipe extérieure demande un espace chez Oni Korp. Enregistrée dans la base ;
// Oni Bot crée l'espace du roster dans la minute (modules/hebergement.ts), sans intervention du staff.
import type { APIRoute } from 'astro';
import { currentSession, sameOrigin } from '../session';
import { exec, rows } from '../db';
import { JEUX } from '../recrutement/postuler';

export const TABLE = `CREATE TABLE IF NOT EXISTS hosting_requests (id INTEGER PRIMARY KEY, user_id TEXT, team TEXT, game TEXT, answers TEXT, created_at INTEGER, status TEXT DEFAULT 'attente', roster_id INTEGER, error TEXT, done_at INTEGER)`;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const user = await currentSession(cookies);
  if (!user || !sameOrigin(request)) return redirect('/heberger/');
  const f = await request.formData();
  const s = (k: string, max: number) => String(f.get(k) ?? '').trim().slice(0, max);
  const team = s('equipe', 30).replace(/\s+/g, ' '), game = s('jeu', 10);
  const answers = { joueurs: s('joueurs', 2), niveau: s('niveau', 200), age: s('age', 3), presentation: s('presentation', 1000), liens: s('liens', 300) };
  const valid = /^[\p{L}\p{N}][\p{L}\p{N} '’._-]{1,29}$/u.test(team) && game in JEUX && /^\d{1,2}$/.test(answers.joueurs)
    && answers.niveau && /^\d{1,2}$/.test(answers.age) && answers.presentation.length >= 20;
  if (!valid) return redirect('/heberger/?erreur=champs');
  if (Number(answers.age) < 18) return redirect('/heberger/?erreur=age');
  await exec(TABLE);
  // Une demande à la fois, et une équipe hébergée par personne
  const busy = await rows(`SELECT 1 FROM hosting_requests WHERE user_id = ? AND status IN ('attente', 'cours', 'ok')`, user.id);
  if (busy.length) return redirect('/heberger/');
  await exec('INSERT INTO hosting_requests (user_id, team, game, answers, created_at) VALUES (?,?,?,?,?)', user.id, team, game, JSON.stringify(answers), Date.now());
  return redirect('/heberger/?envoye=1');
};
