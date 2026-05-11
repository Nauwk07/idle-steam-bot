import pino from "pino";

import type { AppConfig } from "./config";

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type AppLogger = ReturnType<typeof createLogger>;
