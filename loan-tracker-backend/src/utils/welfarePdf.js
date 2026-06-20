// Welfare statement PDFs (group + per-member), built with pdfkit and returned
// as Buffers — same streaming approach as utils/pdfDocuments.js. Builders take
// pre-fetched data so the route owns the queries.
import PDFDocument from "pdfkit";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

const streamToBuffer = (doc) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

const ACCENT = "#0e8a6e";

function header(doc, welfareName, title) {
  doc.fontSize(18).fillColor(ACCENT).text(welfareName, { continued: false });
  doc.fontSize(12).fillColor("#333").text(title);
  doc.fontSize(9).fillColor("#888").text(`Generated ${dt(new Date().toISOString())}`);
  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(ACCENT);
  doc.moveDown(0.7);
}

// Right-aligned columns helper: cols = [{label, x, w, align}].
function row(doc, cells, y, opts = {}) {
  doc.fontSize(opts.size || 9).fillColor(opts.color || "#000");
  for (const c of cells) {
    doc.text(c.text, c.x, y, { width: c.w, align: c.align || "left" });
  }
}

// Group statement: summary + per-member table.
export async function buildWelfareStatementPdf(welfare, summary, members) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const done = streamToBuffer(doc);
  header(doc, welfare.name, "Group Statement");

  // Summary grid.
  doc.fontSize(13).fillColor(ACCENT).text("Summary", { underline: true });
  doc.moveDown(0.4);
  const s = summary;
  const lines = [
    ["Pool balance", money(s.pool.balance)],
    ["Members' savings", money(s.pool.members_savings)],
    ["Distributable surplus", money(s.pool.surplus)],
    ["Active members", String(s.members.active)],
    ["Loans outstanding", `${money(s.loans.outstanding)} (${s.loans.open} open)`],
    ["Penalties outstanding", money(s.penalties.outstanding)],
    ["Dividends distributed", `${money(s.dividends.total)} (${s.dividends.runs} share-out${s.dividends.runs === 1 ? "" : "s"})`],
  ];
  doc.fontSize(10).fillColor("#000");
  for (const [k, v] of lines) {
    doc.text(`${k}: `, { continued: true }).fillColor("#000").text(v).fillColor("#000");
  }
  doc.moveDown();

  // Member table.
  doc.fontSize(13).fillColor(ACCENT).text("Members", { underline: true });
  doc.moveDown(0.4);
  const cols = [
    { key: "member_no", label: "No.", x: 50, w: 60 },
    { key: "name", label: "Name", x: 110, w: 120 },
    { key: "savings", label: "Savings", x: 230, w: 75, align: "right", money: true },
    { key: "loan_outstanding", label: "Loan bal", x: 305, w: 65, align: "right", money: true },
    { key: "penalty_outstanding", label: "Penalty", x: 370, w: 60, align: "right", money: true },
    { key: "dividends", label: "Dividends", x: 430, w: 65, align: "right", money: true },
    { key: "attendance_pct", label: "Att%", x: 495, w: 50, align: "right" },
  ];
  let y = doc.y;
  row(doc, cols.map((c) => ({ text: c.label, x: c.x, w: c.w, align: c.align })), y, { color: ACCENT, size: 9 });
  y += 14;
  doc.moveTo(50, y).lineTo(545, y).stroke("#ccc");
  y += 4;

  for (const m of members) {
    if (y > 780) { doc.addPage(); y = 50; }
    row(doc, cols.map((c) => {
      let text;
      if (c.money) text = money(m[c.key]).replace("KES ", "");
      else if (c.key === "attendance_pct") text = m.attendance_pct == null ? "—" : `${m.attendance_pct}%`;
      else text = String(m[c.key] ?? "");
      return { text, x: c.x, w: c.w, align: c.align };
    }), y, { size: 8 });
    y += 14;
  }
  doc.y = y;
  doc.end();
  return { buffer: await done, filename: `${welfare.name.replace(/[^a-z0-9]+/gi, "_")}_statement_${new Date().toISOString().split("T")[0]}.pdf` };
}

// Per-member statement: balances + ledger.
export async function buildMemberStatementPdf(welfare, member, balances, ledger) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const done = streamToBuffer(doc);
  header(doc, welfare.name, `Member Statement — ${member.first_name} ${member.last_name}`);

  doc.fontSize(10).fillColor("#000");
  doc.text(`Member No: ${member.member_no}`);
  if (member.phone_number) doc.text(`Phone: ${member.phone_number}`);
  doc.text(`Status: ${member.status}`);
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor(ACCENT).text("Balances", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#000");
  doc.text(`Savings: ${money(balances.savings)}`);
  doc.text(`Loan outstanding: ${money(balances.loan_outstanding)}`);
  doc.text(`Penalties outstanding: ${money(balances.penalty_outstanding)}`);
  doc.text(`Dividends received: ${money(balances.dividends)}`);
  doc.moveDown();

  doc.fontSize(11).fillColor(ACCENT).text("Activity", { underline: true });
  doc.moveDown(0.3);
  let y = doc.y;
  const cols = [
    { x: 50, w: 90, label: "Date" },
    { x: 140, w: 140, label: "Type" },
    { x: 280, w: 120, label: "Amount", align: "right" },
    { x: 400, w: 145, label: "Pool balance", align: "right" },
  ];
  row(doc, cols.map((c) => ({ text: c.label, x: c.x, w: c.w, align: c.align })), y, { color: ACCENT, size: 9 });
  y += 14;
  doc.moveTo(50, y).lineTo(545, y).stroke("#ccc");
  y += 4;
  for (const t of ledger) {
    if (y > 780) { doc.addPage(); y = 50; }
    const sign = t.direction > 0 ? "+" : "-";
    row(doc, [
      { text: dt(t.txn_date), x: 50, w: 90 },
      { text: String(t.type).replace(/_/g, " "), x: 140, w: 140 },
      { text: `${sign}${money(t.amount).replace("KES ", "")}`, x: 280, w: 120, align: "right" },
      { text: money(t.balance_after).replace("KES ", ""), x: 400, w: 145, align: "right" },
    ], y, { size: 8 });
    y += 13;
  }
  doc.y = y;
  doc.end();
  return { buffer: await done, filename: `${member.member_no}_statement_${new Date().toISOString().split("T")[0]}.pdf` };
}

export default { buildWelfareStatementPdf, buildMemberStatementPdf };

// Member-loan statement: loan terms + installment schedule + repayment postings.
export async function buildMemberLoanStatementPdf(welfare, loan, member, schedule, ledger) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const done = streamToBuffer(doc);
  header(doc, welfare.name, `Loan statement — ${loan.loan_code}`);

  doc.fontSize(10).fillColor("#000");
  doc.text(`Member: ${member.first_name} ${member.last_name} (${member.member_no || "—"})`);
  doc.text(`Principal: ${money(loan.principal)}   Rate: ${Number(loan.interest_rate)}% ${loan.interest_method}   Term: ${loan.duration_months} mo`);
  doc.text(`Total repayable: ${money(loan.total_amount_due)}   Paid: ${money(loan.amount_paid)}   Balance: ${money(Number(loan.total_amount_due) - Number(loan.amount_paid))}`);
  doc.text(`Status: ${loan.status}${loan.disbursed_at ? `   Disbursed: ${dt(loan.disbursed_at)}` : ""}`);
  doc.moveDown(0.7);

  if (schedule?.length) {
    doc.fontSize(11).fillColor(ACCENT).text("Schedule", { underline: true });
    doc.moveDown(0.3);
    const cols = [{ x: 50, w: 30 }, { x: 85, w: 80 }, { x: 170, w: 90, align: "right" }, { x: 265, w: 90, align: "right" }, { x: 360, w: 90, align: "right" }, { x: 455, w: 90 }];
    row(doc, [{ text: "#", x: cols[0].x, w: cols[0].w }, { text: "Due", x: cols[1].x, w: cols[1].w }, { text: "Amount", x: cols[2].x, w: cols[2].w, align: "right" }, { text: "Interest", x: cols[3].x, w: cols[3].w, align: "right" }, { text: "Paid", x: cols[4].x, w: cols[4].w, align: "right" }, { text: "Status", x: cols[5].x, w: cols[5].w }], doc.y, { color: "#888" });
    doc.moveDown(0.6);
    for (const s of schedule) {
      if (doc.y > 770) doc.addPage();
      const y = doc.y;
      row(doc, [
        { text: String(s.payment_number), x: cols[0].x, w: cols[0].w },
        { text: dt(s.due_date), x: cols[1].x, w: cols[1].w },
        { text: money(s.amount_due), x: cols[2].x, w: cols[2].w, align: "right" },
        { text: money(s.interest_portion), x: cols[3].x, w: cols[3].w, align: "right" },
        { text: money(s.amount_paid), x: cols[4].x, w: cols[4].w, align: "right" },
        { text: s.status, x: cols[5].x, w: cols[5].w },
      ], y);
      doc.moveDown(0.6);
    }
    doc.moveDown(0.5);
  }

  if (ledger?.length) {
    doc.fontSize(11).fillColor(ACCENT).text("Postings", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor("#000");
    for (const t of ledger) {
      if (doc.y > 780) doc.addPage();
      doc.text(`${dt(t.txn_date)}  ${String(t.type).replace(/_/g, " ")}  ${t.direction < 0 ? "−" : "+"}${money(t.amount)}`);
    }
  }

  doc.end();
  return { buffer: await done, filename: `${loan.loan_code}_statement_${new Date().toISOString().split("T")[0]}.pdf` };
}
