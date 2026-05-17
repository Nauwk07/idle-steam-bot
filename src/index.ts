import { loadConfig } from "./config";
import { createDiscordClient, DiscordBot } from "./bot/discord";
import { initDatabase, closeDatabase } from "./db/index";
import {
  AuditRepository,
  GuildConfigRepository,
  UserAccountRepository,
  UserEventsRepository,
  UserGamesRepository,
} from "./db/repositories";
import { createLogger } from "./logger";
import { LogChannelService } from "./services/logChannel";
import { UserIdleManager } from "./services/userIdleManager";

const config = loadConfig();
const logger = createLogger(config);

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — arrêt");
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string, idleManager: UserIdleManager) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "Arrêt demandé, drainage en cours");

  const timeout = setTimeout(() => {
    logger.warn("Shutdown trop long, exit forcé");
    process.exit(1);
  }, 8_000);

  try { await idleManager.stopAll(signal); } catch (err) { logger.warn({ err }, "Erreur stopAll"); }
  try { await closeDatabase(); } catch (err) { logger.warn({ err }, "Erreur closeDatabase"); }

  clearTimeout(timeout);
  process.exit(0);
}

async function main() {
  initDatabase(config.databaseUrl);
  logger.info("Base de données connectée");

  const accounts = new UserAccountRepository();
  const games = new UserGamesRepository();
  const events = new UserEventsRepository();
  const audit = new AuditRepository();
  const guildConfig = new GuildConfigRepository();

  const discordClient = createDiscordClient();
  const logChannel = new LogChannelService(discordClient, config.discord.guildId, guildConfig, logger);
  const idleManager = new UserIdleManager(discordClient, config, accounts, games, events, logger);

  const bot = new DiscordBot(
    discordClient,
    config,
    idleManager,
    accounts,
    games,
    events,
    audit,
    guildConfig,
    logChannel,
    logger,
  );

  process.on("SIGINT", () => shutdown("SIGINT", idleManager));
  process.on("SIGTERM", () => shutdown("SIGTERM", idleManager));

  await bot.start();
}

main().catch((err) => {
  logger.fatal({ err }, "Impossible de démarrer le bot");
  process.exit(1);
});
