// Canonical per-tenant client_code + loan_code generators.
//
// Client codes:  CLT-<PREFIX>-<YEAR>-<NNNNN>      (year = "now")
// Loan codes:    LN-<PREFIX>-<MMYYYY>-<NNNNN>     (month + year = the
//                                                  loan's origination
//                                                  date, NOT now)
//
//   PREFIX   = TENANT_PREFIXES[subdomain]  (3-letter uppercase, derived
//              from business initials, not the subdomain itself).
//              Fallback for unknown tenants: subdomain.substring(0,3).
//   MMYYYY   = zero-padded month + 4-digit year, e.g. "042022".
//              Reflects when the loan was originated, so a back-dated
//              application captured today still reads with its real
//              date in the code.
//   NNNNN    = next sequence within the tenant (zero-padded to 5)
//
// The sequence is MAX(suffix)+1 over the tenant's existing codes,
// which is collision-safe even if older rows were deleted (unlike
// COUNT(*)+1, which the legacy call-sites used). The regex matches
// both the 4-digit YYYY (legacy) and 6-digit MMYYYY (current) shapes
// so the sequence keeps climbing across the format change.

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
 *
 *   LN-<PREFIX>-<MMYYYY>-<NNNNN>     e.g. "LN-TSD-042022-00764"
 *
 * The MMYYYY portion comes from `originationDate` (the loan's
 * application_date), NOT today — so a back-dated loan captured this
 * year for a borrower who applied in April 2022 reads as 042022 in
 * its code, matching the rest of its date metadata. When the caller
 * omits originationDate the helper falls back to today (the live-
 * application path, e.g. the customer portal).
 *
 * @param {Function} query           - db query fn (text, params) => Promise
 * @param {number}   tenantId
 * @param {Date|string} [originationDate]  - application_date for the loan
 * @returns {Promise<string>}
 */
export async function nextLoanCode(query, tenantId, originationDate) {
  return nextScopedCode(
    query,
    tenantId,
    "LN",
    "loan_code",
    "loans",
    originationDate,
  );
}

/**
 * Internal helper — both code generators do MAX(suffix)+1 keyed by
 * tenant. The `\d+` in the regex matches both 4-digit YYYY (client
 * codes + legacy loan codes) and 6-digit MMYYYY (current loan codes),
 * so the sequence keeps climbing across the format change.
 */
async function nextScopedCode(
  query,
  tenantId,
  kind,
  codeColumn,
  table,
  dateContext,
) {
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
  // Loan codes carry MMYYYY tied to the loan's origination date;
  // client codes (and any future code KINDs) keep the 4-digit YYYY
  // tied to today, which is the simpler "we created this client on
  // this calendar year" semantics.
  let datePart;
  if (kind === "LN") {
    const d = dateContext ? new Date(dateContext) : new Date();
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    const mm = String(safe.getMonth() + 1).padStart(2, "0");
    datePart = `${mm}${safe.getFullYear()}`;
  } else {
    datePart = String(new Date().getFullYear());
  }
  return `${kind}-${tenantPrefix(subdomain)}-${datePart}-${String(next).padStart(5, "0")}`;
}
