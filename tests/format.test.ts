import { describe, expect, it } from "vitest";

import {
  formatBoolean,
  formatDate,
  formatDuration,
  formatRelativeTimestamp,
} from "../src/utils/format";

describe("formatDuration", () => {
  it("formate les secondes seules", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(0)).toBe("0s");
  });

  it("combine jours/heures/minutes/secondes", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(3_600_000)).toBe("1h 0s");
    expect(formatDuration(86_400_000)).toBe("1j 0s");
    expect(formatDuration(86_400_000 + 3_600_000 + 60_000 + 1_000)).toBe("1j 1h 1m 1s");
  });
});

describe("formatBoolean", () => {
  it("renvoie 'oui' / 'non'", () => {
    expect(formatBoolean(true)).toBe("oui");
    expect(formatBoolean(false)).toBe("non");
  });
});

describe("formatDate", () => {
  it("retourne 'n/a' pour null", () => {
    expect(formatDate(null)).toBe("n/a");
  });

  it("retourne une string non vide pour une date valide", () => {
    expect(formatDate("2026-01-01T00:00:00Z")).not.toBe("n/a");
    expect(formatDate("2026-01-01T00:00:00Z")).toContain("2026");
  });
});

describe("formatRelativeTimestamp", () => {
  it("retourne 'n/a' pour null", () => {
    expect(formatRelativeTimestamp(null)).toBe("n/a");
  });

  it("retourne le format Discord <t:UNIX:R>", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const unix = Math.floor(date.getTime() / 1000);
    expect(formatRelativeTimestamp(date)).toBe(`<t:${unix}:R>`);
    expect(formatRelativeTimestamp("2026-01-01T00:00:00Z")).toBe(`<t:${unix}:R>`);
  });
});
