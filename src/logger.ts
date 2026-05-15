import pino from "pino";

import type { AppConfig } from "./config";

const isDev = process.env.NODE_ENV !== "production";

function sanitizeErr(err: unknown): unknown {
  if (!err || typeof err !== "object") return err;
  const e = err as Record<string, unknown>;
  const out: Record<string, unknown> = {
    type: (e.constructor as { name?: string } | undefined)?.name ?? e.name,
    message: e.message,
    code: e.code,
    status: e.status,
    stack: e.stack,
  };
  const reqBody = e.requestBody as { files?: Array<{ name?: string; data?: { data?: unknown[] } }> } | undefined;
  if (reqBody?.files) {
    out.files = reqBody.files.map((f) => ({
      name: f.name,
      size: Array.isArray(f.data?.data) ? f.data.data.length : undefined,
    }));
  }
  return out;
}

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: sanitizeErr, error: sanitizeErr },
    ...(isDev && {
      transport: { target: "pino-pretty", options: { colorize: true } },
    }),
  });
}

export type AppLogger = ReturnType<typeof createLogger>;
