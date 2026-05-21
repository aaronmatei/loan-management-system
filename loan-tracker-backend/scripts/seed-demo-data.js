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
const pool = new Pool({
  user: process.env.DB_USER || "aron",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "loan_tracker",
  password: process.env.DB_PASSWORD || "",
  port: process.env.DB_PORT || 5432,
});
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

export async function resetDemoData() {
  const t = await q(`SELECT id FROM tenants WHERE subdomain = 'demo'`);
  if (t.rows.length === 0) {
    throw new Error("Demo tenant not found — run migrations/015_demo_mode.sql");
  }
  const tid = t.rows[0].id;

  console.log(`🎮 Resetting demo data (tenant=${tid})…`);

  // ── Clear in dependency order (applications live in loans table,
  //    so the loans DELETE covers them too).
  await q(`DELETE FROM transactions       WHERE tenant_id = $1`, [tid]);
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
    const r = await q(
      `INSERT INTO clients (
         tenant_id, client_code, first_name, last_name, phone_number,
         email, id_number, county, business_type, date_of_birth, status, created_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, 'active',
         NOW() - (FLOOR(RANDOM() * 180) || ' days')::interval
       ) RETURNING id`,
      [
        tid, code, fn, ln, phone,
        `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
        rand9().slice(0, 8),
        pick(COUNTIES),
        pick(BIZ),
        randDOB(),
      ],
    );
    clientIds.push(r.rows[0].id);
  }

  // ── 18 loans (mix of statuses with schedules + paid transactions)
  console.log("💰 loans + schedules…");
  const statuses = ["active", "active", "active", "completed", "active"];
  const amounts = [1000, 5000, 10000, 25000, 50000, 75000, 100000];
  const durations = [3, 6, 12];

  for (let i = 0; i < 18; i++) {
    const clientId = pick(clientIds);
    const principal = pick(amounts);
    const months = pick(durations);
    const annualRate = 50; // platform default
    const monthlyRatePct = annualRate / 12; // store as monthly % (loans.interest_rate is monthly)
    const monthlyRateFrac = monthlyRatePct / 100;
    const totalInterest = principal * monthlyRateFrac * months;
    const totalDue = principal + totalInterest;
    const status = pick(statuses);
    const daysAgo = Math.floor(Math.random() * 120) + 10;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);

    const loanCode = await nextLoanCode(q, tid);

    const startISO = startDate.toISOString().split("T")[0];
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
         'Business expansion', $12::timestamp, 14
       ) RETURNING id`,
      [
        tid, clientId, loanCode,
        principal, monthlyRatePct, months,
        totalInterest, totalDue,
        startISO,
        endDate.toISOString().split("T")[0],
        status,
        startISO,
      ],
    );

    const loanId = loan.rows[0].id;
    const monthlyPayment = totalDue / months;

    // Schedule + (selective) paid transactions
    let amountPaidRunning = 0;
    for (let p = 1; p <= months; p++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + p);
      const past = dueDate < new Date();
      // Completed loans → everything paid. Active loans →
      // most past installments paid, future ones pending.
      const isPaid =
        status === "completed" || (past && Math.random() > 0.3);

      const psStatus = isPaid
        ? "paid"
        : past
        ? "overdue"
        : "pending";

      await q(
        `INSERT INTO payment_schedules
           (loan_id, payment_number, due_date, amount_due, status, amount_paid, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          loanId,
          p,
          dueDate.toISOString().split("T")[0],
          monthlyPayment,
          psStatus,
          isPaid ? monthlyPayment : 0,
          tid,
        ],
      );

      if (isPaid) {
        amountPaidRunning += monthlyPayment;
        // Synthesize a transaction. transaction_code is unique per
        // tenant; mint with a TXN-<year>-<id-like> sequence based on
        // existing tenant rows.
        const txCnt = await q(
          `SELECT COUNT(*)::int AS n FROM transactions WHERE tenant_id = $1`,
          [tid],
        );
        const txCode = `TXN-${new Date().getFullYear()}-${String(txCnt.rows[0].n + 1).padStart(5, "0")}`;
        const dueISO = dueDate.toISOString().split("T")[0];
        await q(
          `INSERT INTO transactions
             (transaction_code, tenant_id, loan_id, client_id,
              amount_paid, payment_method, payment_status,
              payment_date, created_at)
           VALUES ($1, $2, $3, $4, $5, 'M-Pesa', 'completed', $6::date, $7::timestamp)`,
          [
            txCode, tid, loanId, clientId,
            monthlyPayment,
            dueISO, dueISO,
          ],
        );
      }
    }

    // (loans table has no denormalized amount_paid column —
    // total paid is always computed via SUM on transactions.)
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
         NOW() - ($9::int * INTERVAL '1 day'), 14
       )`,
      [
        tid, clientId, loanCode,
        principal, monthlyRatePct, months,
        totalInterest, totalDue,
        i,
      ],
    );
  }

  // Summary
  const s = await q(
    `SELECT
        (SELECT COUNT(*) FROM clients      WHERE tenant_id = $1)::int AS clients,
        (SELECT COUNT(*) FROM loans        WHERE tenant_id = $1 AND status <> 'pending')::int AS loans,
        (SELECT COUNT(*) FROM loans        WHERE tenant_id = $1 AND status  = 'pending')::int AS pending_apps,
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
