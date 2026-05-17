import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decrypt, encrypt } from "../src/utils/encryption";

const validKey = () => randomBytes(32).toString("hex");

describe("encryption", () => {
  it("round-trip un secret arbitraire", () => {
    const key = validKey();
    const { encrypted, iv } = encrypt("mon-mot-de-passe-secret", key);
    expect(decrypt(encrypted, iv, key)).toBe("mon-mot-de-passe-secret");
  });

  it("génère un IV différent à chaque chiffrement", () => {
    const key = validKey();
    const a = encrypt("hello", key);
    const b = encrypt("hello", key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("supporte unicode et chaînes vides", () => {
    const key = validKey();
    for (const plain of ["", "🔐 émoji çà & ü", "x".repeat(1024)]) {
      const { encrypted, iv } = encrypt(plain, key);
      expect(decrypt(encrypted, iv, key)).toBe(plain);
    }
  });

  it("rejette une clé de mauvaise taille", () => {
    expect(() => encrypt("data", "abcd")).toThrow(/32 bytes/);
  });

  it("échoue à déchiffrer avec une clé différente", () => {
    const k1 = validKey();
    const k2 = validKey();
    const { encrypted, iv } = encrypt("secret", k1);
    expect(() => decrypt(encrypted, iv, k2)).toThrow();
  });

  it("échoue si le ciphertext est altéré (auth tag invalide)", () => {
    const key = validKey();
    const { encrypted, iv } = encrypt("secret", key);
    const tampered = encrypted.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(() => decrypt(tampered, iv, key)).toThrow();
  });
});
