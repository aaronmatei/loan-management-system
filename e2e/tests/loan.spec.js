import { test, expect } from "@playwright/test";
import { loginUI, apiCreateClient } from "../helpers.js";

test("submits a loan application through the UI", async ({ page }) => {
  // Precondition: a client to lend to. The capital pool (which gates the
  // submit button when principal > available) is seeded by setup-db.js.
  await apiCreateClient({ first_name: "Loan", last_name: "Applicant" });

  await loginUI(page);
  await page.goto("/loans");

  await page.getByRole("button", { name: /new application/i }).click();

  // Typeahead-select the client. The filter matches a single field, so
  // search by last name; the dropdown button still reads "Loan Applicant".
  await page.getByPlaceholder(/type to search clients/i).fill("Applicant");
  await page.getByRole("button", { name: /Loan Applicant/ }).click();

  await page.getByPlaceholder("50000", { exact: true }).fill("20000");
  await page.getByRole("button", { name: /submit application/i }).click();

  // Success path redirects to the applications queue.
  await expect(page).toHaveURL(/\/applications$/);
});
