import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  UsersRound,
  Printer,
  UserPlus,
  Trash2,
  AlertTriangle,
  X,
  Search,
  ShieldCheck,
  Wallet,
  TriangleAlert,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";
import Spinner from "../components/Spinner";

const ROLE_LABEL = {
  member: "Member",
  chairperson: "Chairperson",
  treasurer: "Treasurer",
  secretary: "Secretary",
};

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [g, s, l] = await Promise.all([
        api.get(`/groups/${id}`),
        api.get(`/groups/${id}/summary`),
        api.get(`/groups/${id}/loans`),
      ]);
      setGroup(g.data.data.group);
      setMembers(g.data.data.members || []);
      setSummary(s.data.data);
      setLoans(l.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load group");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [id]);

  const money = (v) =>
    "KES " +
    Number(v || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const printGuarantee = async () => {
    try {
      const res = await api.get(`/groups/${id}/guarantee-form`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert("Failed to open form: " + (err.response?.data?.error || err.message));
    }
  };

  const setRole = async (memberId, role) => {
    try {
      await api.patch(`/groups/${id}/members/${memberId}`, { role });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update role");
    }
  };

  const removeMember = async (memberId) => {
    if (!confirm("Remove this member from the group?")) return;
    try {
      await api.delete(`/groups/${id}/members/${memberId}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to remove member");
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-md p-12">
          <Spinner centered label="Loading group…" />
        </div>
      </div>
    );
  }
  if (error || !group) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error || "Group not found"}
        </div>
        <button
          onClick={() => navigate("/groups")}
          className="px-6 py-2 bg-ocean-600 text-white font-semibold rounded-lg hover:bg-ocean-700"
        >
          ← Back to Groups
        </button>
      </div>
    );
  }

  const STATUS_BADGE = {
    active: "bg-emerald-100 text-emerald-800",
    completed: "bg-sky-100 text-sky-800",
    defaulted: "bg-red-100 text-red-800",
    pending: "bg-slate-100 text-slate-700",
    under_review: "bg-amber-100 text-amber-800",
    approved: "bg-indigo-100 text-indigo-800",
    rejected: "bg-red-100 text-red-700",
  };

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <button
        onClick={() => navigate("/groups")}
        className="mb-4 text-ocean-600 hover:text-ocean-800 font-semibold flex items-center gap-2"
      >
        ← Back to Groups
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-md p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UsersRound className="text-ocean-600" /> {group.name}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            <span className="font-mono">{group.group_code}</span>
            {group.registration_no && <> · Reg {group.registration_no}</>}
            {group.meeting_frequency && <> · meets {group.meeting_frequency}</>}
            {" · "}
            <span className="capitalize">{group.status}</span>
          </p>
        </div>
        <button
          onClick={printGuarantee}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-semibold inline-flex items-center gap-2 self-start"
        >
          <Printer size={16} /> Guarantee Form
        </button>
      </div>

      {/* Rollup */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <RollupCard icon={UsersRound} color="ocean" label="Members" value={summary.member_count} />
          <RollupCard
            icon={Wallet}
            color="emerald"
            label="Disbursed"
            value={money(summary.total_disbursed)}
          />
          <RollupCard
            icon={ShieldCheck}
            color="violet"
            label="Exposure (outstanding)"
            value={money(summary.exposure)}
          />
          <RollupCard
            icon={TriangleAlert}
            color={summary.arrears_count > 0 ? "red" : "slate"}
            label="Loans in arrears"
            value={summary.arrears_count}
          />
        </div>
      )}

      {/* Members */}
      <div className="bg-white rounded-xl shadow-md mb-6 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Members ({members.length})</h2>
          <PermissionGate role={["admin", "manager", "loan_officer"]}>
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-1.5 bg-ocean-600 hover:bg-ocean-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"
            >
              <UserPlus size={15} /> Add Member
            </button>
          </PermissionGate>
        </div>
        {members.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-5 py-2.5">Name</th>
                  <th className="text-left px-5 py-2.5">Code</th>
                  <th className="text-left px-5 py-2.5">Phone</th>
                  <th className="text-left px-5 py-2.5">Role</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-5 py-2.5 font-semibold text-slate-800">
                      {m.first_name} {m.last_name}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{m.client_code}</td>
                    <td className="px-5 py-2.5 text-slate-600">{m.phone_number}</td>
                    <td className="px-5 py-2.5">
                      <PermissionGate
                        role={["admin", "manager"]}
                        fallback={<span>{ROLE_LABEL[m.role] || m.role}</span>}
                      >
                        <select
                          value={m.role}
                          onChange={(e) => setRole(m.id, e.target.value)}
                          className="border border-slate-200 rounded-md px-2 py-1 text-sm"
                        >
                          {Object.entries(ROLE_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </PermissionGate>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <PermissionGate role={["admin", "manager"]}>
                        <button
                          onClick={() => removeMember(m.id)}
                          className="text-red-500 hover:text-red-700"
                          title="Remove member"
                        >
                          <Trash2 size={16} />
                        </button>
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Member loans */}
      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Member Loans ({loans.length})</h2>
        </div>
        {loans.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">
            No loans yet. Create a loan with a group package, pick this group, and choose a member.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-5 py-2.5">Loan</th>
                  <th className="text-left px-5 py-2.5">Member</th>
                  <th className="text-right px-5 py-2.5">Principal</th>
                  <th className="text-right px-5 py-2.5">Balance</th>
                  <th className="text-left px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => navigate(`/loans/${l.id}`)}
                    className="border-t border-slate-100 hover:bg-ocean-50 cursor-pointer"
                  >
                    <td className="px-5 py-2.5 font-mono text-xs text-ocean-700">{l.loan_code}</td>
                    <td className="px-5 py-2.5 text-slate-800">
                      {l.first_name} {l.last_name}
                    </td>
                    <td className="px-5 py-2.5 text-right">{money(l.principal_amount)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold">{money(l.balance)}</td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          STATUS_BADGE[l.status] || "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {l.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddMemberModal
          groupId={id}
          existingClientIds={members.map((m) => m.client_id)}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function RollupCard({ icon: Icon, color, label, value }) {
  const C = {
    ocean: "bg-ocean-50 text-ocean-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-50 text-slate-600",
  };
  return (
    <div className="bg-white rounded-xl shadow-md p-4">
      <div className={`inline-flex p-2 rounded-lg mb-2 ${C[color] || C.slate}`}>
        <Icon size={18} />
      </div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

function AddMemberModal({ groupId, existingClientIds, onClose, onAdded }) {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("member");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/clients");
        setClients(r.data.data || r.data || []);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const existing = new Set(existingClientIds);
  const filtered = clients
    .filter((c) => !existing.has(c.id))
    .filter((c) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(s) ||
        (c.phone_number || "").toLowerCase().includes(s) ||
        (c.client_code || "").toLowerCase().includes(s)
      );
    })
    .slice(0, 40);

  const submit = async () => {
    if (!selected) return setError("Pick a client to enrol.");
    setBusy(true);
    setError("");
    try {
      await api.post(`/groups/${groupId}/members`, { client_id: selected.id, role });
      onAdded();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add member.");
      setBusy(false);
    }
  };

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
            <UserPlus size={18} className="text-ocean-600" />
            <h3 className="text-lg font-bold text-slate-900">Add Member</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          {selected ? (
            <div className="flex items-center gap-2 p-3 border-2 border-ocean-300 bg-ocean-50 rounded-lg">
              <div className="flex-1">
                <p className="font-semibold text-ocean-900">
                  {selected.first_name} {selected.last_name}
                </p>
                <p className="text-sm text-ocean-700">
                  {selected.client_code} · {selected.phone_number}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-red-600 hover:text-red-800 px-2">
                <X size={18} />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-3 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search clients…"
                  className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
              </div>
              <div className="max-h-56 overflow-y-auto border border-gray-100 rounded-lg">
                {filtered.length === 0 ? (
                  <p className="p-3 text-center text-gray-500 text-sm">No clients found</p>
                ) : (
                  filtered.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className="w-full text-left p-3 hover:bg-ocean-50 border-b border-gray-100 last:border-0"
                    >
                      <p className="font-semibold text-gray-800 text-sm">
                        {c.first_name} {c.last_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {c.client_code} · {c.phone_number}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
            >
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy || !selected}
              className="px-5 py-2 rounded-lg bg-ocean-600 hover:bg-ocean-700 text-white font-semibold disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add Member"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
