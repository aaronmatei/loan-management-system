// Runs before every frontend test file (Vitest setupFiles).
// Adds jest-dom matchers like toBeInTheDocument / toHaveStyle, and clears
// the rendered DOM between tests so they stay isolated.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
