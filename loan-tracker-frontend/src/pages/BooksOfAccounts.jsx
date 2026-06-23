import React, { useState, useEffect } from "react";
import { BookOpen, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";
import { formatKES } from "../utils/money";

// Books of Accounts (lender) — the statutory statements derived from the
// existing ledgers (capital pool, loans, transactions, expenses, waivers).
// Source: GET /api/books → services/lenderBooksService. Everything ties:
// assets = financed-by, trial-balance debits = credits.
const KES = (v) => formatKES(v, 2);

function Card({ title, children, note }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 overflow-hidden">
      <div className="bg-slate-50 dark:bg-slate-900 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
        <h2 className="font-bold text-slate-900 dark:text-slate-100">{title}</h2>
        {note && <p className="text-xs text-slate-400 dark:text-slate-400 mt-0.5">{note}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
const Row = ({ label, value, bold, indent, tone }) => (
  <div className={`flex items-center justify-between py-1.5 ${bold ? "font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 mt-1 pt-2" : "text-slate-600 dark:text-slate-400"}`}>
    <span className={indent ? "pl-4" : ""}>{label}</span>
    <span className={`tabular-nums ${tone || (bold ? "text-slate-900 dark:text-slate-100" : "text-slate-800 dark:text-slate-100")}`}>{value}</span>
  </div>
);

export default function BooksOfAccounts() {
  const [b, setB] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/books").then((r) => setB(r.data.data)).catch((e) => setError(e.response?.data?.error || "Failed to load books")).finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <PageHeader
          icon={BookOpen}
          title="Books of Accounts"
          subtitle="Derived from your ledgers on a cash basis — every statement reconciles with the Capital position."
        />
        <div className="grid lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 overflow-hidden"
            >
              <div className="bg-slate-50 dark:bg-slate-900 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
                <Skeleton className="h-5 w-40" />
              </div>
              <div className="p-5 space-y-3">
                {Array.from({ length: 5 }).map((__, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  if (error) return <div className="p-4 lg:p-8 max-w-5xl mx-auto"><div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg flex items-center gap-2"><AlertTriangle size={16} /> {error}</div></div>;
  if (!b) return null;

  const inc = b.income_statement, bs = b.balance_sheet, tb = b.trial_balance, cap = b.capital, pf = b.portfolio;
  const STATUS_LABEL = { active: "Active", completed: "Completed", defaulted: "Defaulted", under_review: "Under review", approved: "Approved", rejected: "Rejected" };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <PageHeader
        icon={BookOpen}
        title="Books of Accounts"
        subtitle="Derived from your ledgers on a cash basis — every statement reconciles with the Capital position."
      />

      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="Statement of Capital" note="Receipts & payments of the lending pool">
          <Row label="Opening capital" value={KES(cap.opening_capital)} />
          <Row label="Add: principal collected" value={KES(cap.principal_collected)} indent />
          <Row label="Add: interest, fees & fines earned" value={KES(cap.income_earned)} indent />
          <Row label="Less: principal disbursed" value={KES(-cap.principal_disbursed)} indent tone="text-rose-600" />
          <Row label="Less: operating expenses" value={KES(-cap.operating_expenses)} indent tone="text-rose-600" />
          <Row label="Available capital" value={KES(cap.available_capital)} bold />
        </Card>

        <Card title="Income Statement" note="Cash basis">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-1 mb-1">Income</p>
          <Row label="Loan interest earned" value={KES(inc.income.loan_interest)} indent />
          <Row label="Penalties / fines collected" value={KES(inc.income.penalties)} indent />
          <Row label="Processing fees" value={KES(inc.income.processing_fees)} indent />
          {inc.income.other !== 0 && <Row label="Other income" value={KES(inc.income.other)} indent />}
          <Row label="Total income" value={KES(inc.income.total)} bold />
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-3 mb-1">Expenditure</p>
          <Row label="Operating expenses" value={KES(inc.expenses.operating)} indent />
          <Row label="Bad debts written off" value={KES(inc.expenses.bad_debts_written_off)} indent />
          <Row label="Total expenditure" value={KES(inc.expenses.total)} bold />
          <Row label="Net profit" value={KES(inc.net_profit)} bold tone={inc.net_profit < 0 ? "text-rose-600" : "text-emerald-700"} />
        </Card>

        <Card title="Balance Sheet">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-1 mb-1">Assets</p>
          <Row label="Cash / available capital" value={KES(bs.assets.cash_available_capital)} indent />
          <Row label="Loans receivable" value={KES(bs.assets.loans_receivable)} indent />
          <Row label="Total assets" value={KES(bs.assets.total)} bold />
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-3 mb-1">Financed by</p>
          <Row label="Owner's capital" value={KES(bs.financed_by.owners_capital)} indent />
          <Row label="Retained earnings" value={KES(bs.financed_by.retained_earnings)} indent />
          <Row label="Total" value={KES(bs.financed_by.total)} bold />
        </Card>

        <Card title="Trial Balance">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-sm">
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase">Account</span>
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase text-right">Debit</span>
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase text-right">Credit</span>
            {tb.debits.map((d) => (<React.Fragment key={d.account}><span className="text-slate-600 dark:text-slate-400 py-1">{d.account}</span><span className="tabular-nums text-right py-1">{KES(d.amount)}</span><span className="py-1" /></React.Fragment>))}
            {tb.credits.map((c) => (<React.Fragment key={c.account}><span className="text-slate-600 dark:text-slate-400 py-1">{c.account}</span><span className="py-1" /><span className="tabular-nums text-right py-1">{KES(c.amount)}</span></React.Fragment>))}
            <span className="font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 pt-2">Totals</span>
            <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-right border-t border-slate-200 dark:border-slate-700 pt-2">{KES(tb.debit_total)}</span>
            <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-right border-t border-slate-200 dark:border-slate-700 pt-2">{KES(tb.credit_total)}</span>
          </div>
        </Card>

        <Card title="Loan Portfolio" note={`Portfolio at risk (PAR): ${pf.par_pct}%`}>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-sm">
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase">Status</span>
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase text-right">Loans</span>
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase text-right">Outstanding</span>
            {Object.entries(pf.by_status).map(([s, v]) => (
              <React.Fragment key={s}>
                <span className="text-slate-600 dark:text-slate-400 py-1">{STATUS_LABEL[s] || s}</span>
                <span className="tabular-nums text-right py-1">{v.count}</span>
                <span className="tabular-nums text-right py-1">{KES(v.outstanding)}</span>
              </React.Fragment>
            ))}
            <span className="font-bold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-slate-700 pt-2">Total outstanding</span>
            <span className="border-t border-slate-200 dark:border-slate-700 pt-2" />
            <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-right border-t border-slate-200 dark:border-slate-700 pt-2">{KES(pf.total_outstanding)}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
