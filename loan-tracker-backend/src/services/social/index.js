// Social-login provider layer for the borrower portal.
//
// One normalized identity, many providers. verifySocialToken() validates the
// provider's token server-side and returns:
//   { provider, providerUserId, email, emailVerified, firstName, lastName,
//     name, photo }
// Downstream auth logic (link / login / signup-complete) is provider-agnostic.
import google from "./google.js";
import apple from "./apple.js";
import facebook from "./facebook.js";

const PROVIDERS = { google, apple, facebook };

// Which providers are configured (drives which buttons the portal shows).
export function socialProviderStatus() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([k, p]) => [k, p.isConfigured()]),
  );
}

export async function verifySocialToken({ provider, token }) {
  const p = PROVIDERS[String(provider || "").toLowerCase()];
  if (!p) {
    throw Object.assign(new Error("Unsupported sign-in provider"), {
      status: 400,
    });
  }
  if (!token) {
    throw Object.assign(new Error("Missing sign-in token"), { status: 400 });
  }
  return p.verify(token);
}
