import pool, { query } from "./src/config/database.js";

// ============================================================
// Bulk demo data for the 3 demo tenants (abclenders,
// xyzmicrofinance, quickloans). Adapted to the REAL schema:
//   - clients has NO `gender` column (removed).
//   - transactions needs client_id (NOT NULL) and uses
//     `payment_reference`; there is no `reference_number` /
//     `recorded_by` column.
//   - interest_rate is the MONTHLY rate as a percent (the app
//     does interest_rate * 12 for the annual %), so we store
//     annualRate/12, not annualRate/12/100.
//   - Tech Tsadong (tenant 1) is never touched.
//   - Re-run safe: clients are skipped by (tenant,phone); a
//     tenant that already has bulk loans (>20) is skipped for the
//     loan/schedule/transaction/capital steps so re-runs don't
//     double the data.
// ============================================================

const KENYAN_FIRST_NAMES_MALE = [
  "James", "John", "Peter", "David", "Joseph", "Daniel", "Samuel", "Paul", "Michael", "Stephen",
  "Kevin", "Brian", "Edwin", "Patrick", "Charles", "Anthony", "Felix", "George", "Bernard", "Geoffrey",
  "Mwangi", "Kamau", "Otieno", "Karanja", "Mutua", "Kiprop", "Maina", "Njoroge", "Omondi", "Kipchoge",
  "Kibet", "Wafula", "Wekesa", "Kiplagat", "Ouma", "Onyango", "Mutuku", "Mutiso", "Kioko", "Barasa",
];

const KENYAN_FIRST_NAMES_FEMALE = [
  "Mary", "Grace", "Faith", "Joyce", "Esther", "Ruth", "Margaret", "Lucy", "Jane", "Susan",
  "Caroline", "Christine", "Beatrice", "Agnes", "Anne", "Rose", "Sarah", "Catherine", "Eunice", "Hellen",
  "Wanjiku", "Akinyi", "Wanjiru", "Nyambura", "Wairimu", "Chebet", "Wambui", "Atieno", "Auma", "Adhiambo",
  "Nyokabi", "Njeri", "Muthoni", "Nduta", "Wangari", "Naliaka", "Cherono", "Jepkemboi", "Jepchirchir", "Khadija",
];

const KENYAN_LAST_NAMES = [
  "Kamau", "Mwangi", "Otieno", "Karanja", "Mutua", "Kiprop", "Maina", "Njoroge", "Omondi", "Kipchoge",
  "Kibet", "Wafula", "Wekesa", "Kiplagat", "Ouma", "Onyango", "Mutuku", "Mutiso", "Kioko", "Nyambura",
  "Wairimu", "Chebet", "Wambui", "Atieno", "Auma", "Adhiambo", "Nyokabi", "Njeri", "Muthoni", "Nduta",
  "Wangari", "Naliaka", "Cherono", "Achieng", "Jepkemboi", "Kariuki", "Macharia", "Githinji", "Gitau", "Kinyua",
  "Kuria", "Waweru", "Mungai", "Kahiga", "Barasa", "Simiyu", "Wanyama", "Cheruiyot", "Rotich", "Korir",
];

const KENYAN_COUNTIES = [
  "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Uasin Gishu", "Kiambu", "Machakos", "Meru",
  "Nyeri", "Kakamega", "Kisii", "Trans Nzoia", "Nakuru", "Embu", "Garissa",
  "Kilifi", "Bungoma", "Kirinyaga", "Taita Taveta", "Kajiado",
];

const BUSINESS_TYPES = [
  "Small Shop", "Boda Boda", "Mama Mboga", "Salon", "Barber Shop", "Food Vendor",
  "Tailor", "Carpenter", "Mechanic", "Farmer", "Trader", "Taxi Driver", "Hawker",
  "Boutique", "Hardware Store", "M-Pesa Agent", "Phone Shop", "Cyber Cafe", "Restaurant",
  "Bakery", "Wholesaler", "Tuk Tuk Operator", "Construction", "Pharmacy",
];

const LOAN_PURPOSES = [
  "Business expansion", "Stock purchase", "Equipment purchase", "School fees",
  "Medical emergency", "Home improvement", "Vehicle purchase", "Farming inputs",
  "Working capital", "Inventory restock", "Shop renovation", "Land purchase",
  "Wedding expenses", "Funeral expenses", "Asset acquisition",
];

// 70% mpesa / 20% bank / 10% cash
const PAYMENT_METHODS = [
  "mpesa", "mpesa", "mpesa", "mpesa", "mpesa", "mpesa", "mpesa",
  "bank_transfer", "bank_transfer", "cash",
];

const randomItem = (a) => a[Math.floor(Math.random() * a.length)];
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min, max, d = 2) =>
  parseFloat((Math.random() * (max - min) + min).toFixed(d));

function generatePhone(used) {
  let phone;
  do {
    const prefix = randomItem([
      "711", "712", "713", "714", "715", "716", "717", "718", "719",
      "720", "721", "722", "723", "724", "725", "726", "727", "728", "729",
      "740", "741", "742", "743", "745", "746", "748",
      "790", "791", "792", "793", "794", "795", "796", "797", "798", "799",
    ]);
    phone = `+254${prefix}${String(randomInt(100000, 999999)).padStart(6, "0")}`;
  } while (used.has(phone));
  used.add(phone);
  return phone;
}

function generateID(used) {
  let id;
  do {
    id = String(randomInt(10000000, 39999999));
  } while (used.has(id));
  used.add(id);
  return id;
}

function randomDateInPast(maxDaysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - randomInt(0, Math.max(1, maxDaysAgo)));
  return d.toISOString().split("T")[0];
}

const clientCode = (pfx, seq, yr) =>
  `CLT-${pfx}-${yr}-${String(seq).padStart(5, "0")}`;
const loanCode = (pfx, seq, yr) =>
  `LN-${pfx}-${yr}-${String(seq).padStart(5, "0")}`;
const txnCode = (pfx, seq) => `TXN-${pfx}-${Date.now()}-${seq}`;

async function seedBulkData() {
  console.log("🌱 Starting comprehensive demo data seed...\n");

  const usedPhones = new Set();
  const usedIDs = new Set();

  console.log("📋 Loading existing phones/IDs to avoid conflicts...");
  const ep = await query("SELECT DISTINCT phone_number FROM clients");
  const ei = await query(
    "SELECT DISTINCT id_number FROM clients WHERE id_number IS NOT NULL",
  );
  ep.rows.forEach((r) => usedPhones.add(r.phone_number));
  ei.rows.forEach((r) => usedIDs.add(r.id_number));
  console.log(
    `   ✓ ${usedPhones.size} existing phones, ${usedIDs.size} existing IDs\n`,
  );

  const tenantsResult = await query(`
    SELECT id, subdomain, business_name, tenant_code
    FROM tenants
    WHERE subdomain IN ('abclenders', 'xyzmicrofinance', 'quickloans')
    ORDER BY id
  `);
  if (tenantsResult.rows.length !== 3) {
    console.error("❌ Demo tenants not found. Run seed-demo-tenants.js first.");
    await pool.end();
    process.exit(1);
  }
  const tenants = tenantsResult.rows;
  const year = new Date().getFullYear();

  // ---- Shared customer pool (cross-tenant overlap) -------------------
  const mkPerson = () => {
    const male = Math.random() > 0.5;
    return {
      first_name: randomItem(
        male ? KENYAN_FIRST_NAMES_MALE : KENYAN_FIRST_NAMES_FEMALE,
      ),
      last_name: randomItem(KENYAN_LAST_NAMES),
      phone_number: generatePhone(usedPhones),
      id_number: generateID(usedIDs),
      county: randomItem(KENYAN_COUNTIES),
      business_type: randomItem(BUSINESS_TYPES),
      gender: male ? "male" : "female",
    };
  };

  console.log("👥 Building shared customer pool...");
  const customersAll = Array.from({ length: 50 }, mkPerson);
  const customersTwo = Array.from({ length: 30 }, () => ({
    ...mkPerson(),
    tenant_indices: [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, 2),
  }));
  console.log(
    `   ✓ 50 at all 3 tenants, 30 at 2 tenants each\n`,
  );

  for (let ti = 0; ti < tenants.length; ti++) {
    const tenant = tenants[ti];
    const pfx = tenant.tenant_code.substring(0, 3);

    console.log(
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    );
    console.log(
      `📊 SEEDING: ${tenant.business_name} (tenant_id=${tenant.id})`,
    );
    console.log(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
    );

    // Tenant admin (creator) — fetched ONCE.
    const adminRes = await query(
      "SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY id LIMIT 1",
      [tenant.id],
    );
    if (adminRes.rows.length === 0) {
      console.error(
        `   ⚠️  No admin user for ${tenant.business_name}; skipping tenant.`,
      );
      continue;
    }
    const adminId = adminRes.rows[0].id;

    // Re-run guard: if this tenant already has bulk loans, only
    // top-up clients (idempotent) and skip the heavy steps.
    const existingLoans = parseInt(
      (
        await query("SELECT COUNT(*) c FROM loans WHERE tenant_id = $1", [
          tenant.id,
        ])
      ).rows[0].c,
      10,
    );
    const alreadyBulkSeeded = existingLoans > 20;
    if (alreadyBulkSeeded) {
      console.log(
        `   ⏭️  ${tenant.business_name} already has ${existingLoans} loans — ` +
          `skipping loan/transaction/capital steps (re-run safe).\n`,
      );
    }

    // ---- Client list for this tenant --------------------------------
    const list = [];
    customersAll.forEach((c) => list.push(c));
    customersTwo.forEach((c) => {
      if (c.tenant_indices.includes(ti)) list.push(c);
    });
    const uniqueCount = 220 - list.length;
    for (let i = 0; i < uniqueCount; i++) list.push(mkPerson());

    const sharedTwo = customersTwo.filter((c) =>
      c.tenant_indices.includes(ti),
    ).length;
    console.log(
      `📊 ${list.length} clients (50 all-tenant + ${sharedTwo} two-tenant + ${uniqueCount} unique)`,
    );

    let clientSeq =
      parseInt(
        (
          await query(
            "SELECT COUNT(*) c FROM clients WHERE tenant_id = $1",
            [tenant.id],
          )
        ).rows[0].c,
        10,
      ) + 1;

    // ---- Insert clients --------------------------------------------
    console.log("👤 Inserting clients...");
    const clientIds = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const exists = await query(
        "SELECT id FROM clients WHERE phone_number = $1 AND tenant_id = $2",
        [c.phone_number, tenant.id],
      );
      if (exists.rows.length > 0) {
        clientIds.push(exists.rows[0].id);
        continue;
      }
      const status =
        Math.random() < 0.7
          ? "active"
          : Math.random() < 0.67
            ? "inactive"
            : "suspended";
      try {
        const r = await query(
          `INSERT INTO clients (
             tenant_id, client_code, first_name, last_name,
             phone_number, id_number, email, gender, county,
             business_type, business_name, status, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            tenant.id,
            clientCode(pfx, clientSeq++, year),
            c.first_name,
            c.last_name,
            c.phone_number,
            c.id_number,
            `${c.first_name.toLowerCase()}.${c.last_name.toLowerCase()}${randomInt(
              1,
              999,
            )}@example.com`,
            c.gender,
            c.county,
            c.business_type,
            `${c.first_name}'s ${c.business_type}`,
            status,
            randomDateInPast(730),
          ],
        );
        clientIds.push(r.rows[0].id);
      } catch (e) {
        console.error(`   ⚠️  client insert: ${e.message}`);
      }
      if ((i + 1) % 50 === 0)
        console.log(`   ✓ ${i + 1}/${list.length} clients`);
    }
    console.log(`   ✅ ${clientIds.length} clients available\n`);

    if (alreadyBulkSeeded || clientIds.length === 0) continue;

    // ---- Insert loans ----------------------------------------------
    console.log("💰 Inserting loans...");
    const targetLoans = randomInt(150, 200);
    const loans = [];
    let loanSeq =
      parseInt(
        (
          await query("SELECT COUNT(*) c FROM loans WHERE tenant_id = $1", [
            tenant.id,
          ])
        ).rows[0].c,
        10,
      ) + 1;

    for (let i = 0; i < targetLoans; i++) {
      const cid = randomItem(clientIds);
      const principal = randomItem([
        5000, 10000, 15000, 20000, 25000, 30000, 50000, 75000, 100000,
        150000, 200000, 300000, 500000,
      ]);
      const durationMonths = randomItem([1, 2, 3, 6, 9, 12, 18, 24]);
      const annualRate = randomFloat(10, 30);
      // App convention: interest_rate is the MONTHLY rate as a percent.
      const monthlyPct = parseFloat((annualRate / 12).toFixed(4));
      const totalInterest = parseFloat(
        (principal * (monthlyPct / 100) * durationMonths).toFixed(2),
      );
      const totalAmountDue = parseFloat(
        (principal + totalInterest).toFixed(2),
      );

      const r = Math.random();
      let status;
      let startDate;
      if (r < 0.5) {
        status = "active";
        startDate = randomDateInPast(durationMonths * 10 + randomInt(15, 60));
      } else if (r < 0.75) {
        status = "completed";
        startDate = randomDateInPast(720);
      } else if (r < 0.9) {
        status = "defaulted";
        startDate = randomDateInPast(540);
      } else {
        const s = Math.random();
        status =
          s < 0.4
            ? "pending"
            : s < 0.7
              ? "under_review"
              : s < 0.9
                ? "approved"
                : "rejected";
        startDate = randomDateInPast(30);
      }
      const isApp = ["pending", "under_review", "rejected"].includes(status);
      const sd = new Date(startDate);
      sd.setMonth(sd.getMonth() + durationMonths);
      const endDate = sd.toISOString().split("T")[0];

      try {
        const res = await query(
          `INSERT INTO loans (
             tenant_id, loan_code, client_id, principal_amount,
             interest_rate, loan_duration_months, total_amount_due, total_interest,
             start_date, end_date, status, purpose,
             late_payment_fee, penalty_rate, application_date,
             application_source, created_at, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING id`,
          [
            tenant.id,
            loanCode(pfx, loanSeq++, year),
            cid,
            principal,
            monthlyPct,
            durationMonths,
            totalAmountDue,
            totalInterest,
            isApp ? null : startDate,
            isApp ? null : endDate,
            status,
            randomItem(LOAN_PURPOSES),
            500,
            5.0,
            startDate,
            "walk_in",
            startDate,
            adminId,
          ],
        );
        loans.push({
          id: res.rows[0].id,
          status,
          clientId: cid,
          principal,
          totalAmountDue,
          durationMonths,
          startDate,
        });
      } catch (e) {
        console.error(`   ⚠️  loan insert: ${e.message}`);
      }
      if ((i + 1) % 50 === 0)
        console.log(`   ✓ ${i + 1}/${targetLoans} loans`);
    }
    console.log(`   ✅ ${loans.length} loans inserted\n`);

    // ---- Payment schedules (active/completed/defaulted) -------------
    console.log("📅 Creating payment schedules...");
    const fundedLoans = loans.filter((l) =>
      ["active", "completed", "defaulted"].includes(l.status),
    );
    for (let i = 0; i < fundedLoans.length; i++) {
      const l = fundedLoans[i];
      const monthly = parseFloat(
        (l.totalAmountDue / l.durationMonths).toFixed(2),
      );
      for (let m = 1; m <= l.durationMonths; m++) {
        const due = new Date(l.startDate);
        due.setMonth(due.getMonth() + m);
        let st = "pending";
        if (l.status === "completed") st = "paid";
        else if (l.status === "defaulted" && due < new Date())
          st = Math.random() < 0.3 ? "paid" : "overdue";
        else if (l.status === "active" && due < new Date())
          st = Math.random() < 0.8 ? "paid" : "overdue";
        try {
          await query(
            `INSERT INTO payment_schedules (
               tenant_id, loan_id, payment_number, due_date, amount_due,
               status, amount_paid, actual_payment_date
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              tenant.id,
              l.id,
              m,
              due.toISOString().split("T")[0],
              monthly,
              st,
              st === "paid" ? monthly : 0,
              st === "paid" ? due.toISOString().split("T")[0] : null,
            ],
          );
        } catch {
          /* unique (loan_id,payment_number) — skip dup */
        }
      }
      if ((i + 1) % 40 === 0)
        console.log(`   ✓ ${i + 1}/${fundedLoans.length} loans scheduled`);
    }
    console.log(`   ✅ Payment schedules created\n`);

    // ---- Transactions ----------------------------------------------
    console.log("💳 Creating transactions...");
    let txnSeq = 1;
    let txnCount = 0;
    for (const l of fundedLoans) {
      const ratio =
        l.status === "completed"
          ? 1.0
          : l.status === "defaulted"
            ? randomFloat(0.1, 0.4)
            : randomFloat(0.3, 0.8);
      const totalPaid = l.totalAmountDue * ratio;
      const numPayments = randomInt(1, Math.min(l.durationMonths, 10));
      const avg = totalPaid / numPayments;
      for (let p = 0; p < numPayments; p++) {
        const pd = new Date(l.startDate);
        pd.setDate(pd.getDate() + (p + 1) * randomInt(20, 35));
        if (pd > new Date()) continue;
        const amount = randomFloat(avg * 0.5, avg * 1.5);
        try {
          await query(
            `INSERT INTO transactions (
               tenant_id, transaction_code, loan_id, client_id, amount_paid,
               payment_date, payment_method, payment_reference, payment_status
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed')`,
            [
              tenant.id,
              txnCode(pfx, txnSeq++),
              l.id,
              l.clientId,
              amount,
              pd.toISOString().split("T")[0],
              randomItem(PAYMENT_METHODS),
              `REF${randomInt(100000, 999999)}`,
            ],
          );
          txnCount++;
        } catch (e) {
          console.error(`   ⚠️  txn insert: ${e.message}`);
        }
      }
    }
    console.log(`   ✅ ${txnCount} transactions created\n`);

    // ---- Capital pool ----------------------------------------------
    const disbursed = fundedLoans.reduce(
      (s, l) => s + parseFloat(l.principal),
      0,
    );
    const collected = parseFloat(
      (
        await query(
          `SELECT COALESCE(SUM(amount_paid),0) t FROM transactions
           WHERE tenant_id = $1 AND payment_status = 'completed'`,
          [tenant.id],
        )
      ).rows[0].t,
    );
    await query(
      `UPDATE capital_pool
         SET total_disbursed = $1, total_collected = $2,
             total_interest_earned = $3, updated_at = NOW()
       WHERE tenant_id = $4`,
      [
        disbursed,
        collected,
        parseFloat((collected * 0.15).toFixed(2)),
        tenant.id,
      ],
    );
    console.log(
      `💼 Capital: disbursed KES ${disbursed.toLocaleString()}, ` +
        `collected KES ${collected.toLocaleString()}\n`,
    );
  }

  // ---- Summary -------------------------------------------------------
  console.log(
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );
  console.log("🎉 SEEDING COMPLETE\n");
  for (const t of tenants) {
    const s = (
      await query(
        `SELECT
           (SELECT COUNT(*) FROM clients WHERE tenant_id=$1) clients,
           (SELECT COUNT(*) FROM loans WHERE tenant_id=$1) loans,
           (SELECT COUNT(*) FROM transactions WHERE tenant_id=$1) txns,
           (SELECT COUNT(*) FROM payment_schedules WHERE tenant_id=$1) sched`,
        [t.id],
      )
    ).rows[0];
    console.log(
      `📊 ${t.business_name}: ${s.clients} clients, ${s.loans} loans, ` +
        `${s.txns} txns, ${s.sched} schedules`,
    );
  }

  const cross = await query(`
    SELECT c.phone_number,
           c.first_name || ' ' || c.last_name AS name,
           COUNT(DISTINCT c.tenant_id) AS n,
           STRING_AGG(DISTINCT t.business_name, ', ') AS tenants
    FROM clients c
    JOIN tenants t ON c.tenant_id = t.id
    WHERE t.subdomain IN ('abclenders','xyzmicrofinance','quickloans')
    GROUP BY c.phone_number, c.first_name, c.last_name
    HAVING COUNT(DISTINCT c.tenant_id) > 1
    ORDER BY n DESC, name
    LIMIT 10
  `);
  console.log(`\n🔄 Cross-tenant customers (sample of ${cross.rows.length}):`);
  cross.rows.forEach((c) =>
    console.log(`   ${c.name} (${c.phone_number}) → ${c.tenants}`),
  );

  await pool.end();
  process.exit(0);
}

seedBulkData().catch(async (e) => {
  console.error("\n❌ FATAL:", e.message);
  console.error(e.stack);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
