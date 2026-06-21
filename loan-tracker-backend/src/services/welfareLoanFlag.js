// The per-welfare master "Loans" switch (welfare_settings.loans_enabled, mig
// 095). When off, loan UI is hidden and loan WRITES are refused.
import { query } from "../config/database.js";

// True when the welfare (by tenant) has the loan capability turned on.
export async function isLoansEnabled(tenantId) {
  if (tenantId == null) return false;
  const r = await query(`SELECT COALESCE(loans_enabled, false) AS le FROM welfare_settings WHERE tenant_id = $1`, [tenantId]);
  return r.rows.length ? r.rows[0].le === true : false;
}

// Express middleware: refuse loan WRITES (non-GET) when loans are off. Reads pass
// through (the UI hides them anyway). Resolves the welfare from req.welfare
// (admin routes) or req.member (member portal).
export function gateLoanWrites(req, res, next) {
  if (req.method === "GET") return next();
  const tenantId = req.welfare?.tenant_id ?? req.member?.tenant_id ?? null;
  isLoansEnabled(tenantId)
    .then((on) => (on ? next() : res.status(403).json({ error: "Loans are turned off for this welfare.", blocker: "loans_disabled" })))
    .catch(next);
}
