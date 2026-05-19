// ============================================================
// Tenant scoping helper for raw-SQL routes.
//
// Backward-compatible by design: pre-migration (or for old JWTs
// with no tenant_id) it returns an EMPTY clause, so every existing
// route behaves exactly as it does today and nothing breaks while
// the migration is rolled out incrementally. Once the migration is
// applied and users re-login, req.user.tenant_id is present and
// queries get scoped. Platform admins (is_platform_admin) are NOT
// scoped — they intentionally see all tenants.
//
// Usage (append to an existing parameterised query):
//
//   const t = tenantClause(req, params.length);   // after pushing other params
//   const result = await query(
//     `SELECT * FROM clients WHERE 1=1 ${t.clause}`,
//     [...params, ...t.params],
//   );
//
// For INSERTs:
//
//   const tid = tenantId(req);
//   if (tid) { columns += ", tenant_id"; values.push(tid); ... }
//
// ============================================================

/** The tenant id to scope by, or null when scoping must be skipped. */
export function tenantId(req) {
  if (req.user?.is_platform_admin) return null; // sees everything
  return req.user?.tenant_id || null; // null pre-migration / old token
}

/**
 * Build an ` AND <col> = $N` fragment plus its param.
 * @param {object} req
 * @param {number} paramOffset  number of params already in the array
 * @param {string} [col="tenant_id"]
 * @returns {{clause:string, params:any[]}}
 */
export function tenantClause(req, paramOffset, col = "tenant_id") {
  const tid = tenantId(req);
  if (!tid) return { clause: "", params: [] };
  return { clause: ` AND ${col} = $${paramOffset + 1}`, params: [tid] };
}

export default { tenantId, tenantClause };
