import React, { useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import api from "../services/api";
import Skeleton from "./Skeleton";
import { formatKES } from "../utils/money";

// Welfare Books of Accounts — Receipts & Payments, Income & Expenditure,
// Balance Sheet (Statement of Affairs) and Trial Balance, derived from the pool
// ledger. Source: GET /welfares/:id/reports/books → welfareBooksService.
// Books keep 2-dp accounting precision; delegate to the shared formatter.
const KES = (v) => formatKES(v, 2);

function Card({ title, note, children }) {
  return (
    <div className="bg-surface rounded-xl shadow-md border border-slate-100 dark:border-slate-700 overflow-hidden">
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

// `client`/`path` let the member portal point this at its own token + endpoint;
// the admin app uses the default api client + a welfare reports path.
export default function WelfareBooksPanel({ welfareId, client = api, path }) {
  const base = path || `/welfares/${welfareId}/reports/books`;
  const [year, setYear] = useState(""); // "" = all time
  const [b, setB] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const url = year ? `${base}${base.includes("?") ? "&" : "?"}year=${year}` : base;
    client.get(url).then((r) => setB(r.data.data)).catch((e) => setError(e.response?.data?.error || "Failed to load books")).finally(() => setLoading(false));
  }, [base, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const STATUS_LABEL = { active: "Active", completed: "Completed", defaulted: "Defaulted", pending: "Pending", rejected: "Rejected" };
  const yearsList = b?.period?.available_years || [];

  const picker = (
    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {b?.period?.label || "All time"} ·
        <span className="text-slate-400 dark:text-slate-400"> performance for the period; balance sheet as at period end</span>
      </p>
      <select value={year} onChange={(e) => setYear(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100">
        <option value="">All time</option>
        {yearsList.map((y) => <option key={y} value={y}>FY {y}</option>)}
      </select>
    </div>
  );

  if (loading && !b) return (
    <div>
      {picker}
      <div className="grid lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface rounded-xl shadow-md border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-900 px-5 py-3 border-b border-slate-100 dark:border-slate-700">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((__, j) => (
                <div key={j} className="flex items-center justify-between">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  if (error) return <div>{picker}<div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg flex items-center gap-2"><AlertTriangle size={16} /> {error}</div></div>;
  if (!b) return null;

  const rp = b.receipts_payments, ie = b.income_expenditure, bs = b.balance_sheet, tb = b.trial_balance, pf = b.loan_portfolio;

  return (
    <>
      {picker}
      <div className={`grid lg:grid-cols-2 gap-6 ${loading ? "opacity-50" : ""}`}>
      <Card title="Receipts & Payments" note="Cash book of the savings pool">
        {b.period.year && <Row label="Opening balance b/f" value={KES(rp.opening_balance)} />}
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-1 mb-1">Receipts</p>
        {rp.receipts.map((r) => <Row key={r.label} label={r.label} value={KES(r.amount)} indent />)}
        <Row label="Total receipts" value={KES(rp.total_receipts)} bold />
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-3 mb-1">Payments</p>
        {rp.payments.map((r) => <Row key={r.label} label={r.label} value={KES(r.amount)} indent />)}
        <Row label="Total payments" value={KES(rp.total_payments)} bold />
        <Row label="Closing pool balance" value={KES(rp.closing_balance)} bold tone="text-emerald-700" />
      </Card>

      <Card title="Income & Expenditure" note="A chama is mutual — surplus, not profit">
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-1 mb-1">Income</p>
        <Row label="Loan interest" value={KES(ie.income.loan_interest)} indent />
        <Row label="Fines / penalties" value={KES(ie.income.fines)} indent />
        <Row label="Total income" value={KES(ie.income.total)} bold />
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-3 mb-1">Expenditure</p>
        <Row label="Expenses" value={KES(ie.expenditure.expenses)} indent />
        <Row label="Surplus for the period" value={KES(ie.surplus)} bold tone={ie.surplus < 0 ? "text-rose-600" : "text-emerald-700"} />
        <Row label="Less: dividends distributed" value={KES(-ie.dividends_appropriated)} indent tone="text-slate-500 dark:text-slate-400" />
        <Row label="Accumulated surplus" value={KES(ie.accumulated_surplus)} bold />
      </Card>

      <Card title="Balance Sheet" note="Statement of affairs">
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-1 mb-1">Assets</p>
        <Row label="Pool cash" value={KES(bs.assets.pool_cash)} indent />
        <Row label="Member loans receivable" value={KES(bs.assets.member_loans_receivable)} indent />
        <Row label="Benefit / events fund" value={KES(bs.assets.benefit_fund_cash)} indent />
        <Row label="Total assets" value={KES(bs.assets.total)} bold />
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wide mt-3 mb-1">Members' funds</p>
        <Row label="Members' savings" value={KES(bs.members_funds.members_savings)} indent />
        <Row label="Accumulated surplus" value={KES(bs.members_funds.accumulated_surplus)} indent />
        <Row label="Benefit / events fund" value={KES(bs.members_funds.benefit_fund)} indent />
        <Row label="Total" value={KES(bs.members_funds.total)} bold />
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

      {Object.keys(pf.by_status).length > 0 && (
        <Card title="Member Loan Portfolio">
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
          </div>
        </Card>
      )}
      </div>
    </>
  );
}
