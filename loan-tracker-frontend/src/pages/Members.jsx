import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PiggyBank, Plus, X, Search, ChevronRight, Users, Wallet, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";
import Spinner from "../components/Spinner";

// Member contributions pool — a members' fund separate from the lending capital.
export default function Members() {
  const navigate = useNavigate();
  const [members, setMembers] = useState([]);
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [m, p] = await Promise.all([api.get("/members"), api.get("/members/pool")]);
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
  }, []);

  const money = (v) =>
    "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const filtered = members.filter((m) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(s) ||
      (m.member_no || "").toLowerCase().includes(s) ||
      (m.phone_number || "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <PiggyBank className="text-emerald-600" /> Members
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Members' contributions pool — separate from your lending capital.
          </p>
        </div>
        <PermissionGate role={["admin", "manager", "loan_officer"]}>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 lg:px-6 lg:py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition"
          >
            <span className="inline-flex items-center gap-1"><Plus size={16} /> New Member</span>
          </button>
        </PermissionGate>
      </div>

      {/* Pool summary */}
      {pool && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="inline-flex p-2 rounded-lg mb-2 bg-emerald-50 text-emerald-700"><Wallet size={18} /></div>
            <p className="text-xs text-slate-500">Pool balance</p>
            <p className="text-lg font-bold text-slate-900">{money(pool.balance)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="inline-flex p-2 rounded-lg mb-2 bg-ocean-50 text-ocean-700"><PiggyBank size={18} /></div>
            <p className="text-xs text-slate-500">Total contributions</p>
            <p className="text-lg font-bold text-slate-900">{money(pool.total_contributions)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="inline-flex p-2 rounded-lg mb-2 bg-violet-50 text-violet-700"><Users size={18} /></div>
            <p className="text-xs text-slate-500">Active members</p>
            <p className="text-lg font-bold text-slate-900">{pool.member_count}</p>
          </div>
        </div>
      )}

      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-3 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members…"
          className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-md p-12"><Spinner centered label="Loading members…" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-10 text-center text-gray-500">
          {members.length === 0 ? "No members yet. Enrol members to start their contributions pool." : "No members match your search."}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-5 py-2.5">Member</th>
                <th className="text-left px-5 py-2.5">No.</th>
                <th className="text-left px-5 py-2.5">Phone</th>
                <th className="text-right px-5 py-2.5">Savings</th>
                <th className="text-left px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => navigate(`/members/${m.id}`)}
                  className="border-t border-slate-100 hover:bg-emerald-50 cursor-pointer"
                >
                  <td className="px-5 py-2.5 font-semibold text-slate-800">{m.first_name} {m.last_name}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{m.member_no}</td>
                  <td className="px-5 py-2.5 text-slate-600">{m.phone_number || "—"}</td>
                  <td className="px-5 py-2.5 text-right font-semibold">{money(m.savings_balance)}</td>
                  <td className="px-5 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right"><ChevronRight size={16} className="text-emerald-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <NewMemberModal onClose={() => setShowForm(false)} onCreated={(m) => { setShowForm(false); navigate(`/members/${m.id}`); }} />}
    </div>
  );
}

function NewMemberModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    first_name: "", last_name: "", phone_number: "", id_number: "", email: "", monthly_contribution: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.first_name.trim() || !form.last_name.trim()) return setError("First and last name are required.");
    setBusy(true);
    try {
      const r = await api.post("/members", form);
      onCreated(r.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create member.");
      setBusy(false);
    }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2"><PiggyBank size={18} className="text-emerald-600" /><h3 className="text-lg font-bold text-slate-900">New Member</h3></div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
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
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Enrol Member"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
