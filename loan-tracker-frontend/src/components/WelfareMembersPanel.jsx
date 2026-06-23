import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PiggyBank, Plus, X, Wallet, ChevronRight, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

// A welfare's members + contributions pool, shown on the welfare detail page.
// The pool is separate from the lending capital; click a member for their
// savings + pool loans.
export default function WelfareMembersPanel({ welfareId }) {
  const navigate = useNavigate();
  const [members, setMembers] = useState([]);
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      const [m, p] = await Promise.all([
        api.get(`/welfares/${welfareId}/members`),
        api.get(`/welfares/${welfareId}/members/pool`),
      ]);
      setMembers(m.data.data || []);
      setPool(p.data.data || null);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId]);

  const money = (v) =>
    "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-emerald-100 mb-6 overflow-hidden">
      <div className="bg-emerald-50 px-5 py-3 border-b border-emerald-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <PiggyBank size={18} className="text-emerald-600" /> Members &amp; Pool
        </h2>
        <PermissionGate role={["admin", "manager", "loan_officer"]}>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"
          >
            <Plus size={15} /> Add Member
          </button>
        </PermissionGate>
      </div>

      <div className="p-5">
        {pool && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-xs text-slate-500 flex items-center gap-1"><Wallet size={13} /> Pool balance</p>
              <p className="font-bold text-emerald-800">{money(pool.balance)}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">Contributions</p>
              <p className="font-bold text-slate-900 dark:text-slate-100">{money(pool.total_contributions)}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">Out on loan</p>
              <p className="font-bold text-slate-900 dark:text-slate-100">{money(pool.total_loaned)}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">Members</p>
              <p className="font-bold text-slate-900 dark:text-slate-100">{pool.member_count}</p>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No members yet. Add members to start the contributions pool.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Member</th>
                  <th className="text-left px-4 py-2">No.</th>
                  <th className="text-left px-4 py-2">Phone</th>
                  <th className="text-right px-4 py-2">Savings</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => navigate(`/welfare/members/${m.id}`)}
                    className="border-t border-slate-100 dark:border-slate-700 hover:bg-emerald-50 cursor-pointer"
                  >
                    <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-100">{m.first_name} {m.last_name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{m.member_no}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{m.phone_number || "—"}</td>
                    <td className="px-4 py-2 text-right font-semibold">{money(m.savings_balance)}</td>
                    <td className="px-4 py-2 text-right"><ChevronRight size={16} className="text-emerald-400" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <AddMemberModal
          welfareId={welfareId}
          onClose={() => setShowForm(false)}
          onCreated={(m) => navigate(`/welfare/members/${m.id}`)}
        />
      )}
    </div>
  );
}

function AddMemberModal({ welfareId, onClose, onCreated }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", phone_number: "", id_number: "", email: "", monthly_contribution: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.first_name.trim() || !form.last_name.trim()) return setError("First and last name are required.");
    setBusy(true);
    try {
      const r = await api.post(`/welfares/${welfareId}/members`, form);
      onCreated(r.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add member.");
      setBusy(false);
    }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-700 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2"><PiggyBank size={18} className="text-emerald-600" /><h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Add Member</h3></div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>First name *</label><input value={form.first_name} onChange={set("first_name")} className={fld} /></div>
            <div><label className={lbl}>Last name *</label><input value={form.last_name} onChange={set("last_name")} className={fld} /></div>
            <div><label className={lbl}>Phone</label><input value={form.phone_number} onChange={set("phone_number")} className={fld} /></div>
            <div><label className={lbl}>ID number</label><input value={form.id_number} onChange={set("id_number")} className={fld} /></div>
            <div><label className={lbl}>Email</label><input value={form.email} onChange={set("email")} className={fld} /></div>
            <div><label className={lbl}>Monthly contribution</label><input type="number" value={form.monthly_contribution} onChange={set("monthly_contribution")} className={fld} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Add Member"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
