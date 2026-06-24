import React, { useState, useEffect } from "react";
import { HandCoins, Plus, X, AlertTriangle, Coins, Gavel } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

// Member loans funded from the member pool. Issue a loan (drawing the pool
// down), record repayments (restoring it), or mark a loan defaulted.
export default function MemberLoansPanel({ welfareId, memberId, poolBalance, onChange }) {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showIssue, setShowIssue] = useState(false);
  const [repayLoan, setRepayLoan] = useState(null);
  const base = `/welfares/${welfareId}/members/${memberId}/loans`;

  const load = async () => {
    try {
      const r = await api.get(base);
      setLoans(r.data.data || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [memberId]);

  const money = (v) =>
    "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const refresh = () => {
    load();
    onChange?.();
  };

  const markDefault = async (loan) => {
    if (!confirm(`Mark ${loan.loan_code} as defaulted?`)) return;
    try {
      await api.post(`${base}/${loan.id}/default`, {});
      refresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to default loan");
    }
  };

  const STATUS = {
    active: "bg-emerald-100 text-emerald-800",
    completed: "bg-sky-100 text-sky-800",
    defaulted: "bg-red-100 text-red-800",
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md border border-amber-100 mb-6 overflow-hidden">
      <div className="bg-amber-50 px-5 py-3 border-b border-amber-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <HandCoins size={18} className="text-amber-600" /> Loans from the Pool
        </h2>
        <PermissionGate role={["admin", "manager", "loan_officer"]}>
          <button
            onClick={() => setShowIssue(true)}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"
          >
            <Plus size={15} /> Issue Loan
          </button>
        </PermissionGate>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : loans.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No loans from the pool yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Loan</th>
                  <th className="text-right px-4 py-2">Principal</th>
                  <th className="text-right px-4 py-2">Due</th>
                  <th className="text-right px-4 py-2">Balance</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-4 py-2 font-mono text-xs text-amber-700">{l.loan_code}</td>
                    <td className="px-4 py-2 text-right">{money(l.principal)}</td>
                    <td className="px-4 py-2 text-right">{money(l.total_amount_due)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{money(l.balance)}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[l.status] || "bg-slate-100 text-slate-700"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {["active", "defaulted"].includes(l.status) && Number(l.balance) > 0 && (
                        <PermissionGate role={["admin", "manager", "loan_officer"]}>
                          <button
                            onClick={() => setRepayLoan(l)}
                            className="text-emerald-600 hover:text-emerald-800 inline-flex items-center gap-1 text-sm font-semibold mr-3"
                          >
                            <Coins size={14} /> Repay
                          </button>
                        </PermissionGate>
                      )}
                      {l.status === "active" && (
                        <PermissionGate role={["admin", "manager"]}>
                          <button
                            onClick={() => markDefault(l)}
                            className="text-red-500 hover:text-red-700 inline-flex items-center gap-1 text-sm font-semibold"
                          >
                            <Gavel size={14} /> Default
                          </button>
                        </PermissionGate>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showIssue && (
        <IssueLoanModal
          base={base}
          poolBalance={poolBalance}
          onClose={() => setShowIssue(false)}
          onDone={() => {
            setShowIssue(false);
            refresh();
          }}
        />
      )}
      {repayLoan && (
        <RepayModal
          base={base}
          loan={repayLoan}
          onClose={() => setRepayLoan(null)}
          onDone={() => {
            setRepayLoan(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function IssueLoanModal({ base, poolBalance, onClose, onDone }) {
  const [form, setForm] = useState({ principal: "", interest_rate: "12", duration_months: "6" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE");

  const principal = parseFloat(form.principal) || 0;
  const months = parseInt(form.duration_months, 10) || 0;
  const rate = parseFloat(form.interest_rate) || 0;
  const interest = Math.round(principal * (rate / 100) * (months / 12) * 100) / 100;
  const totalDue = Math.round((principal + interest) * 100) / 100;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!(principal > 0)) return setError("Enter a principal.");
    if (principal > poolBalance) return setError(`Pool only holds ${money(poolBalance)}.`);
    setBusy(true);
    try {
      await api.post(base, {
        principal,
        interest_rate: rate,
        duration_months: months,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to issue loan.");
      setBusy(false);
    }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-amber-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  return (
    <ModalShell title="Issue Loan from Pool" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">Pool balance: <strong>{money(poolBalance)}</strong></p>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>Principal</label><input type="number" value={form.principal} onChange={set("principal")} className={fld} autoFocus /></div>
          <div><label className={lbl}>Rate % p.a.</label><input type="number" value={form.interest_rate} onChange={set("interest_rate")} className={fld} />{rate > 0 && <p className="text-xs text-slate-400 dark:text-slate-400 mt-1">≈ {(rate / 12).toFixed(2)}%/mo</p>}</div>
          <div><label className={lbl}>Months</label><input type="number" min="1" value={form.duration_months} onChange={set("duration_months")} className={fld} /></div>
        </div>
        {principal > 0 && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Interest (flat)</span><span className="font-semibold">{money(interest)}</span></div>
            <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1"><span className="font-bold text-gray-800 dark:text-slate-100">Total repayable</span><span className="font-bold text-amber-700">{money(totalDue)}</span></div>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
          <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50">{busy ? "Issuing…" : "Issue Loan"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function RepayModal({ base, loan, onClose, onDone }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE");
  const outstanding = Number(loan.balance);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const amt = amount === "" ? outstanding : parseFloat(amount);
    if (!(amt > 0)) return setError("Enter an amount.");
    if (amt > outstanding) return setError(`Loan only owes ${money(outstanding)}.`);
    setBusy(true);
    try {
      await api.post(`${base}/${loan.id}/payments`, { amount: amt });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to record repayment.");
      setBusy(false);
    }
  };

  const fld = "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";

  return (
    <ModalShell title={`Repay ${loan.loan_code}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">Outstanding: <strong>{money(outstanding)}</strong>. Repayments go back into the pool.</p>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Amount <span className="text-gray-500 dark:text-slate-400 font-normal">(blank = full {money(outstanding)})</span></label>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(outstanding)} className={fld} autoFocus />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
          <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Record Repayment"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-100"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
