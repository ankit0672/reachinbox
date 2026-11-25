import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/lib/encryption.js";

const KEY = "0123456789abcdef".repeat(4); // 32 bytes as hex
const OTHER = "fedcba9876543210".repeat(4);

describe("AES-256-GCM secrets", () => {
  it("round-trips, and never stores the plaintext", () => {
    const blob = encryptSecret("xoxb-secret-token", KEY);
    expect(blob).not.toContain("xoxb");
    expect(blob.startsWith("v1.")).toBe(true);
    expect(decryptSecret(blob, KEY)).toBe("xoxb-secret-token");
  });

  it("uses a fresh IV every time (same input, different ciphertext)", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });

  it("rejects tampering and the wrong key (GCM auth tag)", () => {
    const blob = encryptSecret("xoxb-secret-token", KEY);
    const parts = blob.split(".");
    const flipped = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret([...parts.slice(0, 3), flipped].join("."), KEY)).toThrow();
    expect(() => decryptSecret(blob, OTHER)).toThrow();
    expect(() => decryptSecret("not-a-blob", KEY)).toThrow(/format/);
  });

  it("requires a 64-hex-char key", () => {
    expect(() => encryptSecret("x", "too-short")).toThrow(/ENCRYPTION_KEY/);
  });
});
