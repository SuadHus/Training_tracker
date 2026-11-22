import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function healthKey() {
  const encoded = process.env.HEALTH_TOKEN_KEY;
  if (!encoded) return null;
  const value = Buffer.from(encoded, "base64");
  return value.length === 32 ? value : null;
}

export function hasHealthKey() {
  return healthKey() !== null;
}

export function sealHealthValue(value: object, context: string) {
  const key = healthKey();
  if (!key) throw new Error("Health encryption key is missing or invalid.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openHealthValue<T>(value: string, context: string): T {
  const key = healthKey();
  if (!key) throw new Error("Health encryption key is missing or invalid.");
  const sealed = Buffer.from(value, "base64url");
  if (sealed.length <= 28) throw new Error("Invalid encrypted health payload.");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8"));
}

export function healthSecretMatches(expected: string, received: string) {
  return timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(received).digest());
}
