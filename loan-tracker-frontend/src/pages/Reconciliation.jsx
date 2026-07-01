// Reconciliation — cashier's end-of-day balancing surface.
//
// Two tabs:
//   Daily Cash Register — every transaction in the window, totals
//     by payment method (Cash, M-Pesa, Bank, Cheque, Other), with
//     each row's allocation broken down (penalty / interest /
//     principal / overpayment) so finance can match against the
//     till + bank statements.
//   Overpayments — loans flagged refund_status='pending'. Same
//     data the Loans-list "Refund Due" column shows, in a focused
//     queue with a running total.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Banknote,
  Smartphone,
  Building2,
  FileText,
  Wallet,
  RefreshCcw,
  ArrowUpRight,
  ArrowDownToLine,
  Coins,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Inbox,
} from "lucide-react";
import api from "../services/api";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";
import DataTable from "../components/DataTable";
import { useColumnPreset } from "../hooks/useTablePrefs";
import { formatKES } from "../utils/money";

const fmt = (n) => formatKES(n);
const fmt2 = (n) => formatKES(n, 2);
const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};
const fmtTime = (d) => {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Methods we expect — anything else buckets to "other". The icon /
// colour mapping makes the per-method tile row scannable at a glance.
const METHOD_META = {
  cash: { label: "Cash", icon: Banknote, color: "emerald" },
  mpesa: { label: "M-Pesa", icon: Smartphone, color: "green" },
  bank_transfer: { label: "Bank Transfer", icon: Building2, color: "sky" },
  cheque: { label: "Cheque", icon: FileText, color: "amber" },
  other: { label: "Other", icon: Wallet, color: "slate" },
};
const COLOR_CLS = {
  emerald: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100" },
  green: { bg: "bg-green-50", text: "text-green-700", border: "border-green-100" },
  sky: { bg: "bg-ocean-50", text: "text-ocean-700", border: "border-ocean-100" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-100" },
  slate: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-100" },
};

// Local-time YYYY-MM-DD so the navigator matches the user's calendar
// rather than UTC (Africa/Nairobi is +3, and toISOString().slice(0,10)
// rolls a day too soon before midnight UTC).
const isoLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today = () => isoLocal(new Date());
const shiftDays = (iso, delta) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return isoLocal(d);
};

const num = (v) => parseFloat(v || 0);

// ── Daily Cash Register column model ──────────────────────────────────
// Column-driven so the page can offer client-side presets + an expandable
// detail row. The Txn identity (code + timestamp) is pinned and rendered
// specially, so it is NOT in this list. The totals footer mirrors the
// original tfoot: Cash/Penalty/Overpaid read the backend `totals` summary
// (kept identical to the prior behaviour), while Principal/Interest sum
// the visible transactions. The factory injects `navigate` + `totals`.
const registerColumns = ({ navigate, totals }) => [
  {
    key: "method",
    label: "Method",
    align: "left",
    cell: (t) => {
      const methKey = (t.payment_method || "other").toLowerCase();
      const meta = METHOD_META[methKey] || METHOD_META.other;
      const cls = COLOR_CLS[meta.color];
      return (
        <div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cls.bg} ${cls.text}`}
          >
            {meta.label}
          </span>
          {t.payment_reference && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
              {t.payment_reference}
            </p>
          )}
        </div>
      );
    },
  },
  {
    key: "loan",
    label: "Loan / Client",
    align: "left",
    cell: (t) => (
      <div>
        <button
          onClick={() => navigate(`/loans/${t.loan_id}`)}
          className="font-mono text-xs font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
        >
          {t.loan_code} <ArrowUpRight size={11} />
        </button>
        <p className="text-xs text-slate-700 dark:text-slate-200">
          {t.first_name} {t.last_name}
        </p>
      </div>
    ),
  },
  {
    key: "cash",
    label: "Cash",
    align: "right",
    money: true,
    footer: () => (
      <p className="font-bold text-sm text-ocean-700">{fmt2(totals.gross)}</p>
    ),
    cell: (t) => (
      <p className="font-bold text-ocean-700">{fmt2(t.amount_paid)}</p>
    ),
  },
  {
    key: "penalty",
    label: "Penalty",
    align: "right",
    money: true,
    footer: () => (
      <p className="font-bold text-sm text-rose-700">{fmt2(totals.penalty)}</p>
    ),
    cell: (t) =>
      parseFloat(t.penalty_portion) > 0 ? (
        <span className="text-rose-700 font-semibold">
          {fmt2(t.penalty_portion)}
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
  },
  {
    key: "principal",
    label: "Principal",
    align: "right",
    money: true,
    footer: (rows) => (
      <p className="font-bold text-sm text-slate-700 dark:text-slate-200">
        {fmt2(rows.reduce((s, t) => s + num(t.principal_portion), 0))}
      </p>
    ),
    cell: (t) =>
      parseFloat(t.principal_portion) > 0 ? (
        <span className="text-slate-700 dark:text-slate-200">
          {fmt2(t.principal_portion)}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "interest",
    label: "Interest",
    align: "right",
    money: true,
    footer: (rows) => (
      <p className="font-bold text-sm text-emerald-700">
        {fmt2(rows.reduce((s, t) => s + num(t.interest_portion), 0))}
      </p>
    ),
    cell: (t) =>
      parseFloat(t.interest_portion) > 0 ? (
        <span className="text-emerald-700 font-semibold">
          {fmt2(t.interest_portion)}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "overpaid",
    label: "Overpaid",
    align: "right",
    money: true,
    footer: () => (
      <p className="font-bold text-sm text-amber-700">
        {fmt2(totals.overpayment)}
      </p>
    ),
    cell: (t) =>
      parseFloat(t.overpayment_portion) > 0 ? (
        <span className="text-amber-700 font-semibold">
          {fmt2(t.overpayment_portion)}
        </span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
  },
];

const REGISTER_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["method", "loan", "cash"],
  },
  full: {
    label: "Everything",
    keys: ["method", "loan", "cash", "penalty", "principal", "interest", "overpaid"],
  },
};
const REGISTER_PRESET_KEY = "reconciliation.register.columnPreset";

// ── Overpayments column model ─────────────────────────────────────────
// Loan Code is pinned; the rest render as preset-driven columns with an
// expandable detail row. The Action button injects `navigate`.
const overpaymentsColumns = ({ navigate }) => [
  {
    key: "client",
    label: "Client",
    align: "left",
    cell: (l) => (
      <div>
        <p className="font-semibold text-navy-900 dark:text-slate-100">
          {l.first_name} {l.last_name}
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
          {l.client_code} · {l.phone_number}
        </p>
      </div>
    ),
  },
  {
    key: "principal_amount",
    label: "Principal",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.principal_amount), 0),
    totalClass: "text-slate-700 dark:text-slate-200",
    cell: (l) => (
      <span className="text-slate-700 dark:text-slate-200">
        {fmt(l.principal_amount)}
      </span>
    ),
  },
  {
    key: "overpayment_amount",
    label: "Overpaid",
    align: "right",
    money: true,
    total: (rows) => rows.reduce((s, l) => s + num(l.overpayment_amount), 0),
    totalClass: "text-amber-700",
    cell: (l) => (
      <span className="font-bold text-amber-700">
        {fmt2(l.overpayment_amount)}
      </span>
    ),
  },
  {
    key: "since",
    label: "Since",
    align: "left",
    cell: (l) => (
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {fmtDate(l.updated_at)}
      </span>
    ),
  },
  {
    key: "action",
    label: "Action",
    align: "left",
    cell: (l) => (
      <button
        onClick={() => navigate(`/loans/${l.id}`)}
        className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition"
        title="Open the loan to mark this refund as paid"
      >
        Process Refund
      </button>
    ),
  },
];

const OVERPAYMENTS_PRESETS = {
  essentials: {
    label: "Essentials",
    keys: ["client", "overpayment_amount", "action"],
  },
  full: {
    label: "Everything",
    keys: ["client", "principal_amount", "overpayment_amount", "since", "action"],
  },
};
const OVERPAYMENTS_PRESET_KEY = "reconciliation.overpayments.columnPreset";

function Reconciliation() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("register");

  // Single-day navigator — cashier's "what came in today/yesterday" is
  // the dominant reconciliation pattern, and stepping ±1 day is the
  // natural review motion. For longer windows the user can paste a
  // wider window into the date input directly (still a date input,
  // just defaults to single-day stepping via the chevrons).
  const [date, setDate] = useState(today());

  const [data, setData] = useState(null);
  const [overpayments, setOverpayments] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Table UX state (client-side only) — one expand set + preset per
  // table (register / overpayments). Presets persist in localStorage.
  const [registerExpanded, setRegisterExpanded] = useState(() => new Set());
  const toggleRegisterRow = (id) =>
    setRegisterExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [overpaymentsExpanded, setOverpaymentsExpanded] = useState(
    () => new Set(),
  );
  const toggleOverpaymentsRow = (id) =>
    setOverpaymentsExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [registerPreset, setRegisterPreset] = useColumnPreset(
    REGISTER_PRESET_KEY,
    REGISTER_PRESETS,
    "full",
  );
  const [overpaymentsPreset, setOverpaymentsPreset] = useColumnPreset(
    OVERPAYMENTS_PRESET_KEY,
    OVERPAYMENTS_PRESETS,
    "full",
  );

  const loadRegister = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      // Single-day window — from and to both = selected date.
      const r = await api.get(`/reconciliation?from=${date}&to=${date}`);
      setData(r.data.data);
    } catch (err) {
      console.error("Failed to load reconciliation:", err);
      setData(null);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  const loadOverpayments = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await api.get("/reconciliation/overpayments");
      setOverpayments(r.data.data);
    } catch (err) {
      console.error("Failed to load overpayments:", err);
      setOverpayments(null);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "register") loadRegister();
    else if (tab === "overpayments") loadOverpayments();
    // 'unmatched' tab is a placeholder until C2B ships — no fetch yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date]);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={Wallet}
        title={
          <>
            Reconciliation{" "}
            <span className="font-serif italic font-medium text-ocean-700">
              &amp; Refunds
            </span>
          </>
        }
        subtitle="Daily cashier balancing. Every transaction in the window with how it split (penalty / amount due / overpayment), grouped by payment method so you can match against the till + bank statements. The Overpayments tab is the refund queue."
        actions={
          <button
            onClick={() =>
              tab === "register"
                ? loadRegister({ silent: true })
                : loadOverpayments({ silent: true })
            }
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-surface border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50"
          >
            <RefreshCcw
              size={16}
              className={refreshing ? "animate-spin" : ""}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {/* Tabs — Cash Register (default), Overpayments, Unmatched
          Payments (placeholder until M-Pesa C2B is wired). */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700 mb-6">
        <button
          onClick={() => setTab("register")}
          className={`relative inline-flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-semibold transition border-b-2 ${
            tab === "register"
              ? "border-ocean-600 text-ocean-700"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <ArrowDownToLine size={15} /> Daily Cash Register
        </button>
        <button
          onClick={() => setTab("overpayments")}
          className={`relative inline-flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-semibold transition border-b-2 ${
            tab === "overpayments"
              ? "border-amber-600 text-amber-700"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <Coins size={15} /> Overpayments
        </button>
        <button
          onClick={() => setTab("unmatched")}
          className={`relative inline-flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-semibold transition border-b-2 ${
            tab === "unmatched"
              ? "border-ocean-600 text-ocean-700"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <Inbox size={15} /> Unmatched M-Pesa
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 uppercase">
            soon
          </span>
        </button>
      </div>

      {tab === "register" && (
        <>
          {/* Single-day navigator. ← steps back one day, → steps
              forward one day, the date input opens a calendar for
              jumping further. "Today" chip stays as a one-click
              return-to-today since stepping back through a long
              window manually would be painful. */}
          <div className="bg-surface rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4 mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDate(shiftDays(date, -1))}
                className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
                title="Previous day"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="relative">
                <Calendar
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-400 pointer-events-none"
                />
                <input
                  type="date"
                  value={date}
                  max={today()}
                  onChange={(e) => setDate(e.target.value || today())}
                  className="pl-8 pr-3 py-2 border-2 border-slate-200 rounded-lg focus:border-ocean-500 focus:outline-none font-semibold text-slate-700 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                />
              </div>
              <button
                onClick={() => setDate(shiftDays(date, +1))}
                disabled={date >= today()}
                className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
                title="Next day"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              onClick={() => setDate(today())}
              disabled={date === today()}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                date === today()
                  ? "bg-ocean-100 text-ocean-700 cursor-default"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              Today
            </button>
            <p className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
              Showing transactions for{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {fmtDate(date)}
              </span>
            </p>
          </div>

          {loading ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" rounded="rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-20 w-full mb-4" rounded="rounded-xl" />
              <div className="bg-surface rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" rounded="rounded-lg" />
                ))}
              </div>
            </>
          ) : !data ? (
            <EmptyState
              icon={RefreshCcw}
              tone="muted"
              title="Couldn't load data"
              description="Something went wrong fetching the cash register. Try refreshing."
            />
          ) : (
            <>
              {/* Per-method tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                {Object.entries(METHOD_META).map(([key, meta]) => {
                  const row = data.by_method.find((r) => r.method === key) || {
                    count: 0,
                    gross: 0,
                  };
                  const cls = COLOR_CLS[meta.color];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={key}
                      className={`rounded-xl border ${cls.border} ${cls.bg} p-3.5`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Icon size={16} className={cls.text} />
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                          {meta.label}
                        </span>
                      </div>
                      <p className={`text-xl font-extrabold ${cls.text}`}>
                        {fmt(row.gross)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {row.count} txn{row.count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Grand total strip */}
              <div className="bg-ocean-gradient-soft border border-ocean-100 rounded-xl p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-ocean-700">
                    Day total
                  </p>
                  <p className="text-2xl font-extrabold text-ocean-700 mt-0.5">
                    {fmt2(data.totals.gross)}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {data.totals.count} transaction
                    {data.totals.count !== 1 ? "s" : ""} on{" "}
                    {fmtDate(data.from)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div>
                    <p className="text-[11px] uppercase font-semibold text-slate-500">
                      Toward Loan
                    </p>
                    <p className="font-bold text-ocean-700">
                      {fmt2(data.totals.toward_amount_due)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase font-semibold text-slate-500">
                      Penalty
                    </p>
                    <p className="font-bold text-rose-700">
                      {fmt2(data.totals.penalty)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase font-semibold text-slate-500">
                      Overpayment
                    </p>
                    <p className="font-bold text-amber-700">
                      {fmt2(data.totals.overpayment)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Transactions table — shared DataTable (column presets,
                  expandable rows, sticky pinned Txn, totals footer). The
                  footer mirrors the prior tfoot exactly: Cash/Penalty/
                  Overpaid from the backend summary, Principal/Interest
                  summed from the visible transactions. */}
              <DataTable
                columns={registerColumns({ navigate, totals: data.totals })}
                rows={data.transactions}
                rowKey={(t) => t.id}
                pinned={{
                  label: "Txn",
                  cell: (t) => (
                    <div>
                      <p className="font-mono text-xs font-bold text-slate-800 dark:text-slate-100">
                        {t.transaction_code}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {fmtDate(t.payment_date)} {fmtTime(t.payment_date)}
                      </p>
                    </div>
                  ),
                }}
                presets={REGISTER_PRESETS}
                preset={registerPreset}
                onPresetChange={setRegisterPreset}
                expandedRows={registerExpanded}
                onToggleRow={toggleRegisterRow}
                totals={data.transactions}
                totalsLabel="TOTALS"
                maxHeight="calc(100vh - 460px)"
                empty={
                  <EmptyState
                    icon={ArrowDownToLine}
                    tone="muted"
                    title={`No transactions on ${fmtDate(date)}`}
                    description="Use the arrows above to step through other days, or jump to a specific date with the picker."
                  />
                }
              />
            </>
          )}
        </>
      )}

      {tab === "overpayments" && (
        <>
          {loading ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 w-full" rounded="rounded-2xl" />
                ))}
              </div>
              <div className="bg-surface rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" rounded="rounded-lg" />
                ))}
              </div>
            </>
          ) : !overpayments || overpayments.count === 0 ? (
            <EmptyState
              icon={Coins}
              title="No overpayments pending refund"
              description='Loans flip to "pending refund" when the borrower pays past their balance.'
            />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
                  <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    Pending Refunds
                  </p>
                  <p className="text-3xl font-bold text-navy-900 dark:text-slate-100 mt-2">
                    {overpayments.count}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    loan{overpayments.count !== 1 ? "s" : ""} on the book
                  </p>
                </div>
                <div className="rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 bg-surface p-5">
                  <p className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                    Total Pending
                  </p>
                  <p className="text-3xl font-bold text-amber-700 mt-2">
                    {fmt(overpayments.total_pending)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    refund owed to borrowers
                  </p>
                </div>
              </div>

              <DataTable
                columns={overpaymentsColumns({ navigate })}
                rows={overpayments.loans}
                rowKey={(l) => l.id}
                pinned={{
                  label: "Loan",
                  cell: (l) => (
                    <button
                      onClick={() => navigate(`/loans/${l.id}`)}
                      className="font-mono text-xs font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
                    >
                      {l.loan_code} <ArrowUpRight size={11} />
                    </button>
                  ),
                }}
                presets={OVERPAYMENTS_PRESETS}
                preset={overpaymentsPreset}
                onPresetChange={setOverpaymentsPreset}
                expandedRows={overpaymentsExpanded}
                onToggleRow={toggleOverpaymentsRow}
                totals={overpayments.loans}
                totalsLabel={`TOTALS (${overpayments.loans.length})`}
                maxHeight="calc(100vh - 360px)"
                empty={
                  <EmptyState
                    icon={Coins}
                    title="No overpayments pending refund"
                    description='Loans flip to "pending refund" when the borrower pays past their balance.'
                  />
                }
              />
            </>
          )}
        </>
      )}

      {/* Unmatched M-Pesa C2B — placeholder while we don't yet have
          a C2B ingest. When it lands, M-Pesa payments arriving
          without a borrower attribution (or with one that doesn't
          match a known phone / loan code) will queue here for human
          review. The empty state below explains what the surface
          will do; the route already exists at /api/reconciliation
          and a future commit can add a /unmatched sub-route plus
          this tab's table without restructuring the page. */}
      {tab === "unmatched" && (
        <div className="bg-surface rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-10 lg:p-14">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-ocean-50 flex items-center justify-center mx-auto mb-5">
              <Inbox size={28} className="text-ocean-600" />
            </div>
            <h3 className="text-2xl font-bold text-navy-900 dark:text-slate-100 mb-2">
              Unmatched M-Pesa payments
            </h3>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
              When M-Pesa C2B is enabled, any incoming payment that
              can't be auto-attributed to a loan — wrong phone, missing
              account reference, ambiguous amount — will queue here for
              a human to assign or refund. Until C2B is wired up, this
              tab stays empty.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
              <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  What it'll show
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  M-Pesa txn code, sender phone, amount, time received
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Actions per row
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  Attach to a loan · Refund · Mark as ignored
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Source
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  Daraja C2B callback (Paybill / Till)
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-400 mt-6">
              Tab is wired into the reconciliation page already — the
              backend route will plug in here when C2B ships.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default Reconciliation;
