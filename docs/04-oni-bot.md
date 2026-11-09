# 04 · Oni Bot

Le bot du club, seul bot « maison » du serveur (il a remplacé ASYLUM-BOT, Dyno, ProBot, Zoe, LunaBot, Green-bot, Tickets, Sharles…). Seuls les outils osu! spécialisés restent à côté (Bathbot, MissAnalyzer, osu!track). Dépôt privé `onikorp/oni-bot`, TypeScript + discord.js 14, hébergé chez Echo-Host.

## Comment il est construit

- `src/index.ts` : crée le client Discord, charge la liste des **modules**, enregistre leurs commandes sur le serveur et route les interactions vers le bon module.
- Un **module** (`src/module.ts`) = un nom, des commandes slash facultatives, et une fonction `setup(client)` qui branche ses écouteurs (`Events.MessageCreate`, `Events.InteractionCreate`, minuteries…). Ajouter une fonction = ajouter un module à la liste de `index.ts`.
- **Boutons et menus** : chaque module préfixe ses `customId` (`ih:` inhouses, `rec:` recrutement, `tk:` tickets, `tr:` tournois, `dp:` disponibilités, `cast:` casts, `ga:` giveaways, `son:` soundboard, `annonce:`, `contact:`…) et ne traite que les siens.
- `src/interactions.ts` : filet de sécurité. Si un module n'a pas répondu à une interaction en 2,2 s, elle est acquittée automatiquement (sinon Discord affiche « L'application ne répond plus »).
- `src/antispam.ts` : 2 s entre deux commandes par membre ; plus de 8 en 30 s → 5 min d'attente (le staff n'est pas limité).
- `src/config.ts` : **noms** des salons et des rôles (le bot les retrouve par leur nom), couleurs, émojis, adresse du site. Renommer un salon sur Discord sans changer `config.ts` casse le module concerné.
- `src/store.ts` : crée toutes les tables du bot au démarrage (`migrate()`) et donne des accès simples aux principales. Base Turso partagée avec le site ; sans `TURSO_*`, fichier local `DATA_DIR/oni.db`.
- `src/util.ts` : outils communs. Les plus utilisés : `mainGuild(client)` (le serveur du club, **jamais** `guilds.cache.first()`), `embed(couleur)`, `log(guild, …)` (journal rangé par fils dans le forum #📋・logs), `isStaff`, `canLeadRoster`, `ts()` (date Discord).
- **Deux serveurs** : le serveur du club (`GUILD_ID`) et le serveur de coulisses (`BACKUP_GUILD_ID`), terrain d'essai du bot. `index.ts` ignore tout événement qui ne vient pas du serveur du club. Le module `labo.ts` utilise les coulisses pour l'état du bot, les erreurs, les sauvegardes quotidiennes de la base et la **vitrine** (toutes les cartes image redessinées à chaque version).
- **Une seule instance** : au démarrage, le bot vérifie qu'il ne tourne pas déjà ailleurs (`sante.ts`) et refuse de démarrer sinon.

## Les modules

| Module | Ce qu'il fait |
|---|---|
| `accueil` | Arrivées (rôle Membre après le règlement, carte de bienvenue) et départs ; rend ses rôles à qui revient |
| `journal` | Journal de modération dans le forum #📋・logs, un fil par catégorie (messages, membres, rôles, modération…) |
| `miroir` | Recopie membres et rôles dans la base, pour qu'Inside sache qui est qui |
| `moderation` | `/avertir`, `/exclure`, `/bannir`, `/historique`, `/nettoyer`, `/lenteur`, `/verrouiller` (sanctions graduées) |
| `recrutement` | Panneau de candidature → formulaire → fil privé avec le staff du pôle ; candidatures du site ; relances |
| `recrues` | Accueil des recrues : message de bienvenue, étapes pour bien démarrer, suivi |
| `rosters` | `/roster` : chaque roster a son rôle et son espace (général, planning, replays, vocal) |
| `matchs` | `/match` : annonces, événements Discord, rappels, résultats, brief de match pour le pôle contenu |
| `planning` | `/entrainement`, `/dispos`, `/presences` : séances avec réponses à boutons, rappels, disponibilités |
| `suivi` | Relie les outils d'Inside à Discord (ce qu'on fait sur le site déclenche un message ou un rappel) |
| `inhouse` | Parties entre membres : files, appel « Prêt ? », groupes « Jouer ensemble », équilibrage Elo, vocaux, résultat (lu automatiquement sur osu!), cartes de fin, classement par saison. Découpé dans `modules/inhouse/` |
| `tournois` | Tournois communautaires à élimination directe (4 à 32 équipes), affiches |
| `stats` | `/stats` (carte de stats d'un joueur), `/compte` (relier ses comptes de jeu) |
| `hebergement` | Équipes extérieures hébergées : traite les demandes du site (`/heberger`) chaque minute, crée l'espace du roster (même fonction que `/roster creer`), donne au demandeur le rôle du roster et « Capitaine », accueil dans le salon de l'équipe, avis dans #staff sans mention. Garde-fous : présent sur le serveur, une équipe par personne, nom libre, 5 créations par 24 h |
| `trackers` | Relève rangs et parties (Riot, HenrikDev, osu!) pour Inside, smurfs compris (`accounts_alt`, sans courbe de rang). Analyse les joueurs adverses demandés par le drafter ou une fiche Scouting (`scout_lol`, toutes les minutes, un joueur à la fois, 1,5 s entre deux appels Riot) |
| `ballchasing` | Parties Rocket League présentes sur ballchasing.com, import des replays de match |
| `debrief` | Débrief automatique des matchs LoL (notes par joueur, repères) |
| `niveaux` | XP et niveaux (messages, vocal), `/rang`, `/niveaux` |
| `lives` | Lives et vidéos (statut Discord, API Twitch, RSS YouTube) → annonces et fil du site |
| `createurs` | Programme créateurs de contenu (suivi mensuel, récap) |
| `casts` | Planning des casts des matchs publics |
| `communaute` | Clip de la semaine, chiffres du serveur pour le site, messages du formulaire de contact et des avis |
| `indicateurs` | Relevé quotidien des indicateurs de communication (table `metrics`, lue par Inside > Contenu) |
| `escalade` | Rappels et escalade : l'outil repère ce qui traîne, une personne décide |
| `recap` | Le lundi à 10 h : les rendez-vous publics de la semaine dans #annonces |
| `bilan` | `/bilan` de la saison ; `periode:` ce mois-ci ou le mois dernier (staff) |
| `rapport` | Le 1er du mois à 10 h, bilan du mois écoulé dans #🔒・staff, avec « à regarder maintenant » |
| `tickets` | Tickets de support (fils privés), motifs (dont réexamen d'une sanction) |
| `extras` | Menu de rôles, giveaways, anniversaires, anti-raid, signalement des comptes récents |
| `vocaux` | Vocaux temporaires (« ➕ Créer un vocal ») |
| `radio`, `playlists`, `sons` | Radio du club, playlists, soundboard |
| `infos` | `/site`, `/aide`, `/agenda`, `/equipe` |
| `nouveautes` | Publie les notes de version (`changelog.ts`) au démarrage, `/nouveautes` |
| `sante` | Signal de vie lu par le site, erreurs, sauvegardes, instance unique |
| `labo` | Serveur de coulisses : état, contrôles quotidiens, vitrine des cartes |

## Les cartes image

Dessinées en SVG puis rendues en PNG avec resvg (`src/cards.ts`), polices dans `assets/fonts`, images dans `assets/img`. Trois gabarits :

- `poster()` (cards.ts) : bandeau noir, illustration du jeu à droite avec un seul bord en biais. Sert à `/stats`, aux affiches de tournoi et au débrief.
- `lineup()` (lineup.ts) : fin d'inhouse en 5v5, une colonne par joueur (champion, agent ou photo de profil plein cadre), chiffres dessous, place au classement avant → après.
- `versus()` (versus.ts) : fin d'inhouse RL et osu!, une bande par joueur (photo en dégradé à gauche).

Avant de changer une carte : `node scripts/preview-cartes.mjs <dossier>` pour la voir, `npm test` pour la non-régression. Toutes les cartes sont visibles d'un coup dans la vitrine des coulisses après chaque nouvelle version.

## Règle de discrétion (10/10/2026)

Des membres se sont plaints d'être relancés sans arrêt (« le bot me harcèle »), et le serveur a perdu 22 membres en une semaine. Depuis la version 2.54.0 :
- **En message privé, le bot n'envoie que l'essentiel** : une sanction de modération, le retour de fin d'essai, un seul message d'accueil quand une candidature est acceptée (sans relance), la réponse à un son proposé. **Aucune relance privée** : lier ses comptes, remplir ses dispos, choisir ses jeux, tâche en retard, merci.
- **Ce qui concerne le staff** (arrivées, retards, fins d'essai) va dans #🔒・staff, pas en privé.
- **Dans les salons** : une annonce par événement, pas la même dans plusieurs salons ; les mentions passent par les rôles « Notif … » choisis par les membres ; les niveaux ne sont annoncés qu'aux paliers.
- Avant d'ajouter un message automatique, se demander : qui le reçoit, combien de fois par semaine, et est-ce qu'il l'a demandé ?

## Ajouter une fonction au bot

1. Un fichier `src/modules/<nom>.ts` avec un en-tête qui dit ce qu'il fait, et `export const <nom>: Module = { name, commands?, setup? }`.
2. L'ajouter à la liste `modules` de `src/index.ts`.
3. Salons et rôles : par leur nom dans `config.ts`. S'ils n'existent pas encore, ils se créent avec un script `discord/` (Viktor l'applique), pas depuis le bot.
4. Nouvelle table : dans `migrate()` de `store.ts` (ou une fonction `tables()` du module), et dans [05 · Données](05-donnees.md).
5. Une entrée dans `changelog.ts`, `npm test`, push, redémarrage.

## Variables d'environnement

Noms seulement (les valeurs sont dans le `.env` du serveur, jamais dans un dépôt) :

| Variable | Pour |
|---|---|
| `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` | le bot et le serveur du club |
| `BACKUP_GUILD_ID` | le serveur de coulisses |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | la base partagée (sinon `DATA_DIR/oni.db`) |
| `PRESENCES` | `1` : lives détectés par le statut Discord (Presence Intent) |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_CHANNELS`, `YOUTUBE_CHANNELS` | lives et vidéos |
| `RIOT_API_KEY`, `HENRIK_API_KEY`, `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`, `BALLCHASING_TOKEN` | données des jeux |
| `RAPIDAPI_KEY`, `RAPIDAPI_DAILY` | rangs RL (service hors ligne depuis octobre 2026) |

Côté site (Vercel) : `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID` (connexion), `SESSION_SECRET` (signature des cookies), `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET` et `RIOT_API_KEY` facultatifs.

## Scripts utiles (`oni-bot/scripts/`)

| Script | Pour |
|---|---|
| `non-regression.mjs` | empreintes des cartes et de l'équilibrage (`npm test`) |
| `preview-cartes.mjs` | aperçu local des cartes d'inhouse et de `/stats` |
| `echo.mjs` | panneau Echo-Host : `etat`, `redemarrer`, `console [n]` (clé du panneau requise) |
| `restaurer.mjs` | restaurer une sauvegarde de la base (simulation par défaut, `--apply`) |
| `*-test.mjs` | essais ponctuels de modules (débrief, radio, tournoi…) |
