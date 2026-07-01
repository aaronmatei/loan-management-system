import React, { useState, useEffect } from "react";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import Skeleton from "../../components/Skeleton";
import { Percent } from "lucide-react";

function PlatformSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feePct, setFeePct] = useState("");
  const [baseFee, setBaseFee] = useState("");
  const [initial, setInitial] = useState({ fee: "", base: "" });

  useEffect(() => {
    platformApi
      .get("/platform/admin/settings")
      .then((r) => {
        const d = r.data.data || {};
        const fee = d.default_fee_percent ?? "5";
        const base = d.default_base_fee ?? "0";
        setFeePct(fee);
        setBaseFee(base);
        setInitial({ fee, base });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const dirty = String(feePct) !== String(initial.fee) || String(baseFee) !== String(initial.base);

  const save = async () => {
    const p = parseFloat(feePct);
    const b = parseFloat(baseFee);
    if (Number.isNaN(p) || p < 0 || p > 100) return alert("Default fee % must be between 0 and 100");
    if (Number.isNaN(b) || b < 0) return alert("Default base fee must be 0 or more");
    setSaving(true);
    try {
      await platformApi.put("/platform/admin/settings", { default_fee_percent: p, default_base_fee: b });
      setInitial({ fee: String(p), base: String(b) });
      setFeePct(String(p));
      setBaseFee(String(b));
      alert("Settings saved");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PlatformLayout>
        <div className="p-4 lg:p-8 max-w-[840px] mx-auto space-y-4">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </PlatformLayout>
    );
  }

  const InfoRow = ({ label, value }) => (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-50 dark:border-slate-700 last:border-0">
      <div className="text-[13.5px] font-bold text-slate-600 dark:text-slate-300">{label}</div>
      <div className="text-[13.5px] font-bold text-navy-900 dark:text-slate-100">{value}</div>
    </div>
  );

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-[840px] mx-auto flex flex-col gap-4">
        {/* New-lender billing defaults — genuinely wired: a new lender tenant is
            created with these values. */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <div className="text-[14px] font-extrabold text-navy-900 dark:text-slate-100 flex items-center gap-2">
              <Percent size={16} /> New-lender billing defaults
            </div>
            <div className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
              Applied to every new lender tenant at signup. Existing tenants are unchanged (edit those on their page).
            </div>
          </div>
          <div className="px-5 py-4 flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Default platform fee (%)</label>
              <div className="relative w-40">
                <input
                  type="number" min="0" max="100" step="0.01" value={feePct}
                  onChange={(e) => setFeePct(e.target.value)}
                  className="w-full px-3 py-2 pr-8 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Charged on interest earned each cycle.</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Default base fee (KES)</label>
              <div className="relative w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">KES</span>
                <input
                  type="number" min="0" step="1" value={baseFee}
                  onChange={(e) => setBaseFee(e.target.value)}
                  className="w-full pl-11 pr-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean-500/30"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Flat amount added per cycle.</p>
            </div>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="px-5 py-2 bg-ocean-600 hover:bg-ocean-700 text-white font-bold rounded-lg text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* Platform facts — read-only context (no fake toggles). */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 text-[14px] font-extrabold text-navy-900 dark:text-slate-100">
            Platform
          </div>
          <InfoRow label="Currency" value="KES" />
          <InfoRow label="Billing model" value="Per-tenant interest fee" />
          <InfoRow label="Plan catalog" value="Enabled" />
          <InfoRow label="Database backups" value="Managed by Neon (automatic)" />
        </div>
      </div>
    </PlatformLayout>
  );
}

export default PlatformSettings;
