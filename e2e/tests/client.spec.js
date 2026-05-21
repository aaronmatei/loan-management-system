import { test, expect } from "@playwright/test";
import { loginUI } from "../helpers.js";

test("creates a client through the UI", async ({ page }) => {
  await loginUI(page);
  await page.goto("/clients");

  await page.getByRole("button", { name: /add client/i }).click();
  // Only the three required fields are needed.
  // exact:true — "John" is otherwise a substring of "john@example.com" etc.
  await page.getByPlaceholder("John", { exact: true }).fill("Grace");
  await page.getByPlaceholder("Mwangi", { exact: true }).fill("Wanjiru");
  await page.getByPlaceholder("0712345678", { exact: true }).fill("0722123456");
  await page.getByRole("button", { name: /save client/i }).click();

  await expect(page.getByText(/created successfully/i)).toBeVisible();
});
