import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/*
 * Authenticated encryption for secrets stored in the database (server code only; see
 * secret-box.server.ts, which supplies the key from the server environment).
 *
 * - AES-256-GCM with a random 96-bit nonce for every seal, so equal secrets never look alike.
 * - The record's context is authenticated with the data, so a sealed value cannot be copied to another
 *   record, and any change to the stored bytes makes opening fail instead of returning garbage.
 * - A short one-way fingerprint records which key sealed a value, so a changed key is reported clearly.
 */

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyFingerprint: string;
}

/** Accepts 32 bytes written as 64 hex characters or as base64 (standard or URL-safe). */
export function parseEncryptionKey(raw: string): Buffer | null {
  const value = raw.trim();
  let key: Buffer | null = null;
  if (/^[0-9a-f]{64}$/i.test(value)) {
    key = Buffer.from(value, "hex");
  } else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
    key = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }
  return key && key.length === 32 ? key : null;
}

export function keyFingerprint(key: Buffer) {
  return createHash("sha256").update("work-instructions:secret-box:v1:").update(key).digest("hex").slice(0, 16);
}

export function sealWithKey(key: Buffer, plaintext: string, context: string): SealedSecret {
  const iv = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyFingerprint: keyFingerprint(key),
  };
}

/** Returns the plaintext, or null when the key or context differ or the stored value was altered. */
export function openWithKey(key: Buffer, sealed: SealedSecret, context: string): string | null {
  if (sealed.keyFingerprint !== keyFingerprint(key)) return null;
  try {
    const iv = Buffer.from(sealed.iv, "base64");
    const tag = Buffer.from(sealed.tag, "base64");
    if (iv.length !== NONCE_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
