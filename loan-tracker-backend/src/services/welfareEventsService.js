// Welfare EVENTS — ad-hoc member payouts funded by a SEPARATE events pool.
//
// The events pool (welfare_event_ledger) is its own fund: members contribute
// into it and a member with an event is paid out of it. It never touches the
// savings pool (member_pool_transactions) — event money is not member equity.
//
// Flow (amount needed N, events-pool balance B):
//   B >= N  → fundEvent('pool')  disburses N straight away.
//   B <  N  → fundEvent('collect') raises equal shares for the shortfall S=N-B
//             across ALL active members (incl. the beneficiary); members pay in;
//             payoutEvent disburses once the pool reaches N.
// (Phase 2 adds the 'bridge' mode: borrow the shortfall from the savings pool.)
import { query, withTransaction } from "../config/database.js";
import { round2, poolBalance, postPool, memberSavings } from "./welfarePoolService.js";

const httpErr = (status, message) => Object.assign(new Error(message), { status });

// Current events-pool balance for a welfare = its last ledger row's running total.
export async function eventsPoolBalance(welfareId) {
  const r = await query(
    `SELECT balance_after FROM welfare_event_ledger
      WHERE welfare_id = $1 ORDER BY id DESC LIMIT 1`,
    [welfareId],
  );
  return r.rows.length ? parseFloat(r.rows[0].balance_after) : 0;
}

// Append a row to the events-pool ledger, carrying the running balance forward.
// The ONLY place welfare_event_ledger.balance_after is computed.
export async function postEventsPool({ welfare, eventId, memberId, type, amount, direction, txnDate, description, userId }) {
  // Atomic + serialized per welfare events pool.
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`welfare-events-${welfare.id}`]);
    const prevRow = await client.query(
      `SELECT balance_after FROM welfare_event_ledger WHERE welfare_id = $1 ORDER BY id DESC LIMIT 1`,
      [welfare.id],
    );
    const prev = prevRow.rows.length ? parseFloat(prevRow.rows[0].balance_after) : 0;
    const balanceAfter = round2(prev + direction * amount);
    const r = await client.query(
      `INSERT INTO welfare_event_ledger
         (tenant_id, welfare_id, event_id, member_id, type, amount, direction, balance_after, txn_date, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date, CURRENT_DATE),$10,$11)
       RETURNING *`,
      [welfare.tenant_id, welfare.id, eventId || null, memberId || null, type, amount, direction, balanceAfter, txnDate || null, description || null, userId || null],
    );
    return r.rows[0];
  });
}

// Split a total into `count` equal cent-accurate shares that sum to it exactly.
// The first few members absorb the rounding remainder.
export function splitEqually(total, count) {
  const cents = Math.round(round2(total) * 100);
  const base = Math.floor(cents / count);
  let rem = cents - base * count;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push((base + (rem > 0 ? 1 : 0)) / 100);
    if (rem > 0) rem--;
  }
  return out;
}

// Create an event (status 'open'); funding is decided next via fundEvent.
export async function createEvent({ welfare, beneficiaryMemberId, amount, dueDate, neededBy, title, description, userId }) {
  const amt = round2(parseFloat(amount));
  if (!(amt > 0)) throw httpErr(400, "A positive amount is required");
  // Both dates must be in the future, and you can't be collecting past the day
  // the funds are needed.
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate && dueDate <= today) throw httpErr(400, "Collection deadline must be a future date");
  if (neededBy && neededBy <= today) throw httpErr(400, "Date needed must be a future date");
  if (dueDate && neededBy && dueDate > neededBy) throw httpErr(400, "Collection deadline can't be after the date needed");
  const ben = await query(
    `SELECT id, first_name, last_name FROM members WHERE id = $1 AND welfare_id = $2 AND status = 'active'`,
    [beneficiaryMemberId, welfare.id],
  );
  if (ben.rows.length === 0) throw httpErr(400, "Beneficiary must be an active member of this welfare");
  const r = await query(
    `INSERT INTO welfare_events (tenant_id, welfare_id, title, description, beneficiary_member_id, amount, due_date, needed_by, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9) RETURNING *`,
    [welfare.tenant_id, welfare.id, title || `Event for ${ben.rows[0].first_name} ${ben.rows[0].last_name}`, description || null, beneficiaryMemberId, amt, dueDate || null, neededBy || null, userId || null],
  );
  return r.rows[0];
}

// Decide how an event is funded.
//   mode 'pool'    → events pool covers it; disburse now.
//   mode 'collect' → raise equal shares for the shortfall; disburse later.
// (mode 'bridge' is phase 2.)
export async function fundEvent({ welfare, event, mode, dueDate, userId }) {
  if (event.status !== "open") throw httpErr(400, `Event is already ${event.status}`);
  const N = round2(parseFloat(event.amount));
  const B = await eventsPoolBalance(welfare.id);

  // Pool covers it → disburse now, whatever mode was asked for.
  if (B >= N) return disburse({ welfare, event, fundingMode: "pool", userId });
  if (mode === "pool")
    throw httpErr(400, `Events pool holds KES ${B.toLocaleString()} — not enough to disburse KES ${N.toLocaleString()}. Collect the shortfall or bridge from savings.`);

  const S = round2(N - B);
  const members = await activeMembers(welfare.id);
  if (members.length === 0) throw httpErr(400, "No active members to collect from");

  // Bridge: the savings pool fronts the shortfall, the beneficiary is paid now,
  // members repay into the events pool, then the admin repays savings.
  if (mode === "bridge") {
    const savings = await poolBalance(welfare.id);
    if (S > savings)
      throw httpErr(400, `Savings pool holds KES ${savings.toLocaleString()} — can't bridge KES ${S.toLocaleString()}`);
    await postPool({ welfare, type: "event_bridge_out", amount: S, direction: -1, description: `Bridge to event "${event.title}"`, userId });
    await postEventsPool({ welfare, eventId: event.id, type: "bridge_in", amount: S, direction: 1, description: `Savings bridge for "${event.title}"`, userId });
    await postEventsPool({ welfare, eventId: event.id, memberId: event.beneficiary_member_id, type: "payout", amount: N, direction: -1, description: `Payout — ${event.title}`, userId });
    await generateShares(welfare, event, members, S);
    const r = await query(
      `UPDATE welfare_events
          SET funding_mode = 'bridge', shortfall_amount = $2, bridged_amount = $2,
              disbursed_amount = $3, disbursed_at = NOW(), status = 'disbursed',
              due_date = COALESCE($4::date, due_date), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [event.id, S, N, dueDate || null],
    );
    return { event: r.rows[0], bridged: S, eventsPoolBalance: await eventsPoolBalance(welfare.id), savingsPoolBalance: await poolBalance(welfare.id) };
  }

  // collect: shortfall split across all active members (beneficiary included).
  await generateShares(welfare, event, members, S);
  const r = await query(
    `UPDATE welfare_events
        SET funding_mode = 'collect', shortfall_amount = $2, status = 'collecting',
            due_date = COALESCE($3::date, due_date), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [event.id, S, dueDate || null],
  );
  return { event: r.rows[0], shortfall: S, shares: members.length };
}

const activeMembers = async (welfareId) =>
  (await query(`SELECT id FROM members WHERE welfare_id = $1 AND status = 'active' ORDER BY id`, [welfareId])).rows;

async function generateShares(welfare, event, members, total) {
  const shares = splitEqually(total, members.length);
  for (let i = 0; i < members.length; i++) {
    await query(
      `INSERT INTO welfare_event_shares (tenant_id, event_id, member_id, amount_due)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id, member_id) DO UPDATE SET amount_due = EXCLUDED.amount_due, updated_at = NOW()`,
      [welfare.tenant_id, event.id, members[i].id, shares[i]],
    );
  }
}

// Repay the savings pool from the events pool (members have refilled it). Partial
// repayment is fine — repay whatever the events pool currently holds, up to the
// outstanding bridge.
export async function repayBridge({ welfare, event, userId }) {
  const outstanding = round2(parseFloat(event.bridged_amount) - parseFloat(event.bridge_repaid));
  if (!(outstanding > 0)) throw httpErr(400, "No outstanding bridge on this event");
  const eb = await eventsPoolBalance(welfare.id);
  const amt = round2(Math.min(outstanding, eb));
  if (!(amt > 0)) throw httpErr(400, "Events pool is empty — nothing to repay yet");
  await postEventsPool({ welfare, eventId: event.id, type: "bridge_repay", amount: amt, direction: -1, description: `Repay savings bridge — ${event.title}`, userId });
  await postPool({ welfare, type: "event_bridge_in", amount: amt, direction: 1, description: `Bridge repaid from event "${event.title}"`, userId });
  const newRepaid = round2(parseFloat(event.bridge_repaid) + amt);
  const settled = newRepaid >= parseFloat(event.bridged_amount) - 0.001;
  const r = await query(
    `UPDATE welfare_events SET bridge_repaid = $2, status = CASE WHEN $3 THEN 'settled' ELSE status END, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [event.id, newRepaid, settled],
  );
  return { event: r.rows[0], repaid: amt, outstanding: round2(outstanding - amt), savingsPoolBalance: await poolBalance(welfare.id), eventsPoolBalance: await eventsPoolBalance(welfare.id) };
}

// Record a member paying their event share → into the events pool. Admin path;
// the member STK path (phase 3) lands here too. Amount defaults to what's still
// owed on the share.
export async function payEventShare({ welfare, event, memberId, amount, txnDate, userId }) {
  const sres = await query(
    `SELECT * FROM welfare_event_shares WHERE event_id = $1 AND member_id = $2`,
    [event.id, memberId],
  );
  if (sres.rows.length === 0) throw httpErr(404, "No share for this member on this event");
  const share = sres.rows[0];
  const outstanding = round2(parseFloat(share.amount_due) - parseFloat(share.amount_paid));
  const amt = amount != null && amount !== "" ? round2(parseFloat(amount)) : outstanding;
  if (!(amt > 0)) throw httpErr(400, "Amount must be positive");
  if (amt > outstanding + 0.001) throw httpErr(400, `Only KES ${outstanding.toLocaleString()} is outstanding on this share`);

  const newPaid = round2(parseFloat(share.amount_paid) + amt);
  const status = newPaid >= parseFloat(share.amount_due) - 0.001 ? "paid" : "partial";
  await query(`UPDATE welfare_event_shares SET amount_paid = $2, status = $3, updated_at = NOW() WHERE id = $1`, [share.id, newPaid, status]);
  const ledger = await postEventsPool({
    welfare, eventId: event.id, memberId, type: "contribution", amount: amt, direction: 1,
    txnDate, description: `Event share — ${event.title}`, userId,
  });
  return { share: { ...share, amount_paid: newPaid, status }, ledger, poolBalance: await eventsPoolBalance(welfare.id) };
}

// Recover an unpaid event share from the member's savings — their share is a
// debt, so the admin can settle it out of their equity. Pulls min(outstanding,
// savings) from the savings pool and credits it into the events pool on the
// member's behalf, marking the share paid.
export async function recoverShareFromSavings({ welfare, event, memberId, userId }) {
  const sres = await query(`SELECT * FROM welfare_event_shares WHERE event_id = $1 AND member_id = $2`, [event.id, memberId]);
  if (sres.rows.length === 0) throw httpErr(404, "No share for this member on this event");
  const share = sres.rows[0];
  const outstanding = round2(parseFloat(share.amount_due) - parseFloat(share.amount_paid));
  if (!(outstanding > 0)) throw httpErr(400, "Share is already paid");
  const savings = await memberSavings(memberId);
  const amt = round2(Math.min(outstanding, savings));
  if (!(amt > 0)) throw httpErr(400, `Member has KES ${savings.toLocaleString()} in savings — nothing to recover`);

  await postPool({ welfare, memberId, type: "withdrawal", amount: amt, direction: -1, description: `Event share recovered from savings — ${event.title}`, userId });
  await postEventsPool({ welfare, eventId: event.id, memberId, type: "contribution", amount: amt, direction: 1, description: `Event share (recovered from savings) — ${event.title}`, userId });

  const newPaid = round2(parseFloat(share.amount_paid) + amt);
  const status = newPaid >= parseFloat(share.amount_due) - 0.001 ? "paid" : "partial";
  await query(`UPDATE welfare_event_shares SET amount_paid = $2, status = $3, updated_at = NOW() WHERE id = $1`, [share.id, newPaid, status]);
  return { share: { ...share, amount_paid: newPaid, status }, recovered: amt, memberSavings: await memberSavings(memberId), eventsPoolBalance: await eventsPoolBalance(welfare.id) };
}

// Disburse a fully-funded event to its beneficiary out of the events pool.
export async function payoutEvent({ welfare, event, userId }) {
  if (event.status === "disbursed" || event.status === "settled" || event.status === "closed")
    throw httpErr(400, `Event is already ${event.status}`);
  return disburse({ welfare, event, fundingMode: event.funding_mode || "pool", userId });
}

// Internal: post the payout ledger row + close the event. Requires the pool to
// cover the amount.
async function disburse({ welfare, event, fundingMode, userId }) {
  const N = round2(parseFloat(event.amount));
  const B = await eventsPoolBalance(welfare.id);
  if (B < N) throw httpErr(400, `Events pool holds KES ${B.toLocaleString()} — KES ${round2(N - B).toLocaleString()} still to collect before disbursing`);
  const ledger = await postEventsPool({
    welfare, eventId: event.id, memberId: event.beneficiary_member_id, type: "payout",
    amount: N, direction: -1, description: `Payout — ${event.title}`, userId,
  });
  const r = await query(
    `UPDATE welfare_events
        SET status = 'disbursed', funding_mode = COALESCE(funding_mode, $2),
            disbursed_amount = $3, disbursed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [event.id, fundingMode, N],
  );
  return { event: r.rows[0], ledger, poolBalance: await eventsPoolBalance(welfare.id) };
}
