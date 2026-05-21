import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ArrowRight } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import IconTile from "../../components/IconTile";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

// "All Lenders" is the lender directory: one card per lender the customer is
// linked to, with that lender's totals. The actual loan list lives in "My
// Loans"; each card here deep-links there filtered to the lender.
function AllLenders() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // client_code / member-since aren't in the loans summary — pull them from
  // the lender list cached at login.
  const linkInfo = (() => {
    try {
      const map = {};
      JSON.parse(localStorage.getItem("portal_tenants") || "[]").forEach(
        (t) => (map[t.tenant_id] = t),
      );
      return map;
    } catch {
      return {};
    }
  })();

  useEffect(() => {
    portalApi
      .get("/portal/customer/all-loans")
      .then((r) => setData(r.data.data))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load lenders"),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-slate-500">Loading…</div>
      </PortalLayout>
    );
  }

  const lenders = data?.summary?.by_tenant || [];

  if (lenders.length === 0) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-3xl mx-auto">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center">
            <div className="flex justify-center mb-4">
              <IconTile icon={Building2} variant="ocean" size={64} />
            </div>
            <h1 className="text-2xl font-bold text-navy-900 mb-2">
              No lenders yet
            </h1>
            <p className="text-slate-500 mb-6">
              Add a lender to start borrowing.
            </p>
            <button
              onClick={() => navigate("/loanfix/portal/add-lender")}
              className="px-6 py-3 bg-ocean-gradient text-white font-bold rounded-xl shadow-tile"
            >
              Add a Lender
            </button>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl lg:text-3xl font-bold text-navy-900">
            🏦 All Lenders
          </h1>
          <button
            onClick={() => navigate("/loanfix/portal/add-lender")}
            className="px-4 py-2 bg-ocean-gradient text-white rounded-lg font-semibold text-sm shadow-tile"
          >
            + Add Lender
          </button>
        </div>
        <p className="text-slate-500 mb-6">
          {lenders.length} lender{lenders.length !== 1 ? "s" : ""} linked to
          your account
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {lenders.map((t) => {
            const bc = t.brand_color || "#0086cc";
            const balance =
              parseFloat(t.total_due || 0) - parseFloat(t.total_paid || 0);
            const info = linkInfo[t.tenant_id] || {};
            return (
              <button
                key={t.tenant_id}
                onClick={() =>
                  navigate(`/loanfix/portal/loans?tenant_id=${t.tenant_id}`)
                }
                className="text-left bg-white rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition overflow-hidden"
              >
                <div className="h-1.5" style={{ backgroundColor: bc }} />
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-xl shrink-0"
                      style={{ backgroundColor: bc }}
                    >
                      {t.business_name?.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-navy-900 truncate">
                        {t.business_name}
                      </p>
                      {info.client_code && (
                        <p className="text-xs text-slate-500 font-mono">
                          {info.client_code}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Active</p>
                      <p className="font-bold text-navy-900">{t.active_loans}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Total</p>
                      <p className="font-bold text-navy-900">{t.total_loans}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Balance</p>
                      <p className="font-bold text-red-600">
                        {KES(Math.max(0, balance))}
                      </p>
                    </div>
                  </div>
                  {info.linked_at && (
                    <p className="text-xs text-slate-400 mt-3">
                      Member since{" "}
                      {new Date(info.linked_at).toLocaleDateString()}
                    </p>
                  )}
                  <div
                    className="mt-3 flex items-center justify-end text-sm font-semibold"
                    style={{ color: bc }}
                  >
                    View loans
                    <ArrowRight size={16} className="ml-1" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </PortalLayout>
  );
}

export default AllLenders;
