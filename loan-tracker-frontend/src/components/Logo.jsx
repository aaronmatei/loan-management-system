// LenderFest logo — mark + wordmark.
//
// The mark is three ascending rounded bars (growth) with an amber spark.
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

export function LogoMark({ variant = "color", className = "", title = "LenderFest" }) {
  let b1, b2, b3, sp;
  if (variant === "ink") b1 = b2 = b3 = sp = C.ink;
  else if (variant === "light") b1 = b2 = b3 = sp = C.cream;
  else {
    b1 = C.tealDeep;
    b2 = C.teal;
    b3 = C.green;
    sp = C.amber;
  }
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="14" y="58" width="17" height="26" rx="7" fill={b1} />
      <rect x="39" y="44" width="17" height="40" rx="7" fill={b2} />
      <rect x="64" y="30" width="17" height="54" rx="7" fill={b3} />
      <path d="M70 3 Q75 12 84 17 Q75 22 70 31 Q65 22 56 17 Q65 12 70 3 Z" fill={sp} />
      <path
        d="M26 38 Q28.5 43 33 45 Q28.5 47 26 52 Q23.5 47 19 45 Q23.5 43 26 38 Z"
        fill={sp}
        opacity={variant === "color" ? 0.55 : 0.5}
      />
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
