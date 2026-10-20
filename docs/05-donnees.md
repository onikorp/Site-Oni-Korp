# 05 · Données

Une seule base **Turso** (libSQL, compatible SQLite), partagée par le bot et le site. Pas d'ORM : des requêtes SQL simples, paramétrées (`?`).

- Les tables du **bot** sont créées au démarrage du bot (`oni-bot/src/store.ts`, `migrate()`, et les fonctions `tables()` de certains modules).
- Les tables du **site** sont créées au premier appel (`ensureTables()` dans `src/server/equipe/outils.ts`, et quelques fichiers d'API).
- On n'efface jamais une colonne ni une table « au cas où » : on en ajoute (`ALTER TABLE … ADD COLUMN`, entouré d'un `.catch(() => {})` pour ne pas échouer si elle existe déjà).
- Les champs JSON sont stockés en texte (`JSON.stringify`) ; les dates en millisecondes (`Date.now()`) ; les identifiants Discord en texte.
- Le bot sauvegarde toute la base chaque jour sur le serveur de coulisses (30 jours gardés) ; restauration avec `scripts/restaurer.mjs`.

Colonne « écrit » : qui crée les lignes. « Lit » : qui s'en sert.

## Membres, rôles, accès

| Table | Contenu | Écrit | Lit |
|---|---|---|---|
| `guild_members` | id, pseudo, avatar, rôles (JSON), date d'arrivée (`joined_at`) de chaque membre | bot (miroir) | site (accès, noms, avatars) |
| `guild_roles` | id, nom, couleur, position, permission admin | bot (miroir) | site (`access.ts`) |
| `user_keys` | sel du lien d'agenda, version de session (déconnexion partout) | site | site |
| `left_roles` | rôles d'un membre parti, rendus s'il revient | bot | bot |

## Rosters et organisation

| Table | Contenu | Écrit | Lit |
|---|---|---|---|
| `rosters` | slug, nom, jeu, rôle et salons Discord, archivé | bot (`/roster`) | les deux |
| `roster_postes` | poste de chaque joueur dans un roster | site | les deux |
| `roster_status` | titulaire, remplaçant ou essai (fin d'essai, retour écrit) | site | les deux |
| `trainings` | séances (date, durée, type, note, message Discord) | bot (`/entrainement`) | les deux |
| `attendance` | réponse de chacun à une séance (présent, peut-être, absent + raison) | les deux | les deux |
| `dispo_days` | disponibilités par jour (état, heure de début) | les deux | les deux |
| `dispo_type` | semaine type d'un joueur | site | site |
| `availability` | ancien format des disponibilités (plus utilisé, gardé) | — | — |
| `rl_replays` | replays envoyés par Oni Sync : fichier (effacé dès l'envoi à ballchasing), statut `attente` → `envoye` → `ok` / `echec` / `refuse`, identifiant ballchasing | site (réception), bot (envoi, analyse) | les deux |
| `voice_consent`, `voice_sessions`, `voice_lines` | écoute des scrims : accord de chaque joueur, écoutes (roster, adversaire, statut, doc du rapport), phrases transcrites (joueur, instant, durée, texte) | bot | site (via le doc) |
| `day_plan` | programme de chaque jour d'une semaine de roster (type, heure, qui l'a choisi) | site (Planning) | bot (message des dispos) |
| `matches` | matchs et scrims (adversaire, format, date, score, événement Discord) | bot (`/match`) | les deux |
| `match_notes` | notes de match des joueurs | site | site, bot |
| `match_stats`, `match_replays` | stats par joueur d'un match, replays à importer | bot | site |
| `goals` | objectifs (joueur ou roster, échéance, progression, `private` : visible du joueur et de l'encadrement) | site | site, bot |
| `docs` | docs du roster, du jeu ou du club (`level`, `game` ; `roster_id` nul hors roster) | site | site |
| `drafts` | drafts LoL sauvegardés | site | site |
| `lineups` | lineups Valorant (position, impact, vidéo) | site | site |
| `boards` | tableaux blancs (état complet en JSON ; `owner` : brouillon privé) | site | site |
| `pools` | pools des joueurs (champions LoL, agents Valorant) par niveau | site | site |
| `comps` | compos Valorant par carte | site | site |
| `rl_packs` | packs d'entraînement Rocket League (codes) | site | site |
| `carnet` | carnet perso de chacun (privé) | site | site |
| `opponents` | fiches de scouting | site | site |
| `vods`, `vod_marks` | VOD et repères horodatés | site | site |
| `setups` | réglages et matériel par joueur et par jeu | site | site |
| `osu_maps` | maps d'entraînement et défis osu! | site | les deux |
| `competitions` | tournois visés par un roster (inscription, statut, résultat) | site | les deux |

## Jeux et statistiques

| Table | Contenu | Écrit | Lit |
|---|---|---|---|
| `accounts` | comptes de jeu reliés (riot, rl, osu ; pseudo, région) | les deux (`/compte`, Inside > Joueurs) | les deux |
| `accounts_alt` | smurfs : comptes secondaires (riot, rl), plusieurs par joueur ; parties relevées au nom du joueur, sans courbe de rang | site (Inside > Joueurs, action `compte-alt`) | bot (trackers, debrief, ballchasing), site |
| `scout_lol` | joueurs adverses LoL à analyser, clé (Riot ID en minuscules, région) ; `status` attente → cours → ok ou erreur ; `data` JSON (rang, postes, champions récents, maîtrise) | site (action `scout`), bot (résultat) | site (drafter, Scouting) |
| `perf` | une ligne par partie jouée (JSON : résultat, stats). Id préfixé par la source (`rl:sync:…`, `rl:<replay>`…). Gardée 180 jours | bot (trackers), site (Oni Sync) | site, bot |
| `stats_cache` | dernières valeurs relevées (rang, profil, maps de la semaine…), clé texte (`lol:euw:pseudo`, `osu:pseudo`, `rl-ranks:pseudo`…) | bot | les deux |
| `rank_history` | un point par jour et par jeu (courbes). Gardé un an | bot | site |
| `rl_sync` | clé Oni Sync de chaque joueur, dernier envoi, dernière erreur | site | site |

## Inhouses et tournois

| Table | Contenu | Écrit | Lit |
|---|---|---|---|
| `inhouse_elo` | Elo par joueur, mode et saison (victoires, défaites, série, meilleur) | bot | les deux (page /inhouses) |
| `inhouse_matches` | parties (équipes, vainqueur, écart, vocaux, lobby, postes, partie osu! trouvée) | bot | les deux |
| `inhouse_prefs` | postes préférés en 5v5 | bot | bot |
| `tournaments`, `tourn_teams`, `tourn_matches` | tournois communautaires, équipes, tableau | bot | bot, site |

## Communauté, contenu, communication

| Table | Contenu | Écrit | Lit |
|---|---|---|---|
| `applications` | candidatures envoyées depuis le site (en attente → fil ouvert) | site | bot |
| `recruits` | suivi des recrues (début, fin, relances) | bot | bot, site |
| `tickets` | tickets de support | bot | bot |
| `contacts` | formulaire de contact et avis (« Un avis ? ») | site | bot (relais dans #staff) |
| `content_tasks` | tâches de contenu (brief de match, calendrier éditorial) | les deux | les deux |
| `metrics` | indicateurs de communication, un relevé par jour | bot | site |
| `consents` | accord d'image (vignette, clips) de chaque membre | site (Mon espace) | site (fiche de cast) |
| `staff_public` | qui apparaît sur la page Staff, avec sa phrase | site | site |
| `survey_answers` | réponses au sondage des membres | site | site |
| `creators` | créateurs de contenu (Twitch, YouTube) | bot | bot, site |
| `feed` | lives et vidéos (fil du site) | bot | site |
| `levels` | XP, messages, minutes de vocal | bot | bot |
| `warnings`, `sanctions` | avertissements et sanctions | bot | bot |
| `giveaways`, `birthdays`, `playlists`, `sounds`, `temp_voices` | fonctions communautaires du bot | bot | bot |
| `meta` | réglages internes (saison des inhouses, version publiée, files sauvegardées…) | bot | bot |

## Durées de conservation

Promises sur la page publique de confidentialité (`/mentions-legales/#confidentialite`) et tenues par `purgeOld()` dans `oni-bot/src/store.ts` (une fois par jour, après la sauvegarde). **Changer une durée = changer les deux.**

| Données | Durée |
|---|---|
| Membres et rôles (`guild_members`) | effacés quand la personne quitte le serveur |
| Disponibilités (`dispo_days`, `availability`) | 90 jours |
| Candidatures closes (`applications`), tickets fermés | 1 an |
| Messages de contact et avis (`contacts`) | 1 an ; empreinte d'adresse IP effacée après 48 h |
| Réponses au sondage (`survey_answers`) | 1 an |
| Parties (`perf`) | 6 mois |
| Historique de rang (`rank_history`) | 1 an |
| Cache des rangs et profils (`stats_cache`) | 30 jours (sauf identifiants techniques) |
| Avertissements et sanctions | 2 ans |
| Accord d'image (`consents`) | jusqu'au départ du serveur (ou retrait par la personne) |
| Sauvegardes de la base (serveur de coulisses) | 30 jours |
