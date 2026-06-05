// The LenderFest logo mark (three ascending rounded bars + an amber spark)
// rendered into a pdfkit document, so every PDF that shows the "LenderFest"
// wordmark can sit it beside the logo. Uses svg-to-pdfkit (already a dep,
// see stamp.js).
import SVGtoPDF from "svg-to-pdfkit";

const C = {
  tealDeep: "#0A5C4C",
  teal: "#0E8A6E",
  green: "#22B488",
  amber: "#F6A92B",
  cream: "#FBF7EF",
};

function markSvg(variant) {
  // "light" (cream) for dark/teal backgrounds; "color" for light backgrounds.
  const c =
    variant === "light"
      ? { b1: C.cream, b2: C.cream, b3: C.cream, sp: C.cream }
      : { b1: C.tealDeep, b2: C.teal, b3: C.green, sp: C.amber };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="14" y="58" width="17" height="26" rx="7" fill="${c.b1}"/>
    <rect x="39" y="44" width="17" height="40" rx="7" fill="${c.b2}"/>
    <rect x="64" y="30" width="17" height="54" rx="7" fill="${c.b3}"/>
    <path d="M70 3 Q75 12 84 17 Q75 22 70 31 Q65 22 56 17 Q65 12 70 3 Z" fill="${c.sp}"/>
    <path d="M26 38 Q28.5 43 33 45 Q28.5 47 26 52 Q23.5 47 19 45 Q23.5 43 26 38 Z" fill="${c.sp}" opacity="0.55"/>
  </svg>`;
}

// Draw the mark at (x, y), `size` points square. The logo is decorative —
// a render failure must never break the document, so it's swallowed.
export function drawBrandMark(doc, { x, y, size = 16, variant = "color" } = {}) {
  try {
    SVGtoPDF(doc, markSvg(variant), x, y, {
      width: size,
      height: size,
      assumePt: true,
    });
  } catch {
    /* ignore — logo is decorative */
  }
}
