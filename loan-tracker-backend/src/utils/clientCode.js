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
  const r = await query(
    `SELECT t.subdomain,
            MAX(CAST(SUBSTRING(c.client_code FROM 'CLT-[A-Z]+-\\d+-(\\d+)$') AS INTEGER)) AS max_pref,
            MAX(CAST(SUBSTRING(c.client_code FROM 'CLT-\\d+-(\\d+)$')        AS INTEGER)) AS max_legacy
       FROM tenants t
       LEFT JOIN clients c ON c.tenant_id = t.id
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
  return `CLT-${tenantPrefix(subdomain)}-${year}-${String(next).padStart(5, "0")}`;
}
