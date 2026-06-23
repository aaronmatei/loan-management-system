import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { UsersRound, Plus, X, Search, ChevronRight, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";

// Group list. For a lender these are group-guaranteed loan groups; a welfare
// account sees the same page as its "Welfare". The label adapts to the account.
function readKind() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null")?.tenant?.kind || "lender";
  } catch {
    return "lender";
  }
}

export default function Groups() {
  const navigate = useNavigate();
  const isWelfare = readKind() === "welfare";
  const noun = isWelfare ? "Welfare" : "Group";
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
      <PageHeader
        icon={UsersRound}
        title={isWelfare ? "Welfare" : "Groups"}
        subtitle={`${groups.length} ${isWelfare ? "welfare group" : "group"}${groups.length === 1 ? "" : "s"}${isWelfare ? " · members, savings & lending" : " · group-guaranteed lending"}`}
        actions={
          <PermissionGate role={["admin", "manager"]}>
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 lg:px-6 lg:py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition"
            >
              <span className="inline-flex items-center gap-1">
                <Plus size={16} /> New {noun}
              </span>
            </button>
          </PermissionGate>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-3 text-gray-400 dark:text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${isWelfare ? "welfare groups" : "groups"}…`}
          className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-5">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-20 mt-2" />
                </div>
                <Skeleton className="h-5 w-14" rounded="rounded-full" />
              </div>
              <Skeleton className="h-4 w-1/2 mt-3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        groups.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title={`No ${isWelfare ? "welfare groups" : "groups"} yet`}
            description={`Create ${isWelfare ? "a welfare group" : "a group"}, enrol members, then run their loans.`}
            action={
              <PermissionGate role={["admin", "manager"]}>
                <button
                  onClick={() => setShowForm(true)}
                  className="px-6 py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition inline-flex items-center gap-1"
                >
                  <Plus size={16} /> New {noun}
                </button>
              </PermissionGate>
            }
          />
        ) : (
          <EmptyState
            icon={Search}
            tone="muted"
            title="No matches for your search"
            description="Try a different name or group code."
          />
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((g) => (
            <button
              key={g.id}
              onClick={() => navigate(`/groups/${g.id}`)}
              className="text-left bg-white dark:bg-slate-800 rounded-xl shadow-md hover:shadow-lg transition p-5 border border-transparent hover:border-ocean-200"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-bold text-gray-900 dark:text-slate-100">{g.name}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 font-mono">{g.group_code}</p>
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
                <span className="text-gray-600 dark:text-slate-400">
                  <strong className="text-gray-900 dark:text-slate-100">{g.member_count}</strong> members ·{" "}
                  <strong className="text-gray-900 dark:text-slate-100">{g.active_loans}</strong> active loans
                </span>
                <ChevronRight size={16} className="text-ocean-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <NewGroupModal
          noun={noun}
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

function NewGroupModal({ noun = "Group", onClose, onCreated }) {
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
    "w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md my-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <UsersRound size={18} className="text-ocean-600" />
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">New {noun}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
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
              className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700"
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
