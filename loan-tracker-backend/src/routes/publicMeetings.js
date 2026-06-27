// Public (no-login) meeting RSVP. A member opens the shared link, enters their
// name + phone, and confirms attending / not — the system matches the phone to a
// member of that welfare and records it in meeting_confirmations (same table the
// portal RSVP uses). Mounted at /api/public/meetings (PUBLIC — no auth).
import express from "express";
import { query } from "../config/database.js";
import { verifyMeetingToken } from "../utils/meetingToken.js";
import logger from "../config/logger.js";

const router = express.Router();

// GET /:meetingId/:token — meeting summary shown on the RSVP page.
router.get("/:meetingId/:token", async (req, res) => {
  try {
    const { meetingId, token } = req.params;
    if (!verifyMeetingToken(meetingId, token)) return res.status(404).json({ error: "This link is invalid or has expired." });
    const m = (await query(
      `SELECT gm.id, gm.title, gm.meeting_date, gm.start_time, gm.grace_minutes, gm.venue, gm.location, gm.status, g.name AS welfare_name
         FROM group_meetings gm JOIN groups g ON g.id = gm.group_id WHERE gm.id = $1`,
      [meetingId],
    )).rows[0];
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    res.json({ success: true, data: m });
  } catch (e) {
    logger.error("public meeting get error:", e);
    res.status(500).json({ error: "Failed to load meeting" });
  }
});

// POST /:meetingId/:token/rsvp { phone, name?, attending } — match the phone to
// an active member of the welfare and record their confirmation.
router.post("/:meetingId/:token/rsvp", async (req, res) => {
  try {
    const { meetingId, token } = req.params;
    if (!verifyMeetingToken(meetingId, token)) return res.status(404).json({ error: "This link is invalid or has expired." });
    const m = (await query(
      `SELECT gm.id, gm.group_id, gm.status, g.tenant_id, g.name AS welfare_name
         FROM group_meetings gm JOIN groups g ON g.id = gm.group_id WHERE gm.id = $1`,
      [meetingId],
    )).rows[0];
    if (!m) return res.status(404).json({ error: "Meeting not found" });
    if (m.status !== "scheduled") return res.status(400).json({ error: "This meeting is no longer open for confirmation." });

    const digits = String(req.body?.phone || "").replace(/[^0-9]/g, "");
    if (digits.length < 9) return res.status(400).json({ error: "Enter a valid phone number." });
    const last9 = digits.slice(-9); // match across 07.. / +2547.. / 2547.. formats
    const attending = req.body?.attending === true || req.body?.attending === "true";

    const member = (await query(
      `SELECT id, first_name, last_name FROM members
        WHERE welfare_id = $1 AND status = 'active'
          AND regexp_replace(phone_number, '[^0-9]', '', 'g') LIKE '%' || $2
        LIMIT 1`,
      [m.group_id, last9],
    )).rows[0];
    if (!member) return res.status(404).json({ error: `We couldn't find your number in ${m.welfare_name}. Please check it or contact your chama admin.` });

    await query(
      `INSERT INTO meeting_confirmations (tenant_id, welfare_id, meeting_id, member_id, attending)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (meeting_id, member_id) DO UPDATE SET attending = EXCLUDED.attending, updated_at = NOW()`,
      [m.tenant_id, m.group_id, meetingId, member.id, attending],
    );
    res.json({ success: true, data: { member_name: `${member.first_name} ${member.last_name}`.trim(), attending } });
  } catch (e) {
    logger.error("public meeting rsvp error:", e);
    res.status(500).json({ error: "Failed to record your response" });
  }
});

export default router;
