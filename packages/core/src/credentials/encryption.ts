import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;

function parseKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (64 hex characters)`,
    );
  }
  return key;
}

export function encryptConfig(
  config: Record<string, string>,
  keyHex: string,
): { ciphertext: string; iv: string; authTag: string } {
  const key = parseKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(config), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptConfig(
  ciphertext: string,
  iv: string,
  authTag: string,
  keyHex: string,
): Record<string, string> {
  const key = parseKey(keyHex);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
}
