import { describe, expect, it } from "vitest";

import {
  RATE_LIMIT_BACKOFF_MS,
  RECONNECT_BACKOFF_SECONDS,
  RECONNECT_MAX_DELAY_SECONDS,
  reconnectDelayMs,
} from "../src/steam/reconnectStrategy";

describe("reconnectDelayMs", () => {
  it("retourne la séquence de backoff puis plafonne", () => {
    expect(reconnectDelayMs(1)).toBe(RECONNECT_BACKOFF_SECONDS[0]! * 1000);
    expect(reconnectDelayMs(2)).toBe(RECONNECT_BACKOFF_SECONDS[1]! * 1000);
    expect(reconnectDelayMs(3)).toBe(RECONNECT_BACKOFF_SECONDS[2]! * 1000);
    expect(reconnectDelayMs(4)).toBe(RECONNECT_BACKOFF_SECONDS[3]! * 1000);
  });

  it("plafonne sur la dernière valeur du tableau pour les attempts > taille", () => {
    const last = RECONNECT_BACKOFF_SECONDS[RECONNECT_BACKOFF_SECONDS.length - 1]!;
    expect(reconnectDelayMs(10)).toBe(last * 1000);
    expect(reconnectDelayMs(999)).toBe(last * 1000);
  });

  it("traite les attempts <= 0 comme la première tentative", () => {
    expect(reconnectDelayMs(0)).toBe(RECONNECT_BACKOFF_SECONDS[0]! * 1000);
    expect(reconnectDelayMs(-5)).toBe(RECONNECT_BACKOFF_SECONDS[0]! * 1000);
  });

  it("RATE_LIMIT_BACKOFF_MS vaut 60 minutes", () => {
    expect(RATE_LIMIT_BACKOFF_MS).toBe(60 * 60 * 1000);
  });

  it("RECONNECT_MAX_DELAY_SECONDS est un fallback raisonnable", () => {
    expect(RECONNECT_MAX_DELAY_SECONDS).toBeGreaterThanOrEqual(60);
  });
});
