// Canonical per-tenant client_code generator.
//
// Format: CLT-<PREFIX>-<YEAR>-<NNNNN>
//   PREFIX  = TENANT_PREFIXES[subdomain]  (3-letter uppercase, derived
//             from business initials, not the subdomain itself).
//             Fallback for unknown tenants: subdomain.substring(0,3).
//   YEAR    = current calendar year
//   NNNNN   = next sequence within the tenant (zero-padded to 5)
//
// The sequence is MAX(suffix)+1 over the tenant's existing codes,
// which is collision-safe even if older rows were deleted (unlike
// COUNT(*)+1, which the legacy call-sites used).

export const TENANT_PREFIXES = {
  techtsadong: "TSD",
  abclenders: "ABC",
  xyzmicrofinance: "XYZ",
  quickloans: "QLC",
};

export function tenantPrefix(subdomain) {
  if (!subdomain) return "GEN";
  return (
    TENANT_PREFIXES[subdomain] || subdomain.substring(0, 3).toUpperCase()
  );
}

/**
 * Generate the next client_code for a tenant.
 * @param {Function} query - the db query fn (text, params) => Promise
 * @param {number}   tenantId
 * @returns {Promise<string>} e.g. "CLT-TSD-2026-00502"
 */
export async function nextClientCode(query, tenantId) {
  return nextScopedCode(query, tenantId, "CLT", "client_code", "clients");
}

/**
 * Generate the next loan_code for a tenant.
 * Same canonical format as client codes: LN-<PREFIX>-<YEAR>-<NNNNN>.
 * Used by both the staff loan-create path (routes/loans.js) and the
 * customer-portal application path (routes/portal/customer.js).
 *
 * @returns {Promise<string>} e.g. "LN-TSD-2026-00764"
 */
export async function nextLoanCode(query, tenantId) {
  return nextScopedCode(query, tenantId, "LN", "loan_code", "loans");
}

/**
 * Internal helper — both code generators do MAX(suffix)+1 keyed by
 * tenant. Considers BOTH the new `<KIND>-<PREFIX>-<YEAR>-<NNNNN>`
 * shape AND the legacy `<KIND>-<YEAR>-<NNNN>` shape so the sequence
 * keeps climbing after the normalization migration runs.
 */
async function nextScopedCode(query, tenantId, kind, codeColumn, table) {
  const r = await query(
    `SELECT t.subdomain,
            MAX(CAST(SUBSTRING(${codeColumn} FROM '${kind}-[A-Z]+-\\d+-(\\d+)$') AS INTEGER)) AS max_pref,
            MAX(CAST(SUBSTRING(${codeColumn} FROM '${kind}-\\d+-(\\d+)$')        AS INTEGER)) AS max_legacy
       FROM tenants t
       LEFT JOIN ${table} x ON x.tenant_id = t.id
      WHERE t.id = $1
      GROUP BY t.subdomain`,
    [tenantId],
  );
  if (r.rows.length === 0) {
    throw new Error(`tenant ${tenantId} not found`);
  }
  const { subdomain, max_pref, max_legacy } = r.rows[0];
  const next =
    Math.max(parseInt(max_pref || 0, 10), parseInt(max_legacy || 0, 10)) + 1;
  const year = new Date().getFullYear();
  return `${kind}-${tenantPrefix(subdomain)}-${year}-${String(next).padStart(5, "0")}`;
}
