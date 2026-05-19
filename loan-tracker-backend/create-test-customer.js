import dotenv from "dotenv";
dotenv.config();

import bcryptjs from "bcryptjs";
import pkg from "pg";
const { Pool } = pkg;

// ===========================================
// SELF-CONTAINED DATABASE CONNECTION
// ===========================================

// Build connection config from env, with fallbacks
const dbConfig = {
  user: process.env.DB_USER || "aron",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "loan_tracker",
  port: parseInt(process.env.DB_PORT || "5432"),
};

// Only add password if it's set (allows peer auth on Linux)
if (process.env.DB_PASSWORD) {
  dbConfig.password = String(process.env.DB_PASSWORD);
}

const pool = new Pool(dbConfig);

const query = (text, params) => pool.query(text, params);

// Test connection on startup
async function testConnection() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    console.error("\n❌ Database connection failed!");
    console.error("Error:", err.message);
    console.error("\nConnection config:");
    console.error("  user:", dbConfig.user);
    console.error("  host:", dbConfig.host);
    console.error("  database:", dbConfig.database);
    console.error("  port:", dbConfig.port);
    console.error(
      "  password:",
      dbConfig.password ? "***SET***" : "(not set - using peer auth)",
    );
    console.error(
      "\n💡 Make sure your .env file has the correct database credentials.",
    );
    console.error(
      "   Or that PostgreSQL allows peer authentication for user",
      dbConfig.user,
    );
    return false;
  }
}

// ===========================================
// CONSTANTS
// ===========================================

const DEFAULT_PASSWORD = "Customer2026";

// ===========================================
// HELPER FUNCTIONS
// ===========================================

/**
 * Normalize phone number to +254XXX format
 */
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.toString().replace(/[\s\-\(\)]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "+254" + cleaned.substring(1);
  } else if (cleaned.startsWith("254")) {
    cleaned = "+" + cleaned;
  } else if (!cleaned.startsWith("+")) {
    cleaned = "+254" + cleaned;
  }
  return cleaned;
}

// ===========================================
// MAIN FUNCTIONS
// ===========================================

async function listTopClients() {
  console.log("\n📋 TOP CLIENTS WITH ACTIVE LOANS (All Tenants):\n");

  const result = await query(`
    SELECT 
      c.id,
      c.client_code,
      c.first_name || ' ' || c.last_name as name,
      c.phone_number,
      c.id_number,
      t.business_name as tenant_name,
      t.subdomain,
      COUNT(l.id) as active_loans,
      COALESCE(SUM(l.principal_amount), 0) as total_borrowed,
      EXISTS(SELECT 1 FROM platform_customers pc WHERE pc.phone_number = c.phone_number) as has_account
    FROM clients c
    JOIN tenants t ON c.tenant_id = t.id
    LEFT JOIN loans l ON c.id = l.client_id AND l.status = 'active'
    WHERE c.phone_number IS NOT NULL AND c.phone_number != ''
    GROUP BY c.id, t.business_name, t.subdomain
    HAVING COUNT(l.id) > 0
    ORDER BY active_loans DESC, total_borrowed DESC
    LIMIT 20
  `);

  if (result.rows.length === 0) {
    console.log("⚠️  No clients with active loans found.\n");
    return;
  }

  console.log(
    "ID    | Client Code         | Name                       | Phone           | Tenant           | Loans | Total Borrowed   | Account?",
  );
  console.log(
    "------+---------------------+----------------------------+-----------------+------------------+-------+------------------+---------",
  );

  result.rows.forEach((c) => {
    const id = String(c.id).padEnd(5);
    const code = String(c.client_code || "")
      .substring(0, 19)
      .padEnd(19);
    const name = String(c.name).substring(0, 26).padEnd(26);
    const phone = String(c.phone_number || "").padEnd(15);
    const tenant = String(c.tenant_name || "")
      .substring(0, 16)
      .padEnd(16);
    const active = String(c.active_loans).padEnd(5);
    const total = `KES ${parseFloat(c.total_borrowed).toLocaleString()}`.padEnd(
      16,
    );
    const hasAccount = c.has_account ? "✅ Yes" : "❌ No";

    console.log(
      `${id} | ${code} | ${name} | ${phone} | ${tenant} | ${active} | ${total} | ${hasAccount}`,
    );
  });

  console.log("\n💡 USAGE:");
  console.log("   node create-test-customer.js <client_id> [password]");
  console.log("");
  console.log("📝 EXAMPLES:");
  console.log("   node create-test-customer.js 142");
  console.log("   node create-test-customer.js 142 MyPassword2026");
  console.log("");
  console.log(`💡 Default password: ${DEFAULT_PASSWORD}\n`);
}

async function createTestCustomer(clientId, password = DEFAULT_PASSWORD) {
  console.log(`\n🔍 Looking up client ID ${clientId}...`);

  // Get client info
  const clientResult = await query(
    `
    SELECT 
      c.*,
      t.business_name as tenant_name,
      t.subdomain as tenant_subdomain,
      (SELECT COUNT(*) FROM loans WHERE client_id = c.id) as total_loans,
      (SELECT COUNT(*) FROM loans WHERE client_id = c.id AND status = 'active') as active_loans,
      (SELECT COALESCE(SUM(principal_amount), 0) FROM loans WHERE client_id = c.id AND status = 'active') as total_active
    FROM clients c
    JOIN tenants t ON c.tenant_id = t.id
    WHERE c.id = $1
    `,
    [clientId],
  );

  if (clientResult.rows.length === 0) {
    console.error(`❌ Client ID ${clientId} not found!\n`);
    process.exit(1);
  }

  const client = clientResult.rows[0];

  console.log(`✓ Found client:`);
  console.log(`   Name: ${client.first_name} ${client.last_name}`);
  console.log(`   Phone: ${client.phone_number}`);
  console.log(`   ID Number: ${client.id_number || "(not set)"}`);
  console.log(`   Client Code: ${client.client_code}`);
  console.log(`   Tenant: ${client.tenant_name} (${client.tenant_subdomain})`);
  console.log(
    `   Total Loans: ${client.total_loans} (${client.active_loans} active)`,
  );
  console.log(
    `   Total Active Borrowing: KES ${parseFloat(client.total_active).toLocaleString()}\n`,
  );

  if (!client.phone_number) {
    console.error(
      `❌ Client has no phone number! Cannot create portal account.\n`,
    );
    process.exit(1);
  }

  // Normalize phone number
  const normalizedPhone = normalizePhone(client.phone_number);
  console.log(`📱 Normalized phone: ${normalizedPhone}`);

  // If client phone needs updating
  if (normalizedPhone !== client.phone_number) {
    console.log(
      `   Updating client record phone from "${client.phone_number}" to "${normalizedPhone}"`,
    );
    await query(`UPDATE clients SET phone_number = $1 WHERE id = $2`, [
      normalizedPhone,
      client.id,
    ]);
  }

  console.log("");

  // Check if customer account already exists
  const existing = await query(
    "SELECT id, password_hash FROM platform_customers WHERE phone_number = $1",
    [normalizedPhone],
  );

  let customerId;
  const passwordHash = await bcryptjs.hash(password, 10);

  if (existing.rows.length > 0) {
    console.log(
      `⚠️  Customer account already exists (id=${existing.rows[0].id})`,
    );
    console.log(`   Updating password and ensuring verified...\n`);

    await query(
      `
      UPDATE platform_customers 
      SET password_hash = $1, 
          phone_verified = true, 
          email_verified = true,
          is_active = true,
          is_blacklisted_platform = false,
          updated_at = NOW()
      WHERE id = $2
      `,
      [passwordHash, existing.rows[0].id],
    );

    customerId = existing.rows[0].id;
    console.log(`✓ Updated platform_customer (id=${customerId})\n`);
  } else {
    console.log(`📝 Creating new platform customer account...`);

    // Generate a temporary ID number if missing
    const idNumber = client.id_number || `TEMP${Date.now()}${client.id}`;

    const result = await query(
      `
      INSERT INTO platform_customers (
        phone_number, id_number, first_name, last_name,
        email, password_hash, phone_verified, email_verified,
        is_active, registration_tenant_id
      ) VALUES ($1, $2, $3, $4, $5, $6, true, true, true, $7)
      RETURNING id
      `,
      [
        normalizedPhone,
        idNumber,
        client.first_name,
        client.last_name,
        client.email,
        passwordHash,
        client.tenant_id,
      ],
    );

    customerId = result.rows[0].id;
    console.log(`✓ Created platform_customer (id=${customerId})\n`);
  }

  // Create or update tenant link
  console.log(`🔗 Linking to ${client.tenant_name}...`);

  const linkResult = await query(
    `
    INSERT INTO customer_tenant_links (
      platform_customer_id, tenant_id, client_id, status, linked_at
    ) VALUES ($1, $2, $3, 'active', NOW())
    ON CONFLICT (platform_customer_id, tenant_id) DO UPDATE 
    SET status = 'active', linked_at = NOW()
    RETURNING id
    `,
    [customerId, client.tenant_id, client.id],
  );

  console.log(`✓ Tenant link created/updated (id=${linkResult.rows[0].id})\n`);

  // Final summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉 TEST CUSTOMER ACCOUNT READY!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("🔐 LOGIN CREDENTIALS:");
  console.log(`   Phone: ${normalizedPhone}`);
  console.log(`   (or try: ${normalizedPhone.replace("+254", "0")})`);
  console.log(`   Password: ${password}\n`);

  console.log("🌐 LOGIN URL:");
  console.log(`   http://localhost:5173/portal/login\n`);

  console.log("🔧 IN DEV MODE:");
  console.log(`   1. Click "Switch" in yellow banner`);
  console.log(`   2. Select "${client.tenant_name}"`);
  console.log(`   3. Enter phone and password above`);
  console.log(`   4. You'll see ${client.active_loans} active loans!\n`);

  console.log("💡 VERIFY IN DATABASE:");
  console.log(`   psql -U aron -d loan_tracker -c "`);
  console.log(
    `     SELECT phone_number, first_name, last_name, phone_verified FROM platform_customers WHERE id = ${customerId};`,
  );
  console.log(`   "\n`);
}

// ===========================================
// MAIN ENTRY POINT
// ===========================================

async function main() {
  // Test database connection first
  const connected = await testConnection();
  if (!connected) {
    await pool.end();
    process.exit(1);
  }

  const args = process.argv.slice(2);

  try {
    if (args.length === 0) {
      // No arguments - show top clients
      await listTopClients();
    } else {
      const clientId = parseInt(args[0]);
      const password = args[1] || DEFAULT_PASSWORD;

      if (isNaN(clientId)) {
        console.error(
          "❌ Invalid client ID. Usage: node create-test-customer.js <client_id> [password]",
        );
        await pool.end();
        process.exit(1);
      }

      await createTestCustomer(clientId, password);
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.detail) console.error("Detail:", error.detail);
    if (error.code) console.error("Code:", error.code);
    await pool.end();
    process.exit(1);
  }

  await pool.end();
  process.exit(0);
}

main();
