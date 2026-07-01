import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Building2, Search, ChevronRight } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import { lenderColor } from "../lenderColor";
import Skeleton from "../../components/Skeleton";
import { CARD, INK, MUTED, LABEL } from "../theme";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
// Tenants store the annual rate; borrowers think monthly.
const PM = (annual) => +(parseFloat(annual || 0) / 12).toFixed(2);

// "Apply for a loan" landing — lists only the lenders the borrower has already
// LINKED (via /portal/customer/calculator-policies, the linked-lender policy
// feed) and lets them start an application with one. Discovering/linking NEW
// lenders lives on the separate /lenders marketplace.
function ApplyHub() {
  const navigate = useNavigate();
  const [lenders, setLenders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi
      .get("/portal/customer/calculator-policies")
      .then((r) => setLenders(r.data.data || []))
      .catch((err) => alert(err.response?.data?.error || "Failed to load lenders"))
      .finally(() => setLoading(false));
  }, []);

  // Open the lender's loan products (packages + their standard flat loan); the
  // borrower then borrows against a specific one from there. Going straight to
  // the wizard would silently pick the flat loan and hide the packages.
  const startApplication = (tenantId) => navigate(`/lenders/${tenantId}?from=apply`);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className={`${MUTED} text-sm`}>Pick a lender you're linked with to see their loan products and apply.</p>
          <button
            onClick={() => navigate("/lenders")}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#0d8f63] shrink-0"
          >
            <Search size={15} /> Find more lenders
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-[18px]" />
            ))}
          </div>
        ) : lenders.length === 0 ? (
          <div className={`${CARD} p-10 text-center`}>
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "#eaf6ef" }}>
                <Building2 size={26} className="text-[#0d8f63]" />
              </div>
            </div>
            <h2 className={`text-lg font-extrabold ${INK} mb-1`}>No linked lenders yet</h2>
            <p className={`${MUTED} mb-5 max-w-sm mx-auto text-sm`}>
              Link a lender first — browse the marketplace, open a lender, and connect. Then come back here to apply.
            </p>
            <button
              onClick={() => navigate("/lenders")}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-white font-bold rounded-[12px] transition hover:brightness-110"
              style={{ background: "#0d8f63" }}
            >
              Browse lenders <ArrowRight size={17} />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {lenders.map((l) => {
              const bc = lenderColor(l.brand_color, l.tenant_id);
              return (
                <button
                  key={l.tenant_id}
                  onClick={() => startApplication(l.tenant_id)}
                  className={`${CARD} p-5 text-left hover:shadow-[0_10px_30px_-18px_rgba(15,30,60,0.25)] transition group`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white font-extrabold shrink-0"
                      style={{ background: bc }}
                    >
                      {(l.business_name || "?").charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[14px] font-bold ${INK} truncate`}>{l.business_name}</div>
                      <div className={`text-[12px] ${MUTED} font-medium`}>{PM(l.default_interest_rate)}% / mo</div>
                    </div>
                    <ChevronRight size={16} className="text-[#c3bcab] group-hover:text-[#8a8170] transition" />
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div>
                      <div className={LABEL}>Borrow</div>
                      <div className={`text-[13px] font-bold ${INK} mt-0.5`}>
                        {KES(l.min_amount)}–{KES(l.max_amount)}
                      </div>
                    </div>
                    <div>
                      <div className={LABEL}>Term</div>
                      <div className={`text-[13px] font-bold ${INK} mt-0.5`}>
                        up to {l.default_duration_months || 12} mo
                      </div>
                    </div>
                  </div>

                  <div
                    className="mt-4 w-full rounded-[11px] py-2.5 text-center text-white text-[13px] font-bold transition group-hover:brightness-110"
                    style={{ background: bc }}
                  >
                    View loan products
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export default ApplyHub;
