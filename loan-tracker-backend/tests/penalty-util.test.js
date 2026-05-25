// Shared late-payment penalty formula used by the Overdue list and the
// loan-detail payment schedule.
import { describe, it, expect } from "vitest";
import { computeInstallmentPenalty } from "../src/utils/penalty.js";

describe("computeInstallmentPenalty", () => {
  it("charges flat late fee + rate% per month, rounding part-months up", () => {
    // 40 days late → 2 months; 5% * 1000 * 2 = 100; + 500 fee = 600.
    const p = computeInstallmentPenalty({
      balance: 1000,
      daysLate: 40,
      lateFee: 500,
      penaltyRate: 5,
    });
    expect(p.months_late).toBe(2);
    expect(p.late_fee).toBe(500);
    expect(p.penalty_interest).toBe(100);
    expect(p.penalty_total).toBe(600);
    expect(p.total_with_penalty).toBe(1600);
  });

  it("counts any part of a month as a full month (1 day late = 1 month)", () => {
    const p = computeInstallmentPenalty({
      balance: 2000,
      daysLate: 1,
      lateFee: 500,
      penaltyRate: 5,
    });
    expect(p.months_late).toBe(1);
    expect(p.penalty_interest).toBe(100); // 5% * 2000 * 1
    expect(p.penalty_total).toBe(600);
  });

  it("returns zero penalty when not overdue or nothing owed", () => {
    expect(
      computeInstallmentPenalty({ balance: 1000, daysLate: 0, lateFee: 500, penaltyRate: 5 }).penalty_total,
    ).toBe(0);
    expect(
      computeInstallmentPenalty({ balance: 0, daysLate: 30, lateFee: 500, penaltyRate: 5 }).penalty_total,
    ).toBe(0);
  });
});
