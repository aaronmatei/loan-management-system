// Welfare SMS reminders: contribution-due and meeting reminders. Run by the
// daily cron and by manual endpoints. Idempotent within a day — we don't re-send
// the same reminder type to the same phone if one already went out today.
import { query } from "../config/database.js";
import { sendWelfareSms, welfareTemplates } from "./welfareSmsService.js";

// Has a reminder of this type already gone to this phone today? Keeps the daily
// cron from spamming if it runs more than once.
async function sentToday(tenantId, phone, type) {
  const r = await query(
    `SELECT 1 FROM sms_logs
      WHERE tenant_id = $1 AND phone_number = $2 AND message_type = $3
        AND created_at::date = CURRENT_DATE LIMIT 1`,
    [tenantId, phone, type],
  );
  return r.rows.length > 0;
}

// Contribution-due reminders for one welfare group: unpaid schedules in open
// cycles, due within `windowDays` (default 3) and not yet overdue-past.
export async function sendContributionReminders(welfare, windowDays = 3) {
  const rows = (
    await query(
      `SELECT s.amount_due, s.amount_paid, s.due_date,
              m.first_name, m.last_name, m.phone_number
         FROM contribution_schedules s
         JOIN contribution_cycles c ON c.id = s.cycle_id
         JOIN members m ON m.id = s.member_id
        WHERE c.welfare_id = $1 AND c.status = 'open' AND s.status <> 'paid'
          AND m.status = 'active' AND m.phone_number IS NOT NULL
          AND s.due_date >= CURRENT_DATE
          AND s.due_date <= (CURRENT_DATE + ($2 * INTERVAL '1 day'))`,
      [welfare.id, windowDays],
    )
  ).rows;

  let sent = 0;
  for (const r of rows) {
    if (await sentToday(welfare.tenant_id, r.phone_number, "welfare_contribution_due")) continue;
    const outstanding = Number(r.amount_due) - Number(r.amount_paid);
    const msg = welfareTemplates.contributionDue(r.first_name, welfare.name, outstanding, r.due_date);
    await sendWelfareSms({ tenantId: welfare.tenant_id, phone: r.phone_number, message: msg, type: "welfare_contribution_due" });
    sent += 1;
  }
  return { candidates: rows.length, sent };
}

// Meeting reminders for one welfare group: meetings scheduled `daysAhead` from
// today (default 1 = tomorrow) go to every active member.
export async function sendMeetingReminders(welfare, daysAhead = 1) {
  const meetings = (
    await query(
      `SELECT id, meeting_date, location FROM group_meetings
        WHERE group_id = $1 AND status <> 'cancelled'
          AND meeting_date::date = (CURRENT_DATE + ($2 * INTERVAL '1 day'))::date`,
      [welfare.id, daysAhead],
    )
  ).rows;
  if (!meetings.length) return { meetings: 0, sent: 0 };

  const members = (
    await query(`SELECT first_name, last_name, phone_number FROM members WHERE welfare_id = $1 AND status = 'active' AND phone_number IS NOT NULL`, [welfare.id])
  ).rows;

  let sent = 0;
  for (const mt of meetings) {
    for (const m of members) {
      if (await sentToday(welfare.tenant_id, m.phone_number, "welfare_meeting_reminder")) continue;
      const msg = welfareTemplates.meetingReminder(m.first_name, welfare.name, "meeting", mt.meeting_date, mt.location);
      await sendWelfareSms({ tenantId: welfare.tenant_id, phone: m.phone_number, message: msg, type: "welfare_meeting_reminder" });
      sent += 1;
    }
  }
  return { meetings: meetings.length, sent };
}

// All active welfare groups (the daily cron entry point).
export async function runAllWelfareReminders() {
  const groups = (
    await query(
      `SELECT g.id, g.name, g.tenant_id FROM groups g
         JOIN tenants t ON t.id = g.tenant_id
        WHERE t.kind = 'welfare' AND t.status = 'active'`,
    )
  ).rows;

  let contributions = 0;
  let meetings = 0;
  for (const g of groups) {
    try {
      contributions += (await sendContributionReminders(g)).sent;
      meetings += (await sendMeetingReminders(g)).sent;
    } catch {
      /* one chama failing shouldn't stop the rest */
    }
  }
  return { groups: groups.length, contributions, meetings };
}
