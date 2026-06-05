// Render the LenderFest markdown manuals into branded PDFs using pdfkit
// (the only PDF tool available here). Supports the markdown subset used in
// docs/*.md: # / ## / ### headings, paragraphs, **bold**, `code`, "- " bullet
// and "N." numbered lists, > blockquotes, --- rules, and | pipe | tables.
//
//   node scripts/build-manual-pdfs.mjs
import PDFDocument from "pdfkit";
import { FONT, registerPdfFonts } from "../src/utils/pdfFonts.js";
import { drawBrandMark } from "../src/utils/pdfBrand.js";
import { readFileSync, createWriteStream, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = join(__dirname, "..", "..", "docs");

const OCEAN = "#0e8a6e";
const NAVY = "#122a2e";
const SLATE = "#475569";
const MUTED = "#94a3b8";
const LIGHT = "#ecfbf5";
const BORDER = "#e2e8f0";
const REG = FONT.reg;
const BOLD = FONT.bold;
const DISPLAY = FONT.display;
const MONO = "Courier";

const MANUALS = [
  { md: "LENDER-MANUAL.md", pdf: "LenderFest-Lender-Manual.pdf", audience: "Lender Guide" },
  { md: "BORROWER-MANUAL.md", pdf: "LenderFest-Borrower-Manual.pdf", audience: "Borrower Guide" },
];

// ── inline: split a line into {text, bold, code} runs ─────────────
function runs(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) out.push({ text: tok.slice(2, -2), bold: true });
    else out.push({ text: tok.slice(1, -1), code: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

function build({ md, pdf, audience }) {
  const src = readFileSync(join(DOCS, md), "utf8");
  const lines = src.split("\n");

  const doc = new PDFDocument({ size: "A4", margin: 56, bufferPages: true });
  registerPdfFonts(doc);
  doc.pipe(createWriteStream(join(DOCS, pdf)));
  const M = doc.page.margins.left;
  const W = doc.page.width - M * 2;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const ensure = (h) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // Render inline runs as one wrapped paragraph at width w (indent x optional).
  const inline = (text, { x = M, w = W, size = 10.5, color = SLATE, gap = 6 } = {}) => {
    const segs = runs(text);
    doc.fontSize(size);
    segs.forEach((s, i) => {
      doc.font(s.bold ? BOLD : s.code ? MONO : REG).fillColor(s.code ? OCEAN : color);
      const opts = { width: w, continued: i < segs.length - 1, lineGap: 1.5 };
      // Only the first run positions; continuations flow inline.
      if (i === 0) doc.text(s.text, x, doc.y, opts);
      else doc.text(s.text, opts);
    });
    doc.y += gap;
  };

  // ── Cover ───────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 220).fill(OCEAN);
  drawBrandMark(doc, { x: M, y: 66, size: 22, variant: "light" });
  doc.fillColor("#ffffff").font(DISPLAY).fontSize(15).text("LenderFest", M + 28, 70);
  doc.font(DISPLAY).fontSize(34).text(
    md.includes("LENDER") ? "Lender User Manual" : "Borrower User Manual",
    M, 110, { width: W },
  );
  doc.font(REG).fontSize(13).fillColor("#dbeeff");
  doc.text(
    md.includes("LENDER")
      ? "Run your lending business — clients, loans, repayments & reports."
      : "One account, every lender — apply, track & repay your loans.",
    M, 165, { width: W },
  );
  doc.y = 260;
  doc.fillColor(MUTED).font(REG).fontSize(10);
  doc.text(`LenderFest • ${audience} • Generated ${new Date().toLocaleDateString("en-KE")}`, M, 250);
  doc.moveDown(2);

  // ── Body ────────────────────────────────────────────────────────
  let i = 0;
  let titleSkipped = false; // the cover banner already shows the H1 title
  while (i < lines.length) {
    let line = lines[i];

    // blank
    if (!line.trim()) { doc.y += 3; i++; continue; }

    // horizontal rule
    if (/^---+$/.test(line.trim())) {
      ensure(16);
      doc.moveTo(M, doc.y + 4).lineTo(M + W, doc.y + 4).lineWidth(0.7).strokeColor(BORDER).stroke();
      doc.y += 14; i++; continue;
    }

    // headings
    if (line.startsWith("### ")) {
      ensure(28);
      doc.moveDown(0.3);
      doc.font(BOLD).fontSize(12.5).fillColor(NAVY).text(line.slice(4), M, doc.y, { width: W });
      doc.y += 4; i++; continue;
    }
    if (line.startsWith("## ")) {
      ensure(40);
      doc.moveDown(0.6);
      doc.font(BOLD).fontSize(16).fillColor(OCEAN).text(line.slice(3), M, doc.y, { width: W });
      doc.y += 2;
      doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(1).strokeColor(BORDER).stroke();
      doc.y += 8; i++; continue;
    }
    if (line.startsWith("# ")) {
      if (!titleSkipped) { titleSkipped = true; i++; continue; }
      ensure(30);
      doc.font(BOLD).fontSize(20).fillColor(NAVY).text(line.slice(2), M, doc.y, { width: W });
      doc.y += 8; i++; continue;
    }

    // blockquote (consecutive >)
    if (line.startsWith(">")) {
      const qs = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        qs.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const text = qs.join(" ").replace(/\s+/g, " ").trim();
      doc.font(REG).fontSize(10);
      const h = doc.heightOfString(text.replace(/\*\*|`/g, ""), { width: W - 28, lineGap: 1.5 }) + 16;
      ensure(h + 6);
      const top = doc.y;
      doc.rect(M, top, W, h).fill(LIGHT);
      doc.rect(M, top, 3.5, h).fill(OCEAN);
      doc.y = top + 8;
      inline(text, { x: M + 14, w: W - 28, size: 10, color: NAVY, gap: 0 });
      doc.y = top + h + 8;
      continue;
    }

    // table (header | sep | rows)
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]+$/.test(lines[i + 1])) {
      const rows = [];
      const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const header = cells(line);
      i += 2; // skip header + separator
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i])); i++;
      }
      drawTable(header, rows);
      continue;
    }

    // list (consecutive bullets or ordered)
    const isBullet = /^[-*]\s+/.test(line);
    const isOrdered = /^\d+\.\s+/.test(line);
    if (isBullet || isOrdered) {
      let n = 1;
      while (i < lines.length && (/^[-*]\s+/.test(lines[i]) || /^\d+\.\s+/.test(lines[i]))) {
        const raw = lines[i];
        const ordered = /^\d+\.\s+/.test(raw);
        const txt = raw.replace(/^([-*]|\d+\.)\s+/, "");
        const marker = ordered ? `${n}.` : "•";
        doc.font(BOLD).fontSize(10.5).fillColor(OCEAN);
        const indent = 16;
        ensure(doc.heightOfString(txt.replace(/\*\*|`/g, ""), { width: W - indent }) + 6);
        const y0 = doc.y;
        doc.text(marker, M, y0, { width: indent });
        doc.y = y0;
        inline(txt, { x: M + indent, w: W - indent, size: 10.5, color: SLATE, gap: 4 });
        n++; i++;
      }
      doc.y += 2;
      continue;
    }

    // paragraph (gather until blank/special)
    const para = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].startsWith("#") && !lines[i].startsWith(">") &&
      !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim()) && !lines[i].includes("|")
    ) { para.push(lines[i]); i++; }
    inline(para.join(" "), { size: 10.5, color: SLATE, gap: 7 });
  }

  // ── Table renderer ──────────────────────────────────────────────
  function drawTable(header, rows) {
    const cols = header.length;
    // First column a touch wider for label-style tables.
    const w0 = cols === 2 ? W * 0.34 : W / cols;
    const colW = header.map((_, c) => (cols === 2 ? (c === 0 ? w0 : W - w0) : W / cols));
    const pad = 6;

    const rowHeight = (cells, font, size) => {
      doc.font(font).fontSize(size);
      let max = 0;
      cells.forEach((cell, c) => {
        const h = doc.heightOfString(cell.replace(/\*\*|`/g, ""), { width: colW[c] - pad * 2, lineGap: 1 });
        if (h > max) max = h;
      });
      return max + pad * 2;
    };

    const drawRow = (cells, { head = false } = {}) => {
      const h = rowHeight(cells, head ? BOLD : REG, head ? 9.5 : 9.5);
      ensure(h);
      const y0 = doc.y;
      if (head) doc.rect(M, y0, W, h).fill(OCEAN);
      else doc.rect(M, y0, W, h).fill("#ffffff");
      // borders
      doc.lineWidth(0.5).strokeColor(BORDER).rect(M, y0, W, h).stroke();
      let x = M;
      cells.forEach((cell, c) => {
        if (c > 0) doc.moveTo(x, y0).lineTo(x, y0 + h).strokeColor(BORDER).stroke();
        doc.font(head ? BOLD : REG).fontSize(9.5).fillColor(head ? "#ffffff" : NAVY);
        // inline bold inside body cells
        const segs = runs(cell);
        doc.y = y0 + pad;
        segs.forEach((s, si) => {
          doc.font(s.bold || head ? BOLD : s.code ? MONO : REG)
             .fillColor(head ? "#ffffff" : s.code ? OCEAN : NAVY);
          const opts = { width: colW[c] - pad * 2, continued: si < segs.length - 1, lineGap: 1 };
          if (si === 0) doc.text(s.text, x + pad, y0 + pad, opts);
          else doc.text(s.text, opts);
        });
        x += colW[c];
      });
      doc.y = y0 + h;
    };

    doc.moveDown(0.2);
    drawRow(header, { head: true });
    rows.forEach((r) => {
      // pad/truncate to column count
      while (r.length < cols) r.push("");
      drawRow(r.slice(0, cols));
    });
    doc.y += 8;
  }

  // ── Footer / page numbers ───────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let p = 0; p < range.count; p++) {
    doc.switchToPage(p);
    const y = doc.page.height - 38;
    doc.font(REG).fontSize(8).fillColor(MUTED);
    doc.text("LenderFest — confidential", M, y, { width: W / 2, lineBreak: false });
    doc.text(`Page ${p + 1} of ${range.count}`, M + W / 2, y, {
      width: W / 2, align: "right", lineBreak: false,
    });
  }

  doc.end();
  return new Promise((res) => doc.on("end", res));
}

mkdirSync(DOCS, { recursive: true });
for (const m of MANUALS) {
  await build(m);
  console.log("✓", m.pdf);
}
console.log("Done →", DOCS);
