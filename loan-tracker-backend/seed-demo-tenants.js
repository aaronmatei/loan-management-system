import bcryptjs from "bcryptjs";
import pool from "./src/config/database.js";

// NOTE: the original spec INSERTed users.user_type / phone_verified /
// email_verified — those columns do NOT exist on `users` (they're on
// platform_customers). Removed. Each tenant is created in ONE
// transaction so a failure can't leave a tenant with no admin.

const DEMO_TENANTS = [
  {
    tenant_code: "ABC001",
    business_name: "ABC Lenders Ltd",
    business_type: "microfinance",
    subdomain: "abclenders",
    contact_name: "Sarah Mwangi",
    contact_email: "admin@abclenders.com",
    contact_phone: "+254712111111",
    physical_address: "Nairobi CBD, Kimathi Street",
    city: "Nairobi",
    county: "Nairobi",
    plan: "pro",
    brand_color: "#3B82F6",
    admin_password: "Admin@2026",
  },
  {
    tenant_code: "XYZ002",
    business_name: "XYZ Microfinance",
    business_type: "microfinance",
    subdomain: "xyzmicrofinance",
    contact_name: "John Otieno",
    contact_email: "admin@xyzmicrofinance.com",
    contact_phone: "+254722222222",
    physical_address: "Westlands Office Park, Block C",
    city: "Nairobi",
    county: "Nairobi",
    plan: "starter",
    brand_color: "#10B981",
    admin_password: "Admin@2026",
  },
  {
    tenant_code: "QLC003",
    business_name: "Quick Loans Co",
    business_type: "individual",
    subdomain: "quickloans",
    contact_name: "Mary Wanjiku",
    contact_email: "admin@quickloans.com",
    contact_phone: "+254733333333",
    physical_address: "Mombasa Road, Industrial Area",
    city: "Nairobi",
    county: "Nairobi",
    plan: "pro",
    brand_color: "#EF4444",
    admin_password: "Admin@2026",
  },
];

async function seed() {
  console.log("🌱 Seeding demo tenants...\n");
  for (const t of DEMO_TENANTS) {
    const client = await pool.connect();
    try {
      const exists = await client.query(
        "SELECT id FROM tenants WHERE subdomain = $1",
        [t.subdomain],
      );
      if (exists.rows.length > 0) {
        console.log(`⚠️  "${t.business_name}" already exists, skipping`);
        continue;
      }

      await client.query("BEGIN");

      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 30);

      const tr = await client.query(
        `INSERT INTO tenants (
           tenant_code, business_name, business_type, subdomain,
           contact_name, contact_email, contact_phone,
           physical_address, city, county,
           plan, status, brand_color,
           platform_fee_percentage, max_clients, max_loans, max_users,
           trial_ends_at, customer_portal_enabled, allow_self_signup
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,5.00,1000,1000,10,$13,true,true)
         RETURNING id`,
        [
          t.tenant_code, t.business_name, t.business_type, t.subdomain,
          t.contact_name, t.contact_email, t.contact_phone,
          t.physical_address, t.city, t.county,
          t.plan, t.brand_color, trialEnd,
        ],
      );
      const tenantId = tr.rows[0].id;

      const passwordHash = await bcryptjs.hash(t.admin_password, 10);
      const [firstName, ...rest] = t.contact_name.split(" ");
      const lastName = rest.join(" ") || "Admin";

      // users.username + users.email carry GLOBAL unique constraints
      // (the multitenancy migration did not make them per-tenant like
      // client_code/loan_code). Every tenant's contact_email local-part
      // is "admin", so derive a globally-unique username from the
      // subdomain to avoid users_username_key collisions.
      await client.query(
        `INSERT INTO users (
           tenant_id, username, email, password_hash,
           first_name, last_name, phone_number, role,
           is_active, is_platform_admin
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'admin',true,false)`,
        [
          tenantId,
          `${t.subdomain}_admin`,
          t.contact_email.toLowerCase(),
          passwordHash,
          firstName,
          lastName,
          t.contact_phone,
        ],
      );

      await client.query(
        `INSERT INTO capital_pool
           (tenant_id, initial_capital, total_disbursed, total_collected, total_interest_earned)
         VALUES ($1, 5000000, 0, 0, 0)`,
        [tenantId],
      );

      await client.query(
        `INSERT INTO company_settings
           (tenant_id, company_name, company_address, company_phone, company_email)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantId,
          t.business_name,
          t.physical_address,
          t.contact_phone,
          t.contact_email,
        ],
      );

      await client.query("COMMIT");
      console.log(
        `✅ ${t.business_name}  (subdomain=${t.subdomain}, admin=${t.contact_email} / ${t.admin_password})`,
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`❌ ${t.business_name}:`, error.message);
    } finally {
      client.release();
    }
  }
  console.log("\n🎉 Done. All demo admin passwords: Admin@2026");
  await pool.end();
  process.exit(0);
}

seed().catch((e) => {
  console.error("Seed error:", e);
  process.exit(1);
});
