// Compact relative time ("20 min ago", "yesterday", "3 days ago").
export function timeAgo(d) {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`;
  const dd = Math.floor(h / 24);
  if (dd === 1) return "yesterday";
  if (dd < 30) return `${dd} days ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
