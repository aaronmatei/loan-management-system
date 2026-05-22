// Gives a back-office client a customer-portal login.
//
// A `clients` row is a CRM record with no login; the portal authenticates
// `platform_customers`. This finds-or-creates a verified platform_customers
// account (default password below) and links it to the client's tenant, so a
// client created by staff can sign in immediately. Existing portal accounts
// keep their own password — we never clobber a real one.
import bcryptjs from "bcryptjs";
import { query } from "../config/database.js";
import { formatPhone } from "../utils/formatter.js";
import logger from "../config/logger.js";

export const DEFAULT_PORTAL_PASSWORD = "Customer2026";

export async function ensurePortalAccount(client, opts = {}) {
  if (!client?.phone_number || !client?.tenant_id) return null;

  const fp = formatPhone(client.phone_number);
  // platform_customers.id_number is NOT NULL + UNIQUE; fall back to a stable,
  // globally-unique synthetic value when the client has no national ID.
  const idNumber = client.id_number || `AUTO-${client.id}`;
  const password = opts.password || DEFAULT_PORTAL_PASSWORD;

  // 1) Find an existing portal account by phone or ID (UNIQUE on both).
  let pc = (
    await query(
      `SELECT * FROM platform_customers
        WHERE phone_number = $1 OR id_number = $2
        LIMIT 1`,
      [fp, idNumber],
    )
  ).rows[0];

  if (!pc) {
    const hash = await bcryptjs.hash(password, 10);
    try {
      pc = (
        await query(
          `INSERT INTO platform_customers
             (phone_number, id_number, first_name, last_name, email,
              password_hash, phone_verified, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,true,true)
           RETURNING *`,
          [
            fp,
            idNumber,
            client.first_name,
            client.last_name,
            client.email || null,
            hash,
          ],
        )
      ).rows[0];
    } catch (e) {
      // Lost a race on the UNIQUE phone/id → re-fetch and use the winner.
      pc = (
        await query(
          `SELECT * FROM platform_customers
            WHERE phone_number = $1 OR id_number = $2 LIMIT 1`,
          [fp, idNumber],
        )
      ).rows[0];
      if (!pc) throw e;
    }
  } else if (!pc.password_hash || !pc.phone_verified) {
    // Existing but unusable (no password / unverified) → make it usable.
    // Keep any password they already set.
    const hash = pc.password_hash || (await bcryptjs.hash(password, 10));
    await query(
      `UPDATE platform_customers
          SET phone_verified = true, is_active = true,
              password_hash = $1, updated_at = NOW()
        WHERE id = $2`,
      [hash, pc.id],
    );
  }

  // 2) Link the portal account to this tenant's client (idempotent).
  await query(
    `INSERT INTO customer_tenant_links
       (platform_customer_id, tenant_id, client_id, status)
     VALUES ($1,$2,$3,'active')
     ON CONFLICT DO NOTHING`,
    [pc.id, client.tenant_id, client.id],
  );

  logger.info(
    `✓ Portal account ready for client ${client.client_code || client.id} (pc=${pc.id})`,
  );
  return pc;
}
