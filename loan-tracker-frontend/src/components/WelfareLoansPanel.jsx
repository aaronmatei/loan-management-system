import React, { useState, useEffect, useMemo } from "react";
import { Plus, X, AlertTriangle, HandCoins, ChevronRight, CheckCircle2 } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";
import { computeLoanTotals } from "../utils/loanMath";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

const STATUS = {
  pending: "bg-amber-100 text-amber-800", under_review: "bg-sky-100 text-sky-800", approved: "bg-violet-100 text-violet-800",
  active: "bg-emerald-100 text-emerald-800", completed: "bg-slate-100 text-slate-600", rejected: "bg-rose-100 text-rose-700", defaulted: "bg-rose-100 text-rose-700",
};
const TABS = [
  { id: "queue", label: "Applications", match: (s) => ["pending", "under_review", "approved"].includes(s) },
  { id: "active", label: "Active", match: (s) => ["active", "defaulted"].includes(s) },
  { id: "all", label: "All", match: () => true },
];

// Welfare member-loan administration — the application queue, the active book,
// and a per-loan detail (schedule grid, repayments, workflow actions).
export default function WelfareLoansPanel({ welfareId }) {
  const [loans, setLoans] = useState([]);
  const [members, setMembers] = useState([]);
  const [products, setProducts] = useState([]);
  const [tab, setTab] = useState("queue");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [l, m, p] = await Promise.all([
        api.get(`/welfares/${welfareId}/loans`),
        api.get(`/welfares/${welfareId}/members`),
        api.get(`/welfares/${welfareId}/loans/products`),
      ]);
      setLoans(l.data.data || []);
      setMembers((m.data.data || []).filter((x) => x.status === "active"));
      setProducts((p.data.data || []).filter((x) => x.active));
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [welfareId]);

  const shown = loans.filter((l) => (TABS.find((t) => t.id === tab) || TABS[2]).match(l.status));

  return (
    <div className="bg-white rounded-xl shadow-md border border-indigo-100 mb-6 overflow-hidden">
      <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2"><HandCoins size={18} className="text-indigo-600" /> Loans</h2>
        <PermissionGate role={["admin", "manager", "loan_officer"]}>
          <button onClick={() => setCreating(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"><Plus size={15} /> New application</button>
        </PermissionGate>
      </div>

      <div className="px-5 pt-3 flex gap-1.5">
        {TABS.map((t) => {
          const count = loans.filter((l) => t.match(l.status)).length;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 text-sm font-semibold rounded-lg ${tab === t.id ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"}`}>
              {t.label} <span className="text-xs text-slate-400">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="p-5">
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : shown.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">No loans here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr><th className="text-left px-3 py-2">Member</th><th className="text-left px-3 py-2">Code</th><th className="text-right px-3 py-2">Principal</th><th className="text-right px-3 py-2">Balance</th><th className="text-left px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} onClick={() => setSelectedId(l.id)} className="border-t border-slate-100 hover:bg-indigo-50/50 cursor-pointer">
                    <td className="px-3 py-2 font-semibold text-slate-800">{l.first_name} {l.last_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{l.loan_code}</td>
                    <td className="px-3 py-2 text-right">{money(l.principal)}</td>
                    <td className="px-3 py-2 text-right">{["active", "defaulted"].includes(l.status) ? money(l.balance) : "—"}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[l.status] || STATUS.pending}`}>{l.status.replace("_", " ")}</span></td>
                    <td className="px-3 py-2 text-right text-indigo-400"><ChevronRight size={16} className="inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && <ApplyModal welfareId={welfareId} members={members} products={products} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {selectedId && <LoanDetailModal welfareId={welfareId} loanId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />}
    </div>
  );
}

function ApplyModal({ welfareId, members, products, onClose, onSaved }) {
  const [form, setForm] = useState({ member_id: "", product_id: "", interest_rate: "", interest_method: "flat", late_fee: "", penalty_rate: "", principal: "", duration_months: 6, purpose: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const product = products.find((p) => String(p.id) === String(form.product_id));
  const rate = product ? Number(product.annual_interest_rate) : Number(form.interest_rate) || 0;
  const method = product ? product.interest_method : form.interest_method;

  const preview = useMemo(() => {
    const principal = Number(form.principal), months = Number(form.duration_months);
    if (!(principal > 0) || !(months > 0)) return null;
    try { return computeLoanTotals({ principal, annualRatePct: rate, months, method }); } catch { return null; }
  }, [form.principal, form.duration_months, rate, method]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.member_id) return setError("Pick a member.");
    if (!(Number(form.principal) > 0)) return setError("Enter a principal.");
    setBusy(true);
    try {
      const body = { member_id: form.member_id, principal: form.principal, duration_months: form.duration_months, purpose: form.purpose };
      if (form.product_id) body.product_id = form.product_id;
      else Object.assign(body, { interest_rate: form.interest_rate, interest_method: form.interest_method, late_fee: form.late_fee, penalty_rate: form.penalty_rate });
      await api.post(`/welfares/${welfareId}/loans`, body);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";
  return (
    <Shell title="New loan application" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <Err msg={error} />}
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Member</label>
            <select value={form.member_id} onChange={set("member_id")} className={fld}>
              <option value="">Select…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Product</label>
            <select value={form.product_id} onChange={set("product_id")} className={fld}>
              <option value="">Custom (no product)</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {Number(p.annual_interest_rate)}% {p.interest_method}</option>)}
            </select>
          </div>
          {!form.product_id && <>
            <div><label className={lbl}>Rate (% p.a.)</label><input type="number" min="0" step="0.01" value={form.interest_rate} onChange={set("interest_rate")} className={fld} /></div>
            <div><label className={lbl}>Method</label><select value={form.interest_method} onChange={set("interest_method")} className={fld}><option value="flat">Flat</option><option value="reducing">Reducing balance</option></select></div>
            <div><label className={lbl}>Late fee (KES)</label><input type="number" min="0" value={form.late_fee} onChange={set("late_fee")} placeholder="0" className={fld} /></div>
            <div><label className={lbl}>Penalty rate (%/mo)</label><input type="number" min="0" step="0.001" value={form.penalty_rate} onChange={set("penalty_rate")} placeholder="0" className={fld} /></div>
          </>}
          <div><label className={lbl}>Principal (KES)</label><input type="number" min="1" value={form.principal} onChange={set("principal")} className={fld} /></div>
          <div><label className={lbl}>Duration (months)</label><input type="number" min="1" value={form.duration_months} onChange={set("duration_months")} className={fld} /></div>
        </div>
        <div><label className={lbl}>Purpose</label><input value={form.purpose} onChange={set("purpose")} placeholder="optional" className={fld} /></div>
        {preview && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xs text-slate-500">Interest</p><p className="font-bold text-slate-800">{money(preview.totalInterest)}</p></div>
            <div><p className="text-xs text-slate-500">Total repayable</p><p className="font-bold text-slate-800">{money(preview.totalAmountDue)}</p></div>
            <div><p className="text-xs text-slate-500">~ / month</p><p className="font-bold text-slate-800">{money(preview.monthlyPayment)}</p></div>
          </div>
        )}
        <Actions busy={busy} onClose={onClose} label="Create application" />
      </form>
    </Shell>
  );
}

function LoanDetailModal({ welfareId, loanId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [payAmt, setPayAmt] = useState("");

  const load = async () => {
    try { setData((await api.get(`/welfares/${welfareId}/loans/${loanId}`)).data.data); } catch { /* */ }
  };
  useEffect(() => { load(); }, [welfareId, loanId]); // eslint-disable-line

  const act = async (action, body = {}) => {
    setBusy(action); setError("");
    try { await api.post(`/welfares/${welfareId}/loans/${loanId}/${action}`, body); await load(); onChanged?.(); }
    catch (e) { setError(e.response?.data?.error || "Failed."); } finally { setBusy(""); }
  };
  const reject = () => { const reason = window.prompt("Reason (optional):", ""); if (reason === null) return; act("reject", { reason }); };
  const recordPay = async () => {
    if (!(Number(payAmt) > 0)) return setError("Enter an amount.");
    setBusy("pay"); setError("");
    try { await api.post(`/welfares/${welfareId}/loans/${loanId}/payments`, { amount: payAmt }); setPayAmt(""); await load(); onChanged?.(); }
    catch (e) { setError(e.response?.data?.error || "Failed."); } finally { setBusy(""); }
  };

  const loan = data?.loan;
  return (
    <Shell title={loan ? `${loan.loan_code} — ${data.member?.first_name} ${data.member?.last_name}` : "Loan"} onClose={onClose} wide>
      {!data ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="space-y-4">
          {error && <Err msg={error} />}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <span><span className="text-slate-400">Status</span> <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[loan.status] || STATUS.pending}`}>{loan.status.replace("_", " ")}</span></span>
            <span><span className="text-slate-400">Principal</span> {money(loan.principal)}</span>
            <span><span className="text-slate-400">Rate</span> {Number(loan.interest_rate)}% {loan.interest_method}</span>
            <span><span className="text-slate-400">Balance</span> {money(loan.balance)}</span>
            {loan.due_date && <span><span className="text-slate-400">Ends</span> {fmt(loan.end_date || loan.due_date)}</span>}
          </div>

          <PermissionGate role={["admin", "manager", "loan_officer"]}>
            <div className="flex flex-wrap gap-2">
              {loan.status === "pending" && <Btn onClick={() => act("review")} busy={busy === "review"}>Mark under review</Btn>}
              {["pending", "under_review"].includes(loan.status) && <Btn onClick={() => act("approve")} busy={busy === "approve"} tone="emerald">Approve</Btn>}
              {["pending", "under_review"].includes(loan.status) && <Btn onClick={reject} busy={busy === "reject"} tone="rose">Reject</Btn>}
              {loan.status === "approved" && <Btn onClick={() => act("disburse")} busy={busy === "disburse"} tone="emerald">Disburse</Btn>}
              {loan.status === "active" && <Btn onClick={() => act("default")} busy={busy === "default"} tone="rose">Mark defaulted</Btn>}
            </div>
          </PermissionGate>

          {["active", "defaulted"].includes(loan.status) && (
            <PermissionGate role={["admin", "manager", "loan_officer"]}>
              <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div className="flex-1"><label className="block text-xs font-semibold text-slate-600 mb-1">Record repayment (KES)</label><input type="number" min="1" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} className="w-full px-3 py-1.5 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none" /></div>
                <button onClick={recordPay} disabled={busy === "pay"} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg disabled:opacity-50">{busy === "pay" ? "…" : "Pay"}</button>
              </div>
            </PermissionGate>
          )}

          {data.schedule?.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-sm font-semibold text-slate-700 mb-1">Schedule</p>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="text-left px-2 py-1">#</th><th className="text-left px-2 py-1">Due</th><th className="text-right px-2 py-1">Amount</th><th className="text-right px-2 py-1">Interest</th><th className="text-right px-2 py-1">Principal</th><th className="text-right px-2 py-1">Paid</th><th className="text-left px-2 py-1">Status</th></tr></thead>
                <tbody>
                  {data.schedule.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-2 py-1">{s.payment_number}</td><td className="px-2 py-1">{fmt(s.due_date)}</td>
                      <td className="px-2 py-1 text-right">{money(s.amount_due)}</td><td className="px-2 py-1 text-right">{money(s.interest_portion)}</td>
                      <td className="px-2 py-1 text-right">{money(s.principal_portion)}</td><td className="px-2 py-1 text-right">{money(s.amount_paid)}</td>
                      <td className="px-2 py-1">{s.status === "paid" ? <CheckCircle2 size={13} className="text-emerald-600 inline" /> : <span className={s.status === "overdue" ? "text-rose-600" : "text-slate-400"}>{s.status}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.ledger?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-1">Pool postings</p>
              <div className="space-y-1">
                {data.ledger.map((t) => (
                  <div key={t.id} className="flex justify-between text-xs text-slate-600"><span>{fmt(t.txn_date)} · {t.type.replace(/_/g, " ")}</span><span className={t.direction < 0 ? "text-rose-600" : "text-emerald-700"}>{t.direction < 0 ? "−" : "+"}{money(t.amount)}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

function Btn({ children, onClick, busy, tone = "slate" }) {
  const tones = { slate: "bg-slate-600 hover:bg-slate-700", emerald: "bg-emerald-600 hover:bg-emerald-700", rose: "bg-white border-2 border-rose-200 text-rose-700 hover:bg-rose-50" };
  return <button onClick={onClick} disabled={busy} className={`px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50 ${tone === "rose" ? tones.rose : `${tones[tone]} text-white`}`}>{busy ? "…" : children}</button>;
}
function Shell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} my-10`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h3 className="text-lg font-bold text-slate-900">{title}</h3><button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
const Err = ({ msg }) => <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {msg}</div>;
function Actions({ busy, onClose, label }) {
  return <div className="flex justify-end gap-3 pt-1"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button><button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : label}</button></div>;
}
