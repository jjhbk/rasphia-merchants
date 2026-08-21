import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function key() {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!value) throw new Error("INTEGRATION_ENCRYPTION_KEY is required before connecting external tools.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return decoded;
}

export function encryptIntegrationSecret(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptIntegrationSecret(value: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) throw new Error("Stored integration credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(encodedIv, "base64url")); decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
}
