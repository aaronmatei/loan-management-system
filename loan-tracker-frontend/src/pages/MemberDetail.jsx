import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PiggyBank, Plus, Minus, X, AlertTriangle, LogOut, FileDown, Smartphone, ChevronLeft, ChevronRight, ChevronDown, MoreHorizontal, UserCog } from "lucide-react";
import api from "../services/api";
import { downloadFile } from "../utils/bulkExport";
import { useWelfare } from "../context/WelfareContext";
import PermissionGate from "../components/PermissionGate";
import MemberLoansPanel from "../components/MemberLoansPanel";
import OfficerBadge from "../components/OfficerBadge";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";
import { formatKES } from "../utils/money";

const TYPE_LABEL = {
  contribution: "Contribution",
  withdrawal: "Withdrawal",
  dividend: "Dividend",
  adjustment: "Adjustment",
  loan_disbursed: "Loan disbursed",
  loan_repayment: "Loan repayment",
};

export default function MemberDetail() {
  const { memberId } = useParams();
  const { welfareId, welfare } = useWelfare();
  const navigate = useNavigate();
  const [member, setMember] = useState(null);
  const [savings, setSavings] = useState(0);
  const [txns, setTxns] = useState([]);
  const [poolBalance, setPoolBalance] = useState(0);
  const [activity, setActivity] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // 'contribution' | 'withdrawal'
  const [exiting, setExiting] = useState(false);
  const [portalLinked, setPortalLinked] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [exemptBusy, setExemptBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const base = `/welfares/${welfareId}/members`;

  // Mark a member exempt from contributions (sick/hardship) or lift it. Exempt
  // members are skipped from contribution dues + penalties but stay full
  // members. Uses the existing member-update endpoint.
  const toggleExempt = async () => {
    const turningOn = !member.contribution_exempt;
    let reason = member.exempt_reason || "";
    if (turningOn) {
      reason = window.prompt("Reason for exemption (e.g. Sick)", reason || "Sick");
      if (reason === null) return; // cancelled
    }
    setExemptBusy(true);
    try {
      await api.put(`${base}/${memberId}`, {
        contribution_exempt: turningOn,
        exempt_reason: turningOn ? reason : null,
      });
      await load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update exemption");
    } finally {
      setExemptBusy(false);
    }
  };

  // Officers are normally elected via decisions, but an admin can set a role
  // directly here. Assigning an officer role auto-demotes the prior holder.
  const changeRole = async (role) => {
    try {
      await api.put(`${base}/${memberId}/role`, { role });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to set role");
    }
  };

  const inviteToPortal = async () => {
    setInviting(true);
    try {
      const r = await api.post(`${base}/${memberId}/invite`, {});
      setPortalLinked(true);
      alert(
        r.data?.data?.already_linked
          ? "Invite re-sent — this member already has portal access."
          : "Invite sent. The member can now log in to the portal with their phone.",
      );
    } catch (err) {
      alert(err.response?.data?.error || "Failed to invite member");
    } finally {
      setInviting(false);
    }
  };

  const exitMember = async () => {
    if (!confirm("Close this membership? Their full savings will be paid out and they'll be deactivated. Outstanding loans/penalties must be cleared first.")) return;
    setExiting(true);
    try {
      const r = await api.post(`${base}/${memberId}/exit`, {});
      alert(`Member exited. Paid out ${formatKES(r.data.payout)}.`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to process exit");
    } finally {
      setExiting(false);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      const [r, p] = await Promise.all([api.get(`${base}/${memberId}`), api.get(`${base}/pool`)]);
      setMember(r.data.data.member);
      setSavings(r.data.data.savings_balance);
      setTxns(r.data.data.transactions || []);
      setPortalLinked(!!r.data.data.portal_linked);
      setPoolBalance(p.data?.data?.balance ?? 0);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load member");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId, memberId]);
  // Contributions / attendance / fines are scoped to the selected year.
  useEffect(() => {
    api.get(`${base}/${memberId}/activity?year=${year}`).then((a) => setActivity(a.data.data)).catch(() => {});
  }, [welfareId, memberId, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const money = (v) => formatKES(v);
  const fmt = (d) => new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <Skeleton className="h-5 w-32 mb-4" />
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-64 mt-3" />
          </div>
          <div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32 mt-2" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {[0, 1].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16 mt-2" />
            </div>
          ))}
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-5 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (error || !member) {
    return (
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error || "Member not found"}</div>
        <button onClick={() => navigate("/welfare/members")} className="px-6 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700">← Back to Welfare</button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto pb-24">
      <button onClick={() => navigate("/welfare/members")} className="mb-4 text-emerald-600 hover:text-emerald-800 font-semibold flex items-center gap-2">← Back to Welfare</button>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><PiggyBank className="text-emerald-600" /> {member.first_name} {member.last_name} <OfficerBadge role={member.role} /></h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            <span className="font-mono">{member.member_no}</span>
            {member.phone_number && <> · {member.phone_number}</>}
            {member.id_number && <> · ID {member.id_number}</>}
            {" · "}<span className="capitalize">{member.status}</span>
          </p>
          {member.contribution_exempt && (
            <span className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title="Skipped from contribution dues & penalties">
              <AlertTriangle size={11} /> Exempt from contributions{member.exempt_reason ? ` · ${member.exempt_reason}` : ""}
            </span>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500 dark:text-slate-400">Savings balance</p>
          <p className="text-2xl font-bold text-emerald-700">{money(savings)}</p>
          <button onClick={() => downloadFile(`/welfares/${welfareId}/reports/members/${memberId}/statement.pdf`, `${member.member_no}-statement.pdf`).catch(() => alert("Export failed."))} className="mt-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-semibold inline-flex items-center gap-1">
            <FileDown size={13} /> Statement PDF
          </button>
        </div>
      </div>

      {member.status === "inactive" ? (
        <div className="bg-slate-100 border border-slate-200 text-slate-600 px-4 py-3 rounded-lg mb-6 text-sm flex items-center gap-2">
          <LogOut size={15} /> This member has exited the welfare. Their account is read-only.
        </div>
      ) : (
        <PermissionGate role={["admin", "manager", "loan_officer"]}>
          <div className="flex flex-wrap gap-2 mb-6 items-center">
            {/* Primary money actions stay visible; everything else lives in the
                "More" menu to keep the header uncluttered. */}
            <button onClick={() => setModal("contribution")} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center gap-2"><Plus size={16} /> Contribution</button>
            <PermissionGate role={["admin", "manager"]}>
              <button onClick={() => setModal("withdrawal")} className="px-4 py-2 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg font-semibold inline-flex items-center gap-2"><Minus size={16} /> Withdrawal</button>

              <div className="relative ml-auto">
                <button onClick={() => setActionsOpen((o) => !o)} className="px-4 py-2 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg font-semibold inline-flex items-center gap-2">
                  <MoreHorizontal size={16} /> More <ChevronDown size={14} className={`transition ${actionsOpen ? "rotate-180" : ""}`} />
                </button>
                {actionsOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setActionsOpen(false)} />
                    <div className="absolute right-0 mt-2 z-20 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden p-2">
                      {/* Portal access */}
                      <button onClick={() => { inviteToPortal(); setActionsOpen(false); }} disabled={inviting} title={member.phone_number ? "" : "Add a phone number and ID first"} className="w-full text-left px-2.5 py-2.5 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 inline-flex items-center gap-3 disabled:opacity-50 transition group">
                        <span className="shrink-0 w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 inline-flex items-center justify-center"><Smartphone size={17} /></span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{inviting ? "Sending…" : portalLinked ? "Resend portal access" : "Invite to portal"}</span>
                          <span className="block text-xs text-slate-400 dark:text-slate-500">{portalLinked ? "Has access ✓" : "Send a login by SMS"}</span>
                        </span>
                      </button>
                      {/* Role — officers are usually elected, but an admin can set directly */}
                      <div className="px-2.5 py-2.5 rounded-xl inline-flex items-center gap-3 w-full">
                        <span className="shrink-0 w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 inline-flex items-center justify-center"><UserCog size={17} /></span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Role</span>
                          <span className="block text-xs text-slate-400 dark:text-slate-500">Officers are usually elected</span>
                        </span>
                        <select value={member.role || "member"} onClick={(e) => e.stopPropagation()} onChange={(e) => changeRole(e.target.value)} className="text-sm font-semibold bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 cursor-pointer focus:border-indigo-400 focus:outline-none">
                          <option value="member">Member</option>
                          <option value="chair">Chair</option>
                          <option value="treasurer">Treasurer</option>
                          <option value="secretary">Secretary</option>
                        </select>
                      </div>
                      {/* Exempt toggle */}
                      <button onClick={() => { toggleExempt(); setActionsOpen(false); }} disabled={exemptBusy} title="Sick/hardship: skip contribution dues & penalties while exempt" className="w-full text-left px-2.5 py-2.5 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20 inline-flex items-center gap-3 disabled:opacity-50 transition">
                        <span className="shrink-0 w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 inline-flex items-center justify-center"><AlertTriangle size={17} /></span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{exemptBusy ? "Saving…" : member.contribution_exempt ? "Remove exemption" : "Mark exempt"}</span>
                          <span className="block text-xs text-slate-400 dark:text-slate-500">Skip dues &amp; penalties (sick/hardship)</span>
                        </span>
                      </button>
                      <div className="border-t border-slate-100 dark:border-slate-700 my-1.5" />
                      {/* Destructive */}
                      <button onClick={() => { exitMember(); setActionsOpen(false); }} disabled={exiting} className="w-full text-left px-2.5 py-2.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-900/20 inline-flex items-center gap-3 disabled:opacity-50 transition">
                        <span className="shrink-0 w-9 h-9 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300 inline-flex items-center justify-center"><LogOut size={17} /></span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold text-rose-700 dark:text-rose-300">{exiting ? "Processing…" : "Exit member"}</span>
                          <span className="block text-xs text-rose-400/80 dark:text-rose-400/70">Remove from the welfare</span>
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </PermissionGate>
          </div>
        </PermissionGate>
      )}

      {activity && (
        <MemberActivity activity={activity} year={year} setYear={setYear} money={money} fmt={fmt}>
          {welfare?.loans_enabled && <MemberLoansPanel welfareId={welfareId} memberId={memberId} poolBalance={poolBalance} onChange={load} />}
        </MemberActivity>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700"><h2 className="font-bold text-slate-900 dark:text-slate-100">Activity</h2></div>
        {txns.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            tone="muted"
            className="shadow-none"
            title="No activity yet"
            description="Contributions, withdrawals and dividends will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-5 py-2">Date</th>
                  <th className="text-left px-5 py-2">Type</th>
                  <th className="text-right px-5 py-2">Amount</th>
                  <th className="text-right px-5 py-2">Pool balance</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((tx) => (
                  <tr key={tx.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-5 py-2 text-slate-600 dark:text-slate-400">{fmt(tx.txn_date)}</td>
                    <td className="px-5 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${tx.direction > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                        {TYPE_LABEL[tx.type] || tx.type}
                      </span>
                    </td>
                    <td className={`px-5 py-2 text-right font-semibold ${tx.direction > 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {tx.direction > 0 ? "+" : "−"}{money(tx.amount)}
                    </td>
                    <td className="px-5 py-2 text-right text-slate-700 dark:text-slate-200">{money(tx.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <TxnModal
          base={base}
          memberId={memberId}
          kind={modal}
          max={modal === "withdrawal" ? savings : null}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

const FINE_REASON = { contribution_late: "Late contribution", attendance_late: "Late to meeting", attendance_absent: "Absent", meeting_missed: "Absent", loan_late: "Late loan", manual: "Manual" };
const Section = ({ title, children }) => (
  <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md overflow-hidden mb-6">
    <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700"><h2 className="font-bold text-slate-900 dark:text-slate-100">{title}</h2></div>
    {children}
  </div>
);
const Empty = ({ children }) => <p className="p-5 text-sm text-slate-500 dark:text-slate-400">{children}</p>;
const ActTable = ({ head, children }) => (
  <div className="overflow-x-auto max-h-96 overflow-y-auto">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase sticky top-0"><tr>{head.map((h, i) => <th key={i} className={`px-5 py-2 ${i >= 2 && i < head.length - 1 ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
const pill = (cls, t) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{t}</span>;

// A member's contribution status, attendance score, and fines — scoped to a year.
// Loans (year-independent) render via children, just before Contributions.
function MemberActivity({ activity, year, setYear, money, fmt, children }) {
  const { contributions, fines, fines_outstanding, attendance } = activity;
  const STAT = "bg-white dark:bg-slate-800 rounded-xl shadow-md p-4";
  const ASTATUS = { present: "bg-emerald-100 text-emerald-800", late: "bg-amber-100 text-amber-800", excused: "bg-sky-100 text-sky-800", absent: "bg-red-100 text-red-700" };

  // Group the member's cycles into ONE card per contribution (Monthly, Quarterly,
  // each emergency) — no cumulative roll-up.
  const FREQ_LABEL = { weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
  const cards = []; const byKey = {};
  for (const c of contributions) {
    const key = c.plan_name || c.cycle_name;
    let g = byKey[key];
    if (!g) { g = byKey[key] = { name: key, frequency: c.frequency, oneoff: !c.frequency, cycles: 0, paidCount: 0, paid: 0, expected: 0 }; cards.push(g); }
    g.cycles++; if (c.status === "paid") g.paidCount++;
    g.paid += Number(c.amount_paid); g.expected += Number(c.amount_due);
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setYear((y) => y - 1)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"><ChevronLeft size={16} /></button>
        <span className="font-bold text-slate-800 dark:text-slate-100 w-16 text-center">{year}</span>
        <button onClick={() => setYear((y) => y + 1)} disabled={year >= new Date().getFullYear()} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-30"><ChevronRight size={16} /></button>
        <span className="text-xs text-slate-400 dark:text-slate-400 ml-1">contributions &amp; fines for {year}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className={STAT}><p className="text-xs text-slate-500 dark:text-slate-400">Attendance</p><p className="text-xl font-bold text-sky-700">{attendance.rate == null ? "—" : `${attendance.rate}%`}</p><p className="text-xs text-slate-500 dark:text-slate-400">{attendance.attended}/{attendance.recorded} meetings &amp; events · all-time</p></div>
        <div className={STAT}><p className="text-xs text-slate-500 dark:text-slate-400">Fines outstanding</p><p className={`text-xl font-bold ${fines_outstanding > 0 ? "text-rose-600" : "text-slate-700 dark:text-slate-200"}`}>{money(fines_outstanding)}</p><p className="text-xs text-slate-500 dark:text-slate-400">{fines.length} fine{fines.length === 1 ? "" : "s"} total</p></div>
      </div>

      {children}

      <div className="mb-6">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-3">Contributions</h2>
        {cards.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-xl shadow-md p-5">No contributions in {year}.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((g) => {
              const due = Math.max(0, g.expected - g.paid);
              const pct = g.expected > 0 ? Math.min(100, Math.round((g.paid / g.expected) * 100)) : 0;
              return (
                <div key={g.name} className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 dark:text-slate-100 truncate">{g.name}</span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold shrink-0">{g.oneoff ? "Emergency / one-off" : (FREQ_LABEL[g.frequency] || g.frequency)}</span>
                  </div>
                  <p className="text-lg font-bold text-emerald-700 mt-2">{money(g.paid)} <span className="text-xs font-normal text-slate-400 dark:text-slate-400">/ {money(g.expected)}</span></p>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-slate-500 dark:text-slate-400">{g.paidCount}/{g.cycles} {g.cycles === 1 ? "paid" : "cycles paid"}</span>
                    {due > 0 ? <span className="text-rose-600 font-semibold">{money(due)} due</span> : <span className="text-emerald-600 font-semibold">up to date</span>}
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full mt-2 overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Section title="Attendance — meetings &amp; events (all-time)">
        {attendance.meetings.length === 0 ? <Empty>No meetings yet.</Empty> : (
          <ActTable head={["Meeting / Event", "Date", "Status"]}>
            {attendance.meetings.map((m) => (
              <tr key={m.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-5 py-2 text-slate-800 dark:text-slate-100">{m.title || "—"} {m.is_event ? <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 align-middle">Event</span> : <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 align-middle">Meeting</span>}</td>
                <td className="px-5 py-2 text-slate-600 dark:text-slate-400">{fmt(m.meeting_date)}</td>
                <td className="px-5 py-2">{m.status ? pill(ASTATUS[m.status] || "bg-slate-100 text-slate-600", m.status) : <span className="text-xs text-slate-400 dark:text-slate-400">not recorded</span>}</td>
              </tr>
            ))}
          </ActTable>
        )}
      </Section>

      <Section title="Fines">
        {fines.length === 0 ? <Empty>No fines. 🎉</Empty> : (
          <ActTable head={["For", "Reason", "Amount", "Status"]}>
            {fines.map((f) => (
              <tr key={f.id} className="border-t border-slate-100 dark:border-slate-700">
                <td className="px-5 py-2"><span className="text-slate-700 dark:text-slate-200">{f.source_label || "—"}</span> {f.source_kind && <span className="text-xs text-slate-400 dark:text-slate-400">({f.source_kind})</span>}</td>
                <td className="px-5 py-2 text-slate-600 dark:text-slate-400">{FINE_REASON[f.trigger] || f.trigger}</td>
                <td className="px-5 py-2 text-right font-semibold">{money(f.amount)}</td>
                <td className="px-5 py-2">{pill(f.status === "paid" ? "bg-emerald-100 text-emerald-800" : f.status === "waived" ? "bg-slate-200 text-slate-600" : "bg-rose-100 text-rose-700", f.status)}</td>
              </tr>
            ))}
          </ActTable>
        )}
      </Section>
    </>
  );
}

function TxnModal({ base, memberId, kind, max, onClose, onDone }) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isContribution = kind === "contribution";
  const money = (v) => formatKES(v);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const amt = parseFloat(amount);
    if (!(amt > 0)) return setError("Enter an amount.");
    if (max != null && amt > max) return setError(`Only ${money(max)} available.`);
    setBusy(true);
    try {
      await api.post(`${base}/${memberId}/${isContribution ? "contributions" : "withdrawals"}`, { amount: amt, notes });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save.");
      setBusy(false);
    }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md my-12" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{isContribution ? "Record Contribution" : "Record Withdrawal"}</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
              Amount{max != null && <span className="text-gray-500 dark:text-slate-400 font-normal"> (max {money(max)})</span>}
            </label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={fld} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={fld} />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
            <button type="submit" disabled={busy} className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${isContribution ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-700 hover:bg-slate-800"}`}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
