import React from "react";

// Shimmering placeholder for "data is loading" states (Dashboard + Loans
// UX pilot). A lighter-weight alternative to the brand <Spinner/> for
// content-shaped loading — the skeleton mirrors the layout that's about to
// appear, so the page doesn't jump when data lands. The shimmer animation
// + prefers-reduced-motion handling live in the `.lf-skeleton` class in
// src/index.css.
//
// Usage:
//   <Skeleton className="h-4 w-24" />            → a single bar
//   <Skeleton className="h-24 w-full rounded-2xl" />
//   <SkeletonText lines={3} />                   → stacked text bars

export default function Skeleton({ className = "", rounded = "rounded-lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`lf-skeleton block ${rounded} ${className}`}
    />
  );
}

// A few text-height bars; the last is shortened so it reads like a
// trailing line of copy.
export function SkeletonText({ lines = 3, className = "" }) {
  return (
    <span className={`block space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </span>
  );
}
