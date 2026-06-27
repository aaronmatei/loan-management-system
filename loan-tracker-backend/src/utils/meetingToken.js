// A stateless token for a meeting's public RSVP link, so the link can't be
// guessed by enumerating meeting ids. HMAC of the meeting id with the server
// secret — no DB column needed; the token is stable per meeting.
import crypto from "crypto";

const secret = () => process.env.JWT_SECRET || "dev-secret";

export const meetingRsvpToken = (id) =>
  crypto.createHmac("sha256", secret()).update(`meeting-rsvp:${id}`).digest("hex").slice(0, 20);

export const verifyMeetingToken = (id, token) =>
  !!token && token === meetingRsvpToken(id);
