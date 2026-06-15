import React, { useState, useEffect } from "react";
import { Smartphone, RefreshCw, CheckCircle2 } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const money = (v) =>
  "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleString("en-KE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const PURPOSE = {
  welfare_contribution: "Contribution",
  welfare_loan_repayment: "Loan repayment",
  welfare_penalty: "Penalty",
};
const STATUS = {
  success: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
};

// Welfare M-Pesa log: every STK request and its outcome, doubling as a manual
// reconciliation desk for confirmed-but-unallocated payments.
export default function WelfareMpesaPanel({ welfareId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const r = await api.get(`/welfares/${welfareId}/mpesa/transactions`);
      setRows(r.data.data || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId]);

  const allocate = async (t) => {
    setBusyId(t.id);
    try {
      await api.post(`/welfares/${welfareId}/mpesa/transactions/${t.id}/allocate`, {});
      load();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to allocate");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-green-100 mb-6 overflow-hidden">
      <div className="bg-green-50 px-5 py-3 border-b border-green-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2">
          <Smartphone size={18} className="text-green-600" /> M-Pesa payments
        </h2>
        <button onClick={load} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No M-Pesa activity yet. STK requests appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Member</th>
                  <th className="text-left px-3 py-2">For</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Receipt</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmt(t.created_at)}</td>
                    <td className="px-3 py-2 text-slate-800">{t.first_name ? `${t.first_name} ${t.last_name}` : t.phone_number}</td>
                    <td className="px-3 py-2 text-slate-600">{PURPOSE[t.purpose] || t.purpose}</td>
                    <td className="px-3 py-2 text-right">{money(t.amount)}</td>
                    <td className="px-3 py-2 text-slate-500 font-mono text-xs">{t.mpesa_receipt_number || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[t.status] || "bg-slate-100 text-slate-700"}`}>{t.status}</span>
                      {t.status === "success" && t.allocated && <CheckCircle2 size={14} className="inline ml-1.5 text-emerald-500" title="Allocated" />}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {t.status === "success" && !t.allocated && (
                        <PermissionGate role={["admin", "manager"]}>
                          <button onClick={() => allocate(t)} disabled={busyId === t.id} className="text-emerald-600 hover:text-emerald-800 text-sm font-semibold disabled:opacity-50">
                            {busyId === t.id ? "…" : "Allocate"}
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
    </div>
  );
}
