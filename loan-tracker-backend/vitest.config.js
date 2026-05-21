import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Rebuild the test schema ONCE per run (main process).
    globalSetup: ["./tests/setup/global-setup.js"],
    // Load .env.test into every worker BEFORE src/config/database.js is
    // imported (its Pool reads process.env at import time).
    setupFiles: ["./tests/setup/load-env.js"],
    // Tests share one DB — run serially to avoid cross-test races.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
