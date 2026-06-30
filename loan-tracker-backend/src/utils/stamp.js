// Reusable lender "official stamp" for downloadable documents
// (PDFs + Excels). One source of truth for the artwork — every
// loan statement, client statement, receipt, and exported sheet
// pulls the same shape, so the brand reads consistently across
// every channel.
//
// PDF rendering uses svg-to-pdfkit which respects textPath/arc
// (PDFKit natively can't curve text). Excel rendering is text-
// only — ExcelJS doesn't render SVG and rasterising would need
// `sharp` which is heavy native deps; a bordered cell range
// with name + location + date keeps Excels feeling official
// without the install footprint.
import SVGtoPDF from "svg-to-pdfkit";

// Render a Date to the "04 JUN 2026" form the stamp uses.
// Pulled out so PDF + Excel surfaces print the exact same
// string, regardless of locale.
export function formatStampDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d
    .toLocaleString("en-GB", { month: "short" })
    .toUpperCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

// Build the location string from a tenant row. Defaults are
// blank rather than "NAIROBI · KENYA" so a tenant without
// address data renders just the business_name + date, not
// somebody else's city.
function locationFor(tenant = {}) {
  const city = (tenant.city || "").trim();
  const country = (tenant.country || "").trim();
  if (city && country) return `${city.toUpperCase()} · ${country.toUpperCase()}`;
  if (city) return city.toUpperCase();
  if (country) return country.toUpperCase();
  return "";
}

// Truncate REALLY long lender names so they don't wrap past the
// outer ring. The arc has hard width limits even with shrunken
// type, so anything past ~38 chars gets an ellipsis. Most
// businesses fit; this catches the pathological cases.
function fitTopArc(name) {
  const upper = (name || "").toUpperCase();
  return upper.length > 38 ? upper.slice(0, 37) + "…" : upper;
}

// Pick a (fontSize, letterSpacing) pair that fits `text` inside
// the stamp's top arc (radius 120, ~π·r = 377pt of arc length).
// Defaults match the original "LENDERFEST LTD" hand-tuned spec;
// progressively shrunken as the name gets longer so a 24-char
// "PAYONEER LIMITED COMPANY" renders complete instead of
// overflowing past the rings. Arial Bold uppercase width is
// roughly fontSize × 0.62 per glyph.
function topArcType(text) {
  const len = text.length;
  if (len <= 14) return { fontSize: 23, letterSpacing: 4 };
  if (len <= 18) return { fontSize: 21, letterSpacing: 3 };
  if (len <= 22) return { fontSize: 18, letterSpacing: 2 };
  if (len <= 28) return { fontSize: 16, letterSpacing: 1.5 };
  if (len <= 34) return { fontSize: 14, letterSpacing: 1 };
  return { fontSize: 12, letterSpacing: 0.5 };
}

// Same dial for the (shorter, smaller-set) bottom arc — "NAIROBI ·
// KENYA" is the canonical short example; long region strings
// like "DAR ES SALAAM · TANZANIA" shrink to keep the dot
// separator centred.
function botArcType(text) {
  const len = text.length;
  if (len <= 16) return { fontSize: 16, letterSpacing: 5 };
  if (len <= 22) return { fontSize: 14, letterSpacing: 3 };
  if (len <= 28) return { fontSize: 12, letterSpacing: 2 };
  return { fontSize: 11, letterSpacing: 1 };
}

// Build the stamp's SVG markup with the lender's name, location,
// and the stamp date substituted in. Output is a complete <svg>
// element ready to hand to SVGtoPDF or to drop into an HTML
// document. The viewBox stays 300x300 so callers can size it via
// `width` when drawing.
export function buildStampSvg({
  lenderName = "",
  location = "",
  date = new Date(),
  initials = "",
} = {}) {
  const top = fitTopArc(lenderName);
  const bot = (location || "").toUpperCase();
  const topType = topArcType(top);
  const botType = botArcType(bot);
  const stamp = formatStampDate(date);
  // Centre mark: when the caller passes the lender's initials (the receipt
  // does — its own seal, not LenderFest's), render them as text. Otherwise
  // keep the original "LF" monogram drawn from rectangles.
  const mono = (initials || "").toUpperCase().slice(0, 3);
  const monoSize = mono.length <= 1 ? 54 : mono.length === 2 ? 46 : 36;
  const centerMark = mono
    ? `<text x="150" y="${(150 + monoSize * 0.34).toFixed(1)}" fill="#122A2E" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${monoSize}" letter-spacing="1.5" text-anchor="middle">${escapeXml(mono)}</text>`
    : `<g fill="#122A2E">
    <rect x="121" y="92" width="15" height="86" rx="3.5"/>
    <rect x="121" y="162" width="44" height="16" rx="3.5"/>
    <rect x="149" y="92" width="14" height="70" rx="3.5"/>
    <rect x="149" y="92" width="30" height="16" rx="3.5"/>
    <rect x="149" y="111" width="24" height="14" rx="3.5"/>
  </g>`;
  return `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${top} stamp">
  <defs>
    <path id="topArc" d="M41,99 A120,120 0 0 1 259,99"/>
    <path id="botArc" d="M52,219 A120,120 0 0 0 248,219"/>
  </defs>
  <g fill="none" stroke="#122A2E">
    <circle cx="150" cy="150" r="146" stroke-width="2.5"/>
    <circle cx="150" cy="150" r="138" stroke-width="5"/>
    <circle cx="150" cy="150" r="103" stroke-width="2"/>
  </g>
  <g fill="#122A2E" font-family="Arial, Helvetica, sans-serif" font-weight="700">
    <text font-size="${topType.fontSize}" letter-spacing="${topType.letterSpacing}" text-anchor="middle"><textPath href="#topArc" startOffset="50%">${escapeXml(top)}</textPath></text>
    <text font-size="${botType.fontSize}" letter-spacing="${botType.letterSpacing}" text-anchor="middle"><textPath href="#botArc" startOffset="50%">${escapeXml(bot)}</textPath></text>
  </g>
  <polygon points="30,144 36,150 30,156 24,150" fill="#122A2E"/>
  <polygon points="270,144 276,150 270,156 264,150" fill="#122A2E"/>
  ${centerMark}
  <rect x="96" y="196" width="108" height="26" rx="5" fill="none" stroke="#122A2E" stroke-width="2"/>
  <text x="150" y="214" fill="#122A2E" font-family="Arial, sans-serif" font-weight="700" font-size="14" letter-spacing="2" text-anchor="middle">${escapeXml(stamp)}</text>
</svg>`;
}

// Tiny escape for the three XML metacharacters that could appear
// in a business name. We don't need a full HTML encoder here
// because we control the source set (no scripts, no quotes in
// text nodes that we use).
function escapeXml(s) {
  return String(s).replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;",
  );
}

// Draw the stamp on a PDFKit document at (x, y) at the given
// size in PDF points. `tenant` should expose business_name +
// city + country; falls back gracefully when fields are blank.
//
// Catches its own errors — a stamp rendering failure must NOT
// take down the entire PDF generation, since the document is
// usable without the stamp. Logs the failure so we notice but
// keeps the receipt printable.
export function drawPdfStamp(
  doc,
  { x, y, size = 110, tenant = {}, date, initials = "" } = {},
) {
  try {
    const svg = buildStampSvg({
      lenderName: tenant.business_name,
      location: locationFor(tenant),
      date: date || new Date(),
      initials,
    });
    SVGtoPDF(doc, svg, x, y, { width: size, height: size, assumePt: true });
  } catch (err) {
    // Best-effort — never block the PDF on stamp rendering.
    // (The caller still has the rest of the document.)
    // eslint-disable-next-line no-console
    console.warn("drawPdfStamp failed:", err?.message || err);
  }
}

// Append a text-based stamp to an ExcelJS worksheet. Excel
// doesn't render SVG and embedding a rasterised image would
// drag in `sharp` (heavy native deps) for marginal value — a
// styled 3-line cell block reads as "officially stamped"
// without the install cost.
//
// Lands two rows below the last data row of `sheet`, styled
// as a small bordered block:
//
//   ┌──────────────────────────────┐
//   │  STAMPED                     │
//   │  LENDERFEST LTD · NAIROBI · KE  │
//   │  04 JUN 2026                 │
//   └──────────────────────────────┘
export function addExcelStamp(sheet, { tenant = {}, date } = {}) {
  if (!sheet) return;
  try {
    const stampDate = formatStampDate(date || new Date());
    const name = (tenant.business_name || "").toUpperCase();
    const loc = locationFor(tenant);
    const lineTwo = [name, loc].filter(Boolean).join(" · ");
    const startRow = (sheet.lastRow?.number || 0) + 3;
    const label = sheet.getCell(`A${startRow}`);
    label.value = "STAMPED";
    label.font = { bold: true, size: 9, color: { argb: "FF0A183F" } };
    const id = sheet.getCell(`A${startRow + 1}`);
    id.value = lineTwo;
    id.font = { bold: true, size: 11, color: { argb: "FF0A183F" } };
    const when = sheet.getCell(`A${startRow + 2}`);
    when.value = stampDate;
    when.font = { size: 10, color: { argb: "FF0A183F" } };
    // Light box around the three cells so it reads as one unit.
    for (let r = startRow; r <= startRow + 2; r++) {
      const cell = sheet.getCell(`A${r}`);
      cell.border = {
        top: r === startRow
          ? { style: "thin", color: { argb: "FF0A183F" } }
          : undefined,
        bottom: r === startRow + 2
          ? { style: "thin", color: { argb: "FF0A183F" } }
          : undefined,
        left: { style: "thin", color: { argb: "FF0A183F" } },
        right: { style: "thin", color: { argb: "FF0A183F" } },
      };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("addExcelStamp failed:", err?.message || err);
  }
}

// Convenience: fetch the tenant's stamp inputs (business_name +
// city + country) from the DB given a tenant id, then stamp the
// supplied Excel worksheet. Centralises the SELECT so individual
// export endpoints don't each duplicate the query. Silently
// degrades to no-op on missing tenant id / failed lookup —
// stamping is presentation, not auth.
export async function stampExcelSheet(query, sheet, tenantId, date) {
  if (!sheet || !tenantId) return;
  try {
    const r = await query(
      "SELECT business_name, city, country FROM tenants WHERE id = $1",
      [tenantId],
    );
    addExcelStamp(sheet, { tenant: r.rows[0] || {}, date });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("stampExcelSheet failed:", err?.message || err);
  }
}

export default {
  formatStampDate,
  buildStampSvg,
  drawPdfStamp,
  addExcelStamp,
  stampExcelSheet,
};
