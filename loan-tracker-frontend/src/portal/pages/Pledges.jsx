import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Gem, ChevronRight, FileDown, Package, CalendarClock } from "lucide-react";
import PortalLayout from "../components/PortalLayout";
import portalApi from "../services/portalApi";
import MpesaPayButton from "../../components/MpesaPayButton";
import Spinner from "../../components/Spinner";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

const STATUS = {
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-slate-200 text-slate-700",
  defaulted: "bg-red-100 text-red-700",
};

// ── Pledges list ─────────────────────────────────────────────────────
export function PortalPledges() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    portalApi.get("/portal/customer/pledges")
      .then((r) => setRows(r.data.data || []))
      .catch((e) => setError(e.response?.data?.error || "Couldn't load your pledges"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 mb-1 flex items-center gap-2"><Gem className="text-ocean-600" /> My Pledges</h1>
        <p className="text-sm text-gray-500 mb-6">Items you've pawned and what's left to redeem them.</p>

        {loading ? (
          <div className="bg-white rounded-xl shadow-md p-12"><Spinner centered label="Loading pledges…" /></div>
        ) : error ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm">{error}</div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center text-slate-500">No pledges yet.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((p) => (
              <button key={p.id} onClick={() => navigate(`/portal/pledges/${p.id}`)} className="w-full text-left bg-white rounded-xl shadow-md border border-slate-100 p-4 hover:border-ocean-300 transition flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-ocean-50 text-ocean-600 flex items-center justify-center shrink-0"><Package size={20} /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{p.item || "Pledged item"}</p>
                  <p className="text-xs text-slate-500 font-mono">{p.loan_code}{p.overdue && <span className="ml-2 text-red-600 font-semibold">OVERDUE</span>}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-900">{KES(p.balance)}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS[p.status] || "bg-slate-100"}`}>{p.status === "active" ? "to redeem" : p.status}</span>
                </div>
                <ChevronRight size={18} className="text-ocean-400 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

// ── Pledge detail ────────────────────────────────────────────────────
export function PortalPledgeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const load = () => {
    setLoading(true);
    portalApi.get(`/portal/customer/pledges/${id}`)
      .then((r) => setData(r.data.data))
      .catch((e) => setError(e.response?.data?.error || "Couldn't load this pledge"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [id]);

  const downloadTicket = async () => {
    setDownloading(true);
    try {
      const r = await portalApi.get(`/portal/customer/pledges/${id}/ticket`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a");
      a.href = url; a.download = `pawn-ticket-${data?.loan?.loan_code || id}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch { alert("Couldn't download the ticket."); } finally { setDownloading(false); }
  };

  if (loading) return <PortalLayout><div className="p-8 max-w-3xl mx-auto"><div className="bg-white rounded-xl shadow-md p-12"><Spinner centered label="Loading…" /></div></div></PortalLayout>;
  if (error || !data) return <PortalLayout><div className="p-8 max-w-3xl mx-auto"><div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error || "Pledge not found"}</div></div></PortalLayout>;

  const { loan, collateral, transactions, paid, balance } = data;
  const brand = data.loan?.tenant_brand_color || "#0e7490";
  const photos = Array.isArray(collateral?.photos) ? collateral.photos : [];

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-3xl mx-auto" style={{ "--brand": brand }}>
        <div className="flex justify-between items-center mb-4">
          <button onClick={() => navigate("/portal/pledges")} className="text-[var(--brand)] font-semibold">← Back to Pledges</button>
          <button onClick={downloadTicket} disabled={downloading} className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"><FileDown size={15} /> {downloading ? "…" : "Pawn ticket"}</button>
        </div>

        {/* Item card */}
        <div className="bg-white rounded-xl shadow-md border border-slate-100 p-5 mb-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-ocean-50 text-ocean-600 flex items-center justify-center shrink-0"><Package size={26} /></div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-slate-900">{collateral?.description || "Pledged item"}</h1>
              <p className="text-sm text-slate-500">{[collateral?.category, collateral?.condition].filter(Boolean).join(" · ") || "—"}</p>
              <p className="text-xs text-slate-400 font-mono mt-1">{loan.loan_code}</p>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS[loan.status] || "bg-slate-100"}`}>{loan.status}</span>
          </div>
          {photos.length > 0 && (
            <div className="flex gap-2 mt-4 overflow-x-auto">
              {photos.map((src, i) => <img key={i} src={src} alt="" className="h-20 w-20 object-cover rounded-lg border border-slate-200" />)}
            </div>
          )}
        </div>

        {/* Redemption summary */}
        <div className="bg-white rounded-xl shadow-md border border-slate-100 p-5 mb-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-slate-500">Borrowed</p><p className="font-bold text-slate-900">{KES(loan.principal_amount)}</p></div>
            <div><p className="text-xs text-slate-500">Redemption total</p><p className="font-bold text-slate-900">{KES(loan.total_amount_due)}</p></div>
            <div><p className="text-xs text-slate-500">Paid</p><p className="font-bold text-emerald-700">{KES(paid)}</p></div>
            <div><p className="text-xs text-slate-500">Balance to redeem</p><p className="font-bold text-slate-900">{KES(balance)}</p></div>
          </div>
          <p className="text-xs text-slate-500 mt-4 flex items-center gap-1.5"><CalendarClock size={14} /> Redeem by <strong>{fmt(loan.end_date)}</strong>{collateral?.appraised_value ? ` · appraised at ${KES(collateral.appraised_value)}` : ""}</p>

          {loan.status === "active" && balance > 0 && (
            <div className="mt-4">
              <MpesaPayButton
                endpoint="/mpesa/stk/loan-repayment"
                payload={{ loan_id: loan.id, amount: balance }}
                apiClient={portalApi}
                amountLabel={KES(balance)}
                buttonText="Redeem with M-Pesa"
                onSuccess={load}
              />
              <p className="text-xs text-slate-400 mt-2">Pay the full balance to clear your pledge. Collateral release is completed in person at the shop.</p>
            </div>
          )}
        </div>

        {/* Payments */}
        <div className="bg-white rounded-xl shadow-md border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100"><h2 className="font-bold text-slate-900">Payments</h2></div>
          {transactions.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No payments yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-5 py-2">Date</th><th className="text-left px-5 py-2">Method</th><th className="text-right px-5 py-2">Amount</th></tr></thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-5 py-2 text-slate-600">{fmt(t.payment_date)}</td>
                    <td className="px-5 py-2 text-slate-600">{t.payment_method || "—"}</td>
                    <td className="px-5 py-2 text-right font-semibold text-emerald-700">{KES(t.amount_paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
