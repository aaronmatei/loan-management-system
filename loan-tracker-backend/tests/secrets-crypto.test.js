// Unit tests for utils/secretsCrypto.
//
// These don't touch the database — pure JS round-trip + envelope
// behaviour. They run alongside the integration suites and add the
// signal we need before someone wires the util into a real column.

import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
} from "../src/utils/secretsCrypto.js";

beforeAll(() => {
  // 32-byte hex key — exercises the fast path. The HKDF-stretch path
  // is reachable too but uses the same downstream API so we don't
  // need to cover both here.
  process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("secretsCrypto envelope", () => {
  it("round-trips a plaintext through encrypt → decrypt", () => {
    const plain = "consumer_secret_value_42";
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a different ciphertext for the same plaintext each time", () => {
    // Random IV per call — same input encrypts differently. If this
    // ever flakes, IVs are being reused and the GCM security argument
    // collapses.
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("returns null/empty inputs unchanged so blank columns don't blow up", () => {
    expect(encryptSecret(null)).toBe(null);
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret(null)).toBe(null);
    expect(decryptSecret("")).toBe("");
  });

  it("decrypt passes through non-envelope plaintext (rollout transparency)", () => {
    // Existing plaintext rows during a rollout — decrypt should just
    // hand them back so reads don't break before re-encryption lands.
    const stillPlain = "legacy-plaintext-value";
    expect(decryptSecret(stillPlain)).toBe(stillPlain);
  });

  it("detects tampering via the GCM auth tag", () => {
    const enc = encryptSecret("don't-mess-with-me");
    // Flip a byte in the ciphertext portion (index 2 of the colon-split).
    const tampered = enc.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("isEncrypted recognises envelopes only", () => {
    expect(isEncrypted("enc:v1:foo:bar:baz")).toBe(true);
    expect(isEncrypted("plain text")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });
});
