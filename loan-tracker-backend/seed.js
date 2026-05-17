/**
 * Database seed script — realistic Kenyan loan-management test data.
 *
 *   Run with:  npm run seed
 *
 * Generates ~200 clients and ~250 loans spread across five real-world
 * scenarios (completed, completed+overpayment, active on-track, active
 * overdue, defaulted), with matching payment schedules and transactions.
 *
 * Notes on schema:
 *  - migrations/init.sql does NOT define the refund/overpayment columns on
 *    `loans` or `notes` on `transactions`, yet the running app uses them.
 *    This script ADD COLUMN IF NOT EXISTS (additive, non-destructive) so it
 *    works on the live DB and on a freshly `npm run migrate`-d database.
 *  - `loans.interest_rate` stores the MONTHLY rate (annual / 12), matching
 *    src/routes/loans.js. Interest itself is computed from the annual rate:
 *    total_interest = principal * (annualRate/100) * (months/12).
 */

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
// Target mix over ~755 loans:
//   30% completed, 10% completed+overpaid, 25% active on-schedule,
//   20% active overdue, 15% defaulted
const SCENARIO_COUNTS = {
  completed: 225, // A — 30%
  completedOverpaid: 75, // B — 10% (≈60% refunded / 40% pending)
  activeOnSchedule: 190, // C — 25%
  activeOverdue: 150, // D — 20%
  defaulted: 115, // E — 15%
};
const CLIENT_COUNT = 500;
const TOTAL_LOANS = Object.values(SCENARIO_COUNTS).reduce((a, b) => a + b, 0);

const NOW = new Date();
const YEAR = 2026; // code prefixes per spec (CLT-2026-, LN-2026-, TXN-2026-)

// ----------------------------------------------------------------------------
// Reference data
// ----------------------------------------------------------------------------
const FIRST_NAMES = [
  "John", "Mary", "Peter", "Grace", "James", "Lucy", "David", "Faith",
  "Samuel", "Esther", "Kevin", "Margaret", "Joseph", "Caroline", "Brian",
  "Anne", "Daniel", "Susan", "Michael", "Hellen", "Paul", "Ruth", "Robert",
  "Joyce", "Stephen", "Mercy", "George", "Jane", "Patrick", "Eunice",
  "Dennis", "Beatrice", "Charles", "Rose", "Anthony", "Agnes", "Francis",
  "Pauline", "Vincent", "Nancy",
];
const LAST_NAMES = [
  "Mwangi", "Otieno", "Wanjiku", "Kamau", "Ochieng", "Njeri", "Kipchoge",
  "Akinyi", "Mutua", "Wanjiru", "Kiprop", "Wambui", "Onyango", "Achieng",
  "Maina", "Wairimu", "Owino", "Chebet", "Mutiso", "Njoroge", "Odhiambo",
  "Cherono", "Karanja", "Atieno", "Korir", "Nyambura", "Omondi", "Wafula",
  "Mbugua", "Jepkosgei",
];
const BUSINESS_TYPES = [
  "Retail Shop", "Boda Boda", "Mama Mboga", "Salon", "Restaurant",
  "M-Pesa Agent", "Tailoring", "Hardware", "Pharmacy", "School", "Transport",
  "Agriculture", "Construction", "Wholesale", "Electronics",
];
// City -> real Kenyan county
const CITY_COUNTY = {
  Nairobi: "Nairobi",
  Mombasa: "Mombasa",
  Kisumu: "Kisumu",
  Nakuru: "Nakuru",
  Eldoret: "Uasin Gishu",
  Thika: "Kiambu",
  Kakamega: "Kakamega",
  Meru: "Meru",
  Nyeri: "Nyeri",
  Machakos: "Machakos",
  Kitale: "Trans Nzoia",
  Garissa: "Garissa",
};
const CITIES = Object.keys(CITY_COUNTY);

// ----------------------------------------------------------------------------
// Random helpers
// ----------------------------------------------------------------------------
const randInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const choice = (arr) => arr[randInt(0, arr.length - 1)];
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const chance = (p) => Math.random() < p;

// Round to nearest 1000 KES, clamped to range
const roundMoney = (n) => Math.round(n / 1000) * 1000;

const pad = (n, width) => String(n).padStart(width, "0");

const fmtDate = (d) => {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  return `${y}-${m}-${day}`;
};

const addMonths = (date, n) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
};

const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

// Date `n` months before NOW
const monthsAgo = (n) => addMonths(NOW, -n);

// Whole days between two dates (a - b), date-only, like CURRENT_DATE - due_date
const daysBetween = (a, b) => {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((da - db) / 86400000);
};

const weightedMethod = () => {
  const r = Math.random();
  if (r < 0.6) return "M-Pesa";
  if (r < 0.85) return "Cash";
  return "Bank Transfer";
};

const mpesaRef = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[randInt(0, chars.length - 1)];
  return s;
};

const paymentReference = (method) => {
  if (method === "M-Pesa") return mpesaRef();
  if (method === "Bank Transfer") return `BANK-${pad(randInt(0, 999999), 6)}`;
  return null; // Cash
};

const NOTE_POOL = [
  null, null, "Monthly installment", "Monthly installment",
  "Partial payment", "Catch-up payment",
];

// ----------------------------------------------------------------------------
// Unique-value generators
// ----------------------------------------------------------------------------
const usedPhones = new Set();
const usedEmails = new Set();
const usedIds = new Set();

function uniquePhone() {
  let p;
  do {
    p = "07" + pad(randInt(0, 99999999), 8);
  } while (usedPhones.has(p));
  usedPhones.add(p);
  return p;
}

function uniqueEmail(first, last) {
  const base = `${first}.${last}`.toLowerCase();
  let email = `${base}@gmail.com`;
  let i = 1;
  while (usedEmails.has(email)) {
    email = `${base}${i}@gmail.com`;
    i++;
  }
  usedEmails.add(email);
  return email;
}

function uniqueIdNumber() {
  let id;
  do {
    id = String(randInt(10000000, 39999999));
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

// ----------------------------------------------------------------------------
// Schema safety: add app-required columns if a fresh DB is missing them
// ----------------------------------------------------------------------------
async function ensureSchema(client) {
  const statements = [
    `ALTER TABLE loans ADD COLUMN IF NOT EXISTS overpayment_amount NUMERIC(12,2) DEFAULT 0`,
    `ALTER TABLE loans ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20)`,
    `ALTER TABLE loans ADD COLUMN IF NOT EXISTS refund_method VARCHAR(30)`,
    `ALTER TABLE loans ADD COLUMN IF NOT EXISTS refund_reference VARCHAR(100)`,
    `ALTER TABLE loans ADD COLUMN IF NOT EXISTS refunded_date DATE`,
    `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT`,
  ];
  for (const s of statements) await client.query(s);
}

// ----------------------------------------------------------------------------
// Bulk insert helper (chunked multi-row INSERT, preserves row order)
// ----------------------------------------------------------------------------
async function bulkInsert(client, table, columns, rows, chunkSize = 500) {
  if (rows.length === 0) return;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params = [];
    const valuesSql = chunk
      .map((row, ri) => {
        const ph = columns.map((_, ci) => `$${ri * columns.length + ci + 1}`);
        params.push(...columns.map((c) => row[c]));
        return `(${ph.join(", ")})`;
      })
      .join(", ");
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${valuesSql}`,
      params,
    );
  }
}

// ----------------------------------------------------------------------------
// Loan financial model
// ----------------------------------------------------------------------------
function buildLoan({ principal, annualRate, months, startDate }) {
  const totalInterest = round2(principal * (annualRate / 100) * (months / 12));
  const totalAmountDue = round2(principal + totalInterest);
  const monthlyRate = round2(annualRate / 12); // stored in interest_rate

  // Per-installment amounts that sum EXACTLY to totalAmountDue
  const base = round2(totalAmountDue / months);
  const amounts = [];
  for (let i = 0; i < months - 1; i++) amounts.push(base);
  amounts.push(round2(totalAmountDue - base * (months - 1)));

  const endDate = addMonths(startDate, months);

  return {
    principal,
    annualRate,
    monthlyRate,
    months,
    startDate,
    endDate,
    totalInterest,
    totalAmountDue,
    amounts, // amount_due for payment_number 1..months
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    console.error(
      "✗ Refusing to seed: NODE_ENV=production. Re-run with --force if you really mean it.",
    );
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const client = await pool.connect();
  try {
    console.log("→ Connected to database:", process.env.DB_NAME);

    // Resolve admin user for loans.created_by
    const adminRes = await client.query(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1",
    );
    const adminId = adminRes.rows[0]?.id ?? 1;
    console.log(`→ Using created_by = ${adminId} (admin user)`);

    await client.query("BEGIN");

    await ensureSchema(client);
    console.log("→ Schema verified (refund/notes columns present)");

    // Wipe test data + reset identity sequences (also clears notifications,
    // which FK-reference clients/loans)
    await client.query(
      "TRUNCATE transactions, payment_schedules, loans, clients, notifications RESTART IDENTITY CASCADE",
    );
    console.log("→ Cleared existing data and reset sequences");

    // ---- 1. Clients (ids will be 1..CLIENT_COUNT after RESTART IDENTITY) ----
    const clientRows = [];
    for (let i = 0; i < CLIENT_COUNT; i++) {
      const first = choice(FIRST_NAMES);
      const last = choice(LAST_NAMES);
      const city = choice(CITIES);
      const createdAt = monthsAgo(randInt(0, 18));
      clientRows.push({
        client_code: `CLT-${YEAR}-${pad(i + 1, 4)}`,
        first_name: first,
        last_name: last,
        phone_number: uniquePhone(),
        email: uniqueEmail(first, last),
        id_number: uniqueIdNumber(),
        business_name: `${first} ${choice(BUSINESS_TYPES)}`,
        business_type: choice(BUSINESS_TYPES),
        address: `P.O. Box ${randInt(100, 99999)}, ${city}`,
        city,
        county: CITY_COUNTY[city],
        status: "active",
        kyc_verified: true,
        created_at: createdAt.toISOString(),
        updated_at: createdAt.toISOString(),
      });
    }
    await bulkInsert(
      client,
      "clients",
      [
        "client_code", "first_name", "last_name", "phone_number", "email",
        "id_number", "business_name", "business_type", "address", "city",
        "county", "status", "kyc_verified", "created_at", "updated_at",
      ],
      clientRows,
    );
    console.log(`✓ Created ${clientRows.length} clients`);

    // ---- 2-4. Loans + schedules + transactions ----
    // Build the scenario worklist
    const worklist = [];
    for (const [scenario, count] of Object.entries(SCENARIO_COUNTS)) {
      for (let i = 0; i < count; i++) worklist.push(scenario);
    }
    // shuffle so codes interleave naturally
    for (let i = worklist.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [worklist[i], worklist[j]] = [worklist[j], worklist[i]];
    }

    const loanRows = [];
    const scheduleRows = [];
    const txnRows = [];
    let txnCounter = 0;

    const newTxn = (loanId, clientId, amount, date, note) => {
      txnCounter++;
      const method = weightedMethod();
      txnRows.push({
        transaction_code: `TXN-${YEAR}-${pad(txnCounter, 5)}`,
        loan_id: loanId,
        client_id: clientId,
        amount_paid: round2(amount),
        payment_date: fmtDate(date),
        payment_method: method,
        payment_reference: paymentReference(method),
        payment_status: "completed",
        notes: note ?? choice(NOTE_POOL),
        created_at: date.toISOString(),
        updated_at: date.toISOString(),
      });
    };

    for (let idx = 0; idx < worklist.length; idx++) {
      const scenario = worklist[idx];
      const loanId = idx + 1; // serial id after RESTART IDENTITY
      const clientId = randInt(1, CLIENT_COUNT);

      // Scenario parameters
      let principal, annualRate, months, startDate;
      if (scenario === "completed" || scenario === "completedOverpaid") {
        principal = Math.min(
          50000,
          Math.max(5000, roundMoney(randInt(5000, 50000))),
        );
        annualRate = randInt(100, 150) / 10; // 10.0 - 15.0
        months = randInt(6, 12);
        // Loan term must have fully elapsed
        startDate = monthsAgo(randInt(months + 1, 18));
      } else if (scenario === "activeOnSchedule") {
        principal = Math.min(
          200000,
          Math.max(10000, roundMoney(randInt(10000, 200000))),
        );
        annualRate = randInt(120, 180) / 10; // 12.0 - 18.0
        months = randInt(6, 24);
        startDate = monthsAgo(randInt(1, 9)); // within last 1-12 months
      } else if (scenario === "activeOverdue") {
        principal = Math.min(
          150000,
          Math.max(15000, roundMoney(randInt(15000, 150000))),
        );
        annualRate = randInt(120, 180) / 10;
        months = randInt(6, 24);
        startDate = monthsAgo(randInt(3, 12));
      } else {
        // defaulted
        principal = Math.min(
          100000,
          Math.max(20000, roundMoney(randInt(20000, 100000))),
        );
        annualRate = randInt(140, 200) / 10;
        months = randInt(8, 18);
        startDate = monthsAgo(randInt(8, 15));
      }

      const L = buildLoan({ principal, annualRate, months, startDate });

      // Compose payment schedule rows (status decided per scenario below)
      const schedules = [];
      for (let n = 1; n <= L.months; n++) {
        const dueDate = addMonths(L.startDate, n);
        schedules.push({
          payment_number: n,
          due_date: dueDate,
          amount_due: L.amounts[n - 1],
          status: "pending",
          amount_paid: 0,
          actual_payment_date: null,
          days_late: 0,
        });
      }

      let overpaymentAmount = 0;
      let refundStatus = null;
      let refundMethod = null;
      let refundReference = null;
      let refundedDate = null;
      let loanStatus = "active";

      const payInstallment = (s, note) => {
        s.status = "paid";
        s.amount_paid = s.amount_due;
        // paid within a few days of the due date
        const payDate = addDays(s.due_date, randInt(-2, 5));
        s.actual_payment_date = fmtDate(payDate);
        s.days_late = 0;
        newTxn(loanId, clientId, s.amount_due, payDate, note);
      };

      const markOverdue = (s) => {
        s.status = "overdue";
        s.amount_paid = 0;
        s.days_late = Math.max(1, daysBetween(NOW, s.due_date));
      };

      if (scenario === "completed" || scenario === "completedOverpaid") {
        schedules.forEach((s) => payInstallment(s, "Monthly installment"));
        loanStatus = "completed";

        if (scenario === "completedOverpaid") {
          overpaymentAmount = round2(randInt(100, 3000));
          // Tack the overpayment onto the final installment payment so
          // SUM(transactions) = total_amount_due + overpayment
          const lastTxn = txnRows[txnRows.length - 1];
          lastTxn.amount_paid = round2(lastTxn.amount_paid + overpaymentAmount);
          lastTxn.notes = "Final payment (overpaid)";

          if (chance(0.6)) {
            refundStatus = "refunded";
            refundMethod = choice(["M-Pesa", "Cash"]);
            refundReference =
              refundMethod === "M-Pesa" ? mpesaRef() : null;
            refundedDate = fmtDate(addDays(L.endDate, randInt(1, 20)));
          } else {
            refundStatus = "pending";
          }
        }
      } else if (scenario === "activeOnSchedule") {
        // Everything already due is paid; nothing overdue
        schedules.forEach((s) => {
          if (daysBetween(NOW, s.due_date) >= 0) {
            payInstallment(s, "Monthly installment");
          }
        });
        loanStatus = "active";
      } else if (scenario === "activeOverdue") {
        const duePassed = schedules.filter(
          (s) => daysBetween(NOW, s.due_date) >= 0,
        );
        const overdueCount = Math.min(
          duePassed.length,
          Math.max(1, randInt(1, 3)),
        );
        const paidCount = duePassed.length - overdueCount;
        duePassed.forEach((s, i) => {
          if (i < paidCount) payInstallment(s, "Monthly installment");
          else markOverdue(s);
        });
        loanStatus = "active";
      } else {
        // defaulted: paid the early installments, then stopped paying
        // 4-8 months ago — leaving 4+ months of missed installments
        const duePassed = schedules.filter(
          (s) => daysBetween(NOW, s.due_date) >= 0,
        );
        const stoppedMonthsAgo = randInt(4, 8);
        const missed = Math.min(
          Math.max(4, stoppedMonthsAgo),
          Math.max(1, duePassed.length - 1),
        );
        const paidCount = Math.max(1, duePassed.length - missed);
        duePassed.forEach((s, i) => {
          if (i < paidCount) payInstallment(s, "Monthly installment");
          else markOverdue(s);
        });
        loanStatus = "defaulted";
      }

      // Collect schedule rows for bulk insert
      for (const s of schedules) {
        scheduleRows.push({
          loan_id: loanId,
          payment_number: s.payment_number,
          due_date: fmtDate(s.due_date),
          amount_due: s.amount_due,
          status: s.status,
          amount_paid: s.amount_paid,
          actual_payment_date: s.actual_payment_date,
          days_late: s.days_late,
          created_at: L.startDate.toISOString(),
          updated_at: NOW.toISOString(),
        });
      }

      loanRows.push({
        loan_code: `LN-${YEAR}-${pad(loanId, 4)}`,
        client_id: clientId,
        principal_amount: L.principal,
        interest_rate: L.monthlyRate,
        loan_duration_months: L.months,
        start_date: fmtDate(L.startDate),
        end_date: fmtDate(L.endDate),
        disbursement_date: fmtDate(L.startDate),
        total_amount_due: L.totalAmountDue,
        total_interest: L.totalInterest,
        status: loanStatus,
        overpayment_amount: overpaymentAmount,
        refund_status: refundStatus,
        refund_method: refundMethod,
        refund_reference: refundReference,
        refunded_date: refundedDate,
        created_by: adminId,
        created_at: L.startDate.toISOString(),
        updated_at: NOW.toISOString(),
      });

      if ((idx + 1) % 50 === 0) {
        console.log(`  …prepared ${idx + 1}/${TOTAL_LOANS} loans`);
      }
    }

    await bulkInsert(
      client,
      "loans",
      [
        "loan_code", "client_id", "principal_amount", "interest_rate",
        "loan_duration_months", "start_date", "end_date",
        "disbursement_date", "total_amount_due", "total_interest", "status",
        "overpayment_amount", "refund_status", "refund_method",
        "refund_reference", "refunded_date", "created_by", "created_at",
        "updated_at",
      ],
      loanRows,
    );
    console.log(`✓ Created ${loanRows.length} loans`);

    await bulkInsert(
      client,
      "payment_schedules",
      [
        "loan_id", "payment_number", "due_date", "amount_due", "status",
        "amount_paid", "actual_payment_date", "days_late", "created_at",
        "updated_at",
      ],
      scheduleRows,
    );
    console.log(`✓ Created ${scheduleRows.length} payment schedules`);

    await bulkInsert(
      client,
      "transactions",
      [
        "transaction_code", "loan_id", "client_id", "amount_paid",
        "payment_date", "payment_method", "payment_reference",
        "payment_status", "notes", "created_at", "updated_at",
      ],
      txnRows,
    );
    console.log(`✓ Created ${txnRows.length} transactions`);

    await client.query("COMMIT");

    // ---- Summary ----
    const fmtKES = (n) =>
      "KES " + Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 });

    const [
      { rows: cRows },
      { rows: catRows },
      { rows: actRows },
      { rows: finRows },
      { rows: ovRows },
      { rows: refRows },
    ] = await Promise.all([
      client.query("SELECT COUNT(*)::int c FROM clients"),
      // Loan categories (status + refund split)
      client.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE status = 'completed' AND COALESCE(overpayment_amount,0) = 0
          )::int AS completed_plain,
          COUNT(*) FILTER (WHERE status = 'completed' AND refund_status = 'refunded')::int
            AS completed_refunded,
          COUNT(*) FILTER (WHERE status = 'completed' AND refund_status = 'pending')::int
            AS completed_pending,
          COUNT(*) FILTER (WHERE status = 'defaulted')::int AS defaulted,
          COUNT(*)::int AS total
        FROM loans
      `),
      // Active loans split into on-schedule vs overdue
      client.query(`
        SELECT
          COUNT(*) FILTER (WHERE ov.cnt > 0)::int  AS active_overdue,
          COUNT(*) FILTER (WHERE ov.cnt = 0)::int  AS active_on_schedule
        FROM loans l
        LEFT JOIN LATERAL (
          SELECT COUNT(*) cnt FROM payment_schedules ps
          WHERE ps.loan_id = l.id AND ps.status = 'overdue'
        ) ov ON true
        WHERE l.status = 'active'
      `),
      client.query(`
        SELECT
          COALESCE(SUM(principal_amount),0)  AS total_issued,
          COALESCE(SUM(total_amount_due),0)  AS total_due
        FROM loans
      `),
      client.query(
        "SELECT COALESCE(SUM(amount_due-COALESCE(amount_paid,0)),0) amt FROM payment_schedules WHERE status='overdue'",
      ),
      client.query(
        "SELECT COUNT(*)::int c, COALESCE(SUM(overpayment_amount),0) amt FROM loans WHERE refund_status='pending'",
      ),
    ]);

    const collectedRes = await client.query(
      "SELECT COALESCE(SUM(amount_paid),0) total FROM transactions WHERE payment_status='completed'",
    );

    const cat = catRows[0];
    const act = actRows[0];
    const fin = finRows[0];
    const totalLoans = cat.total;
    const collected = Number(collectedRes.rows[0].total);
    const totalDue = Number(fin.total_due);
    const outstanding = Math.max(0, totalDue - collected);
    const pct = (n) =>
      totalLoans ? Math.round((n / totalLoans) * 100) : 0;
    const line = (label, n) =>
      `  ${label} ${String(n).padStart(4)} (${pct(n)}%)`;

    const bar = "═".repeat(43);
    console.log(`\n${bar}`);
    console.log("SEEDING COMPLETE");
    console.log(bar);
    console.log(`\nClients: ${cRows[0].c}\n`);
    console.log("Loans Distribution:");
    console.log(line("✓ Completed:                  ", cat.completed_plain));
    console.log(line("✓ Completed (refunded):       ", cat.completed_refunded));
    console.log(line("⏳ Completed (refund pending): ", cat.completed_pending));
    console.log(line("🟢 Active (on schedule):      ", act.active_on_schedule));
    console.log(line("⚠️  Active (overdue):          ", act.active_overdue));
    console.log(line("🔴 Defaulted:                 ", cat.defaulted));
    console.log("  ───────────────────────────────");
    console.log(`  Total:                        ${String(totalLoans).padStart(4)}`);
    console.log("\nFinancial Summary:");
    console.log(`  💰 Total Issued:      ${fmtKES(fin.total_issued)}`);
    console.log(`  ✅ Total Collected:   ${fmtKES(collected)}`);
    console.log(`  📊 Outstanding:       ${fmtKES(outstanding)}`);
    console.log(`  ⚠️  Overdue Amount:   ${fmtKES(ovRows[0].amt)}`);
    console.log(
      `  💸 Pending Refunds:   ${fmtKES(refRows[0].amt)} (${refRows[0].c} loans)`,
    );
    console.log(`${bar}\n`);
    console.log("✓ Seeding complete.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n✗ Seeding failed, rolled back:\n", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
