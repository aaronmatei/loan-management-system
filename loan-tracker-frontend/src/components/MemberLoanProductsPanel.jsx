import React, { useState, useEffect } from "react";
import { Plus, X, AlertTriangle, Pencil, Archive } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const pct = (v) => `${Number(v || 0)}%`;

// Member loan products — the welfare's pre-configured loan terms (rate, method,
// fees, penalty, amount/duration range). Members' loans pick a product, which
// locks the mechanics and range-validates the application.
export default function MemberLoanProductsPanel({ welfareId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // product object | "new" | null

  const base = `/welfares/${welfareId}/loans/products`;
  const load = async () => {
    setLoading(true);
    try { setRows((await api.get(base)).data.data || []); } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [welfareId]);

  const archive = async (p) => {
    if (!window.confirm(`Archive "${p.name}"? Existing loans keep it; it just hides from new applications.`)) return;
    try { await api.delete(`${base}/${p.id}`); load(); } catch (e) { alert(e.response?.data?.error || "Failed"); }
  };

  return (
    <div className="bg-surface rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-6 max-w-2xl mt-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Loan products</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Preset terms members borrow on — rate, method, fees, penalties and the amount/duration range.</p>
        </div>
        <PermissionGate role={["admin", "manager"]}>
          <button onClick={() => setEditing("new")} className="shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"><Plus size={15} /> Add product</button>
        </PermissionGate>
      </div>

      {loading ? <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-400 mt-4">No loan products yet. Add one so members can apply on set terms.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((p) => (
            <div key={p.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${p.active ? "border-slate-200 dark:border-slate-700" : "border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 opacity-70"}`}>
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{p.name}{!p.active && <span className="ml-2 text-xs text-slate-400 dark:text-slate-400">archived</span>}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{pct(p.annual_interest_rate)} p.a. ({(Number(p.annual_interest_rate) / 12).toFixed(2)}%/mo) · {p.interest_method} · {money(p.min_amount)}–{money(p.max_amount)} · {p.min_duration_months}–{p.max_duration_months} mo · late {money(p.late_fee)} + {pct(p.penalty_rate)}{Number(p.loan_count) > 0 ? ` · ${p.loan_count} loan(s)` : ""}</p>
              </div>
              {p.active && (
                <PermissionGate role={["admin", "manager"]}>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setEditing(p)} className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 rounded" title="Edit"><Pencil size={15} /></button>
                    <button onClick={() => archive(p)} className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded" title="Archive"><Archive size={15} /></button>
                  </div>
                </PermissionGate>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && <ProductModal welfareId={welfareId} product={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function ProductModal({ welfareId, product, onClose, onSaved }) {
  const init = product || { name: "", annual_interest_rate: "", interest_method: "flat", processing_fee_rate: "", min_amount: "", max_amount: "", min_duration_months: 1, max_duration_months: 12, late_fee: "", penalty_rate: "" };
  const round4 = (n) => Math.round(n * 10000) / 10000;
  const [form, setForm] = useState({
    name: init.name || "", annual_interest_rate: init.annual_interest_rate ?? "",
    annual_interest_rate_monthly: init.annual_interest_rate ? round4(init.annual_interest_rate / 12) : "", // synced companion
    interest_method: init.interest_method || "flat",
    processing_fee_rate: init.processing_fee_rate ?? "", min_amount: init.min_amount ?? "", max_amount: init.max_amount ?? "",
    min_duration_months: init.min_duration_months ?? 1, max_duration_months: init.max_duration_months ?? 12,
    late_fee: init.late_fee ?? "", penalty_rate: init.penalty_rate ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Keep annual ⇄ monthly in sync (annual = monthly × 12).
  const onAnnual = (v) => setForm((f) => ({ ...f, annual_interest_rate: v, annual_interest_rate_monthly: v === "" ? "" : round4(parseFloat(v) / 12) }));
  const onMonthly = (v) => setForm((f) => ({ ...f, annual_interest_rate_monthly: v, annual_interest_rate: v === "" ? "" : round4(parseFloat(v) * 12) }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Name the product.");
    if (!(parseFloat(form.min_amount) > 0) || !(parseFloat(form.max_amount) >= parseFloat(form.min_amount))) return setError("Max amount must be ≥ a positive min amount.");
    setBusy(true);
    try {
      if (product) await api.put(`/welfares/${welfareId}/loans/products/${product.id}`, form);
      else await api.post(`/welfares/${welfareId}/loans/products`, form);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{product ? "Edit loan product" : "New loan product"}</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
          <div><label className={lbl}>Name</label><input value={form.name} onChange={set("name")} placeholder="e.g. Emergency 12%" className={fld} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={lbl}>Annual rate (%)</label><input type="number" min="0" step="0.01" value={form.annual_interest_rate} onChange={(e) => onAnnual(e.target.value)} className={fld} /></div>
            <div><label className={lbl}>Monthly rate (%)</label><input type="number" min="0" step="0.01" value={form.annual_interest_rate_monthly} onChange={(e) => onMonthly(e.target.value)} className={fld} /></div>
            <div>
              <label className={lbl}>Method</label>
              <select value={form.interest_method} onChange={set("interest_method")} className={fld}>
                <option value="flat">Flat</option>
                <option value="reducing">Reducing balance</option>
              </select>
            </div>
            <div><label className={lbl}>Processing fee (%)</label><input type="number" min="0" step="0.01" value={form.processing_fee_rate} onChange={set("processing_fee_rate")} placeholder="0" className={fld} /></div>
            <div><label className={lbl}>Late fee (KES)</label><input type="number" min="0" value={form.late_fee} onChange={set("late_fee")} placeholder="0" className={fld} /></div>
            <div><label className={lbl}>Min amount (KES)</label><input type="number" min="1" value={form.min_amount} onChange={set("min_amount")} className={fld} /></div>
            <div><label className={lbl}>Max amount (KES)</label><input type="number" min="1" value={form.max_amount} onChange={set("max_amount")} className={fld} /></div>
            <div><label className={lbl}>Min duration (months)</label><input type="number" min="1" value={form.min_duration_months} onChange={set("min_duration_months")} className={fld} /></div>
            <div><label className={lbl}>Max duration (months)</label><input type="number" min="1" value={form.max_duration_months} onChange={set("max_duration_months")} className={fld} /></div>
            <div><label className={lbl}>Penalty rate (% / mo overdue)</label><input type="number" min="0" step="0.001" value={form.penalty_rate} onChange={set("penalty_rate")} placeholder="0" className={fld} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : product ? "Save" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
