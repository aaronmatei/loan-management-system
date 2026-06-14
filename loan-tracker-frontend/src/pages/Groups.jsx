import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { UsersRound, Plus, X, Search, ChevronRight, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";
import Spinner from "../components/Spinner";

// Groups / chama list. Each group wraps its members' individual loans and
// co-guarantees them; click through for members, loans and the rollup.
export default function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const r = await api.get("/groups");
      setGroups(r.data.data || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const filtered = groups.filter((g) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (g.name || "").toLowerCase().includes(s) ||
      (g.group_code || "").toLowerCase().includes(s)
    );
  });

  const STATUS = {
    active: "bg-emerald-100 text-emerald-800",
    dormant: "bg-amber-100 text-amber-800",
    closed: "bg-slate-200 text-slate-700",
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <UsersRound className="text-ocean-600" /> Groups / Chama
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {groups.length} group{groups.length === 1 ? "" : "s"} · joint-liability lending
          </p>
        </div>
        <PermissionGate role={["admin", "manager"]}>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 lg:px-6 lg:py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
          >
            <span className="inline-flex items-center gap-1">
              <Plus size={16} /> New Group
            </span>
          </button>
        </PermissionGate>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-3 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search groups by name or code…"
          className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-md p-12">
          <Spinner centered label="Loading groups…" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-10 text-center text-gray-500">
          {groups.length === 0
            ? "No groups yet. Create a group, enrol members, then lend to them."
            : "No groups match your search."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((g) => (
            <button
              key={g.id}
              onClick={() => navigate(`/groups/${g.id}`)}
              className="text-left bg-white rounded-xl shadow-md hover:shadow-lg transition p-5 border border-transparent hover:border-ocean-200"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-bold text-gray-900">{g.name}</p>
                  <p className="text-xs text-gray-500 font-mono">{g.group_code}</p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    STATUS[g.status] || "bg-slate-100 text-slate-700"
                  }`}
                >
                  {g.status}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="text-gray-600">
                  <strong className="text-gray-900">{g.member_count}</strong> members ·{" "}
                  <strong className="text-gray-900">{g.active_loans}</strong> active loans
                </span>
                <ChevronRight size={16} className="text-ocean-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <NewGroupModal
          onClose={() => setShowForm(false)}
          onCreated={(g) => {
            setShowForm(false);
            navigate(`/groups/${g.id}`);
          }}
        />
      )}
    </div>
  );
}

function NewGroupModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    registration_no: "",
    meeting_frequency: "weekly",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Group name is required.");
    setBusy(true);
    try {
      const r = await api.post("/groups", form);
      onCreated(r.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create group.");
      setBusy(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UsersRound size={18} className="text-ocean-600" />
            <h3 className="text-lg font-bold text-slate-900">New Group / Chama</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
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
            <label className={lbl}>Group name *</label>
            <input value={form.name} onChange={set("name")} placeholder="Umoja Chama" className={fld} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Registration no.</label>
              <input
                value={form.registration_no}
                onChange={set("registration_no")}
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Meeting frequency</label>
              <select value={form.meeting_frequency} onChange={set("meeting_frequency")} className={fld}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="">—</option>
              </select>
            </div>
          </div>
          <div>
            <label className={lbl}>Notes</label>
            <textarea value={form.notes} onChange={set("notes")} rows="2" className={fld} />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 rounded-lg bg-ocean-600 hover:bg-ocean-700 text-white font-semibold disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create Group"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
