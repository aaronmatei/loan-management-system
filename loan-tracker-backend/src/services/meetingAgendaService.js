// Per-meeting agenda items + minutes, shared by the welfare admin
// (welfareMeetings.js) and the member portal (portal/member.js) so a meeting's
// detail shows the same agendas and minutes on both. Minutes are just the
// welfare_documents linked to the meeting with category='minutes'.
import { query } from "../config/database.js";

// Agenda items in display order. author_name is who suggested it.
export async function loadAgenda(meetingId) {
  return (await query(
    `SELECT id, content, position, suggested_by_member, suggested_by_user, author_name, created_at, updated_at
       FROM meeting_agenda_items WHERE meeting_id = $1 ORDER BY position, id`,
    [meetingId],
  )).rows;
}

// Minutes documents uploaded for the meeting (newest first).
export async function loadMinutes(welfareId, meetingId) {
  return (await query(
    `SELECT id, title, file_url, file_name, mime, size_bytes, uploaded_by_name, created_at
       FROM welfare_documents
      WHERE welfare_id = $1 AND meeting_id = $2 AND category = 'minutes'
      ORDER BY created_at DESC, id DESC`,
    [welfareId, meetingId],
  )).rows;
}

// Next position for an appended item (suggestions go to the end of the list).
export async function nextPosition(meetingId) {
  const r = await query(`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM meeting_agenda_items WHERE meeting_id = $1`, [meetingId]);
  return r.rows[0].n;
}
