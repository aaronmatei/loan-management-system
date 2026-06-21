import React, { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { FileDown, FileSpreadsheet, Save } from "lucide-react";
import { useWelfare } from "../../context/WelfareContext";
import { downloadFile } from "../../utils/bulkExport";
import api from "../../services/api";
import WelfareDashboardPanel from "../../components/WelfareDashboardPanel";
import OfficerBadge from "../../components/OfficerBadge";
import WelfareDocumentsPanel from "../../components/WelfareDocumentsPanel";
import WelfareDecisionsPanel from "../../components/WelfareDecisionsPanel";
import WelfareMembersPanel from "../../components/WelfareMembersPanel";
import WelfareContributionsPanel from "../../components/WelfareContributionsPanel";
import WelfarePenaltiesPanel from "../../components/WelfarePenaltiesPanel";
import WelfareMeetingsPanel from "../../components/WelfareMeetingsPanel";
import WelfareDividendsPanel from "../../components/WelfareDividendsPanel";
import WelfareExpensesPanel from "../../components/WelfareExpensesPanel";
import WelfareMpesaPanel from "../../components/WelfareMpesaPanel";
import WelfareSmsPanel from "../../components/WelfareSmsPanel";
import MemberLoanProductsPanel from "../../components/MemberLoanProductsPanel";
import WelfareLoansPanel from "../../components/WelfareLoansPanel";
import PermissionGate from "../../components/PermissionGate";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Standard page wrapper: the welfare name as a small kicker + the module title.
function Page({ title, children }) {
  const { welfare } = useWelfare();
  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto pb-24">
      <div className="mb-6">
        <p className="text-sm font-semibold text-emerald-600 uppercase tracking-wide">{welfare.name}</p>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function WelfareDashboardPage() {
  const { welfareId, welfare } = useWelfare();
  return <Page title="Dashboard"><WelfareDashboardPanel welfareId={welfareId} showLoans={!!welfare?.loans_enabled} /></Page>;
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
  return <Page title="Decisions"><WelfareDecisionsPanel client={api} path={`/welfares/${welfareId}/decisions`} admin /></Page>;
}
export function WelfareEventsPage() {
  const { welfareId } = useWelfare();
  // Benefit contributions (Quarterly, emergencies) — collect into a pool that
  // pays out to a member beneficiary.
  return <Page title="Events & Emergencies"><WelfareContributionsPanel welfareId={welfareId} kind="benefit" /></Page>;
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
      <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Member statements</h2>
          <div className="flex gap-2">
            <button onClick={() => doExport("pdf")} disabled={!!busy} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"><FileDown size={14} /> {busy === "pdf" ? "…" : "Statement PDF"}</button>
            <button onClick={() => doExport("csv")} disabled={!!busy} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"><FileSpreadsheet size={14} /> {busy === "csv" ? "…" : "Members CSV"}</button>
          </div>
        </div>
        <div className="p-5">
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-sm text-slate-500">No members yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
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
                    <tr key={m.member_id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-800">{m.name} <span className="text-slate-400 font-mono text-xs">{m.member_no}</span> <OfficerBadge role={m.role} className="ml-1" />{m.status === "inactive" && <span className="ml-1 text-xs text-slate-400">(exited)</span>}</td>
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

  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <Page title="Settings">
      <div className="bg-white rounded-xl shadow-md border border-slate-100 p-6 max-w-2xl">
        <h2 className="font-bold text-slate-900 mb-1">Contribution & grace defaults</h2>
        <p className="text-sm text-slate-500 mb-5">These pre-fill new contribution cycles and set the grace before late penalties accrue.</p>
        {!form ? <p className="text-sm text-slate-500">Loading…</p> : (
          <PermissionGate role={["admin", "manager"]} fallback={<p className="text-sm text-slate-500">You don't have permission to edit settings.</p>}>
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
    <div className="bg-white rounded-xl shadow-md border border-slate-100 p-6 max-w-2xl mt-6">
      <h2 className="font-bold text-slate-900 mb-1">Loans</h2>
      <p className="text-sm text-slate-500 mb-5">
        Turn the chama's loan feature on or off. When OFF, everything about loans is hidden from
        admins and members and no new loans can be created. When ON, choose who you lend to below.
      </p>
      <PermissionGate role={["admin", "manager"]} fallback={<p className="text-sm text-slate-500">You don't have permission to edit this.</p>}>
        <div className="flex items-center gap-3">
          <button type="button" disabled={busy} onClick={() => toggle(!on)} aria-pressed={on}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-600" : "bg-slate-300"}`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
          </button>
          <span className="text-sm font-semibold text-slate-700">{busy ? "Saving…" : on ? "Loans are ON" : "Loans are OFF"}</span>
        </div>
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
    <div className="bg-white rounded-xl shadow-md border border-slate-100 p-6 max-w-2xl mt-6">
      <h2 className="font-bold text-slate-900 mb-1">Lending to non-members</h2>
      <p className="text-sm text-slate-500 mb-5">
        Most chamas lend only to their own members. Turn this on if you also lend
        to outsiders — your welfare will then appear to borrowers in the public
        lender directory so they can request a loan.
      </p>
      {enabled === null ? <p className="text-sm text-slate-500">Loading…</p> : (
        <PermissionGate role={["admin", "manager"]} fallback={<p className="text-sm text-slate-500">You don't have permission to edit this.</p>}>
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
            <span className="text-sm font-semibold text-slate-700">{enabled ? "Lending to non-members is ON" : "Members only"}</span>
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

  const act = async (kind, id, action) => {
    let body = {};
    if (kind === "loans" && action === "approve") {
      const rate = window.prompt("Interest rate % (annual, flat) for this loan:", "12");
      if (rate === null) return;
      body.interest_rate = rate;
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
    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="font-semibold text-slate-800">{r.first_name} {r.last_name} <span className="font-mono text-xs text-slate-400">{r.member_no}</span></p>
        <p className="text-sm text-slate-500">{money(amount)}{extra ? ` · ${extra}` : ""}</p>
      </div>
      <PermissionGate role={["admin", "manager"]}>
        <div className="flex gap-2">
          <button disabled={busy === `${kind}-${r.id}`} onClick={() => act(kind, r.id, "approve")} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Approve</button>
          <button disabled={busy === `${kind}-${r.id}`} onClick={() => act(kind, r.id, "reject")} className="px-3 py-1.5 bg-white border-2 border-rose-200 text-rose-700 hover:bg-rose-50 rounded-lg text-sm font-semibold disabled:opacity-50">Reject</button>
        </div>
      </PermissionGate>
    </div>
  );

  return (
    <Page title="Requests">
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="space-y-6 max-w-3xl">
          {welfare?.loans_enabled && (
            <div className="bg-white rounded-xl shadow-md border border-slate-100">
              <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">Loan requests ({loans.length})</h2></div>
              {loans.length === 0 ? <p className="px-5 py-8 text-center text-slate-500">No pending loan requests.</p> :
                loans.map((r) => <Row key={r.id} kind="loans" r={r} amount={r.principal} extra={`${r.duration_months} mo${r.purpose ? ` · ${r.purpose}` : ""}`} />)}
            </div>
          )}
          <div className="bg-white rounded-xl shadow-md border border-slate-100">
            <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">Withdrawal requests ({withdrawals.length})</h2></div>
            {withdrawals.length === 0 ? <p className="px-5 py-8 text-center text-slate-500">No pending withdrawal requests.</p> :
              withdrawals.map((r) => <Row key={r.id} kind="withdrawals" r={r} amount={r.amount} extra={r.reason} />)}
          </div>
          <div className="bg-white rounded-xl shadow-md border border-slate-100">
            <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">Event requests ({events.length})</h2></div>
            {events.length === 0 ? <p className="px-5 py-8 text-center text-slate-500">No pending event requests.</p> :
              events.map((r) => <Row key={r.id} kind="events" r={r} amount={r.amount} extra={[r.event_date ? `needed ${new Date(r.event_date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}` : null, r.reason].filter(Boolean).join(" · ")} />)}
          </div>
        </div>
      )}
    </Page>
  );
}
