import React, { useState, useEffect } from "react";
import { FileText, Download, Loader2 } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import { lenderColor } from "../lenderColor";
import Skeleton from "../../components/Skeleton";
import { CARD, INK, MUTED } from "../theme";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

// Loan statements across every lender. Each loan offers its own PDF statement
// (the same per-loan endpoint the loan detail page uses) — we scope the session
// to that loan's lender first, then stream the PDF.
function Statements() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // loan id currently downloading

  useEffect(() => {
    portalApi
      .get("/portal/customer/all-loans")
      .then((r) => setLoans(r.data.data?.loans || []))
      .catch((err) => alert(err.response?.data?.error || "Failed to load loans"))
      .finally(() => setLoading(false));
  }, []);

  const download = async (loan) => {
    setBusy(loan.id);
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: loan.tenant_id,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({ ...r.data.current_tenant, brand_color: loan.tenant_brand_color }),
      );
      const res = await portalApi.get(`/portal/customer/loans/${loan.id}/statement`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `statement_${loan.loan_code || loan.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download statement");
    } finally {
      setBusy(null);
    }
  };

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <p className={`${MUTED} mb-4 text-sm`}>
          Download an official PDF statement for any of your loans.
        </p>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-[18px]" />
            ))}
          </div>
        ) : loans.length === 0 ? (
          <div className={`${CARD} p-12 text-center ${MUTED}`}>
            <div className="flex justify-center mb-3">
              <FileText size={44} className="text-[#d8cfbd] dark:text-slate-600" />
            </div>
            <p>No loans to generate statements for yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {loans.map((loan) => {
              const bc = lenderColor(loan.tenant_brand_color, loan.tenant_id);
              const balance =
                parseFloat(loan.total_amount_due || 0) - parseFloat(loan.total_paid || 0);
              return (
                <div key={loan.id} className={`${CARD} p-4 flex items-center gap-4`}>
                  <span
                    className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white font-extrabold shrink-0"
                    style={{ background: bc }}
                  >
                    {(loan.tenant_name || "?").charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[14px] font-bold ${INK} font-mono truncate`}>
                      {loan.loan_code || `Loan #${loan.id}`}
                    </div>
                    <div className={`text-[12px] ${MUTED} font-medium truncate`}>
                      {loan.tenant_name} · {KES(loan.principal_amount)}
                      {balance > 0 ? ` · ${KES(balance)} balance` : " · cleared"}
                    </div>
                  </div>
                  <button
                    onClick={() => download(loan)}
                    disabled={busy === loan.id}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[11px] text-white text-[13px] font-bold shrink-0 transition hover:brightness-105 disabled:opacity-60"
                    style={{ background: bc }}
                  >
                    {busy === loan.id ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Download size={15} />
                    )}
                    <span className="hidden sm:inline">
                      {busy === loan.id ? "Preparing…" : "Statement"}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export default Statements;
