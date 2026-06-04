// Shared helper for surfacing backend validation errors.
//
// The backend's utils/validate.js returns one of two response shapes:
//
//   single failure  → { error: "field: message" }
//   multi-field     → { error: "Invalid input", details: [{ field, message }, ...] }
//
// Most existing UI catch blocks did
//   setError(err.response?.data?.error || "Failed to …")
// which works for the single case but for multi-field collapses
// every field to the useless "Invalid input" string. This helper
// upgrades that — if details[] is present and non-empty, stack each
// "field: message" on its own line; otherwise fall back to the bare
// error string, then the axios message, then the caller's fallback.
//
// Pair with a `whitespace-pre-line` class on the banner div so the
// joined "\n" separators render as actual line breaks (Tailwind
// otherwise collapses whitespace).
//
//   try { … } catch (err) {
//     setError(apiErrorMessage(err, "Failed to do the thing"));
//   }

export function apiErrorMessage(err, fallback = "Something went wrong") {
  const data = err?.response?.data;
  if (Array.isArray(data?.details) && data.details.length > 0) {
    return data.details.map((d) => `${d.field}: ${d.message}`).join("\n");
  }
  return data?.error || err?.message || fallback;
}

export default apiErrorMessage;
