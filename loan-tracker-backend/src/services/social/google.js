// Google sign-in — verifies a Google Identity Services ID token.
// Activates when GOOGLE_CLIENT_ID is set (the same Web Client ID the
// frontend button uses; it's the token audience).
import { OAuth2Client } from "google-auth-library";

const name = "google";
const isConfigured = () => !!process.env.GOOGLE_CLIENT_ID;

let client = null;
const getClient = () =>
  (client ||= new OAuth2Client(process.env.GOOGLE_CLIENT_ID));

export async function verify(idToken) {
  if (!isConfigured()) {
    throw Object.assign(
      new Error("Google login is not configured (GOOGLE_CLIENT_ID missing)."),
      { status: 503 },
    );
  }
  let payload;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw Object.assign(new Error("Invalid Google token."), { status: 401 });
  }
  if (!payload?.sub) {
    throw Object.assign(new Error("Invalid Google token."), { status: 401 });
  }
  const given = payload.given_name || "";
  const family = payload.family_name || "";
  const parts = (payload.name || "").trim().split(/\s+/);
  return {
    provider: "google",
    providerUserId: payload.sub,
    email: payload.email || null,
    emailVerified: !!payload.email_verified,
    firstName: given || parts[0] || "",
    lastName: family || parts.slice(1).join(" ") || "",
    name: payload.name || `${given} ${family}`.trim(),
    photo: payload.picture || null,
  };
}

export default { name, isConfigured, verify };
