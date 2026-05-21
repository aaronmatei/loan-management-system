import { describe, it, expect } from "vitest";
import { hasPermission, canAccess, getRoleBadge } from "./permissions";

describe("hasPermission", () => {
  it("grants everything to admin via the wildcard", () => {
    expect(hasPermission("admin", "anything:at:all")).toBe(true);
  });

  it("grants a permission the role explicitly has", () => {
    expect(hasPermission("loan_officer", "loans:create")).toBe(true);
  });

  it("denies a permission the role lacks", () => {
    // loan_officer cannot refund; viewer cannot create clients.
    expect(hasPermission("loan_officer", "payments:refund")).toBe(false);
    expect(hasPermission("viewer", "clients:create")).toBe(false);
  });

  it("denies when the role is missing or unknown", () => {
    expect(hasPermission(null, "loans:view")).toBe(false);
    expect(hasPermission("ghost", "loans:view")).toBe(false);
  });
});

describe("canAccess", () => {
  it("allows when the role is in the required list", () => {
    expect(canAccess("manager", ["admin", "manager"])).toBe(true);
  });

  it("denies when the role is absent from the list or missing", () => {
    expect(canAccess("viewer", ["admin", "manager"])).toBe(false);
    expect(canAccess(null, ["admin"])).toBe(false);
  });
});

describe("getRoleBadge", () => {
  it("returns a label and color for a known role", () => {
    expect(getRoleBadge("admin")).toMatchObject({
      label: expect.stringContaining("Admin"),
      color: expect.stringContaining("purple"),
    });
  });

  it("falls back to the raw role and a neutral color when unknown", () => {
    const badge = getRoleBadge("ghost");
    expect(badge.label).toBe("ghost");
    expect(badge.color).toContain("gray");
  });
});
