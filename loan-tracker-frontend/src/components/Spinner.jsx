import React from "react";

// Brand loader for any "data is fetching" state. The SVG is
// inlined (rather than imported from assets/lf-loader.svg as a
// URL) so the stroke colour, size, and ARIA label can be
// overridden per-call. Source of truth for the artwork lives at
// src/assets/lf-loader.svg — if the design changes, sync both.
//
// Usage:
//   <Spinner />                          → 40px, centered inline
//   <Spinner size={20} />                → small inline (e.g. button)
//   <Spinner size={56} label="Saving…"/> → bigger + custom aria label
//   <Spinner fullscreen />               → page-load splash
//   <Spinner centered className="py-12"/>→ block-centered with padding
//
// prefers-reduced-motion is respected via the embedded <style>:
// the spin slows to 2.4s instead of disabling outright (a
// motionless wheel reads as "frozen / app crashed").
function Spinner({
  size = 40,
  className = "",
  label = "Loading",
  color,
  fullscreen = false,
  centered = false,
}) {
  const svg = (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      style={color ? { color } : undefined}
      className={fullscreen || centered ? "" : className}
    >
      <style>{`
        .lf-spin {
          transform-origin: 50px 50px;
          animation: lf-rotate 1.1s linear infinite;
        }
        @keyframes lf-rotate { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .lf-spin { animation-duration: 2.4s; }
        }
        .lf-blade {
          fill: none;
          stroke: ${color ? "currentColor" : "#2563eb"};
          stroke-width: 8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
      `}</style>
      <g className="lf-spin">
        <g transform="rotate(0 50 50)">
          <path className="lf-blade" d="M50 12 L50 28 L64 28" opacity="1" />
        </g>
        <g transform="rotate(120 50 50)">
          <path
            className="lf-blade"
            d="M50 12 L50 28 L64 28"
            opacity="0.55"
          />
        </g>
        <g transform="rotate(240 50 50)">
          <path
            className="lf-blade"
            d="M50 12 L50 28 L64 28"
            opacity="0.28"
          />
        </g>
      </g>
    </svg>
  );

  if (fullscreen) {
    return (
      <div
        className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm ${className}`}
        role="status"
        aria-live="polite"
      >
        {svg}
        {label && (
          <p className="mt-3 text-sm text-slate-500 font-medium">{label}</p>
        )}
      </div>
    );
  }

  if (centered) {
    return (
      <div
        className={`flex flex-col items-center justify-center ${className}`}
        role="status"
        aria-live="polite"
      >
        {svg}
        {label && (
          <p className="mt-2 text-sm text-slate-500">{label}</p>
        )}
      </div>
    );
  }

  return svg;
}

export default Spinner;
