// LenderFest PDF fonts. pdfkit ships only the 14 standard PDF fonts
// (Helvetica/Times/Courier); to render documents in the brand typefaces we
// embed static TTFs and register them per-document.
//
// Body  = Hanken Grotesk        (matches the app body font)
// Bold  = Hanken Grotesk Bold
// Display = Bricolage Grotesque ExtraBold (matches the wordmark / headings)
//
// Usage:
//   import { FONT, registerPdfFonts } from "../utils/pdfFonts.js";
//   const doc = new PDFDocument(...);
//   registerPdfFonts(doc);
//   doc.font(FONT.display).text("LOAN STATEMENT");
//   doc.font(FONT.reg).text("body copy");
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const FONT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "fonts",
);

// Names to pass to doc.font(...). `mono` is the pdfkit builtin (no embed).
export const FONT = {
  reg: "LFBody",
  bold: "LFBold",
  italic: "LFItalic",
  display: "LFDisplay",
  mono: "Courier",
};

// Register the embedded TTFs on a freshly created PDFDocument. Idempotent
// per document; call once right after `new PDFDocument(...)`.
export function registerPdfFonts(doc) {
  doc.registerFont(FONT.reg, join(FONT_DIR, "HankenGrotesk-Regular.ttf"));
  doc.registerFont(FONT.bold, join(FONT_DIR, "HankenGrotesk-Bold.ttf"));
  doc.registerFont(FONT.italic, join(FONT_DIR, "HankenGrotesk-Italic.ttf"));
  doc.registerFont(FONT.display, join(FONT_DIR, "BricolageGrotesque-ExtraBold.ttf"));
  return doc;
}
