// Welfare/chama MEMBER self-service pages. Shown when the selected portal tenant
// is a welfare (PortalLayout swaps to the member menu). All data comes from
// /api/welfare/member/* (scoped to the logged-in member by the backend).
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PiggyBank, Coins, Wallet, CalendarCheck, Gift, AlertTriangle, ArrowRight, Plus, X, HeartHandshake, ClipboardList,
} from "lucide-react";
import portalApi from "../../services/portalApi";
import PortalLayout from "../../components/PortalLayout";
import Spinner from "../../../components/Spinner";
import { computeLoanTotals } from "../../../utils/loanMath";
import WelfareDashboardPanel from "../../../components/WelfareDashboardPanel";

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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm mb-3">{err}</div>}
        <form onSubmit={submit} className="space-y-3">
          {fields.map((f) => (
            <div key={f.name}>
              <label className="block text-sm font-semibold text-slate-700 mb-1">{f.label}</label>
              <input
                type={f.type || "text"}
                value={form[f.name] || ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                placeholder={f.placeholder}
                min={f.min}
                className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-emerald-500 focus:outline-none"
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
function RequestsList({ path, columns, title = "My requests" }) {
  const { data, loading } = useFetch(path);
  if (loading || !data || data.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="font-bold text-slate-900 mb-2">{title}</h2>
      <Table
        head={[...columns.map((c) => c.label), "Status"]}
        rows={data}
        empty=""
        render={(r) => (
          <tr key={r.id}>
            {columns.map((c) => <td key={c.key} className="px-4 py-3 text-slate-700">{c.fmt ? c.fmt(r[c.key]) : r[c.key] || "—"}</td>)}
            <td className="px-4 py-3"><Badge value={r.status} /></td>
          </tr>
        )}
      />
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
    <Shell title="My Chama" icon={PiggyBank}>
      {loading || error || !data ? <Loading error={error} /> : (
        <>
          <p className="text-slate-500 -mt-3 mb-5">{data.welfare?.name}</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Stat label="My savings" value={KES(data.savings_balance)} tone="text-emerald-700" />
            <Stat label="Loan balance" value={KES(data.loans?.outstanding)} tone={data.loans?.outstanding > 0 ? "text-ocean-700" : "text-slate-900"} />
            <Stat label="Penalties due" value={KES(data.penalties_outstanding)} tone={data.penalties_outstanding > 0 ? "text-rose-600" : "text-slate-900"} />
            <Stat label="Chama pool" value={KES(data.welfare?.pool_balance)} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 items-stretch">
            <Stat label={`Compliance${data.compliance ? ` (${data.compliance.paid}/${data.compliance.total})` : ""}`} value={data.compliance_pct == null ? "—" : `${data.compliance_pct}%`} tone={data.compliance_pct != null && data.compliance_pct < 75 ? "text-rose-600" : "text-emerald-700"} />
            <Stat label={`Attendance${data.attendance ? ` (${data.attendance.attended}/${data.attendance.recorded})` : ""}`} value={data.attendance_pct == null ? "—" : `${data.attendance_pct}%`} tone={data.attendance_pct != null && data.attendance_pct < 75 ? "text-rose-600" : "text-emerald-700"} />
            <div className="col-span-2 flex items-center justify-end">
              <button onClick={downloadStatement} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-sm">Download statement (PDF)</button>
            </div>
          </div>

          {/* The same group dashboard the admin sees — members are equal owners. */}
          <WelfareDashboardPanel client={portalApi} summaryUrl="/welfare/member/dashboard" chartsUrl="/welfare/member/charts" showExports={false} />

          {data.next_contribution && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center justify-between">
              <div>
                <p className="font-semibold text-amber-900">Next contribution</p>
                <p className="text-sm text-amber-700">{data.next_contribution.cycle_name} — {KES(data.next_contribution.amount_due)} due {fmt(data.next_contribution.due_date)}</p>
              </div>
              <Link to="/welfare/member/contributions" className="text-amber-800 font-semibold inline-flex items-center gap-1">Pay <ArrowRight size={16} /></Link>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-md border border-slate-100">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Recent activity</h2>
              <Link to="/welfare/member/savings" className="text-sm text-emerald-600 font-semibold">Full ledger →</Link>
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
  const { data, loading, error } = useFetch("/welfare/member/ledger");
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
  const { data, loading, error, reload } = useFetch("/welfare/member/contributions");
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
  const { data, loading, error, reload } = useFetch("/welfare/member/loans");
  const [modal, setModal] = useState(null); // 'loan' | 'event' | null
  const [reqKey, setReqKey] = useState(0);
  const [openLoan, setOpenLoan] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Shell title="Requests" icon={ClipboardList}>
      <div className="flex flex-wrap justify-end gap-2 -mt-2 mb-4">
        <button onClick={() => setModal("event")} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold inline-flex items-center gap-2">
          <HeartHandshake size={16} /> Request event funds
        </button>
        <button onClick={() => setModal("loan")} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center gap-2">
          <Plus size={16} /> Request a loan
        </button>
      </div>
      {modal === "loan" && (
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
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Loan", "Principal", "Total due", "Paid", "Balance", "Status", ""]}
          rows={data}
          empty="You have no chama loans."
          render={(l) => (
            <tr key={l.id} onClick={() => setOpenLoan(l.id)} className="cursor-pointer hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-slate-700">{l.loan_code}</td>
              <td className="px-4 py-3">{KES(l.principal)}</td>
              <td className="px-4 py-3">{KES(l.total_amount_due)}</td>
              <td className="px-4 py-3">{KES(l.amount_paid)}</td>
              <td className="px-4 py-3 font-semibold">{KES(l.balance)}</td>
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
      {openLoan && <LoanDetailModal loanId={openLoan} onClose={() => setOpenLoan(null)} />}
      <RequestsList
        key={`loan-${reqKey}`}
        title="Loan requests"
        path="/welfare/member/loan-requests"
        columns={[
          { key: "principal", label: "Amount", fmt: KES },
          { key: "duration_months", label: "Months" },
          { key: "purpose", label: "Purpose" },
        ]}
      />
      <RequestsList
        key={`event-${reqKey}`}
        title="Event requests"
        path="/welfare/member/event-requests"
        columns={[
          { key: "amount", label: "Amount", fmt: KES },
          { key: "event_date", label: "Event date", fmt },
          { key: "reason", label: "Reason" },
        ]}
      />
    </Shell>
  );
}

// Apply for a chama loan — optional product (locks rate/method + range) with a
// live repayment-schedule preview, else a plain amount/duration request.
function LoanApplyModal({ onClose, onDone }) {
  const { data: products } = useFetch("/welfare/member/loan-products");
  const [form, setForm] = useState({ product_id: "", principal: "", duration_months: "", purpose: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const product = (products || []).find((p) => String(p.id) === String(form.product_id));

  const preview = (() => {
    const principal = Number(form.principal), months = Number(form.duration_months);
    if (!product || !(principal > 0) || !(months > 0)) return null;
    try { return computeLoanTotals({ principal, annualRatePct: Number(product.annual_interest_rate), months, method: product.interest_method }); } catch { return null; }
  })();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await portalApi.post("/welfare/member/loan-requests", { product_id: form.product_id || undefined, principal: form.principal, duration_months: form.duration_months, purpose: form.purpose });
      onDone(); onClose();
    } catch (e2) { setErr(e2.response?.data?.error || "Failed to submit"); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-slate-200 rounded-lg focus:border-emerald-500 focus:outline-none";
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-lg font-bold text-slate-900">Request a chama loan</h3><button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button></div>
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm mb-3">{err}</div>}
        <form onSubmit={submit} className="space-y-3">
          {(products || []).length > 0 && (
            <div><label className="block text-sm font-semibold text-slate-700 mb-1">Loan product</label>
              <select value={form.product_id} onChange={set("product_id")} className={fld}>
                <option value="">No product (standard request)</option>
                {(products || []).map((p) => <option key={p.id} value={p.id}>{p.name} · {Number(p.annual_interest_rate)}% {p.interest_method}</option>)}
              </select>
              {product && <p className="text-xs text-slate-400 mt-1">KES {Number(product.min_amount).toLocaleString()}–{Number(product.max_amount).toLocaleString()} · {product.min_duration_months}–{product.max_duration_months} mo</p>}
            </div>
          )}
          <div><label className="block text-sm font-semibold text-slate-700 mb-1">Amount (KES)</label><input type="number" value={form.principal} onChange={set("principal")} placeholder="e.g. 20000" className={fld} /></div>
          <div><label className="block text-sm font-semibold text-slate-700 mb-1">Duration (months)</label><input type="number" value={form.duration_months} onChange={set("duration_months")} placeholder="e.g. 6" className={fld} /></div>
          <div><label className="block text-sm font-semibold text-slate-700 mb-1">Purpose</label><input value={form.purpose} onChange={set("purpose")} placeholder="What's it for?" className={fld} /></div>
          {preview && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 grid grid-cols-3 gap-2 text-center text-sm">
              <div><p className="text-xs text-slate-500">Interest</p><p className="font-bold text-slate-800">{KES(preview.totalInterest)}</p></div>
              <div><p className="text-xs text-slate-500">Total</p><p className="font-bold text-slate-800">{KES(preview.totalAmountDue)}</p></div>
              <div><p className="text-xs text-slate-500">~/mo</p><p className="font-bold text-slate-800">{KES(preview.monthlyPayment)}</p></div>
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
  const { data, loading, error } = useFetch(`/welfare/member/loans/${loanId}`);
  const loan = data?.loan;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-10 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="text-lg font-bold text-slate-900">{loan ? loan.loan_code : "Loan"}</h3><button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button></div>
        {loading || error || !data ? <Loading error={error} /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
              <span><span className="text-slate-400">Status</span> <Badge value={loan.status} /></span>
              <span><span className="text-slate-400">Principal</span> {KES(loan.principal)}</span>
              <span><span className="text-slate-400">Rate</span> {Number(loan.interest_rate)}% {loan.interest_method}</span>
              <span><span className="text-slate-400">Balance</span> {KES(loan.balance)}</span>
            </div>
            {data.schedule?.length > 0 && (
              <div className="overflow-x-auto">
                <p className="text-sm font-semibold text-slate-700 mb-1">Repayment schedule</p>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="text-left px-2 py-1">#</th><th className="text-left px-2 py-1">Due</th><th className="text-right px-2 py-1">Amount</th><th className="text-right px-2 py-1">Paid</th><th className="text-left px-2 py-1">Status</th></tr></thead>
                  <tbody>
                    {data.schedule.map((s) => (
                      <tr key={s.payment_number} className="border-t border-slate-100">
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
                <p className="text-sm font-semibold text-slate-700 mb-1">Payments</p>
                <div className="space-y-1">
                  {data.payments.map((p, i) => <div key={i} className="flex justify-between text-xs text-slate-600"><span>{fmt(p.txn_date)} · {p.type.replace(/_/g, " ")}</span><span className="text-emerald-700">{KES(p.amount)}</span></div>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function MemberMeetings() {
  const { data, loading, error } = useFetch("/welfare/member/meetings");
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

export function MemberEvents() {
  const { data, loading, error, reload } = useFetch("/welfare/member/events");
  const events = data?.events || [];
  const beneficiaryOf = events.filter((e) => e.is_beneficiary).length;
  const owed = events.reduce((a, e) => a + Math.max(Number(e.amount_due) - Number(e.amount_paid), 0), 0);
  return (
    <Shell title="Events" icon={HeartHandshake}>
      {!loading && !error && data && events.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">Contributing to <strong className="text-slate-800">{events.length}</strong></span>
          {beneficiaryOf > 0 && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5">Beneficiary of <strong className="text-emerald-700">{beneficiaryOf}</strong></span>}
          {owed > 0 && <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5">You owe <strong className="text-rose-600">{KES(owed)}</strong></span>}
        </div>
      )}
      {loading || error || !data ? <Loading error={error} /> : (
        <Table
          head={["Event", "Amount", "My share", "Paid", "Status", ""]}
          rows={data.events}
          empty="No events yet."
          render={(e) => {
            const outstanding = Number(e.amount_due) - Number(e.amount_paid);
            return (
              <tr key={e.share_id}>
                <td className="px-4 py-3 font-medium text-slate-800">
                  {e.title}
                  {e.is_beneficiary && <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">beneficiary</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{KES(e.amount)}</td>
                <td className="px-4 py-3">{KES(e.amount_due)}</td>
                <td className="px-4 py-3">{KES(e.amount_paid)}</td>
                <td className="px-4 py-3"><Badge value={e.status} /></td>
                <td className="px-4 py-3 text-right">
                  {outstanding > 0.001 && ["pending", "partial", "overdue"].includes(e.status) && (
                    <PayButton kind="event" targetId={e.share_id} onDone={reload} />
                  )}
                </td>
              </tr>
            );
          }}
        />
      )}
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
              <span key={g} className="text-xs rounded-full border border-slate-200 bg-white px-3 py-1.5">{g}: <strong className="text-slate-800">{v.count}</strong>{v.outstanding > 0 && <span className="text-rose-600"> · {KES(v.outstanding)} due</span>}</span>
            ))}
          </div>
        )}
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
        </>
      )}
    </Shell>
  );
}
