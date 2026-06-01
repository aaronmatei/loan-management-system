// Compact "x ago" formatter. Sub-minute → "just now"; sub-day shows
// minutes/hours; anything older falls back to a dd/mm/yyyy date so
// the column stays glanceable.
export function timeAgo(d) {
  if (!d) return "—";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (Number.isNaN(s) || s < 0) return "—";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
