// Facebook Login — SCAFFOLD (Phase 2).
//
// Verify the user access token (debug_token against an app token) then read
// the profile via the Graph API: GET /me?fields=id,name,email,picture. Email
// requires the `email` permission (App Review in production) and isn't always
// returned. Map the response into the SAME normalized shape as google.verify.
//
// Activate with: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
const name = "facebook";
const isConfigured = () =>
  !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);

export async function verify(/* accessToken */) {
  throw Object.assign(
    new Error("Facebook login is not wired yet."),
    { status: isConfigured() ? 501 : 503 },
  );
}

export default { name, isConfigured, verify };
