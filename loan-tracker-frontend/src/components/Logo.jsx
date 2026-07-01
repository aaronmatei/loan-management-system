// LenderFest logo — mark + wordmark.
//
// The mark is two interlocking rings — a green and an amber loop (growth +
// partnership); the green ring crosses over amber at the overlap.
// The wordmark is Bricolage Grotesque extrabold, "Lend" + "Fest". Both
// lockups use the full-color mark; only the wordmark colors flip:
//   • default  (light bg): Lend = ink,   Fest = teal
//   • reversed (dark  bg): Lend = cream, Fest = green
//
//   <Logo />                          full lockup on a light surface
//   <Logo variant="reversed" />       full lockup on ink/teal surfaces
//   <LogoMark className="h-8 w-8" />  icon only (collapsed sidebar, etc.)
//
// Tenant customer-portal surfaces are white-labeled and brand on the
// tenant's own color (see portal/brand.js) — do NOT use this there.

const C = {
  ink: "#122A2E",
  teal: "#0E8A6E",
  tealDeep: "#0A5C4C",
  green: "#22B488",
  amber: "#F6A92B",
  cream: "#FBF7EF",
};

// Brand mark ring colours (from the redesigned two-ring mark).
const RING_GREEN = "#1E8A5F";
const RING_AMBER = "#F0A32B";

export function LogoMark({ variant = "color", className = "", title = "LenderFest" }) {
  // color = green + amber interlocking rings; ink/light collapse to one colour.
  const a = variant === "ink" ? C.ink : variant === "light" ? C.cream : RING_GREEN;
  const b = variant === "ink" ? C.ink : variant === "light" ? C.cream : RING_AMBER;
  return (
    <svg
      viewBox="4 -3 54 54"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="22" cy="24" r="13" stroke={a} strokeWidth="6" />
      <circle cx="40" cy="24" r="13" stroke={b} strokeWidth="6" />
      {/* the green ring re-crosses over amber at the overlap so they interlock */}
      <path d="M33.26 30.5 A13 13 0 0 1 27.7 35.68" stroke={a} strokeWidth="6" />
    </svg>
  );
}

export default function Logo({
  variant = "default",
  markClassName = "h-7 w-7",
  textClassName = "text-2xl",
  className = "",
}) {
  const reversed = variant === "reversed";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark variant="color" className={markClassName} />
      <span
        className={`font-display font-extrabold leading-none tracking-tight ${textClassName}`}
      >
        <span style={{ color: reversed ? C.cream : C.ink }}>Lender</span>
        <span style={{ color: reversed ? C.green : C.teal }}>Fest</span>
      </span>
    </span>
  );
}
