// Credit score persistence — single source for writing
// clients.credit_score from the live payment + loan history.
//
// The actual scoring formula lives in src/utils/creditScore.js. This
// service wraps the SQL aggregates the formula needs (loan-status
// counts + schedule on-time/late/missed counts) and caches the
// result back on the client row, so:
//
//   • the Clients list reads a cheap column instead of re-running
//     a per-row multi-table aggregate;
//   • every write that materially changes a client's history
//     (payments, defaults, waiver apply/reverse) can call this once
//     and stay fresh — no nightly job needed.
//
// All entry points are BEST-EFFORT: errors are logged, never thrown.
// Credit-score housekeeping must never block the operation that
// triggered it.

import { query } from "../config/database.js";
import { calculateCreditScore, isRated } from "../utils/creditScore.js";
import logger from "../config/logger.js";

/**
 * Recompute and persist `clients.credit_score` for one client.
 *
 * @param {number} clientId        REQUIRED.
 * @param {number} [tenantId]      When supplied, scopes the UPDATE so a
 *                                  cross-tenant call can't accidentally
 *                                  overwrite another tenant's row.
 * @returns {Promise<number|null>} The new score, or null if the client
 *                                  remains unrated (no repayment
 *                                  history + no adverse marks yet).
 */
export async function recomputeCreditScore(clientId, tenantId) {
  if (!clientId) return null;
  try {
    const r = await query(
      `
      WITH loan_counts AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'defaulted')::int AS defaulted
          FROM loans WHERE client_id = $1
      ),
      schedule_counts AS (
        SELECT
          COUNT(*) FILTER (
            WHERE ps.status = 'paid' AND ps.actual_payment_date IS NOT NULL
              AND ps.actual_payment_date <= ps.due_date
          )::int AS on_time,
          COUNT(*) FILTER (
            WHERE ps.status = 'paid' AND ps.actual_payment_date IS NOT NULL
              AND ps.actual_payment_date > ps.due_date
          )::int AS late,
          COUNT(*) FILTER (WHERE ps.status = 'overdue')::int AS missed
          FROM payment_schedules ps
          JOIN loans l ON ps.loan_id = l.id
         WHERE l.client_id = $1
      )
      SELECT lc.completed, lc.defaulted,
             sc.on_time, sc.late, sc.missed
        FROM loan_counts lc, schedule_counts sc
      `,
      [clientId],
    );
    const m = r.rows[0] || {};
    const onTime = parseInt(m.on_time, 10) || 0;
    const late = parseInt(m.late, 10) || 0;
    const missed = parseInt(m.missed, 10) || 0;
    const totalPayments = onTime + late;
    const dueByNow = onTime + late + missed;
    const onTimeRate =
      dueByNow > 0
        ? parseFloat(((onTime / dueByNow) * 100).toFixed(1))
        : null;

    const summary = {
      completed_loans_count: parseInt(m.completed, 10) || 0,
      defaulted_loans_count: parseInt(m.defaulted, 10) || 0,
      current_overdue_count: missed,
      total_payments: totalPayments,
      late_payments: late,
      on_time_rate: onTimeRate,
    };

    const score = isRated(summary) ? calculateCreditScore(summary) : null;

    // Tenant-scoped UPDATE when we know the tenant — guards against a
    // misrouted callsite from one tenant clobbering another's row.
    if (tenantId) {
      await query(
        `UPDATE clients
            SET credit_score = $1, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        [score, clientId, tenantId],
      );
    } else {
      await query(
        `UPDATE clients
            SET credit_score = $1, updated_at = NOW()
          WHERE id = $2`,
        [score, clientId],
      );
    }
    return score;
  } catch (err) {
    logger.error(
      `recomputeCreditScore failed for client ${clientId}:`,
      err.message,
    );
    return null;
  }
}

/**
 * Convenience: recompute by loan_id. Looks up the loan's client_id
 * + tenant_id in one query, then delegates. Useful for callers that
 * only have a loan in scope (payments, waivers, defaults).
 */
export async function recomputeCreditScoreForLoan(loanId) {
  if (!loanId) return null;
  try {
    const r = await query(
      `SELECT client_id, tenant_id FROM loans WHERE id = $1`,
      [loanId],
    );
    if (!r.rows[0]?.client_id) return null;
    return recomputeCreditScore(r.rows[0].client_id, r.rows[0].tenant_id);
  } catch (err) {
    logger.error(
      `recomputeCreditScoreForLoan failed for loan ${loanId}:`,
      err.message,
    );
    return null;
  }
}
