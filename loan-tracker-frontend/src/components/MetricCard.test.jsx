import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MetricCard from "./MetricCard";

describe("MetricCard", () => {
  it("renders the title and value", () => {
    render(<MetricCard title="Active Loans" value="42" color="#0ea5e9" />);

    expect(screen.getByText("Active Loans")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("uses the given color as the left-border accent", () => {
    const { container } = render(
      <MetricCard title="Disbursed" value="KES 1.2M" color="rgb(14, 165, 233)" />,
    );

    expect(container.firstChild).toHaveStyle({
      borderLeft: "4px solid rgb(14, 165, 233)",
    });
  });
});
