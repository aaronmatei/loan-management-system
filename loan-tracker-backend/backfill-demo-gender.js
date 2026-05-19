import pool, { query } from "./src/config/database.js";

// One-off: backfill clients.gender for the bulk-seeded demo tenants
// (5=ABC, 6=XYZ, 7=Quick) which were inserted before the gender
// column existed. Gender is inferred from first_name using the SAME
// name pools seed-demo-data-bulk.js draws from; names that appear in
// both pools (or neither) get a random gender. Tech Tsadong (tenant
// 1) is never touched. Scoped to gender IS NULL so it is re-run safe.

const MALE = new Set([
  "James", "John", "Peter", "David", "Joseph", "Daniel", "Samuel", "Paul", "Michael", "Stephen",
  "Kevin", "Brian", "Edwin", "Patrick", "Charles", "Anthony", "Felix", "George", "Bernard", "Geoffrey",
  "Mwangi", "Kamau", "Otieno", "Karanja", "Mutua", "Kiprop", "Maina", "Njoroge", "Omondi", "Kipchoge",
  "Kibet", "Wafula", "Wekesa", "Kiplagat", "Ouma", "Onyango", "Mutuku", "Mutiso", "Kioko", "Barasa",
]);

const FEMALE = new Set([
  "Mary", "Grace", "Faith", "Joyce", "Esther", "Ruth", "Margaret", "Lucy", "Jane", "Susan",
  "Caroline", "Christine", "Beatrice", "Agnes", "Anne", "Rose", "Sarah", "Catherine", "Eunice", "Hellen",
  "Wanjiku", "Akinyi", "Wanjiru", "Nyambura", "Wairimu", "Chebet", "Wambui", "Atieno", "Auma", "Adhiambo",
  "Nyokabi", "Njeri", "Muthoni", "Nduta", "Wangari", "Naliaka", "Cherono", "Jepkemboi", "Jepchirchir", "Khadija",
]);

const DEMO_TENANTS = [5, 6, 7];

function classify(name) {
  const m = MALE.has(name);
  const f = FEMALE.has(name);
  if (m && !f) return "male";
  if (f && !m) return "female";
  return Math.random() < 0.5 ? "male" : "female"; // unisex / unknown
}

async function run() {
  console.log("🔧 Backfilling gender for demo tenants (5,6,7)...\n");

  const rows = (
    await query(
      `SELECT id, first_name FROM clients
       WHERE tenant_id = ANY($1::int[]) AND gender IS NULL`,
      [DEMO_TENANTS],
    )
  ).rows;

  if (rows.length === 0) {
    console.log("✓ Nothing to backfill (no NULL-gender demo clients).");
    await pool.end();
    process.exit(0);
  }

  const maleIds = [];
  const femaleIds = [];
  for (const r of rows) {
    (classify(r.first_name) === "male" ? maleIds : femaleIds).push(r.id);
  }

  if (maleIds.length) {
    await query(
      `UPDATE clients SET gender = 'male', updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [maleIds],
    );
  }
  if (femaleIds.length) {
    await query(
      `UPDATE clients SET gender = 'female', updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [femaleIds],
    );
  }

  console.log(
    `✅ Updated ${rows.length} clients — ${maleIds.length} male, ${femaleIds.length} female\n`,
  );

  const summary = await query(
    `SELECT t.business_name,
            COUNT(*) AS clients,
            COUNT(*) FILTER (WHERE c.gender = 'male')   AS male,
            COUNT(*) FILTER (WHERE c.gender = 'female') AS female,
            COUNT(*) FILTER (WHERE c.gender IS NULL)    AS still_null
     FROM clients c JOIN tenants t ON c.tenant_id = t.id
     WHERE c.tenant_id = ANY($1::int[])
     GROUP BY t.business_name ORDER BY t.business_name`,
    [DEMO_TENANTS],
  );
  console.table(
    summary.rows.map((r) => ({
      tenant: r.business_name,
      clients: +r.clients,
      male: +r.male,
      female: +r.female,
      still_null: +r.still_null,
    })),
  );

  await pool.end();
  process.exit(0);
}

run().catch(async (e) => {
  console.error("❌ FATAL:", e.message);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
