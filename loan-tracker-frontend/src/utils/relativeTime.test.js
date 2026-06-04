// timeAgo() runs in almost every list view in the app — payment
// history, notifications bell, audit log, customer activity feed.
// A regression here would be visible everywhere.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { timeAgo } from "./relativeTime";

describe("timeAgo", () => {
  beforeEach(() => {
    // Freeze "now" so the buckets are predictable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (offsetMs) => new Date(Date.now() - offsetMs).toISOString();

  it("returns em-dash for nullish input", () => {
    expect(timeAgo(null)).toBe("—");
    expect(timeAgo(undefined)).toBe("—");
    expect(timeAgo("")).toBe("—");
  });

  it("returns em-dash for unparseable input (defensive)", () => {
    expect(timeAgo("not a date")).toBe("—");
  });

  it("returns em-dash for future dates (clock-skew guard)", () => {
    expect(timeAgo(new Date(Date.now() + 60_000).toISOString())).toBe("—");
  });

  it("'just now' for anything under a minute", () => {
    expect(timeAgo(at(0))).toBe("just now");
    expect(timeAgo(at(59_000))).toBe("just now");
  });

  it("'Nm ago' for sub-hour", () => {
    expect(timeAgo(at(60_000))).toBe("1m ago");
    expect(timeAgo(at(15 * 60_000))).toBe("15m ago");
    expect(timeAgo(at(59 * 60_000))).toBe("59m ago");
  });

  it("'Nh ago' for sub-day", () => {
    expect(timeAgo(at(60 * 60_000))).toBe("1h ago");
    expect(timeAgo(at(23 * 60 * 60_000))).toBe("23h ago");
  });

  it("'Nd ago' for under a month", () => {
    expect(timeAgo(at(24 * 60 * 60_000))).toBe("1d ago");
    expect(timeAgo(at(29 * 24 * 60 * 60_000))).toBe("29d ago");
  });

  it("falls back to dd/mm/yyyy past a month", () => {
    // 60 days ago — should show the exact date, en-GB format.
    const t = timeAgo(at(60 * 24 * 60 * 60_000));
    expect(t).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});
