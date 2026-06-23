import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Gem, Plus, Search, ChevronRight, AlertTriangle, Coins } from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";
import PawnLoanModal from "../components/PawnLoanModal";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";
import { formatKES } from "../utils/money";

// Pawn loans listing. The home of the pawnbroker portal, and also reachable by
// lender tenants that occasionally do pawns. Lists loan_type='pawn' loans and
// launches the New Pawn flow.
export default function Pawns() {
  const navigate = useNavigate();
  const [loans, setLoans] = useState([]);
  const [clients, setClients] = useState([]);
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showPawn, setShowPawn] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [l, c, p] = await Promise.all([
        api.get("/loans"),
        api.get("/clients").catch(() => ({ data: { data: [] } })),
        api.get("/capital/status").catch(() => ({ data: { data: null } })),
      ]);
      setLoans((l.data.data || []).filter((x) => x.loan_type === "pawn"));
      setClients(c.data.data || c.data || []);
      setPool(p.data?.data || null);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const money = (v) => formatKES(v);

  const STATUS = {
    active: "bg-emerald-100 text-emerald-800",
    completed: "bg-sky-100 text-sky-800",
    defaulted: "bg-red-100 text-red-800",
  };
  const STATUS_LABEL = { active: "Active", completed: "Redeemed", defaulted: "Forfeited" };

  const visible = loans.filter((l) => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (l.loan_code || "").toLowerCase().includes(s) ||
      `${l.first_name || ""} ${l.last_name || ""}`.toLowerCase().includes(s)
    );
  });

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader
        icon={Gem}
        title="Pawns"
        subtitle={`${loans.length} pawn${loans.length === 1 ? "" : "s"} · cash against pledged items`}
        actions={
          <PermissionGate role={["admin", "manager", "loan_officer"]}>
            <button
              onClick={() => setShowPawn(true)}
              disabled={clients.length === 0}
              className="px-4 py-2 lg:px-6 lg:py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="inline-flex items-center gap-1"><Plus size={16} /> New Pawn</span>
            </button>
          </PermissionGate>
        }
      />

      {clients.length === 0 && !loading && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <AlertTriangle size={16} /> Add a client first, then you can create a pawn.
        </div>
      )}

      {pool && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 mb-4 inline-flex items-center gap-3">
          <div className="inline-flex p-2 rounded-lg bg-amber-50 text-amber-700"><Coins size={18} /></div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Available capital</p>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {money(pool.available_pool ?? pool.available ?? 0)}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-3 text-gray-400 dark:text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code or client…"
            className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-amber-500 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-900 dark:text-slate-100 focus:border-amber-500 focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Redeemed</option>
          <option value="defaulted">Forfeited</option>
        </select>
      </div>

      {loading ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md overflow-hidden">
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, r) => (
              <div key={r} className="flex items-center gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Gem}
          title={loans.length === 0 ? "No pawns yet" : "No pawns match your filters"}
          description={loans.length === 0 ? "Create one with New Pawn to lend cash against a pledged item." : "Try a different search or status filter."}
          action={loans.length === 0 && (
            <PermissionGate role={["admin", "manager", "loan_officer"]}>
              <button
                onClick={() => setShowPawn(true)}
                disabled={clients.length === 0}
                className="px-4 py-2 lg:px-6 lg:py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="inline-flex items-center gap-1"><Plus size={16} /> New Pawn</span>
              </button>
            </PermissionGate>
          )}
        />
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-5 py-2.5">Pawn</th>
                <th className="text-left px-5 py-2.5">Client</th>
                <th className="text-right px-5 py-2.5">Advanced</th>
                <th className="text-right px-5 py-2.5">Balance</th>
                <th className="text-left px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => navigate(`/loans/${l.id}`)}
                  className="border-t border-slate-100 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-slate-700 cursor-pointer"
                >
                  <td className="px-5 py-2.5 font-mono text-xs text-amber-700">{l.loan_code}</td>
                  <td className="px-5 py-2.5 text-slate-800 dark:text-slate-100">{l.first_name} {l.last_name}</td>
                  <td className="px-5 py-2.5 text-right">{money(l.principal_amount)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold">{money(l.balance_due)}</td>
                  <td className="px-5 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[l.status] || "bg-slate-100 text-slate-700"}`}>
                      {STATUS_LABEL[l.status] || l.status}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right"><ChevronRight size={16} className="text-amber-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPawn && (
        <PawnLoanModal
          clients={clients}
          onClose={() => setShowPawn(false)}
          onCreated={(loan) => {
            setShowPawn(false);
            if (loan?.id) navigate(`/loans/${loan.id}`);
            else load();
          }}
        />
      )}
    </div>
  );
}
