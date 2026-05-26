// Borrowing standing for ONE client with ONE lender (tenant). Used to gate
// new lending at every step of the pipeline — application, approval and
// disbursement — so a client with a defaulted loan can never get another, and
// no client exceeds 3 active loans at a time with a single lender.
import { query } from "../config/database.js";

// Returns { defaulted, active } counts. `excludeLoanId` drops a specific loan
// from the active count (e.g. the loan currently being approved/disbursed, so
// it isn't counted against its own limit).
export async function getLoanStanding(
  clientId,
  tenantId,
  { excludeLoanId = null } = {},
) {
  const r = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'defaulted') AS defaulted,
       COUNT(*) FILTER (
         WHERE status = 'active' AND ($3::int IS NULL OR id <> $3::int)
       ) AS active
     FROM loans
     WHERE client_id = $1 AND tenant_id = $2`,
    [clientId, tenantId, excludeLoanId],
  );
  return {
    defaulted: parseInt(r.rows[0].defaulted, 10),
    active: parseInt(r.rows[0].active, 10),
  };
}
