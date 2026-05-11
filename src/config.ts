import "dotenv/config";

import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) return false;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const numberFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  });

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_OWNER_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  STEAM_USERNAME: z.string().min(1),
  STEAM_PASSWORD: z.string().min(1),
  DATABASE_PATH: z.string().default("./data/idle-steam.sqlite"),
  LOG_LEVEL: z.string().default("info"),
  DRY_RUN: booleanFromEnv,
  STEAM_PLAY_SCAN_INTERVAL_SECONDS: numberFromEnv.default(60),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const parsed = envSchema.parse(process.env);
  const databasePath = resolve(parsed.DATABASE_PATH);

  mkdirSync(dirname(databasePath), { recursive: true });

  return {
    discord: {
      token: parsed.DISCORD_TOKEN,
      ownerId: parsed.DISCORD_OWNER_ID,
      guildId: parsed.DISCORD_GUILD_ID,
    },
    steam: {
      username: parsed.STEAM_USERNAME,
      password: parsed.STEAM_PASSWORD,
      playScanIntervalMs: Math.max(
        15,
        parsed.STEAM_PLAY_SCAN_INTERVAL_SECONDS ?? 60,
      ) * 1000,
    },
    databasePath,
    logLevel: parsed.LOG_LEVEL,
    dryRun: parsed.DRY_RUN,
  };
}
