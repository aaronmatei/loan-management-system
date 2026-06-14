import React, { useState, useEffect } from "react";
import {
  PiggyBank,
  Plus,
  Minus,
  ShieldCheck,
  X,
  AlertTriangle,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

// Group savings ledger + joint-liability coverage. Shows the running balance,
// per-member balances and the ledger, and lets staff record contributions /
// withdrawals and apply savings to cover a member's loan. onChange() refreshes
// the parent (member-loan balances + rollup) after a coverage.
export default function GroupSavingsPanel({ groupId, members = [], loans = [], onChange }) {
  const [data, setData] = useState({ balance: 0, members: [], transactions: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'contribution' | 'withdrawal' | 'cover'

  const load = async () => {
    try {
      const r = await api.get(`/groups/${groupId}/savings`);
      setData(r.data.data || { balance: 0, members: [], transactions: [] });
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [groupId]);

  const money = (v) =>
    "KES " +
    Number(v || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const TYPE_LABEL = {
    contribution: "Contribution",
    withdrawal: "Withdrawal",
    liability_coverage: "Loan coverage",
    adjustment: "Adjustment",
  };

  const coverable = loans.filter(
    (l) => ["active", "defaulted"].includes(l.status) && Number(l.balance) > 0,
  );

  const afterAction = () => {
    setModal(null);
    load();
    onChange?.();
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-emerald-100 mb-6 overflow-hidden">
      <div className="bg-emerald-50 px-5 py-3 border-b border-emerald-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2">
          <PiggyBank size={18} className="text-emerald-600" /> Group Savings
        </h2>
        <div className="text-right">
          <p className="text-xs text-emerald-700">Balance</p>
          <p className="text-lg font-bold text-emerald-800">{money(data.balance)}</p>
        </div>
      </div>

      <div className="p-5">
        <PermissionGate role={["admin", "manager", "loan_officer"]}>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setModal("contribution")}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center gap-2"
            >
              <Plus size={16} /> Contribution
            </button>
            <PermissionGate role={["admin", "manager"]}>
              <button
                onClick={() => setModal("withdrawal")}
                className="px-4 py-2 bg-white border-2 border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg font-semibold inline-flex items-center gap-2"
              >
                <Minus size={16} /> Withdrawal
              </button>
              <button
                onClick={() => setModal("cover")}
                disabled={coverable.length === 0 || data.balance <= 0}
                title={
                  coverable.length === 0
                    ? "No outstanding member loans to cover"
                    : data.balance <= 0
                      ? "No savings to apply"
                      : "Apply savings to a member's loan"
                }
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShieldCheck size={16} /> Cover a Loan
              </button>
            </PermissionGate>
          </div>
        </PermissionGate>

        {/* Per-member balances */}
        {data.members.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {data.members.map((m) => (
              <span
                key={m.client_id}
                className="text-xs bg-slate-50 border border-slate-200 rounded-full px-3 py-1"
              >
                {m.first_name} {m.last_name}:{" "}
                <strong className="text-slate-800">{money(m.balance)}</strong>
              </span>
            ))}
          </div>
        )}

        {/* Ledger */}
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : data.transactions.length === 0 ? (
          <p className="text-sm text-slate-500">No savings activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Member / Loan</th>
                  <th className="text-right px-4 py-2">Amount</th>
                  <th className="text-right px-4 py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-600">
                      {new Date(tx.txn_date).toLocaleDateString("en-KE", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          tx.direction > 0
                            ? "bg-emerald-100 text-emerald-800"
                            : tx.type === "liability_coverage"
                              ? "bg-violet-100 text-violet-800"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {TYPE_LABEL[tx.type] || tx.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {tx.loan_code
                        ? tx.loan_code
                        : tx.first_name
                          ? `${tx.first_name} ${tx.last_name}`
                          : "—"}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-semibold ${
                        tx.direction > 0 ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {tx.direction > 0 ? "+" : "−"}
                      {money(tx.amount)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-700">
                      {money(tx.balance_after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal === "contribution" && (
        <SavingsModal
          title="Record Contribution"
          accent="emerald"
          groupId={groupId}
          endpoint="contribution"
          members={members}
          onClose={() => setModal(null)}
          onDone={afterAction}
        />
      )}
      {modal === "withdrawal" && (
        <SavingsModal
          title="Record Withdrawal"
          accent="slate"
          groupId={groupId}
          endpoint="withdrawal"
          members={members}
          max={data.balance}
          onClose={() => setModal(null)}
          onDone={afterAction}
        />
      )}
      {modal === "cover" && (
        <CoverModal
          groupId={groupId}
          balance={data.balance}
          loans={coverable}
          onClose={() => setModal(null)}
          onDone={afterAction}
        />
      )}
    </div>
  );
}

function SavingsModal({ title, accent, groupId, endpoint, members, max, onClose, onDone }) {
  const [amount, setAmount] = useState("");
  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const amt = parseFloat(amount);
    if (!(amt > 0)) return setError("Enter an amount.");
    if (max != null && amt > max) return setError(`Only ${money(max)} available.`);
    setBusy(true);
    try {
      await api.post(`/groups/${groupId}/savings/${endpoint}`, {
        amount: amt,
        client_id: clientId || null,
        notes: notes || null,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save.");
      setBusy(false);
    }
  };

  const accentBtn =
    accent === "emerald"
      ? "bg-emerald-600 hover:bg-emerald-700"
      : "bg-slate-700 hover:bg-slate-800";
  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";

  return (
    <ModalShell title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
            <AlertTriangle size={15} /> {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Amount{max != null && <span className="text-gray-500 font-normal"> (max {money(max)})</span>}
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={fld}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Member <span className="text-gray-500 font-normal">(optional)</span>
          </label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={fld}>
            <option value="">Group-level (no member)</option>
            {members.map((m) => (
              <option key={m.client_id} value={m.client_id}>
                {m.first_name} {m.last_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={fld} />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${accentBtn}`}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function CoverModal({ groupId, balance, loans, onClose, onDone }) {
  const [loanId, setLoanId] = useState(loans[0] ? String(loans[0].id) : "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loan = loans.find((l) => String(l.id) === String(loanId));
  const maxForLoan = loan ? Math.min(Number(loan.balance), balance) : 0;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!loanId) return setError("Pick a loan.");
    const amt = amount === "" ? maxForLoan : parseFloat(amount);
    if (!(amt > 0)) return setError("Enter an amount.");
    if (amt > maxForLoan) return setError(`Max coverable is ${money(maxForLoan)}.`);
    setBusy(true);
    try {
      await api.post(`/groups/${groupId}/savings/cover-loan`, { loan_id: loanId, amount: amt });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to cover loan.");
      setBusy(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-violet-500 focus:outline-none";

  return (
    <ModalShell title="Cover a Loan from Savings" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Apply group savings (balance <strong>{money(balance)}</strong>) toward a member's
          outstanding loan. This is recorded as a repayment on the loan.
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
            <AlertTriangle size={15} /> {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Loan</label>
          <select value={loanId} onChange={(e) => setLoanId(e.target.value)} className={fld}>
            {loans.map((l) => (
              <option key={l.id} value={l.id}>
                {l.loan_code} — {l.first_name} {l.last_name} ({l.status}) · owes {money(l.balance)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Amount <span className="text-gray-500 font-normal">(blank = max {money(maxForLoan)})</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(maxForLoan)}
            className={fld}
          />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
          >
            {busy ? "Applying…" : "Apply Coverage"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const money = (v) =>
  "KES " +
  Number(v || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
