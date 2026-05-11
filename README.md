# Idle Steam Discord Bot

Bot Discord personnel pour piloter un idle Steam depuis un VPS.

## Fonctionnalités

- Whitelist stricte sur un seul `DISCORD_OWNER_ID`.
- Jeux persistés en SQLite, modifiables sans redémarrer le bot.
- Idle multi-jeux via `steam-user`.
- Steam Guard **toujours manuel** : modal Discord sur `/idle start` et `/idle restart`, ou saisie quand Steam redemande un code (auto-restart, etc.).
- Auto-restart activable/désactivable avec backoff.
- Notifications **uniquement en DM** vers le propriétaire.
- Logs stockés en SQLite et consultables via `/idle logs`.
- Dry-run pour tester Discord/SQLite sans connexion Steam.
- Standby manuel et standby automatique si Steam signale qu'une autre session joue déjà.

## Configuration

Copie `.env.example` vers `.env`, puis renseigne :

```env
DISCORD_TOKEN=
DISCORD_OWNER_ID=
DISCORD_GUILD_ID=

STEAM_USERNAME=
STEAM_PASSWORD=

DATABASE_PATH=./data/idle-steam.sqlite
LOG_LEVEL=info
DRY_RUN=false
STEAM_PLAY_SCAN_INTERVAL_SECONDS=60
```

Aucun salon Discord dédié : tout passe par les réponses aux commandes (éphémères) et les DM.

## Docker

L'application est prévue pour tourner en container gateway-only, sans port exposé.

Scripts disponibles :

- `docker:prod` build et démarre le container en arrière-plan.
- `docker:logs` suit les logs du container.
- `docker:down` arrête le stack.

Le compose utilise `.env` et force `DATABASE_PATH=/app/data/idle-steam.sqlite`. Le dossier local `./data` est monté en volume pour conserver SQLite entre les redémarrages.

Par défaut, le service tourne avec `PUID=1000` et `PGID=1000`, ce qui correspond à l'utilisateur Linux classique du VPS. Si ton dossier `data` appartient à un autre UID/GID, ajuste ces deux valeurs dans `.env`.

Le réseau Docker attendu est `main-gateway`, comme sur Jarvis. Si tu ne veux pas utiliser ce réseau externe, remplace la section `networks` du `docker-compose.yml` par un réseau Compose standard.

## Commandes Discord

`/info`  
Liste toutes les commandes.

`/idle start`  
Démarre l’idle. Hors dry-run, ouvre un modal pour le code Steam Guard si une connexion complète est nécessaire.

`/idle stop`  
Arrête l’idle et vide l'état "joue à".

`/idle restart`  
Redémarre l’idle ; hors dry-run, ouvre le modal Steam Guard (nouvelle session).

`/idle status`  
Affiche phase, connexion Steam, jeux actifs, standby, uptime, erreurs et prochaine relance.

`/idle doctor`  
Vérifie la config Discord/Steam, SQLite, les options runtime et l'état Steam.

`/idle logs limit:20`  
Affiche les derniers events SQLite. Maximum 50.

`/idle autorestart active:true|false`  
Active ou désactive la relance automatique après erreur/déconnexion Steam.

`/idle dry-run active:true|false`  
Active ou désactive le mode test sans connexion Steam. Si l'idle tourne déjà, redémarre-le pour appliquer le changement.

`/idle standby active:true|false`  
Met l'idle en pause ou reprend manuellement.

`/game search query:"portal"`  
Recherche les AppIDs sur le store Steam.

`/game add appid:620 name:"Portal 2"`  
Ajoute un jeu. Si l'idle tourne, la nouvelle liste est appliquée immédiatement.

`/game delete appid:620`  
Supprime le jeu de SQLite.

`/game list`  
Liste les jeux configurés.

Une demande de code Steam Guard (après auto-restart, etc.) expire après 5 minutes ; ouvre à nouveau le modal via `/idle start` ou `/idle restart`.

## Si tu lances un jeu toi-même

Le bot n'utilise jamais `force` dans `gamesPlayed`, donc il ne kick pas ta vraie session Steam.

Quand Steam répond qu'une autre session du même compte joue déjà, le bot passe en `standby`, vide sa liste d'idle, envoie une notification, puis reprobe toutes les `STEAM_PLAY_SCAN_INTERVAL_SECONDS`. Dès que Steam accepte à nouveau `gamesPlayed`, l'idle reprend.

Cette détection dépend de l'événement `playingState` de Steam. C'est le signal le plus propre disponible côté `steam-user`, mais Steam ne fournit pas une API officielle parfaite pour distinguer "je joue vraiment sur mon PC" de tous les cas possibles.
