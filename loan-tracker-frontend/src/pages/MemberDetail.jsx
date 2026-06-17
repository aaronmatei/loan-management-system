import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PiggyBank, Plus, Minus, X, AlertTriangle, LogOut, FileDown, Smartphone } from "lucide-react";
import api from "../services/api";
import { downloadFile } from "../utils/bulkExport";
import { useWelfare } from "../context/WelfareContext";
import PermissionGate from "../components/PermissionGate";
import MemberLoansPanel from "../components/MemberLoansPanel";
import Spinner from "../components/Spinner";

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
  const { welfareId } = useWelfare();
  const navigate = useNavigate();
  const [member, setMember] = useState(null);
  const [savings, setSavings] = useState(0);
  const [txns, setTxns] = useState([]);
  const [poolBalance, setPoolBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // 'contribution' | 'withdrawal'
  const [exiting, setExiting] = useState(false);
  const [portalLinked, setPortalLinked] = useState(false);
  const [inviting, setInviting] = useState(false);

  const base = `/welfares/${welfareId}/members`;

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
      alert(`Member exited. Paid out KES ${Number(r.data.payout || 0).toLocaleString()}.`);
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

  const money = (v) =>
    "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (d) => new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });

  if (loading) {
    return <div className="p-4 lg:p-8 max-w-5xl mx-auto"><div className="bg-white rounded-xl shadow-md p-12"><Spinner centered label="Loading member…" /></div></div>;
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

      <div className="bg-white rounded-xl shadow-md p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><PiggyBank className="text-emerald-600" /> {member.first_name} {member.last_name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            <span className="font-mono">{member.member_no}</span>
            {member.phone_number && <> · {member.phone_number}</>}
            {member.id_number && <> · ID {member.id_number}</>}
            {" · "}<span className="capitalize">{member.status}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Savings balance</p>
          <p className="text-2xl font-bold text-emerald-700">{money(savings)}</p>
          <button onClick={() => downloadFile(`/welfares/${welfareId}/reports/members/${memberId}/statement.pdf`, `${member.member_no}-statement.pdf`).catch(() => alert("Export failed."))} className="mt-1 text-xs text-slate-500 hover:text-slate-800 font-semibold inline-flex items-center gap-1">
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
          <div className="flex flex-wrap gap-2 mb-6">
            <button onClick={() => setModal("contribution")} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center gap-2"><Plus size={16} /> Contribution</button>
            <PermissionGate role={["admin", "manager"]}>
              <button onClick={() => setModal("withdrawal")} className="px-4 py-2 bg-white border-2 border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg font-semibold inline-flex items-center gap-2"><Minus size={16} /> Withdrawal</button>
              <button onClick={inviteToPortal} disabled={inviting} title={member.phone_number ? "" : "Add a phone number and ID first"} className="px-4 py-2 bg-white border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-50"><Smartphone size={16} /> {inviting ? "Sending…" : portalLinked ? "Portal access ✓ — resend" : "Invite to portal"}</button>
              <button onClick={exitMember} disabled={exiting} className="px-4 py-2 bg-white border-2 border-rose-200 text-rose-700 hover:bg-rose-50 rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-50 ml-auto"><LogOut size={16} /> {exiting ? "Processing…" : "Exit member"}</button>
            </PermissionGate>
          </div>
        </PermissionGate>
      )}

      <MemberLoansPanel welfareId={welfareId} memberId={memberId} poolBalance={poolBalance} onChange={load} />

      <div className="bg-white rounded-xl shadow-md overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">Activity</h2></div>
        {txns.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-5 py-2">Date</th>
                  <th className="text-left px-5 py-2">Type</th>
                  <th className="text-right px-5 py-2">Amount</th>
                  <th className="text-right px-5 py-2">Pool balance</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((tx) => (
                  <tr key={tx.id} className="border-t border-slate-100">
                    <td className="px-5 py-2 text-slate-600">{fmt(tx.txn_date)}</td>
                    <td className="px-5 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${tx.direction > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                        {TYPE_LABEL[tx.type] || tx.type}
                      </span>
                    </td>
                    <td className={`px-5 py-2 text-right font-semibold ${tx.direction > 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {tx.direction > 0 ? "+" : "−"}{money(tx.amount)}
                    </td>
                    <td className="px-5 py-2 text-right text-slate-700">{money(tx.balance_after)}</td>
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

function TxnModal({ base, memberId, kind, max, onClose, onDone }) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isContribution = kind === "contribution";
  const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE");

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

  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-12" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{isContribution ? "Record Contribution" : "Record Withdrawal"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Amount{max != null && <span className="text-gray-500 font-normal"> (max {money(max)})</span>}
            </label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={fld} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={fld} />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={busy} className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${isContribution ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-700 hover:bg-slate-800"}`}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
