// Sign in with Apple — SCAFFOLD (Phase 2).
//
// Apple returns an identity token (a JWT) verified against Apple's JWKS
// (https://appleid.apple.com/auth/keys), audience = your Services ID. The
// user's name is only sent on the FIRST authorization, and the email may be
// a private-relay address. The "client secret" is itself a short-lived JWT
// signed with your Sign-in-with-Apple key (.p8). Wire it here when the env
// is set, returning the SAME normalized shape as google.verify.
//
// Activate with: APPLE_SERVICES_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY
const name = "apple";
const isConfigured = () =>
  !!(
    process.env.APPLE_SERVICES_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  );

export async function verify(/* identityToken, extra */) {
  throw Object.assign(
    new Error("Apple login is not wired yet."),
    { status: isConfigured() ? 501 : 503 },
  );
}

export default { name, isConfigured, verify };
