import { describe, it, expect } from "vitest";
import { encryptConfig, decryptConfig } from "../../src/credentials/encryption";

const KEY = "0".repeat(64); // 32 bytes hex, test-only key

describe("encryptConfig/decryptConfig", () => {
  it("round-trips a config object", () => {
    const config = { apiKey: "sk-super-secret" };
    const { ciphertext, iv, authTag } = encryptConfig(config, KEY);
    expect(decryptConfig(ciphertext, iv, authTag, KEY)).toEqual(config);
  });

  it("round-trips a multi-field config object", () => {
    const config = { accessKeyId: "AKIA123", secretAccessKey: "shh", region: "us-east-1" };
    const { ciphertext, iv, authTag } = encryptConfig(config, KEY);
    expect(decryptConfig(ciphertext, iv, authTag, KEY)).toEqual(config);
  });

  it("throws when decrypting with the wrong key", () => {
    const { ciphertext, iv, authTag } = encryptConfig({ apiKey: "x" }, KEY);
    const wrongKey = "1".repeat(64);
    expect(() => decryptConfig(ciphertext, iv, authTag, wrongKey)).toThrow();
  });

  it("throws on a malformed key length", () => {
    expect(() => encryptConfig({ apiKey: "x" }, "too-short")).toThrow(/32 bytes|64 hex/);
  });
});
