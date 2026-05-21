import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import { getPortalBrand } from "../brand";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

const STATUS = {
  pending: {
    color: "bg-yellow-100 text-yellow-700",
    icon: "⏳",
    label: "Awaiting Review",
  },
  under_review: {
    color: "bg-blue-100 text-blue-700",
    icon: "🔍",
    label: "Under Review",
  },
  approved: {
    color: "bg-green-100 text-green-700",
    icon: "✅",
    label: "Approved!",
  },
  rejected: {
    color: "bg-red-100 text-red-700",
    icon: "❌",
    label: "Rejected",
  },
};

function CustomerApplications() {
  const navigate = useNavigate();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const { brand, gradient } = getPortalBrand();

  const load = () => {
    // Per-lender page — needs a lender selected. Drill in from the dashboard.
    if (!localStorage.getItem("portal_current_tenant")) {
      navigate("/loanfix/portal/dashboard");
      return;
    }
    setLoading(true);
    portalApi
      .get("/portal/customer/applications")
      .then((r) => setApps(r.data.data || []))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant")
          navigate("/loanfix/portal/dashboard");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [navigate]);

  const cancel = async (app) => {
    if (!window.confirm(`Cancel application ${app.loan_code}?`)) return;
    try {
      await portalApi.delete(`/portal/customer/applications/${app.id}`);
      alert("✅ Application cancelled");
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to cancel");
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
            <h1 className="text-2xl lg:text-3xl font-bold text-navy-900">
              📋 My Applications
            </h1>
            <p className="text-slate-500 mt-1">
              Track your loan application status
            </p>
          </div>
          <button
            onClick={() => navigate("/loanfix/portal/apply")}
            className="px-4 py-2 text-white rounded-lg font-semibold"
            style={{ background: gradient }}
          >
            + New
          </button>
        </div>

        {apps.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
            <p className="text-5xl mb-3">📝</p>
            <p className="text-navy-900 font-semibold mb-1">
              No applications yet
            </p>
            <p className="text-slate-500 text-sm mb-4">
              Start your loan application journey.
            </p>
            <button
              onClick={() => navigate("/loanfix/portal/apply")}
              className="px-6 py-3 text-white font-bold rounded-lg"
              style={{ background: gradient }}
            >
              Apply for a Loan →
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {apps.map((a) => {
              const s = STATUS[a.status] || STATUS.pending;
              return (
                <div key={a.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 lg:p-6">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-mono font-bold" style={{ color: brand }}>
                        {a.loan_code}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {a.purpose}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${s.color}`}
                    >
                      {s.icon} {s.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Amount</p>
                      <p className="font-bold">
                        {KES(a.principal_amount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Duration</p>
                      <p className="font-bold">
                        {a.loan_duration_months} months
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Total Due</p>
                      <p className="font-bold">
                        {KES(a.total_amount_due)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Applied</p>
                      <p className="font-bold">
                        {a.application_date
                          ? new Date(
                              a.application_date,
                            ).toLocaleDateString()
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {a.status === "approved" && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                      <p className="font-semibold text-green-800">
                        🎉 Approved! Your loan will be disbursed shortly.
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
                      <p className="text-blue-800">
                        🔍 A loan officer is reviewing your application.
                      </p>
                      {a.reviewer_name && (
                        <p className="text-xs text-blue-700 mt-1">
                          Reviewing: {a.reviewer_name}
                        </p>
                      )}
                    </div>
                  )}
                  {a.status === "pending" && (
                    <div className="flex justify-between items-center pt-3 border-t text-sm">
                      <p className="text-gray-600">
                        ⏳ Awaiting review (typically 24–48 hours)
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
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export default CustomerApplications;
