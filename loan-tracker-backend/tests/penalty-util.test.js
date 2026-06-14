// Shared late-payment penalty formula used by the Overdue list, the loan-detail
// payment schedule, and the portal. The late fee + penalty interest accrue PER
// DAY over a 30-day month — you pay only for the days actually late.
import { describe, it, expect } from "vitest";
import { computeInstallmentPenalty } from "../src/utils/penalty.js";

describe("computeInstallmentPenalty", () => {
  it("pro-rates a monthly late fee by the days late (the headline case)", () => {
    // KES 3,000/month late fee, 5 days late → 3000 * 5/30 = 500.
    const p = computeInstallmentPenalty({
      balance: 10000,
      daysLate: 5,
      lateFee: 3000,
      penaltyRate: 0,
    });
    expect(p.late_fee).toBe(500);
    expect(p.penalty_total).toBe(500);
    expect(p.days_late).toBe(5);
  });

  it("accrues the fee + rate% per day, growing past a month", () => {
    // 40 days late → 40/30 = 1.3333 months.
    // fee 500 * 1.3333 = 666.67; interest 5% * 1000 * 1.3333 = 66.67.
    const p = computeInstallmentPenalty({
      balance: 1000,
      daysLate: 40,
      lateFee: 500,
      penaltyRate: 5,
    });
    expect(p.months_late).toBe(1.33);
    expect(p.late_fee).toBe(666.67);
    expect(p.penalty_interest).toBe(66.67);
    expect(p.penalty_total).toBe(733.33);
  });

  it("charges only a fraction on day one (no full-month rounding up)", () => {
    // 1 day late → 1/30 month. fee 500/30 = 16.67; interest 5%*2000/30 = 3.33.
    const p = computeInstallmentPenalty({
      balance: 2000,
      daysLate: 1,
      lateFee: 500,
      penaltyRate: 5,
    });
    expect(p.late_fee).toBe(16.67);
    expect(p.penalty_interest).toBe(3.33);
    expect(p.penalty_total).toBe(20);
  });

  it("exactly one month late equals the full monthly figures", () => {
    const p = computeInstallmentPenalty({
      balance: 1000,
      daysLate: 30,
      lateFee: 500,
      penaltyRate: 5,
    });
    expect(p.months_late).toBe(1);
    expect(p.late_fee).toBe(500);
    expect(p.penalty_interest).toBe(50);
    expect(p.penalty_total).toBe(550);
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
