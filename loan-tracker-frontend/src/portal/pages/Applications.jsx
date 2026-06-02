import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  Search,
  Coins,
  CheckCircle,
  X,
  Clock,
  PartyPopper,
  FileText,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import { lenderColor } from "../lenderColor";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

const STATUS = {
  pending: {
    color: "bg-yellow-100 text-yellow-700",
    Icon: Clock,
    label: "Awaiting Review",
  },
  under_review: {
    color: "bg-blue-100 text-blue-700",
    Icon: Search,
    label: "Under Review",
  },
  counter_offered: {
    color: "bg-amber-100 text-amber-700",
    Icon: Coins,
    label: "New Offer",
  },
  approved: {
    color: "bg-green-100 text-green-700",
    Icon: CheckCircle,
    label: "Approved!",
  },
  rejected: {
    color: "bg-red-100 text-red-700",
    Icon: X,
    label: "Rejected",
  },
};

// My Applications across every linked lender. Status handling is unchanged
// from before; the page just no longer needs a "current lender".
function CustomerApplications() {
  const navigate = useNavigate();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    portalApi
      .get("/portal/customer/all-applications")
      .then((r) => setApps(r.data.data || []))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load applications"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const cancel = async (app) => {
    if (!window.confirm(`Cancel application ${app.loan_code}?`)) return;
    try {
      // The cancel endpoint is tenant-scoped — point the session at this
      // application's lender first.
      const sel = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: app.tenant_id,
      });
      localStorage.setItem("portal_token", sel.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({
          ...sel.data.current_tenant,
          brand_color: app.tenant_brand_color,
        }),
      );
      await portalApi.delete(`/portal/customer/applications/${app.id}`);
      alert("Application cancelled");
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to cancel");
    }
  };

  // Accept or decline a lender's counter-offer.
  const respond = async (app, accept) => {
    const reason = accept
      ? null
      : window.prompt("Optional: reason for declining") || "";
    if (
      !window.confirm(
        accept
          ? `Accept the offer of ${KES(app.offered_amount)} for ${app.loan_code}?`
          : `Decline the offer for ${app.loan_code}?`,
      )
    )
      return;
    try {
      // The respond endpoint is tenant-scoped — point the session at this
      // application's lender first (same as cancel).
      const sel = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: app.tenant_id,
      });
      localStorage.setItem("portal_token", sel.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({
          ...sel.data.current_tenant,
          brand_color: app.tenant_brand_color,
        }),
      );
      await portalApi.post(`/portal/customer/applications/${app.id}/respond`, {
        accept,
        reason,
      });
      alert(accept ? "Offer accepted!" : "Offer declined");
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to submit your response");
    }
  };

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 flex items-center gap-2">
              <ClipboardList size={28} className="text-navy-900" /> My Applications
            </h1>
            <p className="text-slate-500 mt-1">
              Track your loan application status across all lenders
            </p>
          </div>
          <button
            onClick={() => navigate("/lenders")}
            className="px-4 py-2 bg-ocean-gradient text-white rounded-lg font-semibold shadow-tile"
          >
            + New
          </button>
        </div>

        {apps.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
            <div className="flex justify-center mb-3">
              <FileText size={48} className="text-slate-300" />
            </div>
            <p className="text-navy-900 font-semibold mb-1">
              No applications yet
            </p>
            <p className="text-slate-500 text-sm mb-4">
              Start your loan application journey.
            </p>
            <button
              onClick={() => navigate("/lenders")}
              className="px-6 py-3 bg-ocean-gradient text-white font-bold rounded-lg shadow-tile"
            >
              Apply for a Loan →
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {apps.map((a) => {
              const s = STATUS[a.status] || STATUS.pending;
              const SIcon = s.Icon;
              const bc = lenderColor(a.tenant_brand_color, a.tenant_id);
              return (
                <div
                  key={a.id}
                  className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
                >
                  {/* Lender banner */}
                  <div
                    className="px-4 py-2 flex items-center gap-2"
                    style={{
                      backgroundColor: `${bc}15`,
                      borderLeft: `4px solid ${bc}`,
                    }}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: bc }}
                    >
                      {a.tenant_name?.charAt(0)}
                    </div>
                    <span className="font-semibold text-sm" style={{ color: bc }}>
                      {a.tenant_name}
                    </span>
                  </div>
                  <div className="p-4 lg:p-6">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="font-mono font-bold" style={{ color: bc }}>
                          {a.loan_code}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">{a.purpose}</p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${s.color}`}
                      >
                        <SIcon size={12} /> {s.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500">Amount</p>
                        <p className="font-bold">{KES(a.principal_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Duration</p>
                        <p className="font-bold">
                          {a.loan_duration_months} months
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Total Due</p>
                        <p className="font-bold">{KES(a.total_amount_due)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Applied</p>
                        <p className="font-bold">
                          {a.application_date
                            ? new Date(a.application_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
                            : "—"}
                        </p>
                      </div>
                    </div>

                    {a.status === "approved" && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                        <p className="font-semibold text-green-800 flex items-center gap-1.5">
                          <PartyPopper size={16} className="text-green-700" /> Approved! Your loan will be disbursed shortly.
                        </p>
                        {a.approver_name && (
                          <p className="text-xs text-green-600 mt-1">
                            Approved by {a.approver_name}
                          </p>
                        )}
                      </div>
                    )}
                    {a.status === "rejected" && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                        <p className="font-semibold text-red-800">
                          Application was not approved
                        </p>
                        {a.rejection_reason && (
                          <p className="text-xs text-red-700 mt-1">
                            Reason: {a.rejection_reason}
                          </p>
                        )}
                      </div>
                    )}
                    {a.status === "under_review" && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                        <p className="text-blue-800 flex items-center gap-1.5">
                          <Search size={16} className="text-blue-700 shrink-0" /> A loan officer is reviewing your application.
                        </p>
                        {a.reviewer_name && (
                          <p className="text-xs text-blue-700 mt-1">
                            Reviewing: {a.reviewer_name}
                          </p>
                        )}
                      </div>
                    )}
                    {a.status === "counter_offered" && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                        <p className="font-semibold text-amber-800 flex items-center gap-1.5">
                          <Coins size={16} className="text-amber-700" /> New offer from the lender
                        </p>
                        <p className="text-amber-800 mt-1">
                          You requested{" "}
                          <strong>
                            {KES(a.requested_amount || a.principal_amount)}
                          </strong>
                          . They're offering{" "}
                          <strong>{KES(a.offered_amount)}</strong>.
                        </p>
                        {a.counter_offer_note && (
                          <p className="text-xs text-amber-700 mt-1">
                            Note: {a.counter_offer_note}
                          </p>
                        )}
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => respond(a, true)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold"
                          >
                            <CheckCircle size={15} /> Accept offer
                          </button>
                          <button
                            onClick={() => respond(a, false)}
                            className="px-4 py-2 text-sm bg-red-50 text-red-700 hover:bg-red-100 rounded-lg font-semibold"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    )}
                    {a.status === "pending" && (
                      <div className="flex justify-between items-center pt-3 border-t text-sm">
                        <p className="text-gray-600 flex items-center gap-1.5">
                          <Clock size={15} className="text-gray-500 shrink-0" /> Awaiting review (typically 24–48 hours)
                        </p>
                        <button
                          onClick={() => cancel(a)}
                          className="px-3 py-1 text-xs bg-red-50 text-red-700 hover:bg-red-100 rounded-lg font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export default CustomerApplications;
