import { test, expect } from "@playwright/test";
import { loginUI, apiSeedActiveLoan } from "../helpers.js";

test("records a payment against an active loan through the UI", async ({
  page,
}) => {
  // Precondition: an active (approved + disbursed) loan to pay against.
  const { loan } = await apiSeedActiveLoan({ principal: 10_000 });

  await loginUI(page);
  await page.goto("/payments");

  // Toggle is "+ Record Payment"; once open it becomes "✖ Cancel", leaving
  // the submit "✓ Record Payment" as the only /record payment/i match.
  await page.getByRole("button", { name: /record payment/i }).click();

  await page
    .getByPlaceholder(/type to search active loans/i)
    .fill(loan.loan_code);
  await page.getByRole("button", { name: new RegExp(loan.loan_code) }).click();

  await page.getByPlaceholder("9166.67", { exact: true }).fill("5000");
  await page.getByRole("button", { name: /record payment/i }).click();

  await expect(page.getByText(/recorded successfully/i)).toBeVisible();
});
