import "server-only";

import { keyFingerprint, openWithKey, parseEncryptionKey, sealWithKey, type SealedSecret } from "@/lib/secret-box";

/*
 * Encrypts secrets, such as AI provider API keys, before they are stored in the database. The 256-bit
 * encryption key comes from AI_KEY_ENCRYPTION_KEY in the server environment and is never written to
 * the database, so a database dump or backup alone cannot reveal a secret. See secret-box.ts.
 */

export type { SealedSecret };

export type SecretEncryptionStatus = "ready" | "missing" | "invalid";

function readEncryptionKey(): Buffer | null {
  return parseEncryptionKey(process.env.AI_KEY_ENCRYPTION_KEY ?? "");
}

/** "missing" or "invalid" means secrets cannot be saved or read until the server is configured. */
export function secretEncryptionStatus(): SecretEncryptionStatus {
  if (!process.env.AI_KEY_ENCRYPTION_KEY?.trim()) return "missing";
  return readEncryptionKey() ? "ready" : "invalid";
}

export class SecretEncryptionUnavailableError extends Error {
  constructor() {
    super("AI_KEY_ENCRYPTION_KEY is missing or is not a 32-byte key.");
    this.name = "SecretEncryptionUnavailableError";
  }
}

export function sealSecret(plaintext: string, context: string): SealedSecret {
  const key = readEncryptionKey();
  if (!key) throw new SecretEncryptionUnavailableError();
  return sealWithKey(key, plaintext, context);
}

/** True when the server's current encryption key is the one that sealed this value. */
export function sealedWithCurrentKey(sealed: Pick<SealedSecret, "keyFingerprint">): boolean {
  const key = readEncryptionKey();
  return Boolean(key && sealed.keyFingerprint === keyFingerprint(key));
}

/** Returns the plaintext, or null when the key changed or the stored value was altered. */
export function openSecret(sealed: SealedSecret, context: string): string | null {
  const key = readEncryptionKey();
  return key ? openWithKey(key, sealed, context) : null;
}
