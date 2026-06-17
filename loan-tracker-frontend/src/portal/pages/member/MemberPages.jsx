// Welfare/chama MEMBER self-service pages. Shown when the selected portal tenant
// is a welfare (PortalLayout swaps to the member menu). All data comes from
// /api/portal/member/* (scoped to the logged-in member by the backend).
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PiggyBank, Coins, Wallet, CalendarCheck, Gift, AlertTriangle, ArrowRight,
} from "lucide-react";
import portalApi from "../../services/portalApi";
import PortalLayout from "../../components/PortalLayout";
import Spinner from "../../../components/Spinner";

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
  contribution: { url: "/member/mpesa/contribution", key: "schedule_id", type: "contribution_schedule" },
  loan: { url: "/member/mpesa/loan-repayment", key: "loan_id", type: "member_loan" },
  penalty: { url: "/member/mpesa/penalty", key: "assessment_id", type: "penalty_assessment" },
};
function PayButton({ kind, targetId, onDone }) {
  const [phase, setPhase] = useState("idle"); // idle | sending | waiting | done
  const cfg = PAY[kind];

  const poll = async (deadline) => {
    if (Date.now() > deadline) { setPhase("idle"); onDone?.(); return; }
    try {
      const r = await portalApi.get("/member/mpesa/transactions");
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
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2 mb-6">
          {Icon && <Icon className="text-emerald-600" />} {title}
        </h1>
        {children}
      </div>
    </PortalLayout>
  );
}

function Loading({ error }) {
  if (error) return <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg">{error}</div>;
  return <div className="bg-white rounded-xl shadow-md p-12"><Spinner centered label="Loading…" /></div>;
}

function Empty({ children }) {
  return <div className="bg-white rounded-xl shadow-md border border-slate-100 p-10 text-center text-slate-500">{children}</div>;
}

const Stat = ({ label, value, tone = "text-slate-900" }) => (
  <div className="bg-white rounded-xl shadow-md border border-slate-100 p-5">
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
    <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
  </div>
);

export function MemberDashboard() {
  const { data, loading, error } = useFetch("/member/overview");
  return (
    <Shell title="My Chama" icon={PiggyBank}>
      {loading || error || !data ? <Loading error={error} /> : (
        <>
          <p className="text-slate-500 -mt-3 mb-5">{data.welfare?.name}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat label="My savings" value={KES(data.savings_balance)} tone="text-emerald-700" />
            <Stat label="Loan balance" value={KES(data.loans?.outstanding)} tone={data.loans?.outstanding > 0 ? "text-ocean-700" : "text-slate-900"} />
            <Stat label="Penalties due" value={KES(data.penalties_outstanding)} tone={data.penalties_outstanding > 0 ? "text-rose-600" : "text-slate-900"} />
            <Stat label="Chama pool" value={KES(data.welfare?.pool_balance)} />
          </div>

          {data.next_contribution && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center justify-between">
              <div>
                <p className="font-semibold text-amber-900">Next contribution</p>
                <p className="text-sm text-amber-700">{data.next_contribution.cycle_name} — {KES(data.next_contribution.amount_due)} due {fmt(data.next_contribution.due_date)}</p>
              </div>
              <Link to="/portal/member/contributions" className="text-amber-800 font-semibold inline-flex items-center gap-1">Pay <ArrowRight size={16} /></Link>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-md border border-slate-100">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Recent activity</h2>
              <Link to="/portal/member/savings" className="text-sm text-emerald-600 font-semibold">Full ledger →</Link>
            </div>
            {(data.recent_transactions || []).length === 0 ? (
              <p className="px-5 py-8 text-center text-slate-500">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recent_transactions.map((t, i) => (
                  <li key={i} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800 capitalize">{t.type.replace(/_/g, " ")}</p>
                      <p className="text-xs text-slate-500">{fmt(t.txn_date)}{t.description ? ` · ${t.description}` : ""}</p>
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

function Table({ head, rows, render, empty }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-left">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{rows.map(render)}</tbody>
      </table>
    </div>
  );
}

export function MemberSavings() {
  const { data, loading, error } = useFetch("/member/ledger");
  return (
    <Shell title="My Savings" icon={PiggyBank}>
      {loading || error || !data ? <Loading error={error} /> : (
        <>
          <Stat label="Savings balance" value={KES(data.savings_balance)} tone="text-emerald-700" />
          <div className="mt-6">
            <Table
              head={["Date", "Type", "Description", "Amount", "Balance"]}
              rows={data.transactions}
              empty="No transactions yet."
              render={(t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 text-slate-600">{fmt(t.txn_date)}</td>
                  <td className="px-4 py-3 capitalize">{t.type.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3 text-slate-600">{t.description || "—"}</td>
                  <td className={`px-4 py-3 font-semibold ${t.direction > 0 ? "text-emerald-700" : "text-rose-600"}`}>{t.direction > 0 ? "+" : "−"}{KES(t.amount)}</td>
                  <td className="px-4 py-3 text-slate-600">{KES(t.balance_after)}</td>
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
  const { data, loading, error, reload } = useFetch("/member/contributions");
  return (
    <Shell title="Contributions" icon={Coins}>
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Cycle", "Due date", "Expected", "Paid", "Status", ""]}
          rows={data}
          empty="No contribution cycles yet."
          render={(c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-medium text-slate-800">{c.cycle_name}</td>
              <td className="px-4 py-3 text-slate-600">{fmt(c.due_date)}</td>
              <td className="px-4 py-3">{KES(c.amount_due)}</td>
              <td className="px-4 py-3">{KES(c.amount_paid)}</td>
              <td className="px-4 py-3"><Badge value={c.status} /></td>
              <td className="px-4 py-3 text-right">
                {["pending", "partial", "overdue"].includes(c.status) && (
                  <PayButton kind="contribution" targetId={c.id} onDone={reload} />
                )}
              </td>
            </tr>
          )}
        />
      )}
    </Shell>
  );
}

export function MemberLoans() {
  const { data, loading, error, reload } = useFetch("/member/loans");
  return (
    <Shell title="Chama Loans" icon={Wallet}>
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Loan", "Principal", "Total due", "Paid", "Balance", "Status", ""]}
          rows={data}
          empty="You have no chama loans."
          render={(l) => (
            <tr key={l.id}>
              <td className="px-4 py-3 font-mono text-slate-700">{l.loan_code}</td>
              <td className="px-4 py-3">{KES(l.principal)}</td>
              <td className="px-4 py-3">{KES(l.total_amount_due)}</td>
              <td className="px-4 py-3">{KES(l.amount_paid)}</td>
              <td className="px-4 py-3 font-semibold">{KES(l.balance)}</td>
              <td className="px-4 py-3"><Badge value={l.status} /></td>
              <td className="px-4 py-3 text-right">
                {l.status === "active" && Number(l.balance) > 0 && (
                  <PayButton kind="loan" targetId={l.id} onDone={reload} />
                )}
              </td>
            </tr>
          )}
        />
      )}
    </Shell>
  );
}

export function MemberMeetings() {
  const { data, loading, error } = useFetch("/member/meetings");
  return (
    <Shell title="Meetings" icon={CalendarCheck}>
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Date", "Location", "Meeting", "My attendance"]}
          rows={data}
          empty="No meetings recorded."
          render={(m) => (
            <tr key={m.id}>
              <td className="px-4 py-3 text-slate-700">{fmt(m.meeting_date)}</td>
              <td className="px-4 py-3 text-slate-600">{m.location || "—"}</td>
              <td className="px-4 py-3"><Badge value={m.status} /></td>
              <td className="px-4 py-3">{m.my_attendance ? <Badge value={m.my_attendance} /> : <span className="text-slate-400">—</span>}</td>
            </tr>
          )}
        />
      )}
    </Shell>
  );
}

export function MemberDividends() {
  const { data, loading, error } = useFetch("/member/dividends");
  return (
    <Shell title="Dividends" icon={Gift}>
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Date", "Basis", "My share"]}
          rows={data}
          empty="No dividends paid out yet."
          render={(d, i) => (
            <tr key={i}>
              <td className="px-4 py-3 text-slate-700">{fmt(d.txn_date)}</td>
              <td className="px-4 py-3 capitalize text-slate-600">{d.basis}</td>
              <td className="px-4 py-3 font-semibold text-emerald-700">{KES(d.amount)}</td>
            </tr>
          )}
        />
      )}
    </Shell>
  );
}

export function MemberPenalties() {
  const { data, loading, error, reload } = useFetch("/member/penalties");
  return (
    <Shell title="Penalties" icon={AlertTriangle}>
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Date", "Reason", "Amount", "Paid", "Balance", "Status", ""]}
          rows={data}
          empty="No penalties — nicely done."
          render={(p) => (
            <tr key={p.id}>
              <td className="px-4 py-3 text-slate-700">{fmt(p.assessed_at)}</td>
              <td className="px-4 py-3 text-slate-600">{p.description || p.trigger?.replace(/_/g, " ")}</td>
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
      )}
    </Shell>
  );
}
