// Download a welfare document so it saves with the ORIGINAL filename + format.
// Cloudinary delivery URLs are a different origin, so a plain <a download> would
// ignore the name — fetch the file as a blob and save it ourselves. Falls back
// to opening the URL in a new tab if the fetch is blocked (e.g. CORS).
export async function downloadDoc(d) {
  if (!d?.file_url) return;
  const name = d.file_name || d.title || "document";
  try {
    const res = await fetch(d.file_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    window.open(d.file_url, "_blank", "noopener");
  }
}
