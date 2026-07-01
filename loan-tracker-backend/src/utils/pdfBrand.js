// The LenderFest logo mark (two interlocking rings — green + amber) rendered
// into a pdfkit document, so every PDF that shows the "LenderFest" wordmark can
// sit it beside the logo. Uses svg-to-pdfkit (already a dep, see stamp.js).
import SVGtoPDF from "svg-to-pdfkit";

const C = {
  green: "#1E8A5F",
  amber: "#F0A32B",
  cream: "#FBF7EF",
};

function markSvg(variant) {
  // "light" (cream) for dark/teal backgrounds; "color" (green + amber) for light.
  const a = variant === "light" ? C.cream : C.green;
  const b = variant === "light" ? C.cream : C.amber;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 -3 54 54" fill="none">
    <circle cx="22" cy="24" r="13" fill="none" stroke="${a}" stroke-width="6"/>
    <circle cx="40" cy="24" r="13" fill="none" stroke="${b}" stroke-width="6"/>
    <path d="M33.26 30.5 A13 13 0 0 1 27.7 35.68" fill="none" stroke="${a}" stroke-width="6"/>
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
