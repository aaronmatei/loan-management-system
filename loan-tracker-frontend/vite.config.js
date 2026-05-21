/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  test: {
    // Browser-like DOM for React component tests; node would be too bare.
    environment: "jsdom",
    // describe/it/expect available without imports (matches backend setup).
    globals: true,
    // Registers @testing-library/jest-dom matchers + auto-cleanup.
    setupFiles: ["./src/test/setup.js"],
    // Don't pull component CSS imports through the pipeline — faster, and
    // we assert behavior/markup, not styles.
    css: false,
  },
});
