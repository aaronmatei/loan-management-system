#!/usr/bin/env node
// Seed a realistic multi-tenant dataset for demos / pre-launch:
//   • 13 lenders — 1 microfinance, 2 SACCOs, 5 chamas, 5 individuals
//     each with a KES 100,000 capital pool and admin password Admin@202626
//   • 130 borrowers, each linked to exactly 2 lenders → 260 client records
//     (20 per tenant). Portal password = first-initial + last-initial + ID +
//     "@<year>" (the enforced default, e.g. "Jd40000005@2026").
//   • Loans spanning every status (pending, under_review, approved,
//     counter_offered, rejected, active, completed, defaulted), principal
//     1,000–20,000, with schedules + payments so capital pools and analytics
//     are realistic.
//   • Audit-log rows so the activity shows in BOTH the tenant admin and the
//     platform admin audit views.
//
// Idempotent guard: aborts if the first seed tenant already exists. Runs in a
// single transaction (all-or-nothing). Safe to run in the Render Shell:
//   node scripts/seed-launch-data.js

import "dotenv/config.js";
import bcryptjs from "bcryptjs";
import { tenantPrefix } from "../src/utils/clientCode.js";

const { default: pool } = await import("../src/config/database.js");

const YEAR = new Date().getFullYear();
const ADMIN_PASSWORD = "Admin@202626";
const CAPITAL = 100000;

const TENANTS = [
  { name: "Faulu Microfinance", subdomain: "faulu-mfi", type: "microfinance", color: "#0086cc" },
  { name: "Stima SACCO", subdomain: "stima-sacco", type: "sacco", color: "#16a34a" },
  { name: "Harambee SACCO", subdomain: "harambee-sacco", type: "sacco", color: "#0d9488" },
  { name: "Umoja Chama", subdomain: "umoja-chama", type: "chama", color: "#7c3aed" },
  { name: "Maendeleo Chama", subdomain: "maendeleo-chama", type: "chama", color: "#9333ea" },
  { name: "Tujenge Chama", subdomain: "tujenge-chama", type: "chama", color: "#c026d3" },
  { name: "Wezesha Chama", subdomain: "wezesha-chama", type: "chama", color: "#db2777" },
  { name: "Pamoja Chama", subdomain: "pamoja-chama", type: "chama", color: "#e11d48" },
  { name: "James Mwangi Lending", subdomain: "jmwangi-lending", type: "individual", color: "#ea580c" },
  { name: "Grace Otieno Loans", subdomain: "gotieno-loans", type: "individual", color: "#d97706" },
  { name: "Peter Kariuki Credit", subdomain: "pkariuki-credit", type: "individual", color: "#ca8a04" },
  { name: "Mary Achieng Finance", subdomain: "machieng-finance", type: "individual", color: "#65a30d" },
  { name: "Daniel Kipchoge Lending", subdomain: "dkipchoge-lending", type: "individual", color: "#0891b2" },
];

const FIRST = ["John", "Mary", "Peter", "Grace", "James", "Faith", "David", "Esther", "Samuel", "Ann", "Joseph", "Lucy", "Daniel", "Jane", "Paul", "Rose", "Michael", "Sarah", "Stephen", "Mercy"];
const LAST = ["Mwangi", "Otieno", "Kariuki", "Achieng", "Kipchoge", "Wanjiru", "Omondi", "Njoroge", "Chebet", "Mutua", "Kamau", "Akinyi", "Korir", "Wambui", "Onyango", "Maina", "Cheruiyot", "Nyambura", "Barasa", "Kiprop"];
const CLIENT_BIZ = ["Retail Shop", "Boda Boda", "Salon / Barber", "Food / Restaurant", "M-Pesa Agent", "Tailoring", "Hardware", "Clothing / Mitumba", "Farming / Agriculture", "Electronics"];
const COUNTIES = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Kiambu", "Machakos", "Nyeri", "Kakamega", "Meru"];
const PURPOSES = ["Business expansion", "Stock purchase", "School fees", "Medical emergency", "Working capital", "Farming inputs", "Equipment purchase", "Home improvement"];
const STATUSES = ["pending", "under_review", "approved", "counter_offered", "rejected", "active", "completed", "defaulted"];
const DISBURSED = new Set(["active", "completed", "defaulted"]);

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (a) => a[rand(0, a.length - 1)];
const fmt = (d) => d.toISOString().split("T")[0];
const daysAgo = (n) => fmt(new Date(Date.now() - n * 864e5));
const monthsAgoDate = (m) => {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d;
};
const addMonths = (d, m) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + m);
  return x;
};

// Build a loan (+ schedules + transactions) for the given status.
function buildLoan(tenant, c, status) {
  const principal = rand(2, 40) * 500; // 1,000 – 20,000
  const months = pick([3, 6, 9, 12]);
  const monthlyPct = +(36 / 12).toFixed(2); // 3.00% p.m.
  const frac = monthlyPct / 100;
  const totalInterest = +(principal * frac * months).toFixed(2);
  const totalDue = +(principal + totalInterest).toFixed(2);
  const loan_code = `LN-${tenant.prefix}-${YEAR}-${String(tenant.loanSeq++).padStart(5, "0")}`;
  const adminId = tenant.adminId;

  const loan = {
    tenant_id: tenant.id, loan_code, client_id: c.clientId,
    principal_amount: principal, interest_rate: monthlyPct,
    loan_duration_months: months, total_amount_due: totalDue, total_interest: totalInterest,
    status, purpose: pick(PURPOSES), application_date: daysAgo(rand(20, 220)),
    application_source: "walk_in", created_by: adminId,
    start_date: null, end_date: null, disbursement_date: null, disbursement_method: null,
    reviewed_by: null, reviewed_at: null, approved_by: null, approved_at: null,
    disbursed_by: null, disbursed_at: null, rejection_reason: null, rejected_at: null,
    requested_amount: null, offered_amount: null, counter_offered_by: null, counter_offered_at: null,
  };

  const reviewed = () => {
    loan.reviewed_by = adminId;
    loan.reviewed_at = daysAgo(rand(10, 19));
  };
  const approved = () => {
    reviewed();
    loan.approved_by = adminId;
    loan.approved_at = daysAgo(rand(5, 9));
  };

  const schedules = [];
  const txns = [];

  if (status === "under_review") reviewed();
  else if (status === "approved") approved();
  else if (status === "rejected") {
    reviewed();
    loan.rejection_reason = "Insufficient repayment capacity";
    loan.rejected_at = daysAgo(rand(3, 8));
  } else if (status === "counter_offered") {
    reviewed();
    loan.requested_amount = principal;
    loan.offered_amount = Math.max(1000, Math.round((principal * 0.7) / 500) * 500);
    loan.counter_offered_by = adminId;
    loan.counter_offered_at = daysAgo(rand(2, 6));
  } else if (DISBURSED.has(status)) {
    approved();
    const startBackMonths =
      status === "completed" ? months + 1 : status === "defaulted" ? months : Math.min(2, months);
    const start = monthsAgoDate(startBackMonths);
    loan.start_date = fmt(start);
    loan.disbursement_date = fmt(start);
    loan.disbursed_by = adminId;
    loan.disbursed_at = fmt(start);
    loan.disbursement_method = "mpesa";
    loan.end_date = fmt(addMonths(start, months));

    const perInstallment = +(totalDue / months).toFixed(2);
    let paidCount;
    if (status === "completed") paidCount = months;
    else if (status === "active") paidCount = Math.min(months - 1, rand(1, 2));
    else paidCount = rand(0, Math.max(1, Math.floor(months / 4))); // defaulted

    for (let n = 1; n <= months; n++) {
      const due = addMonths(start, n);
      const isPaid = n <= paidCount;
      const past = due.getTime() < Date.now();
      let sStatus = "pending";
      if (isPaid) sStatus = "paid";
      else if (status === "defaulted" && past) sStatus = "overdue";
      schedules.push({
        tenant_id: tenant.id, payment_number: n, due_date: fmt(due),
        amount_due: perInstallment, amount_paid: isPaid ? perInstallment : 0,
        status: sStatus, actual_payment_date: isPaid ? fmt(due) : null,
        days_late: 0,
      });
      if (isPaid) {
        txns.push({
          transaction_code: `TXN-${tenant.prefix}-${YEAR}-${String(tenant.txnSeq++).padStart(5, "0")}`,
          tenant_id: tenant.id, amount_paid: perInstallment, payment_date: fmt(due),
          payment_method: "mpesa", payment_status: "completed",
        });
      }
    }
  }

  return { loan, schedules, txns, tenantRef: tenant, clientName: c.name };
}

async function main() {
  const client = await pool.connect();
  const q = (t, p) => client.query(t, p);

  // Multi-row INSERT helper (single statement) → returns RETURNING rows in order.
  const bulk = async (table, cols, rows, returning = "id") => {
    if (!rows.length) return [];
    const params = [];
    const tuples = rows.map((row) => {
      const ph = cols.map((c) => {
        params.push(row[c] === undefined ? null : row[c]);
        return `$${params.length}`;
      });
      return `(${ph.join(",")})`;
    });
    const r = await q(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}${
        returning ? ` RETURNING ${returning}` : ""
      }`,
      params,
    );
    return r.rows;
  };

  try {
    await client.query("BEGIN");

    const guard = await q("SELECT 1 FROM tenants WHERE subdomain = $1", [
      TENANTS[0].subdomain,
    ]);
    if (guard.rows.length) {
      throw new Error(
        `Seed tenant '${TENANTS[0].subdomain}' already exists — aborting to avoid duplicates.`,
      );
    }

    const platformAdmin =
      (await q("SELECT id, email, first_name, last_name FROM users WHERE is_platform_admin = true ORDER BY id LIMIT 1")).rows[0] || null;

    const adminHash = await bcryptjs.hash(ADMIN_PASSWORD, 10);
    const audit = [];

    // ── 1. Tenants + admin users + capital pools ──────────────────
    const tenants = [];
    for (let i = 0; i < TENANTS.length; i++) {
      const t = TENANTS[i];
      const prefix = tenantPrefix(t.subdomain);
      const tenant_code = `SD${String(i + 1).padStart(3, "0")}`;
      const contactEmail = `admin@${t.subdomain}.co.ke`;
      const tRow = (
        await q(
          `INSERT INTO tenants (
             tenant_code, business_name, subdomain, business_type, brand_color,
             contact_name, contact_email, contact_phone,
             plan, status, customer_portal_enabled, allow_self_signup,
             default_interest_rate, default_loan_duration, min_loan_amount, max_loan_amount,
             onboarding_completed, onboarding_completed_at, is_demo, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','active',true,true,
             36,6,1000,50000,true,NOW(),false,NOW(),NOW()) RETURNING id`,
          [
            tenant_code, t.name, t.subdomain, t.type, t.color,
            `${t.name} Admin`, contactEmail, `0790${String(100000 + i).slice(-6)}`,
          ],
        )
      ).rows[0];

      const uRow = (
        await q(
          `INSERT INTO users (
             tenant_id, username, email, password_hash, first_name, last_name,
             role, is_active, is_platform_admin, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,'Admin',$5,'admin',true,false,NOW(),NOW()) RETURNING id`,
          [tRow.id, `admin_${t.subdomain}`, contactEmail, adminHash, t.name],
        )
      ).rows[0];

      await q(
        `INSERT INTO capital_pool (tenant_id, initial_capital, total_disbursed, total_collected, total_interest_earned)
         VALUES ($1,$2,0,0,0)`,
        [tRow.id, CAPITAL],
      );

      tenants.push({
        ...t, id: tRow.id, prefix, tenant_code, adminId: uRow.id,
        adminEmail: contactEmail, clientSeq: 1, loanSeq: 1, txnSeq: 1,
        clientIds: [], disbursed: 0, collected: 0, interestEarned: 0,
      });

      audit.push({
        tenant_id: tRow.id, user_id: platformAdmin?.id ?? null,
        user_email: platformAdmin?.email ?? "system",
        user_name: platformAdmin ? `${platformAdmin.first_name} ${platformAdmin.last_name}`.trim() : "Seeder",
        user_role: "admin", is_platform_admin: true,
        action: "tenant_created", action_category: "tenant",
        entity_type: "tenant", entity_id: tRow.id, entity_code: tenant_code,
        entity_label: t.name, description: `Seeded ${t.type} lender "${t.name}"`,
        severity: "info", status: "success",
      });
    }

    // ── 2. 130 borrowers, each linked to exactly 2 tenants (circulant
    //       design → every tenant gets exactly 20 client records) ──────
    const N = 13;
    const ROUNDS = 10; // 10 × 13 = 130 borrowers
    const persons = [];
    for (let r = 0; r < ROUNDS; r++) {
      for (let t = 0; t < N; t++) {
        const p = r * N + t;
        const first = FIRST[p % FIRST.length];
        const last = LAST[(p * 7) % LAST.length];
        const id_number = String(40000000 + p);
        const phone07 = `0790${String(p).padStart(6, "0")}`;
        persons.push({
          idx: p, first, last, id_number,
          phone07, phonePlus: `+254${phone07.slice(1)}`,
          email: `${first.toLowerCase()}.${last.toLowerCase()}.${p}@example.com`,
          biz: pick(CLIENT_BIZ), county: pick(COUNTIES), city: pick(COUNTIES),
          gender: pick(["male", "female"]),
          dob: `19${rand(70, 99)}-${String(rand(1, 12)).padStart(2, "0")}-${String(rand(1, 28)).padStart(2, "0")}`,
          tenants: [t, (t + 1 + r) % N],
        });
      }
    }

    const hashes = await Promise.all(
      persons.map((p) =>
        bcryptjs.hash(`${p.first.charAt(0).toUpperCase()}${p.last.charAt(0).toLowerCase()}${p.id_number}@${YEAR}`, 10),
      ),
    );

    const pcRows = await bulk(
      "platform_customers",
      ["phone_number", "id_number", "first_name", "last_name", "email", "password_hash", "phone_verified", "is_active", "business_name", "business_type", "city", "county", "gender", "date_of_birth"],
      persons.map((p, i) => ({
        phone_number: p.phonePlus, id_number: p.id_number, first_name: p.first,
        last_name: p.last, email: p.email, password_hash: hashes[i],
        phone_verified: true, is_active: true,
        business_name: `${p.first}'s ${p.biz}`, business_type: p.biz,
        city: p.city, county: p.county, gender: p.gender, date_of_birth: p.dob,
      })),
    );
    persons.forEach((p, i) => (p.pcId = pcRows[i].id));

    const clientSpecs = [];
    for (const p of persons) {
      for (const ti of p.tenants) {
        const tn = tenants[ti];
        clientSpecs.push({
          person: p, tenant: tn,
          client_code: `CLT-${tn.prefix}-${YEAR}-${String(tn.clientSeq++).padStart(5, "0")}`,
        });
      }
    }
    const clientRows = await bulk(
      "clients",
      ["tenant_id", "client_code", "first_name", "last_name", "phone_number", "email", "id_number", "business_name", "business_type", "city", "county", "date_of_birth", "gender", "status"],
      clientSpecs.map((c) => ({
        tenant_id: c.tenant.id, client_code: c.client_code,
        first_name: c.person.first, last_name: c.person.last,
        phone_number: c.person.phone07, email: c.person.email,
        id_number: c.person.id_number, business_name: `${c.person.first}'s ${c.person.biz}`,
        business_type: c.person.biz, city: c.person.city, county: c.person.county,
        date_of_birth: c.person.dob, gender: c.person.gender, status: "active",
      })),
    );
    clientSpecs.forEach((c, i) => {
      c.clientId = clientRows[i].id;
      c.tenant.clientIds.push({ clientId: c.clientId, code: c.client_code, name: `${c.person.first} ${c.person.last}` });
    });

    await bulk(
      "customer_tenant_links",
      ["platform_customer_id", "tenant_id", "client_id", "status"],
      clientSpecs.map((c) => ({
        platform_customer_id: c.person.pcId, tenant_id: c.tenant.id,
        client_id: c.clientId, status: "active",
      })),
      "",
    );

    // ── 3. Loans across every status (+ schedules + payments) ─────────
    const loanPlans = [];
    for (const tn of tenants) {
      tn.clientIds.forEach((c, j) => {
        loanPlans.push(buildLoan(tn, c, STATUSES[j % STATUSES.length]));
      });
    }
    const loanRows = await bulk(
      "loans",
      ["tenant_id", "loan_code", "client_id", "principal_amount", "interest_rate", "loan_duration_months", "total_amount_due", "total_interest", "status", "purpose", "application_date", "application_source", "created_by", "start_date", "end_date", "disbursement_date", "disbursement_method", "reviewed_by", "reviewed_at", "approved_by", "approved_at", "disbursed_by", "disbursed_at", "rejection_reason", "rejected_at", "requested_amount", "offered_amount", "counter_offered_by", "counter_offered_at"],
      loanPlans.map((p) => p.loan),
    );
    loanPlans.forEach((p, i) => (p.loanId = loanRows[i].id));

    const allSchedules = [];
    const allTxns = [];
    for (const p of loanPlans) {
      const tn = p.tenantRef;
      if (DISBURSED.has(p.loan.status)) tn.disbursed += p.loan.principal_amount;
      for (const s of p.schedules) {
        s.loan_id = p.loanId;
        allSchedules.push(s);
      }
      for (const tx of p.txns) {
        tx.loan_id = p.loanId;
        tx.client_id = p.loan.client_id;
        tn.collected += tx.amount_paid;
        tn.interestEarned += tx.amount_paid * (p.loan.total_interest / p.loan.total_amount_due);
        allTxns.push(tx);
      }
      audit.push({
        tenant_id: tn.id, user_id: tn.adminId, user_email: tn.adminEmail,
        user_name: "Admin", user_role: "admin", is_platform_admin: false,
        action: DISBURSED.has(p.loan.status) ? "loan_disbursed" : "loan_created",
        action_category: "loan", entity_type: "loan", entity_id: p.loanId,
        entity_code: p.loan.loan_code, entity_label: p.clientName,
        description: `Seeded ${p.loan.status} loan ${p.loan.loan_code} (KES ${p.loan.principal_amount})`,
        severity: "info", status: "success",
      });
    }

    await bulk(
      "payment_schedules",
      ["loan_id", "tenant_id", "payment_number", "due_date", "amount_due", "amount_paid", "status", "actual_payment_date", "days_late"],
      allSchedules, "",
    );
    if (allTxns.length) {
      await bulk(
        "transactions",
        ["transaction_code", "loan_id", "client_id", "tenant_id", "amount_paid", "payment_date", "payment_method", "payment_status"],
        allTxns, "",
      );
    }

    for (const c of clientSpecs) {
      audit.push({
        tenant_id: c.tenant.id, user_id: c.tenant.adminId, user_email: c.tenant.adminEmail,
        user_name: "Admin", user_role: "admin", is_platform_admin: false,
        action: "client_created", action_category: "client", entity_type: "client",
        entity_id: c.clientId, entity_code: c.client_code,
        entity_label: `${c.person.first} ${c.person.last}`,
        description: `Seeded client ${c.person.first} ${c.person.last}`,
        severity: "info", status: "success",
      });
    }

    // ── 4. Capital pools reflect disbursements + collections ──────────
    for (const tn of tenants) {
      await q(
        `UPDATE capital_pool
            SET total_disbursed = $1, total_collected = $2, total_interest_earned = $3, updated_at = NOW()
          WHERE tenant_id = $4`,
        [tn.disbursed.toFixed(2), tn.collected.toFixed(2), tn.interestEarned.toFixed(2), tn.id],
      );
    }

    // ── 5. Audit logs (tenant admin + platform admin views) ───────────
    await bulk(
      "audit_logs",
      ["tenant_id", "user_id", "user_email", "user_name", "user_role", "is_platform_admin", "action", "action_category", "entity_type", "entity_id", "entity_code", "entity_label", "description", "severity", "status"],
      audit, "",
    );

    await client.query("COMMIT");

    console.log("\n✅ Seed complete");
    console.table(
      tenants.map((t) => ({
        tenant: t.name, type: t.type, clients: t.clientIds.length,
        disbursed: t.disbursed, collected: Math.round(t.collected),
      })),
    );
    console.log(`\nTenants: ${tenants.length}  Borrowers: ${persons.length}  Clients: ${clientSpecs.length}  Loans: ${loanPlans.length}  Audit rows: ${audit.length}`);
    console.log(`\nLender admin login: <contact_email> / ${ADMIN_PASSWORD}  e.g. ${tenants[0].adminEmail}`);
    console.log(`Borrower portal login: ${persons[0].phonePlus} / ${persons[0].first.charAt(0).toUpperCase()}${persons[0].last.charAt(0).toLowerCase()}${persons[0].id_number}@${YEAR}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
