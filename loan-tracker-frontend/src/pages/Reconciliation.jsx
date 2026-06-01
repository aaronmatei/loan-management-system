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
} from "lucide-react";
import api from "../services/api";

const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString("en-KE", {
    maximumFractionDigits: 0,
  })}`;
const fmt2 = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  sky: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-100" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-100" },
  slate: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-100" },
};

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

function Reconciliation() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("register");

  // Date window — defaults to today.
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());

  const [data, setData] = useState(null);
  const [overpayments, setOverpayments] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRegister = async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const r = await api.get(`/reconciliation?from=${from}&to=${to}`);
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
    else loadOverpayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to]);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
        <div className="max-w-2xl">
          <h1 className="text-4xl lg:text-5xl font-bold text-navy-900 tracking-tight">
            Reconciliation{" "}
            <span className="font-serif italic font-medium text-ocean-700">
              & Refunds
            </span>
          </h1>
          <p className="text-slate-500 mt-3 leading-relaxed">
            Daily cashier balancing. Every transaction in the window with how
            it split (penalty / amount due / overpayment), grouped by payment
            method so you can match against the till + bank statements. The
            Overpayments tab is the refund queue.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={() =>
              tab === "register"
                ? loadRegister({ silent: true })
                : loadOverpayments({ silent: true })
            }
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
          >
            <RefreshCcw
              size={16}
              className={refreshing ? "animate-spin" : ""}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-6">
        <button
          onClick={() => setTab("register")}
          className={`relative inline-flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-semibold transition border-b-2 ${
            tab === "register"
              ? "border-ocean-600 text-ocean-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <ArrowDownToLine size={15} /> Daily Cash Register
        </button>
        <button
          onClick={() => setTab("overpayments")}
          className={`relative inline-flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-semibold transition border-b-2 ${
            tab === "overpayments"
              ? "border-amber-600 text-amber-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Coins size={15} /> Overpayments
        </button>
      </div>

      {tab === "register" && (
        <>
          {/* Date window + quick picks */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wide font-semibold text-slate-500 mb-1">
                From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-ocean-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide font-semibold text-slate-500 mb-1">
                To
              </label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                min={from}
                className="px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-ocean-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-1.5 ml-auto">
              {[
                { label: "Today", from: today(), to: today() },
                { label: "Yesterday", from: daysAgo(1), to: daysAgo(1) },
                { label: "Last 7d", from: daysAgo(6), to: today() },
                { label: "Last 30d", from: daysAgo(29), to: today() },
              ].map((quick) => (
                <button
                  key={quick.label}
                  onClick={() => {
                    setFrom(quick.from);
                    setTo(quick.to);
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                    from === quick.from && to === quick.to
                      ? "bg-ocean-100 text-ocean-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {quick.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-500">
              Loading transactions…
            </div>
          ) : !data ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-500">
              Couldn't load data.
            </div>
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
                    Window total
                  </p>
                  <p className="text-2xl font-extrabold text-ocean-700 mt-0.5">
                    {fmt2(data.totals.gross)}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {data.totals.count} transaction
                    {data.totals.count !== 1 ? "s" : ""} between{" "}
                    {fmtDate(data.from)} and {fmtDate(data.to)}
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

              {/* Transactions table */}
              {data.transactions.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
                  <ArrowDownToLine
                    size={42}
                    className="text-slate-300 mx-auto mb-3"
                  />
                  <h3 className="text-lg font-bold text-slate-700">
                    No transactions in this window
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Pick a wider date range, or check Today / Yesterday quick
                    picks above.
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="overflow-auto max-h-[calc(100vh-460px)]">
                    <table className="w-full whitespace-nowrap text-sm">
                      <thead className="bg-slate-50 border-b-2 border-slate-200 sticky top-0 z-10">
                        <tr className="text-left text-xs font-semibold text-slate-600 uppercase">
                          <th className="px-4 py-3">Txn</th>
                          <th className="px-4 py-3">Method</th>
                          <th className="px-4 py-3">Loan / Client</th>
                          <th className="px-4 py-3 text-right">Cash</th>
                          <th className="px-4 py-3 text-right">Penalty</th>
                          <th className="px-4 py-3 text-right">Principal</th>
                          <th className="px-4 py-3 text-right">Interest</th>
                          <th className="px-4 py-3 text-right">Overpaid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions.map((t) => {
                          const methKey = (
                            t.payment_method || "other"
                          ).toLowerCase();
                          const meta =
                            METHOD_META[methKey] || METHOD_META.other;
                          const cls = COLOR_CLS[meta.color];
                          return (
                            <tr
                              key={t.id}
                              className="border-b border-slate-100 hover:bg-slate-50 transition"
                            >
                              <td className="px-4 py-3">
                                <p className="font-mono text-xs font-bold text-slate-800">
                                  {t.transaction_code}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {fmtDate(t.payment_date)}{" "}
                                  {fmtTime(t.payment_date)}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cls.bg} ${cls.text}`}
                                >
                                  {meta.label}
                                </span>
                                {t.payment_reference && (
                                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                                    {t.payment_reference}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() =>
                                    navigate(`/loans/${t.loan_id}`)
                                  }
                                  className="font-mono text-xs font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
                                >
                                  {t.loan_code}{" "}
                                  <ArrowUpRight size={11} />
                                </button>
                                <p className="text-xs text-slate-700">
                                  {t.first_name} {t.last_name}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-ocean-700">
                                {fmt2(t.amount_paid)}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {parseFloat(t.penalty_portion) > 0 ? (
                                  <span className="text-rose-700 font-semibold">
                                    {fmt2(t.penalty_portion)}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-700">
                                {parseFloat(t.principal_portion) > 0
                                  ? fmt2(t.principal_portion)
                                  : "—"}
                              </td>
                              <td className="px-4 py-3 text-right text-emerald-700 font-semibold">
                                {parseFloat(t.interest_portion) > 0
                                  ? fmt2(t.interest_portion)
                                  : "—"}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {parseFloat(t.overpayment_portion) > 0 ? (
                                  <span className="text-amber-700 font-semibold">
                                    {fmt2(t.overpayment_portion)}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t-2 border-slate-200 sticky bottom-0">
                        <tr className="text-xs font-bold text-slate-700">
                          <td colSpan={3} className="px-4 py-3 uppercase">
                            Totals
                          </td>
                          <td className="px-4 py-3 text-right text-ocean-700">
                            {fmt2(data.totals.gross)}
                          </td>
                          <td className="px-4 py-3 text-right text-rose-700">
                            {fmt2(data.totals.penalty)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {fmt2(
                              data.transactions.reduce(
                                (s, t) =>
                                  s + parseFloat(t.principal_portion || 0),
                                0,
                              ),
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-emerald-700">
                            {fmt2(
                              data.transactions.reduce(
                                (s, t) =>
                                  s + parseFloat(t.interest_portion || 0),
                                0,
                              ),
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-amber-700">
                            {fmt2(data.totals.overpayment)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "overpayments" && (
        <>
          {loading ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center text-slate-500">
              Loading overpayments…
            </div>
          ) : !overpayments || overpayments.count === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
              <Coins size={42} className="text-emerald-400 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-700">
                No overpayments pending refund
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Loans flip to "pending refund" when the borrower pays past
                their balance.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="rounded-2xl shadow-sm border border-slate-100 bg-white p-5">
                  <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">
                    Pending Refunds
                  </p>
                  <p className="text-3xl font-bold text-navy-900 mt-2">
                    {overpayments.count}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    loan{overpayments.count !== 1 ? "s" : ""} on the book
                  </p>
                </div>
                <div className="rounded-2xl shadow-sm border border-slate-100 bg-white p-5">
                  <p className="text-xs uppercase tracking-wider font-semibold text-slate-500">
                    Total Pending
                  </p>
                  <p className="text-3xl font-bold text-amber-700 mt-2">
                    {fmt(overpayments.total_pending)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    refund owed to borrowers
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="overflow-auto max-h-[calc(100vh-360px)]">
                  <table className="w-full whitespace-nowrap text-sm">
                    <thead className="bg-slate-50 border-b-2 border-slate-200 sticky top-0 z-10">
                      <tr className="text-left text-xs font-semibold text-slate-600 uppercase">
                        <th className="px-4 py-3">Loan</th>
                        <th className="px-4 py-3">Client</th>
                        <th className="px-4 py-3 text-right">Principal</th>
                        <th className="px-4 py-3 text-right">Overpaid</th>
                        <th className="px-4 py-3">Since</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overpayments.loans.map((l) => (
                        <tr
                          key={l.id}
                          className="border-b border-slate-100 hover:bg-slate-50 transition"
                        >
                          <td className="px-4 py-3">
                            <button
                              onClick={() => navigate(`/loans/${l.id}`)}
                              className="font-mono text-xs font-bold text-ocean-600 hover:text-ocean-800 inline-flex items-center gap-1"
                            >
                              {l.loan_code}{" "}
                              <ArrowUpRight size={11} />
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-navy-900">
                              {l.first_name} {l.last_name}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono">
                              {l.client_code} · {l.phone_number}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {fmt(l.principal_amount)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-bold text-amber-700">
                              {fmt2(l.overpayment_amount)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {fmtDate(l.updated_at)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => navigate(`/loans/${l.id}`)}
                              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition"
                              title="Open the loan to mark this refund as paid"
                            >
                              Process Refund
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default Reconciliation;
