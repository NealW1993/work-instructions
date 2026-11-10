import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { keyFingerprint, openWithKey, parseEncryptionKey, sealWithKey } from "../src/lib/secret-box";

const key = randomBytes(32);
const context = "ai-provider-key:anthropic";
const secret = "sk-ant-api03-example-secret-value-0123456789";

test("a sealed key opens only with the same encryption key and record", () => {
  const sealed = sealWithKey(key, secret, context);
  expect(openWithKey(key, sealed, context)).toBe(secret);
  expect(JSON.stringify(sealed)).not.toContain("example-secret");
  // Another provider's record, or another server key, cannot open it.
  expect(openWithKey(key, sealed, "ai-provider-key:openai")).toBeNull();
  expect(openWithKey(randomBytes(32), sealed, context)).toBeNull();
});

test("every save uses a fresh nonce, so the same key never produces the same ciphertext", () => {
  const first = sealWithKey(key, secret, context);
  const second = sealWithKey(key, secret, context);
  expect(first.iv).not.toBe(second.iv);
  expect(first.ciphertext).not.toBe(second.ciphertext);
});

test("any change to the stored bytes is detected instead of returning a wrong key", () => {
  const sealed = sealWithKey(key, secret, context);
  const flip = (value: string) => {
    const bytes = Buffer.from(value, "base64");
    bytes[0] ^= 0x01;
    return bytes.toString("base64");
  };
  expect(openWithKey(key, { ...sealed, ciphertext: flip(sealed.ciphertext) }, context)).toBeNull();
  expect(openWithKey(key, { ...sealed, tag: flip(sealed.tag) }, context)).toBeNull();
  expect(openWithKey(key, { ...sealed, iv: flip(sealed.iv) }, context)).toBeNull();
  // A shortened authentication tag is refused rather than weakly checked.
  expect(openWithKey(key, { ...sealed, tag: Buffer.from(sealed.tag, "base64").subarray(0, 4).toString("base64") }, context)).toBeNull();
});

test("the server encryption key must be exactly 32 bytes, as hex or base64", () => {
  const raw = randomBytes(32);
  expect(parseEncryptionKey(raw.toString("hex"))?.equals(raw)).toBe(true);
  expect(parseEncryptionKey(raw.toString("base64"))?.equals(raw)).toBe(true);
  expect(parseEncryptionKey(raw.toString("base64url"))?.equals(raw)).toBe(true);
  expect(parseEncryptionKey(`  ${raw.toString("base64")}\n`)?.equals(raw)).toBe(true);
  for (const bad of ["", "short", randomBytes(16).toString("hex"), randomBytes(31).toString("base64"), randomBytes(48).toString("base64")]) {
    expect(parseEncryptionKey(bad), bad).toBeNull();
  }
  // The fingerprint identifies the key without revealing it.
  expect(keyFingerprint(raw)).toMatch(/^[0-9a-f]{16}$/);
  expect(keyFingerprint(raw)).not.toBe(keyFingerprint(randomBytes(32)));
});
