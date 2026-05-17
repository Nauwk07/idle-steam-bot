import { describe, expect, it } from "vitest";

import {
  resolveModalHandler,
  resolveSubHandler,
  type CommandMap,
  type ModalHandler,
} from "../src/bot/dispatch";

const noop = async () => {};

describe("resolveSubHandler", () => {
  const map: CommandMap = {
    config: {
      status: { fn: noop, publicAccess: true },
      role: { fn: noop, ownerOnly: true, publicAccess: true },
    },
    idle: {
      start: { fn: noop },
    },
  };

  it("retourne le handler correspondant", () => {
    const h = resolveSubHandler(map, "config", "role");
    expect(h?.ownerOnly).toBe(true);
    expect(h?.publicAccess).toBe(true);
  });

  it("retourne null pour une commande inconnue", () => {
    expect(resolveSubHandler(map, "wat", "status")).toBeNull();
    expect(resolveSubHandler(map, "config", "unknown")).toBeNull();
  });
});

describe("resolveModalHandler", () => {
  const handlers: ModalHandler[] = [
    { match: (id) => id === "setup", fn: async () => {} },
    { match: (id) => id.startsWith("sg:"), fn: async () => {} },
  ];

  it("matche par égalité exacte", () => {
    expect(resolveModalHandler(handlers, "setup")).toBe(handlers[0]);
  });

  it("matche par prefix", () => {
    expect(resolveModalHandler(handlers, "sg:start:123")).toBe(handlers[1]);
  });

  it("retourne null si aucun match", () => {
    expect(resolveModalHandler(handlers, "unknown")).toBeNull();
  });
});
