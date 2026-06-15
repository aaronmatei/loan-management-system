// Applies a confirmed welfare M-Pesa payment to its target (a contribution
// schedule, a member loan, or a penalty), posting the cash into the pool — the
// same effects as the manual flows. Idempotent via mpesa_transactions.allocated,
// so the Daraja callback and manual reconciliation can each run safely.
import { query } from "../config/database.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function poolBalance(welfareId) {
  const r = await query(
    `SELECT balance_after FROM member_pool_transactions WHERE welfare_id = $1 ORDER BY id DESC LIMIT 1`,
    [welfareId],
  );
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

async function postPool(tx, type, amount, description) {
  const prev = await poolBalance(tx.welfare_id);
  await query(
    `INSERT INTO member_pool_transactions
       (tenant_id, welfare_id, member_id, type, amount, direction, balance_after, description, created_by)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)`,
    [tx.tenant_id, tx.welfare_id, tx.member_id, type, amount, round2(prev + amount), description, tx.initiated_by_user_id || null],
  );
}

// Apply a successful welfare M-Pesa transaction. `cb` is the parsed callback
// (we trust cb.amount as the amount actually paid; fall back to the requested).
export async function allocateWelfarePayment(tx, cb = {}) {
  if (tx.allocated) return { applied: false, reason: "already allocated" };
  const paid = round2(cb.amount != null ? Number(cb.amount) : Number(tx.amount));
  if (!(paid > 0)) return { applied: false, reason: "no amount" };

  let applied = false;
  if (tx.target_type === "contribution_schedule") {
    const s = (await query(`SELECT * FROM contribution_schedules WHERE id = $1`, [tx.target_id])).rows[0];
    if (s) {
      const amt = Math.min(paid, round2(parseFloat(s.amount_due) - parseFloat(s.amount_paid)));
      if (amt > 0) {
        const newPaid = round2(parseFloat(s.amount_paid) + amt);
        const status = newPaid >= parseFloat(s.amount_due) ? "paid" : "partial";
        await query(`UPDATE contribution_schedules SET amount_paid=$2, status=$3, updated_at=NOW() WHERE id=$1`, [s.id, newPaid, status]);
        await postPool(tx, "contribution", amt, `Contribution via M-Pesa (${tx.mpesa_receipt_number || "STK"})`);
        applied = true;
      }
    }
  } else if (tx.target_type === "member_loan") {
    const l = (await query(`SELECT * FROM member_loans WHERE id = $1`, [tx.target_id])).rows[0];
    if (l && l.status !== "completed") {
      const amt = Math.min(paid, round2(parseFloat(l.total_amount_due) - parseFloat(l.amount_paid)));
      if (amt > 0) {
        const newPaid = round2(parseFloat(l.amount_paid) + amt);
        const completed = newPaid >= parseFloat(l.total_amount_due);
        await query(`UPDATE member_loans SET amount_paid=$2, status=$3, updated_at=NOW() WHERE id=$1`, [l.id, newPaid, completed ? "completed" : l.status === "defaulted" ? "active" : l.status]);
        await postPool(tx, "loan_repayment", amt, `Loan repayment via M-Pesa (${tx.mpesa_receipt_number || "STK"})`);
        applied = true;
      }
    }
  } else if (tx.target_type === "penalty_assessment") {
    const a = (await query(`SELECT * FROM penalty_assessments WHERE id = $1`, [tx.target_id])).rows[0];
    if (a && a.status === "outstanding") {
      const amt = Math.min(paid, round2(parseFloat(a.amount) - parseFloat(a.paid_amount)));
      if (amt > 0) {
        const newPaid = round2(parseFloat(a.paid_amount) + amt);
        const status = newPaid >= parseFloat(a.amount) ? "paid" : "outstanding";
        await query(`UPDATE penalty_assessments SET paid_amount=$2, status=$3 WHERE id=$1`, [a.id, newPaid, status]);
        await postPool(tx, "penalty", amt, `Penalty via M-Pesa (${tx.mpesa_receipt_number || "STK"})`);
        applied = true;
      }
    }
  }

  await query(`UPDATE mpesa_transactions SET allocated = true, updated_at = NOW() WHERE id = $1`, [tx.id]);
  return { applied, amount: paid };
}

export default { allocateWelfarePayment };
