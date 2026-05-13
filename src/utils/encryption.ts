import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export type EncryptedData = {
  encrypted: string;
  iv: string;
};

export function encrypt(plaintext: string, keyHex: string): EncryptedData {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("La clé de chiffrement doit faire 32 bytes (256 bits).");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decrypt(encryptedHex: string, ivHex: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const encryptedBuf = Buffer.from(encryptedHex, "hex");

  const authTag = encryptedBuf.subarray(encryptedBuf.length - AUTH_TAG_LENGTH);
  const ciphertext = encryptedBuf.subarray(0, encryptedBuf.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
