// Welfare/chama MEMBER self-service pages. Shown when the selected portal tenant
// is a welfare (PortalLayout swaps to the member menu). All data comes from
// /api/welfare/member/* (scoped to the logged-in member by the backend).
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PiggyBank, Coins, Wallet, CalendarCheck, Gift, AlertTriangle, ArrowRight, Plus, X, HeartHandshake, ClipboardList, FileText, Vote, LayoutDashboard, BookOpen, Users, ChevronRight,
} from "lucide-react";
import portalApi from "../../services/portalApi";
import PortalLayout from "../../components/PortalLayout";
import Skeleton from "../../../components/Skeleton";
import { computeLoanTotals } from "../../../utils/loanMath";
import WelfareDashboardPanel from "../../../components/WelfareDashboardPanel";
import OfficerBadge from "../../../components/OfficerBadge";
import WelfareDocumentsPanel from "../../../components/WelfareDocumentsPanel";
import WelfareDecisionsPanel from "../../../components/WelfareDecisionsPanel";
import WelfareBooksPanel from "../../../components/WelfareBooksPanel";
import WelfareContributionsPanel from "../../../components/WelfareContributionsPanel";
import WelfareMeetingsPanel from "../../../components/WelfareMeetingsPanel";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

const BADGE = {
  active: "bg-emerald-100 text-emerald-700", completed: "bg-ocean-100 text-ocean-700",
  defaulted: "bg-rose-100 text-rose-700", pending: "bg-amber-100 text-amber-700",
  partial: "bg-amber-100 text-amber-700", overdue: "bg-rose-100 text-rose-700",
  paid: "bg-emerald-100 text-emerald-700", outstanding: "bg-rose-100 text-rose-700",
  waived: "bg-slate-100 text-slate-600", present: "bg-emerald-100 text-emerald-700",
  late: "bg-amber-100 text-amber-700", absent: "bg-rose-100 text-rose-700",
  excused: "bg-slate-100 text-slate-600", scheduled: "bg-ocean-100 text-ocean-700", held: "bg-emerald-100 text-emerald-700",
};
const Badge = ({ value }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${BADGE[value] || "bg-slate-100 text-slate-600"}`}>
    {value || "—"}
  </span>
);

// Generic fetch wrapper — keeps each page tiny. Exposes reload() so a pay action
// can refresh the list once the payment lands.
function useFetch(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    portalApi.get(path)
      .then((r) => on && setData(r.data.data))
      .catch((e) => on && setError(e.response?.data?.error || "Failed to load"))
      .finally(() => on && setLoading(false));
    return () => { on = false; };
  }, [path, tick]);
  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

// STK pay button. Kicks off the member STK, then polls the member's M-Pesa log
// until this target is allocated (or a timeout), refreshing the page on success.
const PAY = {
  contribution: { url: "/welfare/member/mpesa/contribution", key: "schedule_id", type: "contribution_schedule" },
  loan: { url: "/welfare/member/mpesa/loan-repayment", key: "loan_id", type: "member_loan" },
  penalty: { url: "/welfare/member/mpesa/penalty", key: "assessment_id", type: "penalty_assessment" },
  event: { url: "/welfare/member/mpesa/event-share", key: "share_id", type: "welfare_event_share" },
};
function PayButton({ kind, targetId, onDone }) {
  const [phase, setPhase] = useState("idle"); // idle | sending | waiting | done
  const cfg = PAY[kind];

  const poll = async (deadline) => {
    if (Date.now() > deadline) { setPhase("idle"); onDone?.(); return; }
    try {
      const r = await portalApi.get("/welfare/member/mpesa/transactions");
      const hit = (r.data.data || []).find((t) => t.target_type === cfg.type && String(t.target_id) === String(targetId));
      if (hit?.allocated) { setPhase("done"); onDone?.(); return; }
    } catch {
      /* keep polling */
    }
    setTimeout(() => poll(deadline), 4000);
  };

  const pay = async () => {
    setPhase("sending");
    try {
      await portalApi.post(cfg.url, { [cfg.key]: targetId });
      setPhase("waiting");
      poll(Date.now() + 60000);
    } catch (e) {
      alert(e.response?.data?.error || "Couldn't start the payment");
      setPhase("idle");
    }
  };

  if (phase === "done") return <span className="text-emerald-600 font-semibold text-xs">Paid ✓</span>;
  return (
    <button
      onClick={pay}
      disabled={phase !== "idle"}
      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold disabled:opacity-60 inline-flex items-center gap-1"
    >
      {phase === "sending" ? "Sending…" : phase === "waiting" ? "Enter M-Pesa PIN…" : "Pay"}
    </button>
  );
}

function Shell({ title, icon: Icon, children }) {
  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-6">
          {Icon && <Icon className="text-emerald-600" />} {title}
        </h1>
        {children}
      </div>
    </PortalLayout>
  );
}

function Loading({ error }) {
  if (error) return <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg">{error}</div>;
  // Content-shaped skeleton (brand-neutral) — mirrors the stat strip + list
  // most member pages render, so content doesn't jump when data lands.
  return (
    <div aria-busy="true">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-10 text-center text-slate-500 dark:text-slate-400">{children}</div>;
}

const Stat = ({ label, value, tone = "text-slate-900 dark:text-slate-100" }) => (
  <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 p-5">
    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
    <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
  </div>
);

// Small modal for submitting a request (loan or withdrawal). `fields` is an
// array of {name,label,type,placeholder}; submits the collected body to `url`.
function RequestModal({ title, fields, url, onClose, onDone }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await portalApi.post(url, form);
      onDone();
      onClose();
    } catch (e2) {
      setErr(e2.response?.data?.error || "Failed to submit");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X size={20} /></button>
        </div>
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm mb-3">{err}</div>}
        <form onSubmit={submit} className="space-y-3">
          {fields.map((f) => (
            <div key={f.name}>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">{f.label}</label>
              <input
                type={f.type || "text"}
                value={form[f.name] || ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                placeholder={f.placeholder}
                min={f.min}
                className="w-full px-3 py-2 border-2 border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none"
              />
            </div>
          ))}
          <button type="submit" disabled={busy} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg disabled:opacity-50">
            {busy ? "Submitting…" : "Submit request"}
          </button>
        </form>
      </div>
    </div>
  );
}

// A member's own request history (loan / withdrawal / event).
// Collapsed by default: the table only appears after clicking the heading.
function RequestsList({ path, columns, title = "My requests", kind, onOpenLoan }) {
  const { data, loading } = useFetch(path);
  const [open, setOpen] = useState(null);
  const [show, setShow] = useState(false);
  if (loading || !data || data.length === 0) return null;
  // An approved loan request opens the issued loan (with its repayment history);
  // anything else opens the read-only request detail.
  const handle = (r) => {
    if (onOpenLoan && r.status === "approved" && r.issued_loan_id) onOpenLoan(r.issued_loan_id);
    else setOpen(r);
  };
  return (
    <div className="mt-6">
      <button type="button" onClick={() => setShow((s) => !s)} className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100 mb-2 hover:text-slate-700 dark:hover:text-slate-200">
        <ChevronRight size={18} className={`transition-transform ${show ? "rotate-90" : ""}`} />
        {title} <span className="font-normal text-slate-400 dark:text-slate-400">({data.length})</span>
      </button>
      {show && (
        <Table
          head={[...columns.map((c) => c.label), "Status"]}
          rows={data}
          empty=""
          render={(r) => (
            <tr key={r.id} onClick={() => handle(r)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
              {columns.map((c) => <td key={c.key} className="px-4 py-3 text-slate-700 dark:text-slate-200">{c.fmt ? c.fmt(r[c.key]) : r[c.key] || "—"}</td>)}
              <td className="px-4 py-3"><Badge value={r.status} /></td>
            </tr>
          )}
        />
      )}
      {open && <RequestDetailModal request={open} columns={columns} kind={kind} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Read-only detail for one loan / event request, shown when its row is clicked.
function RequestDetailModal({ request: r, columns, kind, onClose }) {
  const dt = (v) => (v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : null);
  const Item = ({ label, value }) => (value == null || value === "" ? null : (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-100 dark:border-slate-700 last:border-0 text-sm">
      <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}</span><span className="font-semibold text-slate-800 dark:text-slate-200 text-right">{value}</span>
    </div>
  ));
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-6 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{kind === "loan" ? "Loan request" : kind === "event" ? "Event request" : "Request"}</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X size={20} /></button>
        </div>
        <div className="mb-3"><Badge value={r.status} /></div>
        <div>
          {columns.map((c) => <Item key={c.key} label={c.label} value={c.fmt ? c.fmt(r[c.key]) : (r[c.key] || "—")} />)}
          {kind === "loan" && r.interest_rate != null && r.interest_rate !== "" && (
            <Item label="Interest rate" value={`${Number(r.interest_rate)}% p.a. (${(Number(r.interest_rate) / 12).toFixed(2)}%/mo) ${r.interest_method || "flat"}`} />
          )}
          {kind === "loan" && r.collateral_description && (
            <Item label="Collateral" value={`${r.collateral_description}${r.collateral_value ? ` · ${KES(r.collateral_value)}` : ""}`} />
          )}
          <Item label="Submitted" value={dt(r.created_at)} />
          <Item label="Decided" value={dt(r.decided_at)} />
          {r.decision_notes && <Item label="Notes" value={r.decision_notes} />}
        </div>
      </div>
    </div>
  );
}

export function MemberDashboard() {
  const { data, loading, error } = useFetch("/welfare/member/overview");
  const downloadStatement = async () => {
    try {
      const res = await portalApi.get("/welfare/member/statement.pdf", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a"); a.href = url; a.download = "my-statement.pdf"; a.click(); URL.revokeObjectURL(url);
    } catch { /* */ }
  };
  return (
    <Shell icon={LayoutDashboard} title={<>My {data?.welfare?.name ? `${data.welfare.name} ` : ""}Dashboard <OfficerBadge role={data?.member?.role} className="ml-1 align-middle" /></>}>
      {loading || error || !data ? <Loading error={error} /> : (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={downloadStatement} className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg text-sm">Download statement (PDF)</button>
          </div>

          {/* The same group dashboard the admin sees — members are equal owners — with
              the member's own figures merged into each card as a "Mine:" line. */}
          <WelfareDashboardPanel
            client={portalApi}
            summaryUrl="/welfare/member/dashboard"
            chartsUrl="/welfare/member/charts"
            showExports={false}
            showLoans={!!data.welfare?.loans_enabled}
            linkBase="/welfare/member"
            personal={{
              savings: data.savings_balance,
              penalties: data.penalties_outstanding,
              loan: data.loans?.outstanding,
              compliance_pct: data.compliance_pct,
              compliance: data.compliance,
              attendance_pct: data.attendance_pct,
              attendance: data.attendance,
            }}
          />

          {data.next_contribution && (() => {
            // Savings dues are paid on Contributions; benefit-pool dues
            // (quarterly/emergencies, pool_key !== "savings") on Events &
            // Emergencies — so Pay lands where this due actually shows.
            const pk = data.next_contribution.pool_key;
            const isSavings = !pk || pk === "savings";
            const payTo = isSavings ? "/welfare/member/contributions" : "/welfare/member/events";
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-amber-900">Next {isSavings ? "contribution" : "due"}</p>
                  <p className="text-sm text-amber-700">{data.next_contribution.cycle_name} — {KES(data.next_contribution.amount_due)} due {fmt(data.next_contribution.due_date)}</p>
                </div>
                <Link to={payTo} className="text-amber-800 font-semibold inline-flex items-center gap-1">Pay <ArrowRight size={16} /></Link>
              </div>
            );
          })()}

          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h2 className="font-bold text-slate-900 dark:text-slate-100">Recent activity</h2>
              <Link to="/welfare/member/ledger" className="text-sm text-emerald-600 font-semibold">Full ledger →</Link>
            </div>
            {(data.recent_transactions || []).length === 0 ? (
              <p className="px-5 py-8 text-center text-slate-500 dark:text-slate-400">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {data.recent_transactions.map((t, i) => (
                  <li key={i} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800 dark:text-slate-200 capitalize">{t.type.replace(/_/g, " ")}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{fmt(t.txn_date)}{t.description ? ` · ${t.description}` : ""}</p>
                    </div>
                    <span className={`font-semibold ${t.direction > 0 ? "text-emerald-700" : "text-rose-600"}`}>
                      {t.direction > 0 ? "+" : "−"}{KES(t.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}

// A read-only "what's happening in the chama" section: fetches a group endpoint
// and renders a labelled table. Lets members view group activity without any
// admin controls.
function GroupSection({ title, path, head, render, empty, pick }) {
  const { data, loading, error } = useFetch(path);
  // Guard pick() behind `data` — it's null on the first (loading) render.
  const rows = data ? (pick ? (pick(data) || []) : data) : [];
  return (
    <div className="mt-8">
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">{title}</h3>
      {loading || error || !data ? <Loading error={error} /> : <Table head={head} rows={rows} render={render} empty={empty} />}
    </div>
  );
}

function Table({ head, rows, render, empty }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-100 dark:border-slate-700 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-left">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{rows.map(render)}</tbody>
      </table>
    </div>
  );
}

// Full ledger — every payment activity on the member's pool record
// (contributions, withdrawals, dividends, loan disbursements/repayments,
// penalties …). Read-only; data from GET /welfare/member/ledger.
export function MemberLedger() {
  const { data, loading, error } = useFetch("/welfare/member/ledger");
  const txns = data?.transactions || [];
  return (
    <Shell title="Full ledger" icon={ClipboardList}>
      {loading || error || !data ? <Loading error={error} /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="Savings balance" value={KES(data.savings_balance)} tone="text-emerald-700 dark:text-emerald-400" />
            <Stat label="Activities" value={txns.length} />
          </div>
          <div className="mt-6">
            <Table
              head={["Date", "Activity", "Description", "Amount", "Pool balance"]}
              rows={txns}
              empty="No activity yet."
              render={(t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{fmt(t.txn_date)}</td>
                  <td className="px-4 py-3 capitalize text-slate-700 dark:text-slate-200">{t.type.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{t.description || "—"}</td>
                  <td className={`px-4 py-3 font-semibold whitespace-nowrap ${t.direction > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{t.direction > 0 ? "+" : "−"}{KES(t.amount)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{KES(t.balance_after)}</td>
                </tr>
              )}
            />
          </div>
        </>
      )}
    </Shell>
  );
}

export function MemberContributions() {
  const { data, loading, error, reload } = useFetch("/welfare/member/contributions");
  // Only monthly SAVINGS contributions belong here — event/emergency (benefit
  // pool) dues live on the Events & Emergencies page.
  const isSavings = (c) => !c.pool_key || c.pool_key === "savings";
  const due = (data || []).filter((c) => isSavings(c) && ["pending", "partial", "overdue"].includes(c.status));
  return (
    <Shell title="Contributions" icon={Coins}>
      {/* Quick pay for the member's own outstanding savings dues. */}
      {!loading && due.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <p className="font-semibold text-amber-900 mb-2">Pay your contributions</p>
          <div className="space-y-2">
            {due.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-amber-900">{c.cycle_name} <span className="text-amber-700">· due {fmt(c.due_date)} · {KES(Number(c.amount_due) - Number(c.amount_paid))} left</span></span>
                <PayButton kind="contribution" targetId={c.id} onDone={reload} />
              </div>
            ))}
          </div>
        </div>
      )}
      {/* The full chama view, same as the admin sees (read-only) — click a
          contribution to see yours and every member's. */}
      <WelfareContributionsPanel client={portalApi} basePath="/welfare/member/contrib" readOnly kind="savings" />
    </Shell>
  );
}

export function MemberLoans() {
  const { data, loading, error, reload } = useFetch("/welfare/member/loans");
  const { data: overview } = useFetch("/welfare/member/overview");
  const { data: eventReqs } = useFetch("/welfare/member/event-requests");
  const loansOn = !!overview?.welfare?.loans_enabled; // chama Loans switch
  const [modal, setModal] = useState(null); // 'loan' | 'event' | null
  const [reqKey, setReqKey] = useState(0);
  const [openLoan, setOpenLoan] = useState(null);
  const [openEvent, setOpenEvent] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const eventColumns = [
    { key: "amount", label: "Amount", fmt: KES },
    { key: "event_date", label: "Event date", fmt },
    { key: "reason", label: "Reason" },
  ];
  const approvedEvents = (eventReqs || []).filter((e) => e.status === "approved");
  return (
    <Shell title="Requests" icon={ClipboardList}>
      <div className="flex flex-wrap justify-end gap-2 -mt-2 mb-4">
        <button onClick={() => setModal("event")} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold inline-flex items-center gap-2">
          <HeartHandshake size={16} /> Request event funds
        </button>
        {loansOn && (
          <button onClick={() => setModal("loan")} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center gap-2">
            <Plus size={16} /> Request a loan
          </button>
        )}
      </div>
      {loansOn && modal === "loan" && (
        <LoanApplyModal onClose={() => setModal(null)} onDone={() => setReqKey((k) => k + 1)} />
      )}
      {modal === "event" && (
        <RequestModal
          title="Request event funds"
          url="/welfare/member/event-requests"
          fields={[
            { name: "amount", label: "Amount needed (KES)", type: "number", placeholder: "e.g. 10000" },
            { name: "event_date", label: "Date of the event", type: "date", min: today },
            { name: "reason", label: "What's it for?", placeholder: "e.g. medical, funeral, wedding" },
          ]}
          onClose={() => setModal(null)}
          onDone={() => setReqKey((k) => k + 1)}
        />
      )}
      {loansOn && (
        <>
          <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-2">Approved loans</h2>
          {loading || error || !data ? <Loading error={error} /> : (
            <Table
              head={["Loan", "Principal", "Total due", "Paid", "Balance", "Status", ""]}
              rows={data}
              empty="You have no chama loans."
              render={(l) => (
                <tr key={l.id} onClick={() => setOpenLoan(l.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
                  <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-200">{l.loan_code}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{KES(l.principal)}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{KES(l.total_amount_due)}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{KES(l.amount_paid)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{KES(l.balance)}</td>
                  <td className="px-4 py-3"><Badge value={l.status} /></td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {l.status === "active" && Number(l.balance) > 0 && (
                      <PayButton kind="loan" targetId={l.id} onDone={reload} />
                    )}
                  </td>
                </tr>
              )}
            />
          )}
          {/* Collapsed by default — click the heading to reveal the table. */}
          <RequestsList
            key={`loan-${reqKey}`}
            title="Loan requests"
            kind="loan"
            path="/welfare/member/loan-requests"
            columns={[
              { key: "principal", label: "Amount", fmt: KES },
              { key: "duration_months", label: "Months" },
              { key: "purpose", label: "Purpose" },
            ]}
            // An approved request opens the real loan (schedule + repayments + Pay).
            onOpenLoan={setOpenLoan}
          />
        </>
      )}
      <h2 className="font-bold text-slate-900 dark:text-slate-100 mb-2 mt-6">Approved events</h2>
      <Table
        head={["Amount", "Event date", "Reason", "Status"]}
        rows={approvedEvents}
        empty="No approved events yet."
        render={(e) => (
          <tr key={e.id} onClick={() => setOpenEvent(e)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
            <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{KES(e.amount)}</td>
            <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{fmt(e.event_date)}</td>
            <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{e.reason || "—"}</td>
            <td className="px-4 py-3"><Badge value={e.status} /></td>
          </tr>
        )}
      />
      <RequestsList
        key={`event-${reqKey}`}
        title="Event requests"
        kind="event"
        path="/welfare/member/event-requests"
        columns={eventColumns}
      />
      {openLoan && <LoanDetailModal loanId={openLoan} onClose={() => setOpenLoan(null)} />}
      {openEvent && <RequestDetailModal request={openEvent} columns={eventColumns} kind="event" onClose={() => setOpenEvent(null)} />}
      {/* Loans are private — a member sees only their own; no group loan list. */}
    </Shell>
  );
}

// Request a loan — the member just picks a package (which carries the rate,
// method and fees the admin preset); a live repayment summary auto-calculates
// before they submit. Collateral is optional.
function LoanApplyModal({ onClose, onDone }) {
  const { data: products } = useFetch("/welfare/member/loan-products");
  const { data: policy } = useFetch("/welfare/member/loan-policy");
  const [form, setForm] = useState({ product_id: "", principal: "", duration_months: "", purpose: "", coll_description: "", coll_value: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const hasProducts = (products || []).length > 0;
  // Pre-select the first package so the repayment summary appears right away.
  useEffect(() => {
    if (hasProducts && !form.product_id) setForm((s) => ({ ...s, product_id: String(products[0].id) }));
  }, [products]); // eslint-disable-line react-hooks/exhaustive-deps
  const product = (products || []).find((p) => String(p.id) === String(form.product_id));
  // Terms come from the chosen package, or — when the chama has no packages —
  // from its default loan policy (a "standard loan, no package").
  const terms = product
    ? { rate: Number(product.annual_interest_rate), method: product.interest_method, feeRate: Number(product.processing_fee_rate) || 0 }
    : { rate: policy?.annual_interest_rate != null ? Number(policy.annual_interest_rate) : 0, method: policy?.interest_method || "flat", feeRate: Number(policy?.processing_fee_rate) || 0 };

  // Auto-calculated loan summary from the terms + amount + duration.
  const preview = (() => {
    const principal = Number(form.principal), months = Number(form.duration_months);
    if (!(terms.rate > 0) || !(principal > 0) || !(months > 0)) return null;
    let totals;
    try { totals = computeLoanTotals({ principal, annualRatePct: terms.rate, months, method: terms.method }); } catch { return null; }
    const processingFee = Math.round(principal * (terms.feeRate / 100) * 100) / 100;
    return { ...totals, processingFee, netDisburse: Math.round((principal - processingFee) * 100) / 100 };
  })();

  const submit = async (e) => {
    e.preventDefault();
    if (form.coll_description.trim() && !(Number(form.coll_value) > 0)) return setErr("Enter the collateral's value (or clear its description).");
    setBusy(true); setErr("");
    try {
      const body = { principal: form.principal, duration_months: form.duration_months, purpose: form.purpose };
      if (product) body.product_id = form.product_id;
      else if (terms.rate > 0) { body.interest_rate = terms.rate; body.interest_method = terms.method; }
      if (form.coll_description.trim()) { body.collateral_description = form.coll_description.trim(); body.collateral_value = form.coll_value; }
      await portalApi.post("/welfare/member/loan-requests", body);
      onDone(); onClose();
    } catch (e2) { setErr(e2.response?.data?.error || "Failed to submit"); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1";
  const Row = ({ label, value, strong }) => (
    <div className="flex items-center justify-between"><span className="text-slate-500 dark:text-slate-400">{label}</span><span className={strong ? "font-bold text-slate-900 dark:text-slate-100" : "font-semibold text-slate-700 dark:text-slate-200"}>{value}</span></div>
  );
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-md p-6 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Request Loan</h3><button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X size={20} /></button></div>
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm mb-3">{err}</div>}
        <form onSubmit={submit} className="space-y-3">
          {hasProducts ? (
            <div><label className={lbl}>Loan package</label>
              <select value={form.product_id} onChange={set("product_id")} className={fld}>
                {(products || []).map((p) => <option key={p.id} value={p.id}>{p.name} · {Number(p.annual_interest_rate)}% p.a. ({(Number(p.annual_interest_rate) / 12).toFixed(2)}%/mo) {p.interest_method}</option>)}
              </select>
              {product && <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">KES {Number(product.min_amount).toLocaleString()}–{Number(product.max_amount).toLocaleString()} · {product.min_duration_months}–{product.max_duration_months} mo{terms.feeRate > 0 ? ` · ${terms.feeRate}% processing fee` : ""}</p>}
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-400">
              Standard loan (no package){terms.rate > 0 ? <> · {terms.rate}% p.a. ({(terms.rate / 12).toFixed(2)}%/mo) {terms.method}{terms.feeRate > 0 ? ` · ${terms.feeRate}% fee` : ""}</> : " · terms set by your chama admin on approval"}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Amount (KES)</label><input type="number" value={form.principal} onChange={set("principal")} placeholder="e.g. 20000" className={fld} /></div>
            <div><label className={lbl}>Duration (months)</label><input type="number" value={form.duration_months} onChange={set("duration_months")} placeholder="e.g. 6" className={fld} /></div>
          </div>
          <div><label className={lbl}>Purpose</label><input value={form.purpose} onChange={set("purpose")} placeholder="What's it for?" className={fld} /></div>
          {/* Collateral (optional) — offer security with the request. */}
          <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Collateral <span className="font-normal text-slate-400 dark:text-slate-400">(optional)</span></p>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2"><input value={form.coll_description} onChange={set("coll_description")} placeholder="e.g. Title deed, TV, logbook" className={fld} /></div>
              <div><input type="number" min="0" value={form.coll_value} onChange={set("coll_value")} placeholder="Value" className={fld} /></div>
            </div>
          </div>
          {/* Auto-calculated repayment summary. */}
          {preview && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 space-y-1.5 text-sm">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">What you'll repay</p>
              {preview.processingFee > 0 && <Row label="Processing fee" value={`− ${KES(preview.processingFee)}`} />}
              {preview.processingFee > 0 && <Row label="You receive" value={KES(preview.netDisburse)} strong />}
              <Row label="Interest" value={KES(preview.totalInterest)} />
              <Row label="Total to repay" value={KES(preview.totalAmountDue)} strong />
              <Row label="~ per month" value={KES(preview.monthlyPayment)} />
            </div>
          )}
          <button type="submit" disabled={busy} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg disabled:opacity-50">{busy ? "Submitting…" : "Submit request"}</button>
        </form>
      </div>
    </div>
  );
}

// A member's loan detail — the installment schedule + repayment postings.
function LoanDetailModal({ loanId, onClose }) {
  const { data, loading, error, reload } = useFetch(`/welfare/member/loans/${loanId}`);
  const loan = data?.loan;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg my-10 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{loan ? loan.loan_code : "Loan"}</h3>
          <div className="flex items-center gap-2">
            {loan && loan.status === "active" && Number(loan.balance) > 0 && <PayButton kind="loan" targetId={loan.id} onDone={reload} />}
            <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X size={20} /></button>
          </div>
        </div>
        {loading || error || !data ? <Loading error={error} /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
              <span><span className="text-slate-400 dark:text-slate-400">Status</span> <Badge value={loan.status} /></span>
              <span><span className="text-slate-400 dark:text-slate-400">Principal</span> {KES(loan.principal)}</span>
              <span><span className="text-slate-400 dark:text-slate-400">Rate</span> {Number(loan.interest_rate)}% p.a. · {(Number(loan.interest_rate) / 12).toFixed(2)}%/mo {loan.interest_method}</span>
              <span><span className="text-slate-400 dark:text-slate-400">Balance</span> {KES(loan.balance)}</span>
            </div>
            {data.schedule?.length > 0 && (
              <div className="overflow-x-auto">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Repayment schedule</p>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase"><tr><th className="text-left px-2 py-1">#</th><th className="text-left px-2 py-1">Due</th><th className="text-right px-2 py-1">Amount</th><th className="text-right px-2 py-1">Paid</th><th className="text-left px-2 py-1">Status</th></tr></thead>
                  <tbody>
                    {data.schedule.map((s) => (
                      <tr key={s.payment_number} className="border-t border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                        <td className="px-2 py-1">{s.payment_number}</td><td className="px-2 py-1">{fmt(s.due_date)}</td>
                        <td className="px-2 py-1 text-right">{KES(s.amount_due)}</td><td className="px-2 py-1 text-right">{KES(s.amount_paid)}</td>
                        <td className="px-2 py-1"><Badge value={s.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.payments?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Payments</p>
                <div className="space-y-1">
                  {data.payments.map((p, i) => <div key={i} className="flex justify-between text-xs text-slate-600 dark:text-slate-400"><span>{fmt(p.txn_date)} · {p.type.replace(/_/g, " ")}</span><span className="text-emerald-700">{KES(p.amount)}</span></div>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Every member's standing — the same Reports table the admin sees (read-only).
export function MemberGroup() {
  const { data, loading, error } = useFetch("/welfare/member/group-members");
  return (
    <Shell title="Members" icon={Users}>
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Member", "Savings", "Contributions", "Dividends", "Penalty bal", "Attendance"]}
          rows={data}
          empty="No members yet."
          render={(m) => (
            <tr key={m.member_id} className="text-slate-700 dark:text-slate-200">
              <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{m.name} <span className="text-slate-400 dark:text-slate-400 font-mono text-xs">{m.member_no}</span> <OfficerBadge role={m.role} className="ml-1" /></td>
              <td className="px-4 py-3">{KES(m.savings)}</td>
              <td className="px-4 py-3">{KES(m.contributions)}</td>
              <td className="px-4 py-3">{KES(m.dividends)}</td>
              <td className="px-4 py-3">{KES(m.penalty_outstanding)}</td>
              <td className="px-4 py-3">{m.attendance_pct == null ? "—" : `${m.attendance_pct}%`}</td>
            </tr>
          )}
        />
      )}
      <GroupSection
        title="Expenses (chama spending)"
        path="/welfare/member/group-expenses"
        pick={(d) => d.expenses}
        head={["Date", "Description", "Amount"]}
        empty="No expenses recorded."
        render={(e, i) => (
          <tr key={i}>
            <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{fmt(e.txn_date)}</td>
            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{e.description}</td>
            <td className="px-4 py-3 font-semibold text-rose-600">{KES(e.amount)}</td>
          </tr>
        )}
      />
    </Shell>
  );
}

export function MemberMeetings() {
  // The full admin Meetings & Attendance view, read-only — click a meeting to
  // see the whole roster (everyone's present/late/absent + arrival).
  return (
    <Shell title="Meetings & Attendance" icon={CalendarCheck}>
      <WelfareMeetingsPanel client={portalApi} basePath="/welfare/member" readOnly />
    </Shell>
  );
}

export function MemberDividends() {
  const { data, loading, error } = useFetch("/welfare/member/dividends");
  const { data: proj } = useFetch("/welfare/member/dividends-projection");
  return (
    <Shell title="Dividends" icon={Gift}>
      {proj && proj.surplus > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-5">
          <p className="font-semibold text-emerald-900">If a share-out ran today</p>
          <p className="text-sm text-emerald-800 mt-0.5">Distributable surplus is <strong>{KES(proj.surplus)}</strong>. Your estimated share: <strong>{KES(proj.projected.savings)}</strong> by savings, or <strong>{KES(proj.projected.equal)}</strong> split equally.</p>
          <p className="text-xs text-emerald-700/70 mt-1">An estimate — the committee decides if and when to share out, and on which basis.</p>
        </div>
      )}
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Date", "Basis", "My share"]}
          rows={data}
          empty="No dividends paid out yet."
          render={(d, i) => (
            <tr key={i}>
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{fmt(d.txn_date)}</td>
              <td className="px-4 py-3 capitalize text-slate-600 dark:text-slate-400">{d.basis}</td>
              <td className="px-4 py-3 font-semibold text-emerald-700">{KES(d.amount)}</td>
            </tr>
          )}
        />
      )}
    </Shell>
  );
}

export function MemberDocuments() {
  return (
    <Shell title="Documents" icon={FileText}>
      <WelfareDocumentsPanel client={portalApi} path="/welfare/member/documents" />
    </Shell>
  );
}

export function MemberDecisions() {
  return (
    <Shell title="Decisions" icon={Vote}>
      <WelfareDecisionsPanel client={portalApi} path="/welfare/member/decisions" membersPath="/welfare/member/group-members" />
    </Shell>
  );
}

export function MemberBooks() {
  return (
    <Shell title="Books of Accounts" icon={BookOpen}>
      <WelfareBooksPanel client={portalApi} path="/welfare/member/books" />
    </Shell>
  );
}

export function MemberEvents() {
  const { data, loading, reload } = useFetch("/welfare/member/events"); // ad-hoc events pool (welfare_event_shares)
  const { data: contribs, reload: reloadContribs } = useFetch("/welfare/member/contributions");
  const events = data?.events || [];
  const beneficiaryOf = events.filter((e) => e.is_beneficiary).length;
  const payable = (s) => ["pending", "partial", "overdue"].includes(s.status);
  // Outstanding benefit contribution dues (event/emergency plans) + ad-hoc shares.
  const benefitDue = (contribs || []).filter((c) => c.pool_key && c.pool_key !== "savings" && payable(c));
  const shareDue = events.filter((e) => Number(e.amount_due) - Number(e.amount_paid) > 0.001 && payable(e));
  const hasDue = benefitDue.length + shareDue.length > 0;
  return (
    <Shell title="Events & Emergencies" icon={HeartHandshake}>
      {beneficiaryOf > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5">Beneficiary of <strong className="text-emerald-700">{beneficiaryOf}</strong></span>
        </div>
      )}
      {/* Quick pay for the member's own outstanding event & emergency dues. */}
      {!loading && hasDue && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <p className="font-semibold text-amber-900 mb-2">Pay your event &amp; emergency shares</p>
          <div className="space-y-2">
            {benefitDue.map((c) => (
              <div key={`c${c.id}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-amber-900">{c.cycle_name} <span className="text-amber-700">· due {fmt(c.due_date)} · {KES(Number(c.amount_due) - Number(c.amount_paid))} left</span></span>
                <PayButton kind="contribution" targetId={c.id} onDone={reloadContribs} />
              </div>
            ))}
            {shareDue.map((e) => (
              <div key={`e${e.share_id}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-amber-900">{e.title} <span className="text-amber-700">· {KES(Number(e.amount_due) - Number(e.amount_paid))} left</span></span>
                <PayButton kind="event" targetId={e.share_id} onDone={reload} />
              </div>
            ))}
          </div>
        </div>
      )}
      {/* The full events & emergencies view, same as the admin sees (read-only) —
          click one to see yours and every member's contribution + payouts. */}
      <WelfareContributionsPanel client={portalApi} basePath="/welfare/member/contrib" readOnly kind="benefit" />
    </Shell>
  );
}

const FINE_GROUP = (t) => (t === "contribution_late" ? "Contributions" : t === "event_late" ? "Events" : (t || "").startsWith("attendance") ? "Meetings" : t === "loan_late" ? "Loans" : "Other");

export function MemberPenalties() {
  const { data, loading, error, reload } = useFetch("/welfare/member/penalties");
  const groups = (data || []).reduce((acc, p) => {
    const g = FINE_GROUP(p.trigger);
    acc[g] = acc[g] || { count: 0, outstanding: 0 };
    acc[g].count += 1; acc[g].outstanding += Number(p.balance || 0);
    return acc;
  }, {});
  return (
    <Shell title="Penalties" icon={AlertTriangle}>
      {loading || error || !data ? <Loading error={error} /> : (
        <>
        {Object.keys(groups).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(groups).map(([g, v]) => (
              <span key={g} className="text-xs rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-slate-700 dark:text-slate-200">{g}: <strong className="text-slate-800 dark:text-slate-100">{v.count}</strong>{v.outstanding > 0 && <span className="text-rose-600"> · {KES(v.outstanding)} due</span>}</span>
            ))}
          </div>
        )}
        <Table
          head={["Date", "Reason", "Amount", "Paid", "Balance", "Status", ""]}
          rows={data}
          empty="No penalties — nicely done."
          render={(p) => (
            <tr key={p.id} className="text-slate-700 dark:text-slate-200">
              <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{fmt(p.assessed_at)}</td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{p.description || p.trigger?.replace(/_/g, " ")}</td>
              <td className="px-4 py-3">{KES(p.amount)}</td>
              <td className="px-4 py-3">{KES(p.paid_amount)}</td>
              <td className="px-4 py-3 font-semibold">{KES(p.balance)}</td>
              <td className="px-4 py-3"><Badge value={p.status} /></td>
              <td className="px-4 py-3 text-right">
                {p.status === "outstanding" && (
                  <PayButton kind="penalty" targetId={p.id} onDone={reload} />
                )}
              </td>
            </tr>
          )}
        />
        </>
      )}
    </Shell>
  );
}
