// ErrorBoundary is the safety net — if it breaks, a single render-
// time crash anywhere in the app goes back to white-screening users.
// Pin the contract: renders children on the happy path; renders the
// fallback when a child throws; the fallback has reachable Reload +
// Home buttons.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

// Mute the React + console noise from intentional throws so the test
// output stays readable. Restored after each test.
const originalConsoleError = console.error;
afterEach(() => {
  console.error = originalConsoleError;
  cleanup();
});

function Boom() {
  throw new Error("intentional render-time crash");
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>healthy child</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy child")).toBeInTheDocument();
  });

  it("renders the fallback when a child throws", () => {
    console.error = vi.fn(); // mute the expected error output
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    // Headline copy from the fallback.
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("exposes Reload + Home buttons on the fallback", () => {
    console.error = vi.fn();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole("button", { name: /reload page/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /go home/i }),
    ).toBeInTheDocument();
  });

  it("sets role='alert' on the fallback so screen readers announce it", () => {
    console.error = vi.fn();
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.querySelector("[role='alert']")).toBeTruthy();
  });
});
