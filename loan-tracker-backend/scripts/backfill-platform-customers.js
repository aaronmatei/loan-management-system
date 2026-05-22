// One-time backfill: give every EXISTING client a customer-portal login —
// a verified platform_customers account (default password Customer2026)
// linked to their tenant. Idempotent: re-running skips clients already linked
// and never resets a password a real customer already set.
//
//   Local:       node scripts/backfill-platform-customers.js
//   Production:  DATABASE_URL="postgres://...neon.../neondb?sslmode=require" \
//                  node scripts/backfill-platform-customers.js
//
// dotenv is loaded BEFORE importing config/database.js (its pool reads env at
// import time); an exported DATABASE_URL still wins over the .env file.
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const { query } = await import("../src/config/database.js");
const { ensurePortalAccount, DEFAULT_PORTAL_PASSWORD } = await import(
  "../src/services/portalAccountService.js"
);

async function main() {
  const { rows: clients } = await query("SELECT * FROM clients ORDER BY id");
  console.log(
    `Backfilling portal accounts for ${clients.length} client(s)...`,
  );
  let ok = 0;
  let failed = 0;
  for (const c of clients) {
    try {
      await ensurePortalAccount(c);
      ok++;
    } catch (e) {
      failed++;
      console.error(`  ✗ client ${c.id} (${c.phone_number}): ${e.message}`);
    }
  }
  console.log(
    `✓ Done: ${ok} linked, ${failed} failed. Default password: ${DEFAULT_PORTAL_PASSWORD}`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
