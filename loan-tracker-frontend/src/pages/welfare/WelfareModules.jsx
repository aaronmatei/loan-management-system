import React, { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { FileDown, FileSpreadsheet, Save, Inbox } from "lucide-react";
import { useWelfare } from "../../context/WelfareContext";
import { downloadFile } from "../../utils/bulkExport";
import api from "../../services/api";
import WelfareDashboardPanel from "../../components/WelfareDashboardPanel";
import OfficerBadge from "../../components/OfficerBadge";
import WelfareDocumentsPanel from "../../components/WelfareDocumentsPanel";
import WelfareDecisionsPanel from "../../components/WelfareDecisionsPanel";
import WelfareBooksPanel from "../../components/WelfareBooksPanel";
import WelfareMembersPanel from "../../components/WelfareMembersPanel";
import WelfareContributionsPanel from "../../components/WelfareContributionsPanel";
import WelfarePenaltiesPanel from "../../components/WelfarePenaltiesPanel";
import WelfareMeetingsPanel from "../../components/WelfareMeetingsPanel";
import WelfareDividendsPanel from "../../components/WelfareDividendsPanel";
import WelfareExpensesPanel from "../../components/WelfareExpensesPanel";
import WelfareAuditPanel from "../../components/WelfareAuditPanel";
import WelfareMpesaPanel from "../../components/WelfareMpesaPanel";
import WelfareSmsPanel from "../../components/WelfareSmsPanel";
import MemberLoanProductsPanel from "../../components/MemberLoanProductsPanel";
import WelfareLoansPanel from "../../components/WelfareLoansPanel";
import PermissionGate from "../../components/PermissionGate";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";
import Skeleton from "../../components/Skeleton";
import { formatKES } from "../../utils/money";

// Welfare module figures keep 2-dp precision; delegate to the shared formatter.
const money = (v) => formatKES(v, 2);

// Standard page wrapper. Every welfare module page leads with the welfare's
// own name (in brand colour); the module title is carried by the panel/section
// header below, so we don't repeat it as a big page title. `title` is accepted
// for clarity at call sites but not rendered.
function Page({ children }) {
  const { welfare } = useWelfare();
  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <PageHeader title={<span className="text-ocean-600 dark:text-ocean-300">{welfare?.name || "Welfare"}</span>} />
      {children}
    </div>
  );
}

export function WelfareDashboardPage() {
  const { welfareId, welfare } = useWelfare();
  return <Page title="Dashboard"><WelfareDashboardPanel welfareId={welfareId} showLoans={!!welfare?.loans_enabled} manage linkBase="/welfare" /></Page>;
}
export function WelfareMembersPage() {
  const { welfareId } = useWelfare();
  return <Page title="Members & Pool"><WelfareMembersPanel welfareId={welfareId} /></Page>;
}
export function WelfareContributionsPage() {
  const { welfareId } = useWelfare();
  return <Page title="Contributions"><WelfareContributionsPanel welfareId={welfareId} kind="savings" /></Page>;
}
export function WelfareDocumentsPage() {
  const { welfareId } = useWelfare();
  return <Page title="Documents"><WelfareDocumentsPanel client={api} path={`/welfares/${welfareId}/documents`} admin /></Page>;
}
export function WelfareDecisionsPage() {
  const { welfareId } = useWelfare();
  return <Page title="Decisions"><WelfareDecisionsPanel client={api} path={`/welfares/${welfareId}/decisions`} membersPath={`/welfares/${welfareId}/members`} admin /></Page>;
}
export function WelfareBooksPage() {
  const { welfareId } = useWelfare();
  return <Page title="Books of Accounts"><WelfareBooksPanel welfareId={welfareId} /></Page>;
}
export function WelfareEventsPage() {
  const { welfareId } = useWelfare();
  // Recurring benefit pools (e.g. Quarterly dowry) — members contribute, the
  // pool pays a lump sum to each beneficiary.
  return <Page title="Events"><WelfareContributionsPanel welfareId={welfareId} kind="benefit" benefitView="events" /></Page>;
}
export function WelfareEmergenciesPage() {
  const { welfareId } = useWelfare();
  // One-off emergency collections that pay out to a member in need.
  return <Page title="Emergencies"><WelfareContributionsPanel welfareId={welfareId} kind="benefit" benefitView="emergencies" /></Page>;
}
export function WelfareLoansPage() {
  const { welfareId, welfare } = useWelfare();
  if (!welfare?.loans_enabled) return <Navigate to="/welfare" replace />; // loans off → no loans page
  return <Page title="Loans"><WelfareLoansPanel welfareId={welfareId} /></Page>;
}
export function WelfarePenaltiesPage() {
  const { welfareId } = useWelfare();
  return <Page title="Penalties"><WelfarePenaltiesPanel welfareId={welfareId} /></Page>;
}
export function WelfareMeetingsPage() {
  const { welfareId } = useWelfare();
  return <Page title="Meetings & Attendance"><WelfareMeetingsPanel welfareId={welfareId} /></Page>;
}
export function WelfareDividendsPage() {
  const { welfareId } = useWelfare();
  return <Page title="Dividends & Share-out"><WelfareDividendsPanel welfareId={welfareId} /></Page>;
}
export function WelfareExpensesPage() {
  const { welfareId } = useWelfare();
  return <Page title="Expenses"><WelfareExpensesPanel welfareId={welfareId} /></Page>;
}
export function WelfareAuditPage() {
  const { welfareId } = useWelfare();
  return <Page title="Audit log"><WelfareAuditPanel welfareId={welfareId} /></Page>;
}
export function WelfareMpesaPage() {
  const { welfareId } = useWelfare();
  return <Page title="M-Pesa"><WelfareMpesaPanel welfareId={welfareId} /></Page>;
}
export function WelfareSmsPage() {
  const { welfareId } = useWelfare();
  return <Page title="SMS"><WelfareSmsPanel welfareId={welfareId} /></Page>;
}

// Reports — per-member statement table + group/CSV/PDF exports.
export function WelfareReportsPage() {
  const { welfareId } = useWelfare();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api.get(`/welfares/${welfareId}/reports/members?include=all`).then((r) => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [welfareId]);

  const doExport = async (kind) => {
    setBusy(kind);
    try {
      if (kind === "pdf") await downloadFile(`/welfares/${welfareId}/reports/statement.pdf?include=all`, "group-statement.pdf");
      else await downloadFile(`/welfares/${welfareId}/reports/members.csv?include=all`, "members.csv");
    } catch { alert("Export failed."); } finally { setBusy(""); }
  };

  return (
    <Page title="Reports & Statements">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Member statements</h2>
          <div className="flex gap-2">
            <button onClick={() => doExport("pdf")} disabled={!!busy} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"><FileDown size={14} /> {busy === "pdf" ? "…" : "Statement PDF"}</button>
            <button onClick={() => doExport("csv")} disabled={!!busy} className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"><FileSpreadsheet size={14} /> {busy === "csv" ? "…" : "Members CSV"}</button>
          </div>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                  <Skeleton className="h-4 w-40" />
                  <div className="flex gap-6">
                    {Array.from({ length: 6 }).map((__, j) => <Skeleton key={j} className="h-4 w-16" />)}
                  </div>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileDown}
              title="No members yet"
              description="Member statements appear here once people join this welfare. Add members to start building their savings, contributions and loan history."
              tone="muted"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Member</th>
                    <th className="text-right px-3 py-2">Savings</th>
                    <th className="text-right px-3 py-2">Contributions</th>
                    <th className="text-right px-3 py-2">Dividends</th>
                    <th className="text-right px-3 py-2">Loan bal</th>
                    <th className="text-right px-3 py-2">Penalty bal</th>
                    <th className="text-right px-3 py-2">Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.member_id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{m.name} <span className="text-slate-400 dark:text-slate-400 font-mono text-xs">{m.member_no}</span> <OfficerBadge role={m.role} className="ml-1" />{m.status === "inactive" && <span className="ml-1 text-xs text-slate-400 dark:text-slate-400">(exited)</span>}</td>
                      <td className="px-3 py-2 text-right">{money(m.savings)}</td>
                      <td className="px-3 py-2 text-right">{money(m.contributions)}</td>
                      <td className="px-3 py-2 text-right">{money(m.dividends)}</td>
                      <td className="px-3 py-2 text-right">{money(m.loan_outstanding)}</td>
                      <td className="px-3 py-2 text-right">{money(m.penalty_outstanding)}</td>
                      <td className="px-3 py-2 text-right">{m.attendance_pct == null ? "—" : `${m.attendance_pct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

// Settings — the welfare's contribution defaults + grace periods.
export function WelfareSettingsPage() {
  const { welfareId, welfare } = useWelfare();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loansOn, setLoansOn] = useState(!!welfare?.loans_enabled);

  useEffect(() => {
    api.get(`/welfares/${welfareId}/settings`).then((r) => {
      const s = r.data?.data || {};
      setForm({
        contribution_frequency: s.contribution_frequency || "monthly",
        contribution_amount: s.contribution_amount ?? "",
        contribution_grace_days: s.contribution_grace_days ?? 0,
        attendance_grace_minutes: s.attendance_grace_minutes ?? 0,
      });
    }).catch(() => setForm({ contribution_frequency: "monthly", contribution_amount: "", contribution_grace_days: 0, attendance_grace_minutes: 0 }));
  }, [welfareId]);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.put(`/welfares/${welfareId}/settings`, form); setSaved(true); }
    catch (err) { alert(err.response?.data?.error || "Failed to save"); }
    finally { setBusy(false); }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  return (
    <Page title="Settings">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-6 max-w-2xl">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-1">Contribution & grace defaults</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">These pre-fill new contribution cycles and set the grace before late penalties accrue.</p>
        {!form ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <PermissionGate role={["admin", "manager"]} fallback={<p className="text-sm text-slate-500 dark:text-slate-400">You don't have permission to edit settings.</p>}>
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Default frequency</label>
                  <select value={form.contribution_frequency} onChange={set("contribution_frequency")} className={fld}>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div><label className={lbl}>Default amount (KES)</label><input type="number" value={form.contribution_amount} onChange={set("contribution_amount")} className={fld} /></div>
                <div><label className={lbl}>Contribution grace (days)</label><input type="number" min="0" value={form.contribution_grace_days} onChange={set("contribution_grace_days")} className={fld} /></div>
                <div><label className={lbl}>Attendance grace (minutes)</label><input type="number" min="0" value={form.attendance_grace_minutes} onChange={set("attendance_grace_minutes")} className={fld} /></div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50 inline-flex items-center gap-2"><Save size={16} /> {busy ? "Saving…" : "Save settings"}</button>
                {saved && <span className="text-sm text-emerald-600 font-semibold">Saved.</span>}
              </div>
            </form>
          </PermissionGate>
        )}
      </div>
      <LoansSwitchCard welfareId={welfareId} on={loansOn} onChange={setLoansOn} />
      {loansOn && (
        <>
          <NonMemberLendingCard />
          <LoanPolicyCard welfareId={welfareId} />
          <MemberLoanProductsPanel welfareId={welfareId} />
        </>
      )}
    </Page>
  );
}

// Whether this welfare extends loans to non-members. When on, the welfare shows
// up to outside borrowers in the customer lender directory (and is addable);
// when off it stays members-only and stays hidden. Tenant-scoped, so it uses
// the singular /welfare endpoint rather than /welfares/:id.
// Master "Loans" switch. Off → all loan UI is hidden (admin + member) and loan
// writes are refused. On → reveals the lending-scope switch + loan products.
function LoansSwitchCard({ welfareId, on, onChange }) {
  const [busy, setBusy] = useState(false);
  const toggle = async (next) => {
    setBusy(true);
    try {
      await api.put(`/welfares/${welfareId}/settings/loans`, { enabled: next });
      onChange(next);
      // Reload so the nav, route guards and member portal all reflect the
      // change immediately (the welfare context is fetched once at mount).
      window.location.reload();
    } catch (err) { alert(err.response?.data?.error || "Failed to save"); setBusy(false); }
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-6 max-w-2xl mt-6">
      <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-1">Loans</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
        Turn the chama's loan feature on or off. When OFF, everything about loans is hidden from
        admins and members and no new loans can be created. When ON, choose who you lend to below.
      </p>
      <PermissionGate role={["admin", "manager"]} fallback={<p className="text-sm text-slate-500 dark:text-slate-400">You don't have permission to edit this.</p>}>
        <div className="flex items-center gap-3">
          <button type="button" disabled={busy} onClick={() => toggle(!on)} aria-pressed={on}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-600" : "bg-slate-300"}`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
          </button>
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{busy ? "Saving…" : on ? "Loans are ON" : "Loans are OFF"}</span>
        </div>
      </PermissionGate>
    </div>
  );
}

// Default loan terms for the chama (mirrors the lender's Loan Policy). Pre-fills
// every new loan / loan product; per-loan and per-product values still override.
function LoanPolicyCard({ welfareId }) {
  const [p, setP] = useState({ default_loan_interest_rate: "", monthly: "", default_loan_interest_method: "flat", default_loan_processing_fee_rate: "", default_loan_late_fee: "", default_loan_penalty_rate: "" });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const round4 = (n) => Math.round(n * 10000) / 10000;

  useEffect(() => {
    api.get(`/welfares/${welfareId}/settings`).then((r) => {
      const d = r.data?.data || {};
      const annual = d.default_loan_interest_rate ?? "";
      setP({
        default_loan_interest_rate: annual,
        monthly: annual === "" ? "" : round4(annual / 12),
        default_loan_interest_method: d.default_loan_interest_method || "flat",
        default_loan_processing_fee_rate: d.default_loan_processing_fee_rate ?? "",
        default_loan_late_fee: d.default_loan_late_fee ?? "",
        default_loan_penalty_rate: d.default_loan_penalty_rate ?? "",
      });
    }).catch(() => {});
  }, [welfareId]);

  const onAnnual = (v) => setP((s) => ({ ...s, default_loan_interest_rate: v, monthly: v === "" ? "" : round4(parseFloat(v) / 12) }));
  const onMonthly = (v) => setP((s) => ({ ...s, monthly: v, default_loan_interest_rate: v === "" ? "" : round4(parseFloat(v) * 12) }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setSaved(false);
    try {
      await api.put(`/welfares/${welfareId}/settings/loan-policy`, {
        default_loan_interest_rate: p.default_loan_interest_rate,
        default_loan_interest_method: p.default_loan_interest_method,
        default_loan_processing_fee_rate: p.default_loan_processing_fee_rate,
        default_loan_late_fee: p.default_loan_late_fee,
        default_loan_penalty_rate: p.default_loan_penalty_rate,
      });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (err) { alert(err.response?.data?.error || "Failed to save"); } finally { setBusy(false); }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-6 max-w-2xl mt-6">
      <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-1">Loan policy</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Default terms applied to every new loan and loan product. You can still override them per loan. The processing fee is deducted from what the borrower receives — they repay the full principal plus interest.</p>
      <PermissionGate role={["admin", "manager"]} fallback={<p className="text-sm text-slate-500 dark:text-slate-400">You don't have permission to edit this.</p>}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className={lbl}>Annual interest rate (%)</label><input type="number" min="0" step="0.01" value={p.default_loan_interest_rate} onChange={(e) => onAnnual(e.target.value)} className={fld} /><p className="text-xs text-gray-500 dark:text-slate-400 mt-1">e.g. 24 = 24% p.a.</p></div>
            <div><label className={lbl}>Monthly interest rate (%)</label><input type="number" min="0" step="0.01" value={p.monthly} onChange={(e) => onMonthly(e.target.value)} className={fld} /><p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Syncs with annual (÷ 12).</p></div>
            <div><label className={lbl}>Interest method</label><select value={p.default_loan_interest_method} onChange={(e) => setP({ ...p, default_loan_interest_method: e.target.value })} className={fld}><option value="flat">Flat</option><option value="reducing">Reducing balance</option></select></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className={lbl}>Processing fee (%)</label><input type="number" min="0" max="100" step="0.01" value={p.default_loan_processing_fee_rate} onChange={(e) => setP({ ...p, default_loan_processing_fee_rate: e.target.value })} className={fld} /><p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Deducted upfront (0 = none).</p></div>
            <div><label className={lbl}>Late fee (KES)</label><input type="number" min="0" step="1" value={p.default_loan_late_fee} onChange={(e) => setP({ ...p, default_loan_late_fee: e.target.value })} className={fld} /><p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Flat fee on a missed instalment.</p></div>
            <div><label className={lbl}>Penalty rate (%)</label><input type="number" min="0" step="0.001" value={p.default_loan_penalty_rate} onChange={(e) => setP({ ...p, default_loan_penalty_rate: e.target.value })} className={fld} /><p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Per period on overdue balance.</p></div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save loan policy"}</button>
            {saved && <span className="text-sm text-emerald-700 font-semibold">Saved ✓</span>}
          </div>
        </form>
      </PermissionGate>
    </div>
  );
}

function NonMemberLendingCard() {
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get(`/welfare/lending`)
      .then((r) => setEnabled(!!r.data?.data?.lends_to_non_members))
      .catch(() => setEnabled(false));
  }, []);

  const toggle = async (next) => {
    setBusy(true);
    setSaved(false);
    try {
      const r = await api.put(`/welfare/lending`, { lends_to_non_members: next });
      setEnabled(!!r.data?.data?.lends_to_non_members);
      setSaved(true);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-6 max-w-2xl mt-6">
      <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-1">Lending to non-members</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
        Most chamas lend only to their own members. Turn this on if you also lend
        to outsiders — your welfare will then appear to borrowers in the public
        lender directory so they can request a loan.
      </p>
      {enabled === null ? (
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-12 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : (
        <PermissionGate role={["admin", "manager"]} fallback={<p className="text-sm text-slate-500 dark:text-slate-400">You don't have permission to edit this.</p>}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => toggle(!enabled)}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? "bg-emerald-600" : "bg-slate-300"}`}
              aria-pressed={enabled}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{enabled ? "Lending to non-members is ON" : "Members only"}</span>
            {saved && <span className="text-sm text-emerald-600 font-semibold">Saved.</span>}
          </div>
        </PermissionGate>
      )}
    </div>
  );
}

// Requests — members ask for loans from the pool or savings withdrawals; an
// admin/manager approves or rejects. Approval runs the same pool logic as the
// direct issue/withdrawal flows.
export function WelfareRequestsPage() {
  const { welfareId, welfare } = useWelfare();
  const [loans, setLoans] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const base = `/welfares/${welfareId}/requests`;
  const load = async () => {
    setLoading(true);
    try {
      const [l, w, e] = await Promise.all([
        api.get(`${base}/loans?status=pending`),
        api.get(`${base}/withdrawals?status=pending`),
        api.get(`${base}/events?status=pending`),
      ]);
      setLoans(l.data.data || []);
      setWithdrawals(w.data.data || []);
      setEvents(e.data.data || []);
    } catch {
      /* surfaced as empty */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [welfareId]);

  const act = async (kind, r, action) => {
    const id = r.id;
    let body = {};
    if (kind === "loans" && action === "approve") {
      // The rate was captured when the member applied — use it. Only ask as a
      // fallback if the request somehow carries no rate (e.g. a no-package
      // request when the chama had set no default policy).
      if (r.interest_rate != null && r.interest_rate !== "") {
        body.interest_rate = r.interest_rate;
      } else {
        const rate = window.prompt("This request has no interest rate. Enter one % (annual) to approve:", "12");
        if (rate === null) return;
        body.interest_rate = rate;
      }
    }
    if (action === "reject") {
      const notes = window.prompt("Reason (optional):", "");
      if (notes === null) return;
      body.notes = notes;
    }
    setBusy(`${kind}-${id}`);
    try {
      await api.post(`${base}/${kind}/${id}/${action}`, body);
      load();
    } catch (e) {
      alert(e.response?.data?.error || "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const Row = ({ kind, r, amount, extra }) => (
    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <div>
        <p className="font-semibold text-slate-800 dark:text-slate-100">{r.first_name} {r.last_name} <span className="font-mono text-xs text-slate-400 dark:text-slate-400">{r.member_no}</span></p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{money(amount)}{extra ? ` · ${extra}` : ""}</p>
      </div>
      <PermissionGate role={["admin", "manager"]}>
        <div className="flex gap-2">
          <button disabled={busy === `${kind}-${r.id}`} onClick={() => act(kind, r, "approve")} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Approve</button>
          <button disabled={busy === `${kind}-${r.id}`} onClick={() => act(kind, r, "reject")} className="px-3 py-1.5 bg-white dark:bg-slate-800 border-2 border-rose-200 text-rose-700 hover:bg-rose-50 rounded-lg text-sm font-semibold disabled:opacity-50">Reject</button>
        </div>
      </PermissionGate>
    </div>
  );

  return (
    <Page title="Requests">
      {loading ? (
        <div className="space-y-6 max-w-3xl">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700"><Skeleton className="h-4 w-44" /></div>
              {Array.from({ length: 2 }).map((__, j) => (
                <div key={j} className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
                  <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
                  <Skeleton className="h-8 w-32" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          {welfare?.loans_enabled && (
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700"><h2 className="font-bold text-slate-900 dark:text-slate-100">Loan requests ({loans.length})</h2></div>
              {loans.length === 0 ? <div className="p-5"><EmptyState icon={Inbox} title="No pending loan requests" description="When a member asks for a loan from the pool, it lands here for an officer to approve or reject." tone="muted" /></div> :
                loans.map((r) => <Row key={r.id} kind="loans" r={r} amount={r.principal} extra={[
                  `${r.duration_months} mo`,
                  r.interest_rate != null && r.interest_rate !== "" ? `${Number(r.interest_rate)}% p.a. (${(Number(r.interest_rate) / 12).toFixed(2)}%/mo) ${r.interest_method || "flat"}` : "rate set on approval",
                  r.purpose || null,
                  r.collateral_description ? `collateral: ${r.collateral_description}` : null,
                ].filter(Boolean).join(" · ")} />)}
            </div>
          )}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700"><h2 className="font-bold text-slate-900 dark:text-slate-100">Withdrawal requests ({withdrawals.length})</h2></div>
            {withdrawals.length === 0 ? <div className="p-5"><EmptyState icon={Inbox} title="No pending withdrawal requests" description="Members' savings-withdrawal requests appear here for an officer to approve or reject." tone="muted" /></div> :
              withdrawals.map((r) => <Row key={r.id} kind="withdrawals" r={r} amount={r.amount} extra={r.reason} />)}
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700"><h2 className="font-bold text-slate-900 dark:text-slate-100">Event requests ({events.length})</h2></div>
            {events.length === 0 ? <div className="p-5"><EmptyState icon={Inbox} title="No pending event requests" description="Members' event and emergency payout requests appear here for an officer to approve or reject." tone="muted" /></div> :
              events.map((r) => <Row key={r.id} kind="events" r={r} amount={r.amount} extra={[r.event_date ? `needed ${new Date(r.event_date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}` : null, r.reason].filter(Boolean).join(" · ")} />)}
          </div>
        </div>
      )}
    </Page>
  );
}
