// Password policy: ≥12 chars with an uppercase letter, a number, and a special
// character. "Special" is any non-alphanumeric — the old whitelist regex
// wrongly rejected valid passwords containing characters outside @$!%*?&
// (e.g. '#').
import { describe, it, expect } from "vitest";
import { validatePassword } from "../src/utils/validators.js";

describe("validatePassword", () => {
  it("accepts a strong password whose special char is '#'", () => {
    expect(validatePassword("RealOgs@2026#")).toBe(true); // the reported case
    expect(validatePassword("RealOgs2026#x")).toBe(true); // '#' only
  });

  it("accepts other common specials", () => {
    for (const p of ["Strong-Pass2026", "Strong_Pass2026", "Strong.Pass2026", "Strong!Pass2026"]) {
      expect(validatePassword(p)).toBe(true);
    }
  });

  it("rejects when a requirement is missing", () => {
    expect(validatePassword("short@1A")).toBe(false); // < 12
    expect(validatePassword("alllowercase2026#")).toBe(false); // no uppercase
    expect(validatePassword("NoDigitsHere#x")).toBe(false); // no number
    expect(validatePassword("NoSpecial2026xy")).toBe(false); // no special
    expect(validatePassword("")).toBe(false);
    expect(validatePassword(null)).toBe(false);
  });
});
