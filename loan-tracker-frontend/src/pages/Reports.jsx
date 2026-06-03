// Reports & Exports — combined page. The KPI block at the top is the
// historical Reports view; the Excel-download tiles below it absorbed
// what used to live on the separate Exports page.
//
// KPI data comes from /api/analytics/tenant; row-level exports come
// from /api/reports/export/{clients,loans,overdue,payments}.

import React, { useState, useEffect } from "react";
import {
  BarChart3,
  Coins,
  FileText,
  Users,
  AlertTriangle,
  XCircle,
  Wallet,
  Gavel,
  Download,
  Calendar,
  Lightbulb,
  DollarSign,
  CheckCircle,
  TrendingUp,
  Clock,
  Eye,
  Receipt,
  ArrowUpDown,
  Banknote,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Line,
  ComposedChart,
} from "recharts";
import api from "../services/api";
import PeriodNavigator, {
  periodToRange,
  periodLabel,
  usePersistentPeriod,
} from "../components/PeriodNavigator";

const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const fmtK = (n) => {
  const v = parseFloat(n) || 0;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}K`;
  return `${v}`;
};

// Last calendar day of a YYYY-MM value, as "YYYY-MM-DD".
const monthEnd = (ym) => {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  return new Date(y, m, 0).toISOString().split("T")[0];
};
const monthStart = (ym) => `${ym}-01`;
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  return new Date(y, m - 1, 1).toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });
};

const today = () => new Date().toISOString().split("T")[0];

function Reports() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Unified time control — Month or Year, persisted across pages.
  const [period, setPeriod] = usePersistentPeriod();
  // Some legacy code paths (snapshot tiles, exports) check this string.
  const mode = period.mode === "year" ? "year" : "month";
  const [exporting, setExporting] = useState(null);

  // Row-export filter state — each export card has its own range so
  // they can be configured independently.
  const [clientsRange, setClientsRange] = useState({ from: "", to: "" });
  const [loansFilters, setLoansFilters] = useState({
    status: "all",
    from: "",
    to: "",
  });
  const [paymentsRange, setPaymentsRange] = useState({ from: "", to: today() });
  const [rowExporting, setRowExporting] = useState(null);

  const downloadRowExport = async (kind) => {
    setRowExporting(kind);
    try {
      const url = (() => {
        const qs = new URLSearchParams();
        if (kind === "clients") {
          if (clientsRange.from) qs.set("date_from", clientsRange.from);
          if (clientsRange.to) qs.set("date_to", clientsRange.to);
          return `/reports/export/clients${qs.toString() ? `?${qs}` : ""}`;
        }
        if (kind === "loans") {
          if (loansFilters.status !== "all") qs.set("status", loansFilters.status);
          if (loansFilters.from) qs.set("date_from", loansFilters.from);
          if (loansFilters.to) qs.set("date_to", loansFilters.to);
          return `/reports/export/loans${qs.toString() ? `?${qs}` : ""}`;
        }
        if (kind === "overdue") return "/reports/export/overdue";
        if (kind === "payments") {
          if (paymentsRange.from) qs.set("date_from", paymentsRange.from);
          if (paymentsRange.to) qs.set("date_to", paymentsRange.to);
          return `/reports/export/payments${qs.toString() ? `?${qs}` : ""}`;
        }
      })();
      const res = await api.get(url, { responseType: "blob" });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = blobUrl;
      const slug =
        kind === "loans" && loansFilters.status !== "all"
          ? `${loansFilters.status}_loans`
          : kind;
      a.download = `${slug}_${today()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert("Download failed: " + (err.response?.data?.error || err.message));
    } finally {
      setRowExporting(null);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.mode, period.value]);

  // Build the from/to/months query string from the current period.
  // Year mode sends from/to spanning Jan 1 → Dec 31; month mode sends
  // from/to spanning the first/last day. Backend infers daily vs
  // monthly chart granularity from the window width.
  const buildQuery = () => {
    const { from, to } = periodToRange(period);
    return `from=${from}&to=${to}`;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/analytics/tenant?${buildQuery()}`);
      setData(res.data.data);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async (format) => {
    setExporting(format);
    try {
      const res = await api.get(
        `/analytics/export/${format}?${buildQuery()}`,
        { responseType: "blob" },
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `portfolio-report-${period.value}.${format === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + (err.response?.data?.error || err.message));
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">Loading analytics…</div>
    );
  }
  if (!data) return null;

  const { kpis, par, snapshot, expenseStats, cashFlow,
          collectionTrend, disbursementTrend } = data;

  // Merge the disbursement + collection time series on month so we can
  // render them in one chart. Both series share the "month" key from
  // analyticsService (e.g. "Mar 2026" or "12 Mar" in daily mode), so a
  // map-by-month merge produces clean rows. Missing values default to
  // zero — the absent series just renders as a flat bar that month.
  const disbursedVsCollected = (() => {
    const byMonth = new Map();
    (disbursementTrend || []).forEach((d) => {
      byMonth.set(d.month, { month: d.month, disbursed: d.disbursed || 0, collected: 0 });
    });
    (collectionTrend || []).forEach((c) => {
      const existing = byMonth.get(c.month) || { month: c.month, disbursed: 0, collected: 0 };
      existing.collected = c.collected || 0;
      byMonth.set(c.month, existing);
    });
    return Array.from(byMonth.values());
  })();

  const expensesWindow = parseFloat(expenseStats?.total_in_window || 0);
  // Income = interest portion of payments + fines + processing fees
  // retained at disbursement (cash-side counters only).
  // Net Profit = income − expenses − principal_written_off. The cash-
  // flow lens: a waiver's income share is already absent from the
  // cash counters above (borrower paid less, those ticked less), so
  // re-subtracting waivers_applied would double-count. The only real
  // economic loss not already in lower cash income is the principal
  // share of amount_due waivers — that's principal_written_off_by_ratio,
  // computed in analyticsService against the contract ratio. waivers_*
  // are still shown on the report for transparency but don't move the
  // bottom line a second time.
  const processingFeesWindow = parseFloat(kpis.processing_fees) || 0;
  const waiversWindow = parseFloat(kpis.waivers_applied) || 0;
  const waiversCount = parseInt(kpis.waivers_count, 10) || 0;
  const waiversInterest = parseFloat(kpis.waivers_interest) || 0;
  const waiversPenalty = parseFloat(kpis.waivers_penalty) || 0;
  const waiversPrincipal = parseFloat(kpis.waivers_principal) || 0;
  const principalWrittenOff =
    parseFloat(kpis.principal_written_off_by_ratio) || 0;
  const incomeWindow =
    (parseFloat(kpis.interest_earned) || 0) +
    (parseFloat(kpis.fines_collected) || 0) +
    processingFeesWindow;
  const netProfitWindow = incomeWindow - expensesWindow - principalWrittenOff;
  const snap = snapshot || {
    outstanding_balance: 0,
    overdue_count: 0,
    overdue_amount: 0,
    overdue_loans: 0,
    defaulted_count: 0,
    defaulted_amount: 0,
  };
  const parPct = parseFloat(par.par_percentage);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
              <BarChart3 size={28} /> Reports &amp; Exports
            </h1>
            <p className="text-gray-600 mt-1">
              Performance for {periodLabel(period)} · download data for analysis
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <PeriodNavigator value={period} onChange={setPeriod} />
            <button
              onClick={() => exportReport("pdf")}
              disabled={exporting !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              {exporting === "pdf" ? "…" : <><FileText size={15} /> PDF</>}
            </button>
            <button
              onClick={() => exportReport("excel")}
              disabled={exporting !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
            >
              {exporting === "excel" ? "…" : <><BarChart3 size={15} /> Excel</>}
            </button>
          </div>
        </div>

        {/* Portfolio Performance hero — investor-view summary of the
            selected window: how much capital was deployed, what it
            cost to run, and what was left over. ROI = net profit ÷
            invested so it reflects the bottom-line yield, not just
            gross income. */}
        {(() => {
          const invested = parseFloat(kpis.total_disbursed) || 0;
          const roiPct =
            invested > 0
              ? ((netProfitWindow / invested) * 100).toFixed(1)
              : "0.0";
          const periodSubtitle = periodLabel(period);
          return (
            <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-6 mb-6 bg-gradient-to-br from-ocean-100/70 via-white/55 to-indigo-100/60 backdrop-blur-md">
              {/* Soft auroras behind the frosted glass, matching the
                  Capital Pool card on the Dashboard. */}
              <div className="pointer-events-none absolute -top-20 -right-12 w-64 h-64 rounded-full bg-ocean-300/30 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -left-16 w-64 h-64 rounded-full bg-indigo-300/25 blur-3xl" />

              <div className="relative flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-ocean-400 to-indigo-500 flex items-center justify-center shadow-sm">
                    <TrendingUp size={22} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-navy-900">
                      Portfolio Performance
                    </h2>
                    <p className="text-xs text-slate-500">
                      {periodSubtitle} · capital out vs profit back
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="rounded-xl border border-white/70 bg-white/55 p-4 backdrop-blur-sm">
                  <p className="text-xs uppercase font-semibold tracking-wide text-slate-500">
                    Amount Invested
                  </p>
                  <p className="text-2xl lg:text-3xl font-extrabold text-navy-900 mt-1 break-words">
                    {fmt(invested)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {kpis.total_loans} loan
                    {kpis.total_loans !== 1 ? "s" : ""} disbursed
                  </p>
                </div>

                {/* ── Net Profit group: Expenses + Waivers are the two
                    deductions feeding the bottom-line Net Profit on the
                    right. Container border + gradient swing emerald
                    when profit is positive, rose when it dips
                    negative — matches the Income frame's pattern. */}
                <div
                  className={`col-span-2 lg:col-span-3 rounded-xl border-2 p-3 ${
                    netProfitWindow >= 0
                      ? "border-emerald-200/70 bg-gradient-to-br from-emerald-50/60 via-white/55 to-emerald-100/40"
                      : "border-rose-200/70 bg-gradient-to-br from-rose-50/60 via-white/55 to-rose-100/40"
                  } backdrop-blur-sm`}
                >
                  <div className="flex items-center justify-between mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center ring-1 ${
                          netProfitWindow >= 0
                            ? "bg-emerald-100 ring-emerald-200"
                            : "bg-rose-100 ring-rose-200"
                        }`}
                      >
                        <ArrowUpDown
                          size={16}
                          className={
                            netProfitWindow >= 0
                              ? "text-emerald-700"
                              : "text-rose-700"
                          }
                        />
                      </div>
                      <div>
                        <p
                          className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${
                            netProfitWindow >= 0
                              ? "text-emerald-700"
                              : "text-rose-700"
                          }`}
                        >
                          Net Profit
                        </p>
                        <p className="text-xs text-slate-500">
                          income − expenses − principal write-off
                        </p>
                      </div>
                    </div>
                    <p
                      className={`text-2xl lg:text-3xl font-extrabold break-words leading-none ${
                        netProfitWindow >= 0
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }`}
                    >
                      {netProfitWindow >= 0 ? "+" : ""}
                      {fmt(netProfitWindow)}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div
                      className={`bg-white rounded-lg border p-3 ${
                        netProfitWindow >= 0
                          ? "border-emerald-100/80"
                          : "border-rose-100/80"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                        Expenses
                      </p>
                      <p className="text-lg lg:text-xl font-extrabold text-amber-700 mt-0.5 break-words">
                        −{fmt(expensesWindow)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {expenseStats?.count_in_window || 0} entries
                      </p>
                    </div>
                    {/* Principal Write-off — the ACTUAL second
                        subtraction from Income. Cash interest waivers
                        are already missing from cash income (so
                        re-subtracting them double-counts), but the
                        principal share of those waivers — money you
                        lent that won't come back — is a real cash
                        loss not captured anywhere else. By contract
                        ratio: Σ (waiver.amount_total × principal /
                        total_amount_due). For Paul: 3,000 × 5/11 =
                        1,364. Without this tile the arithmetic
                        "Income − Expenses − Waivers" doesn't add up
                        to Net Profit. */}
                    <div
                      className={`bg-white rounded-lg border p-3 ${
                        netProfitWindow >= 0
                          ? "border-emerald-100/80"
                          : "border-rose-100/80"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                        Principal Write-off
                      </p>
                      <p className="text-lg lg:text-xl font-extrabold text-rose-700 mt-0.5 break-words">
                        −{fmt(principalWrittenOff)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        principal share of waivers
                      </p>
                    </div>
                    {/* Waivers — informational. Interest waivers are
                        already reflected in lower cash interest
                        (Income side ticks up less), and penalty
                        waivers were never cash income to begin with,
                        so neither moves Net Profit by itself. Kept
                        here as a record of what was forgiven. */}
                    <div
                      className={`bg-white rounded-lg border border-dashed p-3 ${
                        netProfitWindow >= 0
                          ? "border-emerald-200/60"
                          : "border-rose-200/60"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                        Waivers <span className="lowercase italic font-normal text-slate-400">(info)</span>
                      </p>
                      <p className="text-lg lg:text-xl font-extrabold text-fuchsia-700 mt-0.5 break-words">
                        −{fmt(waiversWindow)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {waiversCount} waiver
                        {waiversCount !== 1 ? "s" : ""} applied
                      </p>
                      {/* Breakdown by waiver type — visible only when
                          there's something to break down. Sky for
                          interest waivers, rose for penalty, slate
                          for legacy/principal rows. */}
                      {waiversWindow > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {waiversInterest > 0 && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[10px] font-semibold"
                              title="Sum of interest portions waived"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                              Interest {fmt(waiversInterest)}
                            </span>
                          )}
                          {waiversPenalty > 0 && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 text-[10px] font-semibold"
                              title="Sum of penalty / fines waived"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              Penalty {fmt(waiversPenalty)}
                            </span>
                          )}
                          {waiversPrincipal > 0 && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold"
                              title="Historical principal waivers (no longer accepted at request time)"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                              Principal {fmt(waiversPrincipal)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/70 bg-white/55 p-4 backdrop-blur-sm">
                  <p className="text-xs uppercase font-semibold tracking-wide text-slate-500">
                    ROI
                  </p>
                  <p className="text-2xl lg:text-3xl font-extrabold text-ocean-700 mt-1">
                    {roiPct}%
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    net profit ÷ invested
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* KPI cards — clean white tile with a tinted icon-square in the
            top-left, brand-coloured icon inside. Identity comes from the
            icon, not the card body, so the row reads calmly. Period-
            filtered tiles always show; snapshot tiles (Outstanding /
            PAR / Overdue / Defaulted) describe today's state and hide
            in specific-month mode. */}
        {/* Row 1 — Total Disbursed · Collected · Income container
            (the three income components share an emerald-bordered
            group with their summed Income reading at the top). */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-3">
              <DollarSign size={20} className="text-blue-600" />
            </div>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
              Total Disbursed
            </p>
            <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
              {fmt(kpis.total_disbursed)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {kpis.total_loans} loans
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center mb-3">
              <CheckCircle size={20} className="text-emerald-600" />
            </div>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
              Collected
            </p>
            <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
              {fmt(kpis.total_collected)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {kpis.payment_count} payments
            </p>
          </div>

          {/* ── Income group: emerald border, gradient header showing
              the summed Income at a glance, three pastel breakdown
              tiles beneath. Spans 3 columns so it visually anchors
              the right half of the row. */}
          <div className="col-span-2 lg:col-span-3 rounded-2xl border-2 border-emerald-200/70 bg-gradient-to-br from-emerald-50/40 via-white to-emerald-50/30 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 ring-1 ring-emerald-200 flex items-center justify-center">
                  <TrendingUp size={16} className="text-emerald-700" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700 font-semibold">
                    Income
                  </p>
                  <p className="text-xs text-gray-500">
                    interest + fines + fees
                  </p>
                </div>
              </div>
              <p className="text-2xl lg:text-3xl font-extrabold text-emerald-700 break-words leading-none">
                +{fmt(incomeWindow)}
              </p>
            </div>
            {(() => {
              // Interest + Fines tile breakdowns are informational —
              // Initial shows what was on the books contractually,
              // Waived shows what the admin chose to forgive. Both
              // use admin-declared waiver buckets (waivers_interest /
              // waivers_penalty) so the numbers match what the admin
              // typed into the Waive modal. The cash-headline value
              // is independent — it's the cash actually collected,
              // which won't equal Initial − Waived because cash
              // payments split principal vs interest by ratio and
              // admin-declared waivers don't.
              const interestCash = parseFloat(kpis.interest_earned) || 0;
              const finesCash = parseFloat(kpis.fines_collected) || 0;
              // "Contract" = lifetime contractual interest on loans
              // disbursed in this period (SUM(l.total_interest)).
              // It's a property of the LOAN, not the WINDOW — so on
              // a single-month view this routinely dwarfs the
              // headline cash interest. The label was "Initial"
              // which read as "expected this period" and confused
              // users (April 2022 PAY: headline 500, "Initial"
              // 86,733). Same shape for fines: accrued so far on
              // these loans.
              const initialInterest =
                parseFloat(kpis.total_interest_expected) || 0;
              const initialFines = finesCash + waiversPenalty;
              return (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white rounded-xl border border-emerald-100/80 p-3.5">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                      Interest from Loans
                    </p>
                    <p className="text-base lg:text-lg font-bold text-gray-900 mt-0.5 break-words">
                      {fmt(interestCash)}
                    </p>
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5 text-[11px]">
                      <div
                        className="flex justify-between text-gray-500"
                        title="Total lifetime contractual interest on loans disbursed in this period — a property of the loans, not of this window."
                      >
                        <span>Contract</span>
                        <span className="font-semibold text-gray-700">
                          {fmt(initialInterest)}
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>Waived</span>
                        <span className="font-semibold text-fuchsia-700">
                          {waiversInterest > 0 ? "−" : ""}
                          {fmt(waiversInterest)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-emerald-100/80 p-3.5">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                      Fines Collected
                    </p>
                    <p className="text-base lg:text-lg font-bold text-gray-900 mt-0.5 break-words">
                      {fmt(finesCash)}
                    </p>
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5 text-[11px]">
                      <div
                        className="flex justify-between text-gray-500"
                        title="Total late-fee + penalty interest accrued on these loans before any waivers."
                      >
                        <span>Accrued</span>
                        <span className="font-semibold text-gray-700">
                          {fmt(initialFines)}
                        </span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>Waived</span>
                        <span className="font-semibold text-fuchsia-700">
                          {waiversPenalty > 0 ? "−" : ""}
                          {fmt(waiversPenalty)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-emerald-100/80 p-3.5">
                    <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center mb-2">
                      <Banknote size={15} className="text-sky-600" />
                    </div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                      Processing Fees
                    </p>
                    <p className="text-base lg:text-lg font-bold text-gray-900 mt-0.5 break-words">
                      {fmt(processingFeesWindow)}
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Row 2 — Snapshot tiles. Use 4 cols on lg since the Income
            tile has merged into the row-1 income group above. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">

          {/* ── Snapshot tiles (today's state). Shown for every
              period — they describe outstanding balances right now,
              not the picked window, so hiding them when you pick a
              past year just made the layout look broken. */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mb-3">
                  <Clock size={20} className="text-amber-600" />
                </div>
                <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                  Receivable
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
                  {fmt(snap.outstanding_balance)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">to be collected</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                    parPct > 15
                      ? "bg-rose-50"
                      : parPct > 5
                        ? "bg-orange-50"
                        : "bg-teal-50"
                  }`}
                >
                  <Eye
                    size={20}
                    className={
                      parPct > 15
                        ? "text-rose-600"
                        : parPct > 5
                          ? "text-orange-600"
                          : "text-teal-600"
                    }
                  />
                </div>
                <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                  Portfolio at Risk
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900">
                  {par.par_percentage}%
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {par.at_risk_count} of {par.total_active} loans
                </p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center mb-3">
                  <AlertTriangle size={20} className="text-orange-600" />
                </div>
                <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                  Overdue
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
                  {fmt(snap.overdue_amount)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {snap.overdue_count} payment
                  {snap.overdue_count !== 1 ? "s" : ""}
                  {snap.overdue_loans > 0 && ` · ${snap.overdue_loans} loans`}
                </p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center mb-3">
                  <XCircle size={20} className="text-rose-600" />
                </div>
                <p className="text-xs uppercase font-semibold tracking-wide text-gray-500">
                  Defaulted
                </p>
                <p className="text-xl lg:text-2xl font-bold mt-1 text-gray-900 break-words">
                  {fmt(snap.defaulted_amount)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {snap.defaulted_count} loan
                  {snap.defaulted_count !== 1 ? "s" : ""}
                </p>
              </div>

          {/* Expenses + Net Profit moved up into the Portfolio
              Performance hero so the bottom-line story sits beside
              Amount Invested + ROI. */}
        </div>

        {/* ── Income vs Expenses monthly trend ──────────────────── */}
        {Array.isArray(cashFlow) && cashFlow.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <ArrowUpDown size={18} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">
                  Income vs Expenses
                </h3>
                <p className="text-xs text-gray-500">
                  What's coming in (interest + fines) versus going out
                  (operating expenses), month by month.
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={cashFlow}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#eef2f6"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmtK}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  formatter={(v, n) => [fmt(v), n]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="income"
                  name="Income"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="expenses"
                  name="Expenses"
                  fill="#d97706"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net"
                  stroke="#0086cc"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#0086cc" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Loans Disbursed vs Collections trend ──────────────── */}
        {/* Money-out (disbursements, principal lent) vs money-in
            (collections, cash received). The stakeholder view — were
            we lending faster than we collected this period? A line
            for the difference makes the gap pop, similar to the Net
            line on Income vs Expenses above. */}
        {disbursedVsCollected.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-ocean-50 flex items-center justify-center">
                <ArrowUpDown size={18} className="text-ocean-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">
                  Disbursed vs Collected
                </h3>
                <p className="text-xs text-gray-500">
                  Principal lent versus cash received, by period. The Net
                  line is collections minus disbursements — positive means
                  more came back than went out.
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={disbursedVsCollected.map((r) => ({
                  ...r,
                  net: (r.collected || 0) - (r.disbursed || 0),
                }))}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#eef2f6"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmtK}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  formatter={(v, n) => [fmt(v), n]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="disbursed"
                  name="Disbursed"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="collected"
                  name="Collected"
                  fill="#0086cc"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net (in − out)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#10b981" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Excel exports ────────────────────────────────────── */}
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2 mt-2">
          <Download size={22} /> Excel Exports
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Clients export — optional join-date window */}
          <div className="bg-white rounded-xl shadow-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Users size={18} className="text-ocean-600" /> Clients
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Full client list with totals borrowed and paid.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Joined from
                </label>
                <input
                  type="date"
                  value={clientsRange.from}
                  onChange={(e) =>
                    setClientsRange({ ...clientsRange, from: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Joined to
                </label>
                <input
                  type="date"
                  value={clientsRange.to}
                  onChange={(e) =>
                    setClientsRange({ ...clientsRange, to: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
            </div>
            <button
              onClick={() => downloadRowExport("clients")}
              disabled={rowExporting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              <Download size={16} />
              {rowExporting === "clients" ? "Downloading…" : "Download Clients"}
            </button>
          </div>

          {/* Loans export — status filter + optional disbursement window */}
          <div className="bg-white rounded-xl shadow-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Coins size={18} className="text-ocean-600" /> Loans
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Filter by status, narrow by disbursement date.
                </p>
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Status
              </label>
              <select
                value={loansFilters.status}
                onChange={(e) =>
                  setLoansFilters({ ...loansFilters, status: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white text-sm"
              >
                <option value="all">All loans</option>
                <option value="active">Active only</option>
                <option value="completed">Completed only</option>
                <option value="defaulted">Defaulted only</option>
                <option value="overdue">With overdue payments</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Disbursed from
                </label>
                <input
                  type="date"
                  value={loansFilters.from}
                  onChange={(e) =>
                    setLoansFilters({ ...loansFilters, from: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Disbursed to
                </label>
                <input
                  type="date"
                  value={loansFilters.to}
                  onChange={(e) =>
                    setLoansFilters({ ...loansFilters, to: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
            </div>
            <button
              onClick={() => downloadRowExport("loans")}
              disabled={rowExporting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              <Download size={16} />
              {rowExporting === "loans" ? "Downloading…" : "Download Loans"}
            </button>
          </div>

          {/* Payments export — date range */}
          <div className="bg-white rounded-xl shadow-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <Calendar size={18} className="text-green-600" /> Payments
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Every transaction recorded in a date window.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  From
                </label>
                <input
                  type="date"
                  value={paymentsRange.from}
                  onChange={(e) =>
                    setPaymentsRange({ ...paymentsRange, from: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  To
                </label>
                <input
                  type="date"
                  value={paymentsRange.to}
                  onChange={(e) =>
                    setPaymentsRange({ ...paymentsRange, to: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none text-sm"
                />
              </div>
            </div>
            <button
              onClick={() => downloadRowExport("payments")}
              disabled={rowExporting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              <Download size={16} />
              {rowExporting === "payments" ? "Downloading…" : "Download Payments"}
            </button>
          </div>

          {/* Overdue export — no filters needed */}
          <div className="bg-white rounded-xl shadow-md p-5 flex flex-col">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                  <AlertTriangle size={18} className="text-orange-600" />{" "}
                  Overdue Payments
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Every past-due installment with days late.
                </p>
              </div>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => downloadRowExport("overdue")}
              disabled={rowExporting !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              <Download size={16} />
              {rowExporting === "overdue" ? "Downloading…" : "Download Overdue"}
            </button>
          </div>
        </div>

        {/* About */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
            <Lightbulb size={18} /> About reports
          </h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>
              • The PDF / Excel buttons at the top export the portfolio summary
              for the period you've picked above.
            </li>
            <li>
              • The four cards below export raw rows — clients, loans, payments,
              and overdue installments — for accounting or further analysis.
            </li>
            <li>
              • PDF statements for an individual client or loan live on their
              respective detail pages.
            </li>
            <li>
              • Exports always reflect current data — regenerate any time.
            </li>
          </ul>
        </div>
    </div>
  );
}

export default Reports;
