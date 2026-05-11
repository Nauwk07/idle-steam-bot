import { loadConfig } from "./config";
import { createDiscordClient, DiscordBot, DiscordNotifier } from "./bot/discord";
import { openDatabase } from "./db/database";
import {
  EventLogRepository,
  GamesRepository,
  SettingsRepository,
} from "./db/repositories";
import { createLogger } from "./logger";
import { SteamIdleService } from "./steam/steamIdleService";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = openDatabase(config.databasePath);

  const games = new GamesRepository(db);
  const settings = new SettingsRepository(db);
  const events = new EventLogRepository(db);
  const discordClient = createDiscordClient();
  const notifier = new DiscordNotifier(discordClient, config, logger);
  const idle = new SteamIdleService(
    config,
    games,
    settings,
    events,
    logger,
    notifier,
  );

  const bot = new DiscordBot(
    discordClient,
    config,
    idle,
    games,
    settings,
    events,
    logger,
  );

  process.on("SIGINT", () => shutdown("SIGINT", idle, db, logger));
  process.on("SIGTERM", () => shutdown("SIGTERM", idle, db, logger));

  await bot.start();
}

async function shutdown(
  signal: string,
  idle: SteamIdleService,
  db: ReturnType<typeof openDatabase>,
  logger: ReturnType<typeof createLogger>,
) {
  logger.info({ signal }, "Arrêt demandé");
  await idle.stop(signal);
  db.close();
  process.exit(0);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
