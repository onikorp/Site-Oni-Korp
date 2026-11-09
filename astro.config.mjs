import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import node from '@astrojs/node';

// Hébergement : Vercel (VERCEL=1 fourni par la plateforme). Les pages restent statiques ;
// seules les routes /api/* tournent à la demande (lecture de la base Turso partagée avec Oni Bot).
// Sans Vercel (build local), le site est 100 % statique et l'API est absente.
const onVercel = !!process.env.VERCEL;
// En local, ONI_API=1 active aussi les routes serveur (test de l'espace équipe avec npm run dev)
const withApi = onVercel || !!process.env.ONI_API;
const api = {
  name: 'oni-api',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      if (!withApi) return;
      const route = (pattern, entrypoint) => injectRoute({ pattern, entrypoint, prerender: false });
      route('/api/agenda', './src/server/agenda.ts');
      route('/api/feed', './src/server/feed.ts');
      route('/api/createurs', './src/server/createurs.ts');
      route('/api/avatar', './src/server/avatar.ts');
      route('/api/club', './src/server/club.ts');
      route('/api/staff', './src/server/staff.ts');
      route('/api/sante', './src/server/sante.ts');
      route('/api/inhouse', './src/server/inhouse.ts');
      route('/api/contact', './src/server/contact.ts');
      route('/api/avis', './src/server/avis.ts');
      route('/agenda.ics', './src/server/ics.ts');
      route('/api/equipe/agenda.ics', './src/server/equipe/ics.ts');
      route('/api/auth/login', './src/server/auth/login.ts');
      route('/api/auth/callback', './src/server/auth/callback.ts');
      route('/api/auth/logout', './src/server/auth/logout.ts');
      route('/api/equipe/presence', './src/server/equipe/presence.ts');
      route('/api/equipe/dispos', './src/server/equipe/dispos.ts');
      route('/equipe', './src/server/equipe/accueil.astro');
      route('/equipe/planning', './src/server/equipe.astro');
      route('/sondage', './src/server/sondage.astro');
      route('/equipe/vue', './src/server/equipe/vue.astro');
      route('/equipe/contenu', './src/server/equipe/contenu.astro');
      route('/equipe/communaute', './src/server/equipe/communaute.astro');
      route('/equipe/tournois', './src/server/equipe/tournois.astro');
      route('/equipe/joueurs', './src/server/equipe/joueurs.astro');
      route('/equipe/notes', './src/server/equipe/notes.astro');
      route('/equipe/lol', './src/server/equipe/lol.astro');
      route('/equipe/valo', './src/server/equipe/valo.astro');
      route('/api/equipe/outils', './src/server/equipe/outils.ts');
      route('/equipe/tactique', './src/server/equipe/tactique.astro');
      route('/equipe/objectifs', './src/server/equipe/objectifs.astro');
      route('/equipe/stats', './src/server/equipe/mesures.astro');
      route('/equipe/osu', './src/server/equipe/osu.astro');
      route('/equipe/rl', './src/server/equipe/rl.astro');
      route('/equipe/packs', './src/server/equipe/packs.astro');
      route('/equipe/pools', './src/server/equipe/pools.astro');
      route('/equipe/tracker-lol', './src/server/equipe/lol-tracker.astro');
      route('/equipe/tracker-valo', './src/server/equipe/valo-tracker.astro');
      route('/equipe/tracker-osu', './src/server/equipe/osu-tracker.astro');
      route('/equipe/compos', './src/server/equipe/compos.astro');
      route('/api/rl/oni-sync', './src/server/equipe/rl-sync.ts');
      route('/api/rl/sync', './src/server/equipe/rl-sync.ts');
      route('/api/rl/replay', './src/server/equipe/rl-replay.ts');
      route('/equipe/setup', './src/server/equipe/setup.astro');
      route('/equipe/vod', './src/server/equipe/vod.astro');
      route('/equipe/docs', './src/server/equipe/docs.astro');
      route('/equipe/scouting', './src/server/equipe/scouting.astro');
      route('/equipe/match', './src/server/equipe/match.astro');
      route('/equipe/calendrier', './src/server/equipe/calendrier.astro');
      route('/equipe/profil', './src/server/equipe/profil.astro');
      route('/equipe/guide', './src/server/equipe/guide.astro');
      route('/api/equipe/tableau', './src/server/equipe/tableau-api.ts');
      route('/postuler', './src/server/recrutement/page.astro');
      route('/api/postuler', './src/server/recrutement/postuler.ts');
      route('/heberger', './src/server/heberger/page.astro');
      route('/api/heberger', './src/server/heberger/heberger.ts');
    },
  },
};

export default defineConfig({
  site: 'https://oni-korp.vercel.app',
  // ONI_NODE=1 : build de production servi en local (mesures Lighthouse de l'espace équipe, scripts/lighthouse-equipe.mjs)
  adapter: onVercel ? vercel() : process.env.ONI_NODE ? node({ mode: 'standalone' }) : undefined,
  // Sitemap : pages publiques seulement (Inside est privé, pages en noindex)
  integrations: [sitemap({ filter: (page) => !page.includes('/equipe/') && !page.includes('/mentions-legales/') }), api],
  // CSS du site (~15 Ko) intégré dans chaque page : supprime la requête bloquante
  build: { inlineStylesheets: 'always' },
});
