import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { BACKEND_PORT, FRONTEND_PORT, E2E_DB, dbConfig } from "./fixtures.js";

const db = dbConfig(E2E_DB);

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Playwright boots BOTH servers and waits for them. The backend is pinned
  // to the isolated e2e DB via env (server.js's dotenv loads .env but cannot
  // override these already-set vars). reuseExistingServer is false so we
  // never accidentally run against a dev server on the same port.
  webServer: [
    {
      command: "npm run start",
      cwd: "../loan-tracker-backend",
      url: `http://localhost:${BACKEND_PORT}/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        NODE_ENV: "test",
        PORT: String(BACKEND_PORT),
        DB_HOST: db.host,
        DB_PORT: String(db.port),
        DB_NAME: E2E_DB,
        DB_USER: db.user,
        DB_PASSWORD: db.password,
        JWT_SECRET: "e2e_secret_only_minimum_32_characters_long",
        JWT_EXPIRE: "7d",
        // Allow the e2e frontend's (alt-port) origin through CORS.
        CORS_ORIGINS: `http://localhost:${FRONTEND_PORT}`,
        SMS_ENABLED: "false",
        EMAIL_ENABLED: "false",
        BACKUP_SCHEDULE_ENABLED: "false",
      },
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      cwd: "../loan-tracker-frontend",
      url: `http://localhost:${FRONTEND_PORT}`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        // Honored once src/services/api.js reads VITE_API_URL; lets the E2E
        // frontend target the E2E backend when running on non-default ports.
        VITE_API_URL: `http://localhost:${BACKEND_PORT}/api`,
      },
    },
  ],
});
