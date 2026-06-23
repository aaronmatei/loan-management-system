import { useState, useEffect, useCallback } from "react";

// Client-side table preferences — column presets and saved filter
// "segments" — persisted in localStorage ONLY (never server-side).
// Promoted from the Loans pilot so every list page shares one
// implementation instead of forking the logic.

// ── Column presets ────────────────────────────────────────────────
// presets: { key: { label, keys: [...columnKeys] } }
export function useColumnPreset(storageKey, presets, defaultKey) {
  const [preset, setPreset] = useState(() => {
    const saved = storageKey ? localStorage.getItem(storageKey) : null;
    return saved && presets[saved] ? saved : defaultKey;
  });
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, preset);
  }, [storageKey, preset]);
  return [preset, setPreset];
}

// ── Saved filter segments ─────────────────────────────────────────
// A segment is a named snapshot of an arbitrary filter object. The page
// owns the filter shape; this hook only stores/loads named snapshots and
// hands them back on apply.
export function useFilterSegments(storageKey) {
  const [segments, setSegments] = useState(() => {
    try {
      const raw = storageKey ? localStorage.getItem(storageKey) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (storageKey)
      localStorage.setItem(storageKey, JSON.stringify(segments));
  }, [storageKey, segments]);

  // `snapshot` is any JSON-serialisable filter state the page wants saved.
  const saveSegment = useCallback((name, snapshot) => {
    const clean = (name || "").trim();
    if (!clean) return;
    const segment = { id: `${clean}-${Date.now()}`, name: clean, snapshot };
    setSegments((prev) => [
      ...prev.filter((s) => s.name !== clean),
      segment,
    ]);
  }, []);

  const deleteSegment = useCallback(
    (id) => setSegments((prev) => prev.filter((s) => s.id !== id)),
    [],
  );

  return { segments, saveSegment, deleteSegment };
}
