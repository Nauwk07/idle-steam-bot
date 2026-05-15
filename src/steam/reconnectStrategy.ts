export const RECONNECT_BACKOFF_SECONDS = [10, 30, 60, 300];
export const RECONNECT_MAX_DELAY_SECONDS = 900;
export const RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

export function reconnectDelayMs(attempt: number): number {
  const idx = Math.max(0, Math.min(attempt - 1, RECONNECT_BACKOFF_SECONDS.length - 1));
  const seconds = RECONNECT_BACKOFF_SECONDS[idx] ?? RECONNECT_MAX_DELAY_SECONDS;
  return seconds * 1000;
}
