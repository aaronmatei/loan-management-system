// Welfare decisions — governance voting logic shared by the admin router
// (routes/welfareDecisions.js) and the member portal (routes/portal/member.js).
// A decision passes when approvals reach the quorum threshold (quorum_percent of
// active members) or, at its deadline, when approvals outnumber rejections.
import { query, withTransaction } from "../config/database.js";

export const VOTES = ["approve", "reject", "abstain"];
export const OFFICER_ROLES = ["chair", "treasurer", "secretary"];

export async function activeMemberCount(welfareId) {
  return (await query(`SELECT COUNT(*)::int AS n FROM members WHERE welfare_id = $1 AND status = 'active'`, [welfareId])).rows[0].n;
}

// Approvals needed to pass: ceil(quorum% of active members), at least 1.
export const requiredApprovals = (memberCount, quorumPercent) => Math.max(1, Math.ceil((quorumPercent / 100) * memberCount));

export async function tally(decisionId) {
  const r = await query(`SELECT vote, COUNT(*)::int AS n FROM welfare_decision_votes WHERE decision_id = $1 GROUP BY vote`, [decisionId]);
  const t = { approve: 0, reject: 0, abstain: 0 };
  for (const row of r.rows) t[row.vote] = row.n;
  t.total = t.approve + t.reject + t.abstain;
  return t;
}

// Add live tallies + quorum info to a decision row (no DB mutation).
export async function decorate(decision) {
  const t = await tally(decision.id);
  const members = await activeMemberCount(decision.welfare_id);
  return { ...decision, tally: t, active_members: members, required_approvals: requiredApprovals(members, decision.quorum_percent) };
}

// Assign an officer role to the election winner, demoting the prior holder so
// the one-per-welfare rule holds. Runs inside the resolving transaction.
async function applyElection(client, decision) {
  if (decision.type !== "election" || !decision.target_member_id || !OFFICER_ROLES.includes(decision.target_role)) return;
  await client.query(
    `UPDATE members SET role = 'member', updated_at = NOW()
       WHERE welfare_id = $1 AND role = $2 AND status = 'active' AND id <> $3`,
    [decision.welfare_id, decision.target_role, decision.target_member_id],
  );
  await client.query(`UPDATE members SET role = $2, updated_at = NOW() WHERE id = $1`, [decision.target_member_id, decision.target_role]);
}

// Resolve a decision if it has reached the approval threshold or passed its
// deadline; a passed election assigns the officer role. Idempotent.
export async function resolveIfDue(decision) {
  if (decision.status !== "open") return decision;
  const t = await tally(decision.id);
  const required = requiredApprovals(await activeMemberCount(decision.welfare_id), decision.quorum_percent);
  const past = decision.closes_at && new Date(decision.closes_at) <= new Date();
  let outcome = null;
  if (t.approve >= required) outcome = "passed";
  else if (past) outcome = t.approve > t.reject ? "passed" : "rejected";
  if (!outcome) return decision;
  return finalize(decision, outcome);
}

// Force a decision to a terminal state now (manual close / cancel). `outcome` is
// 'passed' | 'rejected' | 'cancelled'. Returns the updated row.
export async function finalize(decision, outcome) {
  const updated = await withTransaction(async (client) => {
    const r = await client.query(
      `UPDATE welfare_decisions SET status = $2, resolved_at = NOW() WHERE id = $1 AND status = 'open' RETURNING *`,
      [decision.id, outcome],
    );
    if (!r.rows.length) return null; // resolved by a concurrent call
    if (outcome === "passed") await applyElection(client, r.rows[0]);
    return r.rows[0];
  });
  return updated || (await query(`SELECT * FROM welfare_decisions WHERE id = $1`, [decision.id])).rows[0];
}

// Validate an election's candidate + role. Returns { member, role } or { error }.
export async function resolveElectionTarget(welfareId, targetMemberId, targetRole) {
  const role = (targetRole || "").toLowerCase();
  if (!OFFICER_ROLES.includes(role)) return { error: "Choose an officer role (chair, treasurer or secretary)" };
  const m = (await query(`SELECT id, first_name, last_name FROM members WHERE id = $1 AND welfare_id = $2 AND status = 'active'`, [targetMemberId, welfareId])).rows[0];
  if (!m) return { error: "Choose an active member to elect" };
  return { member: m, role };
}
export const electionTitle = (member, role) => `Elect ${member.first_name} ${member.last_name} as ${role}`;

// Outcome a manual close would produce given the current tally.
export async function closeOutcome(decision) {
  const t = await tally(decision.id);
  const required = requiredApprovals(await activeMemberCount(decision.welfare_id), decision.quorum_percent);
  return t.approve >= required ? "passed" : "rejected";
}
