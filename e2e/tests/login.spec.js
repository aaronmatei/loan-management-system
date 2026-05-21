import { test, expect } from "@playwright/test";
import { ADMIN, FRONTEND_PORT } from "../fixtures.js";

const loginButton = (page) => page.getByRole("button", { name: /^login$/i });

test.describe("Staff login", () => {
  test("logs in with seeded admin and reaches the dashboard", async ({
    page,
  }) => {
    await page.goto("/login");

    await page.getByPlaceholder("admin@example.com").fill(ADMIN.email);
    await page.getByPlaceholder("Enter password").fill(ADMIN.password);
    await loginButton(page).click();

    // On success the SPA navigates to "/" and swaps to the authenticated
    // shell, so the login button is gone.
    await expect(page).toHaveURL(`http://localhost:${FRONTEND_PORT}/`);
    await expect(loginButton(page)).toHaveCount(0);
  });

  test("rejects a wrong password and does not authenticate", async ({
    page,
  }) => {
    await page.goto("/login");

    await page.getByPlaceholder("admin@example.com").fill(ADMIN.email);
    await page.getByPlaceholder("Enter password").fill("WrongPass1234!");
    await loginButton(page).click();

    // The global 401 interceptor (api.js) clears storage and redirects to
    // /login on any 401, so we land back on the login screen, unauthenticated.
    await expect(page).toHaveURL(/\/login$/);
    await expect(loginButton(page)).toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeNull();
  });
});
