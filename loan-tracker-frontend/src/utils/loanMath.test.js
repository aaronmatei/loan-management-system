// Loan-totals calculator tests.
//
// computeLoanTotals powers the live-preview tile on the Apply Loan
// form. If it drifts from the backend's matching helper
// (loan-tracker-backend/src/utils/loanMath.js), staff see one number
// in the form and the loan books with a different total. That's a
// trust bug, so worth pinning down both methods + the degenerate
// edges.

import { describe, it, expect } from "vitest";
import { computeLoanTotals } from "./loanMath";

describe("computeLoanTotals — flat method (default)", () => {
  it("returns principal × rate × years for a clean 1-year loan", () => {
    const r = computeLoanTotals({
      principal: 50000,
      annualRatePct: 20,
      months: 12,
    });
    // 50,000 × 0.20 × 1 = 10,000 interest. Total = 60,000. EMI = 5,000.
    expect(r.totalInterest).toBe(10000);
    expect(r.totalAmountDue).toBe(60000);
    expect(r.monthlyPayment).toBe(5000);
  });

  it("handles non-integer years (6-month loan at annual rate)", () => {
    const r = computeLoanTotals({
      principal: 100000,
      annualRatePct: 24,
      months: 6,
    });
    // 100k × 0.24 × 0.5 = 12,000 interest. Total = 112,000. EMI = 18,666.67.
    expect(r.totalInterest).toBe(12000);
    expect(r.totalAmountDue).toBe(112000);
    expect(r.monthlyPayment).toBeCloseTo(18666.67, 2);
  });
});

describe("computeLoanTotals — reducing balance", () => {
  it("amortizes a 50k / 6mo / 20% reducing loan to the expected EMI", () => {
    // This is the exact loan we used as the running test case in
    // the production debugging session — pinned values guard the
    // schedule that the backend cascade also relies on.
    const r = computeLoanTotals({
      principal: 50000,
      annualRatePct: 240, // 20% MONTHLY in the staff form
      months: 6,
      method: "reducing",
    });
    expect(r.monthlyPayment).toBeCloseTo(15035.29, 2);
    expect(r.totalAmountDue).toBeCloseTo(90211.74, 2);
    expect(r.totalInterest).toBeCloseTo(40211.74, 2);
  });

  it("collapses to flat principal split when the rate is zero", () => {
    const r = computeLoanTotals({
      principal: 60000,
      annualRatePct: 0,
      months: 12,
      method: "reducing",
    });
    expect(r.totalInterest).toBe(0);
    expect(r.totalAmountDue).toBe(60000);
    expect(r.monthlyPayment).toBe(5000);
  });
});

describe("computeLoanTotals — degenerate inputs", () => {
  it("zero principal returns all zeros", () => {
    expect(
      computeLoanTotals({ principal: 0, annualRatePct: 20, months: 12 }),
    ).toEqual({
      totalInterest: 0,
      totalAmountDue: 0,
      monthlyPayment: 0,
    });
  });

  it("zero months returns all zeros (avoids divide-by-zero)", () => {
    expect(
      computeLoanTotals({ principal: 50000, annualRatePct: 20, months: 0 }),
    ).toEqual({
      totalInterest: 0,
      totalAmountDue: 0,
      monthlyPayment: 0,
    });
  });

  it("non-numeric input coerces safely (defensive against the form)", () => {
    const r = computeLoanTotals({
      principal: "fifty thousand",
      annualRatePct: "20",
      months: 12,
    });
    // principal coerces to 0 → early-return zeros. The form never
    // calls this with a non-numeric principal in practice, but a
    // typo-in-progress shouldn't NaN the preview.
    expect(r.totalAmountDue).toBe(0);
  });
});
