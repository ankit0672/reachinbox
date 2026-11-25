import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for secrets at rest (Slack bot tokens). Stored as
// "v1.<iv>.<authTag>.<ciphertext>" (base64url). GCM's auth tag makes any
// tampering or a wrong key fail loudly instead of decrypting to garbage.
const VERSION = "v1";

function keyFrom(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes as 64 hex chars (openssl rand -hex 32)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12); // fresh per message; never reuse an IV with GCM
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyHex), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url"));
  return [VERSION, ...parts].join(".");
}

export function decryptSecret(blob: string, keyHex: string): string {
  const [version, iv, tag, data] = blob.split(".");
  if (version !== VERSION || !iv || !tag || !data)
    throw new Error("Unrecognised encrypted secret format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyHex), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
