import React, { useState, useEffect } from "react";
import { Receipt, Plus, X, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

// Welfare expenses — money spent out of the monthly-contribution (savings) pool.
export default function WelfareExpensesPanel({ welfareId }) {
  const [expenses, setExpenses] = useState([]);
  const [total, setTotal] = useState(0);
  const [poolBalance, setPoolBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/welfares/${welfareId}/expenses`);
      setExpenses(r.data.data || []);
      setTotal(r.data.total || 0);
      setPoolBalance(r.data.pool_balance || 0);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [welfareId]);

  return (
    <div className="bg-surface rounded-xl shadow-md border border-amber-100 mb-6 overflow-hidden">
      <div className="bg-amber-50 px-5 py-3 border-b border-amber-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><Receipt size={18} className="text-amber-600" /> Expenses</h2>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-amber-700/70">Total spent</p>
            <p className="text-lg font-bold text-amber-800">{money(total)}</p>
          </div>
          <PermissionGate role={["admin", "manager"]}>
            <button onClick={() => setShowNew(true)} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"><Plus size={15} /> Record expense</button>
          </PermissionGate>
        </div>
      </div>

      <div className="p-5">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Expenses are paid from the savings (monthly-contribution) pool. Pool balance: <span className="font-semibold">{money(poolBalance)}</span>.</p>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : expenses.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No expenses recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Description</th>
                  <th className="text-right px-4 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{fmt(e.txn_date)}</td>
                    <td className="px-4 py-2 text-slate-800 dark:text-slate-100">{e.description}</td>
                    <td className="px-4 py-2 text-right font-semibold text-rose-600">− {money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <ExpenseModal welfareId={welfareId} poolBalance={poolBalance} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function ExpenseModal({ welfareId, poolBalance, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ amount: "", description: "", txn_date: today });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-amber-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!(parseFloat(form.amount) > 0)) return setError("Enter the amount.");
    if (parseFloat(form.amount) > poolBalance) return setError(`The pool only holds ${money(poolBalance)}.`);
    if (!form.description.trim()) return setError("Describe what it was for.");
    setBusy(true);
    try { await api.post(`/welfares/${welfareId}/expenses`, form); onSaved(); }
    catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md my-12" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Record expense</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
          <p className="text-xs text-slate-500 dark:text-slate-400">Paid from the savings pool ({money(poolBalance)} available).</p>
          <div><label className={lbl}>Amount *</label><input type="number" value={form.amount} onChange={set("amount")} className={fld} autoFocus /></div>
          <div><label className={lbl}>Description *</label><input value={form.description} onChange={set("description")} placeholder="e.g. Bank charges, stationery" className={fld} /></div>
          <div><label className={lbl}>Date</label><input type="date" max={today} value={form.txn_date} onChange={set("txn_date")} className={fld} /></div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Record"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
