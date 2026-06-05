// Cross-subdomain auth handoff. When a redirect bounces between
// *.lenderfest.loans subdomains (e.g. logged into the wrong tenant's
// URL), each subdomain has its OWN localStorage and the target
// may hold stale state from a prior session under a different
// tenant. Without a handoff, the target's stale user fires the
// subdomain-mismatch check in App.jsx and ping-pongs back.
//
// The redirect carries the fresh {token, user} in the URL
// fragment (#__lf_auth=…); the target consumes + clears it
// before reading localStorage, so the new tenant always wins.
//
// The fragment is browser-only (never sent to the server, never
// appears in access logs). Stripped via history.replaceState the
// moment it's consumed so it can't leak via the address bar or
// browser history beyond this load.

// Build the URL fragment payload to attach to a cross-subdomain
// redirect. Returns null on failure so callers can fall back to a
// plain redirect — at worst the user hits the login screen on
// the right subdomain.
export function buildAuthHandoff(token, user) {
  try {
    const payload = btoa(
      unescape(encodeURIComponent(JSON.stringify({ token, user }))),
    );
    return `__lf_auth=${encodeURIComponent(payload)}`;
  } catch {
    return null;
  }
}

// Read the handoff out of window.location.hash on page load,
// overwrite localStorage with it, and strip the handoff segment
// from the hash so the next refresh doesn't re-trigger. Returns
// the user object on success, null otherwise.
export function consumeAuthHandoff() {
  const hash = window.location.hash || "";
  const m = hash.match(/(?:^#|&)__lf_auth=([^&]+)/);
  if (!m) return null;
  try {
    const decoded = JSON.parse(
      decodeURIComponent(escape(atob(decodeURIComponent(m[1])))),
    );
    if (!decoded?.token || !decoded?.user) return null;
    localStorage.setItem("token", decoded.token);
    localStorage.setItem("user", JSON.stringify(decoded.user));
    // Strip the handoff segment from the hash, preserving any
    // other fragment the app might use for routing/anchors.
    const cleaned = hash
      .replace(/(?:^#|&)__lf_auth=[^&]*/, "")
      .replace(/^&/, "#");
    const newHash = cleaned === "#" || cleaned === "" ? "" : cleaned;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + newHash,
    );
    return decoded.user;
  } catch {
    return null;
  }
}
