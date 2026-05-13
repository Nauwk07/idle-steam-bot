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
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().length(64, "ENCRYPTION_KEY doit faire 64 caractères hex (32 bytes)"),
  LOG_LEVEL: z.string().default("info"),
  DRY_RUN: booleanFromEnv,
  STEAM_PLAY_SCAN_INTERVAL_SECONDS: numberFromEnv.default(300),
  LOG_DIR: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const parsed = envSchema.parse(process.env);

  if (parsed.LOG_DIR) {
    mkdirSync(resolve(parsed.LOG_DIR), { recursive: true });
  }

  return {
    discord: {
      token: parsed.DISCORD_TOKEN,
      ownerId: parsed.DISCORD_OWNER_ID,
      guildId: parsed.DISCORD_GUILD_ID,
    },
    databaseUrl: parsed.DATABASE_URL,
    encryptionKey: parsed.ENCRYPTION_KEY,
    steam: {
      playScanIntervalMs: Math.max(60, parsed.STEAM_PLAY_SCAN_INTERVAL_SECONDS ?? 300) * 1000,
    },
    logLevel: parsed.LOG_LEVEL,
    logDir: parsed.LOG_DIR ? resolve(parsed.LOG_DIR) : undefined,
    dryRun: parsed.DRY_RUN,
  };
}
