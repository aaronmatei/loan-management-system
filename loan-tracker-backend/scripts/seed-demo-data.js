#!/usr/bin/env node
// Idempotent demo-tenant seed. Wipes tenant=demo's
// transactions/payment_schedules/loans/clients/audit_logs, then
// regenerates a realistic snapshot:
//   • 25 clients (mixed Kenyan names, counties, business types)
//   • 18 loans (mix of active/completed, schedules + paid txns)
//   • 4 pending applications (loans with status='pending' +
//     submitted_by_customer=true — the schema already does
//     applications as loans rows, no separate table)
//
// Exports `resetDemoData()` so the nightly cron + the
// /api/platform/cron manual-trigger endpoint can both call it.
//
// Spec uses payment_schedule (singular) / loan_applications / loan_number
// — adapted to the real schema (payment_schedules / loans / loan_code).
// Client + loan codes go through nextClientCode/nextLoanCode so they
// follow the existing CLT-DEM-2026-NNNNN / LN-DEM-2026-NNNNN convention.

import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  nextClientCode,
  nextLoanCode,
} from "../src/utils/clientCode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

const { Pool } = pg;
// Prefer DATABASE_URL (prod/Render — needs SSL) so the nightly reset and a
// manual run both hit the right database; fall back to discrete DB_* vars
// for local dev.
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        user: process.env.DB_USER || "aron",
        host: process.env.DB_HOST || "localhost",
        database: process.env.DB_NAME || "loan_tracker",
        password: process.env.DB_PASSWORD || "",
        port: process.env.DB_PORT || 5432,
      },
);
const q = (text, params) => pool.query(text, params);

const FIRST = ["Mary","John","Grace","Peter","Faith","James","Lucy","David","Esther","Samuel","Joyce","Daniel","Ann","Paul","Sarah","Robert","Margaret","Patrick","Jane","Anthony"];
const LAST  = ["Wanjiku","Kamau","Achieng","Otieno","Njoroge","Mwangi","Wafula","Cheruiyot","Muthoni","Omondi","Kariuki","Nyambura","Onyango","Kiprop","Wambui"];
const BIZ   = ["Boda Boda","Mama Mboga","Small Shop","Salon","M-Pesa Agent","Tailoring","Hardware","Cyber Cafe","Butchery","Kiosk"];
const COUNTIES = ["Nairobi","Mombasa","Kisumu","Nakuru","Eldoret","Thika","Machakos","Kakamega"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand9 = () =>
  String(Math.floor(100000000 + Math.random() * 899999999));
// Random adult date of birth (ages ~18–65) as YYYY-MM-DD, so the
// dashboard's "Loans by Age" chart has realistic borrower ages.
const randDOB = () => {
  const age = 18 + Math.floor(Math.random() * 48); // 18..65
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setMonth(Math.floor(Math.random() * 12));
  d.setDate(1 + Math.floor(Math.random() * 28));
  return d.toISOString().split("T")[0];
};
const GENDERS = ["male", "female"];

// Keep ALL demo activity inside the current year (2026) — `daysAgo` is
// clamped so nothing spills into the previous year, so the demo always
// reads as current-year data.
const YEAR_START = new Date(new Date().getFullYear(), 0, 1);
const day = (daysAgo) => {
  const now = new Date();
  const floor = Math.max(0, Math.floor((now - YEAR_START) / 86400000));
  const d = new Date(now);
  d.setDate(d.getDate() - Math.min(daysAgo, floor));
  return d;
};
const iso = (d) => d.toISOString().split("T")[0];

export async function resetDemoData() {
  const t = await q(`SELECT id FROM tenants WHERE subdomain = 'demo'`);
  if (t.rows.length === 0) {
    throw new Error("Demo tenant not found — run migrations/015_demo_mode.sql");
  }
  const tid = t.rows[0].id;

  // The demo's own admin user — used for created_by / waiver actor instead
  // of a hard-coded id (which used to point at another tenant's user).
  const uRes = await q(
    `SELECT id FROM users WHERE tenant_id = $1 ORDER BY id LIMIT 1`,
    [tid],
  );
  const uid = uRes.rows[0]?.id || null;

  console.log(`🎮 Resetting demo data (tenant=${tid})…`);

  // ── Clear in dependency order (applications live in loans table,
  //    so the loans DELETE covers them too).
  await q(`DELETE FROM transactions       WHERE tenant_id = $1`, [tid]);
  await q(`DELETE FROM loan_waivers       WHERE tenant_id = $1`, [tid]);
  await q(`DELETE FROM payment_schedules  WHERE loan_id IN (SELECT id FROM loans WHERE tenant_id = $1)`, [tid]);
  await q(`DELETE FROM loans              WHERE tenant_id = $1`, [tid]);
  await q(`DELETE FROM clients            WHERE tenant_id = $1`, [tid]);
  await q(`DELETE FROM audit_logs         WHERE tenant_id = $1`, [tid]);

  // ── 25 clients
  console.log("👥 clients…");
  const clientIds = [];
  for (let i = 0; i < 25; i++) {
    const fn = pick(FIRST);
    const ln = pick(LAST);
    const code = await nextClientCode(q, tid);
    const phone = `+254${7}${rand9().slice(0, 8)}`;
    const county = pick(COUNTIES);
    const biz = pick(BIZ);
    const r = await q(
      `INSERT INTO clients (
         tenant_id, client_code, first_name, last_name, phone_number,
         email, id_number, county, city, business_name, business_type,
         date_of_birth, gender, credit_score, kyc_verified, client_type,
         status, created_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15, 'individual',
         'active', $16::timestamp
       ) RETURNING id`,
      [
        tid, code, fn, ln, phone,
        `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
        rand9().slice(0, 8),
        county, county,
        `${fn}'s ${biz}`,
        biz,
        randDOB(),
        pick(GENDERS),
        300 + Math.floor(Math.random() * 551), // 300..850
        Math.random() > 0.25, // mostly KYC-verified
        iso(day(Math.floor(Math.random() * 150))),
      ],
    );
    clientIds.push(r.rows[0].id);
  }

  // ── 18 loans — a realistic mix: completed, current, overdue and
  //    defaulted, all dated within the current year.
  console.log("💰 loans + schedules…");
  const amounts = [5000, 10000, 15000, 25000, 40000, 50000, 75000, 100000];
  const durations = [3, 6, 12];
  // Profile drives status, how far back the loan started, and repayment.
  const profiles = [
    ...Array(5).fill("completed"),
    ...Array(6).fill("current"),
    ...Array(4).fill("overdue"),
    ...Array(3).fill("defaulted"),
  ];
  const lapsedLoans = []; // overdue/defaulted loans → candidates for waivers

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const clientId = pick(clientIds);
    const principal = pick(amounts);
    const months = profile === "completed" ? pick([3, 6]) : pick(durations);
    const annualRate = 50; // platform default
    const monthlyRatePct = annualRate / 12; // monthly % (loans.interest_rate)
    const totalInterest = principal * (monthlyRatePct / 100) * months;
    const totalDue = principal + totalInterest;

    // Older start for overdue/defaulted so installments are genuinely past
    // due; recent for current; mid for completed (short, fully repaid).
    const startAgo =
      profile === "completed"
        ? 120 + Math.floor(Math.random() * 30)
        : profile === "current"
        ? 20 + Math.floor(Math.random() * 55)
        : 100 + Math.floor(Math.random() * 50);
    const startDate = day(startAgo);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);

    const status =
      profile === "completed"
        ? "completed"
        : profile === "defaulted"
        ? "defaulted"
        : "active";

    const loanCode = await nextLoanCode(q, tid);
    const startISO = iso(startDate);
    const loan = await q(
      `INSERT INTO loans (
         tenant_id, client_id, loan_code,
         principal_amount, interest_rate, loan_duration_months,
         total_interest, total_amount_due,
         start_date, end_date, status,
         purpose, created_at, created_by
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6,
         $7, $8,
         $9::date, $10::date, $11,
         'Business expansion', $12::timestamp, $13
       ) RETURNING id`,
      [
        tid, clientId, loanCode,
        principal, monthlyRatePct, months,
        totalInterest, totalDue,
        startISO, iso(endDate), status,
        startISO, uid,
      ],
    );

    const loanId = loan.rows[0].id;
    const monthlyPayment = totalDue / months;

    for (let p = 1; p <= months; p++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + p);
      const past = dueDate < new Date();

      // Repayment behaviour by profile:
      //   completed → all paid · current → past installments mostly paid
      //   overdue   → only the first paid, the rest lapse
      //   defaulted → nothing paid
      let isPaid;
      if (profile === "completed") isPaid = true;
      else if (profile === "current") isPaid = past && Math.random() > 0.15;
      else if (profile === "overdue") isPaid = past && p <= 1;
      else isPaid = false;

      const psStatus = isPaid ? "paid" : past ? "overdue" : "pending";

      await q(
        `INSERT INTO payment_schedules
           (loan_id, payment_number, due_date, amount_due, status, amount_paid, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [loanId, p, iso(dueDate), monthlyPayment, psStatus, isPaid ? monthlyPayment : 0, tid],
      );

      if (isPaid) {
        const txCnt = await q(
          `SELECT COUNT(*)::int AS n FROM transactions WHERE tenant_id = $1`,
          [tid],
        );
        const txCode = `TXN-${new Date().getFullYear()}-${String(txCnt.rows[0].n + 1).padStart(5, "0")}`;
        // Paid on/around the due date — never in the future.
        const payISO = iso(dueDate < new Date() ? dueDate : new Date());
        await q(
          `INSERT INTO transactions
             (transaction_code, tenant_id, loan_id, client_id,
              amount_paid, payment_method, payment_status,
              payment_date, created_at)
           VALUES ($1, $2, $3, $4, $5, 'M-Pesa', 'completed', $6::date, $7::timestamp)`,
          [txCode, tid, loanId, clientId, monthlyPayment, payISO, payISO],
        );
      }
    }

    if (profile === "overdue" || profile === "defaulted") {
      lapsedLoans.push({ loanId, principal });
    }
  }

  // ── A few approved waivers (penalty / interest) on the lapsed loans.
  console.log("🎟️  waivers…");
  const WAIVER_REASONS = {
    penalty: [
      "Financial hardship (illness, job loss, family emergency)",
      "Goodwill — long-standing client",
    ],
    interest: ["Goodwill — first late payment", "Negotiated settlement"],
  };
  for (let i = 0; i < Math.min(4, lapsedLoans.length); i++) {
    const w = lapsedLoans[i];
    const type = i % 2 === 0 ? "penalty" : "interest";
    const amount =
      Math.round(w.principal * (0.03 + Math.random() * 0.05) * 100) / 100;
    const when = iso(day(10 + Math.floor(Math.random() * 40)));
    const allocation = JSON.stringify(
      type === "penalty"
        ? { amount_total: amount, penalty_total: amount }
        : { amount_total: amount, interest_total: amount },
    );
    await q(
      `INSERT INTO loan_waivers
         (loan_id, tenant_id, type, amount, reason, status,
          requested_by, requested_at, approved_by, approved_at,
          allocation, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'approved',
               $6, $7::timestamp, $6, $7::timestamp,
               $8::jsonb, $7::timestamp, $7::timestamp)`,
      [w.loanId, tid, type, amount, pick(WAIVER_REASONS[type]), uid, when, allocation],
    );
  }

  // ── 4 pending applications (as loans rows, submitted_by_customer)
  console.log("📝 applications…");
  for (let i = 0; i < 4; i++) {
    const clientId = pick(clientIds);
    const principal = [20000, 35000, 50000, 80000][i];
    const months = [3, 6, 6, 12][i];
    const annualRate = 50;
    const monthlyRatePct = annualRate / 12;
    const totalInterest = principal * (monthlyRatePct / 100) * months;
    const totalDue = principal + totalInterest;
    const loanCode = await nextLoanCode(q, tid);
    await q(
      `INSERT INTO loans (
         tenant_id, client_id, loan_code,
         principal_amount, interest_rate, loan_duration_months,
         total_interest, total_amount_due,
         status, purpose,
         submitted_by_customer, application_date, application_source,
         created_at, created_by
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6,
         $7, $8,
         'pending', 'Working capital',
         true, (NOW()::date - ($9::int)), 'customer_portal',
         NOW() - ($9::int * INTERVAL '1 day'), $10
       )`,
      [
        tid, clientId, loanCode,
        principal, monthlyRatePct, months,
        totalInterest, totalDue,
        i, uid,
      ],
    );
  }

  // Summary
  const s = await q(
    `SELECT
        (SELECT COUNT(*) FROM clients      WHERE tenant_id = $1)::int AS clients,
        (SELECT COUNT(*) FROM loans        WHERE tenant_id = $1 AND status <> 'pending')::int AS loans,
        (SELECT COUNT(*) FROM loans        WHERE tenant_id = $1 AND status  = 'defaulted')::int AS defaulted,
        (SELECT COUNT(DISTINCT ps.loan_id) FROM payment_schedules ps
           JOIN loans l ON l.id = ps.loan_id
          WHERE l.tenant_id = $1 AND ps.status = 'overdue')::int AS loans_overdue,
        (SELECT COUNT(*) FROM loans        WHERE tenant_id = $1 AND status  = 'pending')::int AS pending_apps,
        (SELECT COUNT(*) FROM loan_waivers WHERE tenant_id = $1)::int AS waivers,
        (SELECT COUNT(*) FROM transactions WHERE tenant_id = $1)::int AS payments`,
    [tid],
  );
  console.log("📊 demo now contains:", s.rows[0]);
  return s.rows[0];
}

// Run directly if invoked from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  resetDemoData()
    .catch((err) => {
      console.error("❌", err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
