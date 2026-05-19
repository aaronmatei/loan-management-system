import pool, { query } from "./src/config/database.js";

// Demo clients per tenant. "Peter Kamau" intentionally exists at TWO
// lenders to test the global-customer auto-link / multi-tenant flow.
const DEMO = [
  {
    sub: "abclenders",
    clients: [
      { first_name: "Peter", last_name: "Kamau", phone_number: "+254712345678", id_number: "12345678", county: "Nairobi" },
      { first_name: "Mary", last_name: "Akinyi", phone_number: "+254723456789", id_number: "23456789", county: "Mombasa" },
    ],
  },
  {
    sub: "xyzmicrofinance",
    clients: [
      { first_name: "Peter", last_name: "Kamau", phone_number: "+254712345678", id_number: "12345678", county: "Nairobi" },
      { first_name: "Grace", last_name: "Wanjiru", phone_number: "+254734567890", id_number: "34567890", county: "Nakuru" },
    ],
  },
  {
    sub: "quickloans",
    clients: [
      { first_name: "James", last_name: "Mwangi", phone_number: "+254745678901", id_number: "45678901", county: "Kisumu" },
    ],
  },
];

async function seed() {
  console.log("🌱 Seeding demo clients...\n");
  for (const cfg of DEMO) {
    const tr = await query(
      "SELECT id, business_name FROM tenants WHERE subdomain = $1",
      [cfg.sub],
    );
    if (tr.rows.length === 0) {
      console.log(`⚠️  tenant "${cfg.sub}" not found, skipping`);
      continue;
    }
    const tenant = tr.rows[0];
    console.log(`\n📋 ${tenant.business_name}`);

    for (const c of cfg.clients) {
      try {
        const exists = await query(
          "SELECT id FROM clients WHERE phone_number = $1 AND tenant_id = $2",
          [c.phone_number, tenant.id],
        );
        if (exists.rows.length > 0) {
          console.log(`   ⚠️  ${c.first_name} ${c.last_name} exists`);
          continue;
        }
        const cnt = await query(
          "SELECT COUNT(*) AS count FROM clients WHERE tenant_id = $1",
          [tenant.id],
        );
        const year = new Date().getFullYear();
        const code = `CLT-${year}-${String(
          parseInt(cnt.rows[0].count, 10) + 1,
        ).padStart(5, "0")}`;
        await query(
          `INSERT INTO clients (
             tenant_id, client_code, first_name, last_name,
             phone_number, id_number, county, status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
          [
            tenant.id, code, c.first_name, c.last_name,
            c.phone_number, c.id_number, c.county,
          ],
        );
        console.log(`   ✅ ${c.first_name} ${c.last_name} (${code})`);
      } catch (error) {
        console.error(`   ❌ ${c.first_name}:`, error.message);
      }
    }
  }
  console.log(
    "\n🎉 Done. Multi-lender test customer: Peter Kamau · 0712345678 · ID 12345678 (ABC + XYZ)",
  );
  await pool.end();
  process.exit(0);
}

seed().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
