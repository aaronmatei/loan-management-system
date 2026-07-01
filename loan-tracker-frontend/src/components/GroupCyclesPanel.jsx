import React, { useState, useEffect } from "react";
import { RefreshCw, Plus, X, Lock, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

// Group lending cycles / rounds.
export default function GroupCyclesPanel({ groupId, onChange }) {
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/groups/${groupId}/cycles`);
      setCycles(r.data.data || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [groupId]);

  const money = (v) =>
    "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 });
  const fmt = (d) =>
    d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—";

  const close = async (cycle) => {
    if (!confirm(`Close ${cycle.name || "Cycle " + cycle.cycle_number}?`)) return;
    try {
      await api.put(`/groups/${groupId}/cycles/${cycle.id}`, { status: "closed" });
      load();
      onChange?.();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to close cycle");
    }
  };

  return (
    <div className="bg-surface rounded-xl shadow-md border border-amber-100 mb-6 overflow-hidden">
      <div className="bg-amber-50 px-5 py-3 border-b border-amber-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <RefreshCw size={18} className="text-amber-600" /> Lending Cycles
        </h2>
        <PermissionGate role={["admin", "manager"]}>
          <button
            onClick={() => setShowNew(true)}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"
          >
            <Plus size={15} /> New Cycle
          </button>
        </PermissionGate>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : cycles.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No cycles yet. Open a cycle to group a round of member loans.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">#</th>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Period</th>
                  <th className="text-right px-4 py-2">Loans</th>
                  <th className="text-right px-4 py-2">Disbursed</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-100">{c.cycle_number}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">{c.name}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                      {fmt(c.start_date)} – {fmt(c.end_date)}
                    </td>
                    <td className="px-4 py-2 text-right">{c.loan_count}</td>
                    <td className="px-4 py-2 text-right">{money(c.total_disbursed)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          c.status === "open"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {c.status === "open" && (
                        <PermissionGate role={["admin", "manager"]}>
                          <button
                            onClick={() => close(c)}
                            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 inline-flex items-center gap-1 text-sm font-semibold"
                          >
                            <Lock size={14} /> Close
                          </button>
                        </PermissionGate>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <NewCycleModal
          groupId={groupId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
            onChange?.();
          }}
        />
      )}
    </div>
  );
}

function NewCycleModal({ groupId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post(`/groups/${groupId}/cycles`, form);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create cycle.");
      setBusy(false);
    }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-amber-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">New Lending Cycle</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-100">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          <div>
            <label className={lbl}>Name <span className="text-gray-500 dark:text-slate-400 font-normal">(optional)</span></label>
            <input value={form.name} onChange={set("name")} placeholder="e.g. Q1 2026" className={fld} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Start date</label>
              <input type="date" value={form.start_date} onChange={set("start_date")} className={fld} />
            </div>
            <div>
              <label className={lbl}>End date</label>
              <input type="date" value={form.end_date} onChange={set("end_date")} className={fld} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50">
              {busy ? "Creating…" : "Open Cycle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
