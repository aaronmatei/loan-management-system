// Application-level secret encryption.
//
// Symmetric AES-256-GCM with a versioned + tagged ciphertext envelope so
// secrets stored at rest in Postgres aren't readable from a DB dump or
// a casual SELECT. The actual M-Pesa credentials today live in process.env
// (Render encrypts those at the infra layer), but the tenants table
// reserves columns for a future per-tenant M-Pesa wiring — when that
// lands, all writes MUST go through encryptSecret() and reads through
// decryptSecret() so plaintext never lands on disk.
//
// Envelope format (so we can rotate keys / algorithms later without a
// destructive migration):
//
//   enc:v1:<base64(iv:12)>:<base64(authTag:16)>:<base64(ciphertext)>
//
// • The "enc:v1:" prefix is the version marker.
// • IV is random per encryption — never re-use one with the same key.
// • authTag is GCM's integrity tag; decryptSecret() will throw if the
//   ciphertext has been tampered with.
//
// Self-detecting reads: decryptSecret(input) returns the input as-is
// when it doesn't start with "enc:v1:". That makes the boundary
// transparent for existing plaintext rows during a rollout — the next
// time the value is re-saved, encryptSecret() upgrades it. (No big-bang
// migration step required.)

import crypto from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

// Cached 32-byte key. Loaded once on first use so a missing
// ENCRYPTION_KEY doesn't crash app startup in dev / test where the
// crypto util may never get called. Production callers should still
// fail loud — see assertEncryptionAvailable() below.
let cachedKey = null;

/**
 * Resolve ENCRYPTION_KEY into a 32-byte Buffer. Accepts either:
 *   • a 64-char hex string (preferred — exact 32 bytes)
 *   • any other string, which is HKDF-stretched to 32 bytes
 *
 * Throws if the env var is missing — callers that must succeed in
 * production should use assertEncryptionAvailable() at startup to fail
 * fast instead of at first-use.
 */
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY env var is not set. Generate one with " +
        '`node -e "console.log(require(\\"crypto\\").randomBytes(32).toString(\\"hex\\"))"` ' +
        "and set it in your environment.",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, "hex");
  } else {
    // Caller passed a passphrase — stretch it to 32 bytes deterministically.
    // The HKDF salt is a constant so the same passphrase always derives
    // the same key (the alternative would force re-encrypting on every
    // restart — useless).
    cachedKey = crypto.hkdfSync(
      "sha256",
      Buffer.from(raw, "utf8"),
      Buffer.from("loanfix-secrets-crypto-v1"),
      Buffer.from(""),
      32,
    );
    cachedKey = Buffer.from(cachedKey); // hkdfSync returns ArrayBuffer
  }
  return cachedKey;
}

/**
 * Encrypt a plaintext secret. Returns the versioned envelope string,
 * safe to store in any text column. Empty / null input passes through
 * unchanged so blank fields don't blow up at INSERT.
 */
export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === "") return plaintext;
  if (typeof plaintext !== "string") plaintext = String(plaintext);
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return (
    PREFIX +
    iv.toString("base64") +
    ":" +
    authTag.toString("base64") +
    ":" +
    ciphertext.toString("base64")
  );
}

/**
 * Decrypt. Self-detecting: input that doesn't start with the version
 * prefix is returned as-is (existing plaintext during rollout). Throws
 * if the envelope is malformed or the auth tag fails (tampered).
 */
export function decryptSecret(value) {
  if (value == null || value === "") return value;
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return value;
  const rest = value.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) {
    throw new Error("decryptSecret: malformed envelope");
  }
  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Returns true if the value is already in our envelope format.
 * Useful for skipping re-encryption in idempotent writes.
 */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Call from app.js bootstrap when at least one encrypted column is in
 * use — throws at startup with a clear message if ENCRYPTION_KEY isn't
 * configured, instead of failing on first request hours later.
 *
 * Not called automatically today because no production path actually
 * touches encryptSecret yet; wire it in when per-tenant M-Pesa or any
 * other encrypted column goes live.
 */
export function assertEncryptionAvailable() {
  getKey();
}

export default {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  assertEncryptionAvailable,
};
