import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

const STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  defaulted: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  under_review: "bg-indigo-100 text-indigo-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-gray-200 text-gray-600",
};

function MyLoans() {
  const navigate = useNavigate();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    portalApi
      .get("/portal/customer/loans")
      .then((r) => setLoans(r.data.data || []))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/portal/select-tenant");
        } else {
          setError(err.response?.data?.error || "Failed to load loans");
        }
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 mb-6">
          💰 My Loans
        </h1>

        {loading && (
          <p className="text-center text-gray-500 py-10">Loading…</p>
        )}
        {error && (
          <p className="text-center text-red-600 py-10">{error}</p>
        )}

        {!loading && !error && loans.length === 0 && (
          <div className="bg-white rounded-xl shadow p-10 text-center text-gray-500">
            <p className="text-4xl mb-2">📭</p>
            <p>No loans at this lender yet.</p>
          </div>
        )}

        <div className="space-y-3">
          {loans.map((loan) => {
            const due = parseFloat(loan.total_amount_due || 0);
            const paid = parseFloat(loan.total_paid || 0);
            const balance = Math.max(0, due - paid);
            const progress = due > 0 ? Math.min((paid / due) * 100, 100) : 0;
            return (
              <button
                key={loan.id}
                onClick={() => navigate(`/portal/loans/${loan.id}`)}
                className="w-full text-left bg-white border rounded-xl p-4 hover:shadow-md transition"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-mono font-bold text-indigo-600">
                      {loan.loan_code || `#${loan.id}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      Principal {KES(loan.principal_amount)}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${
                      STATUS_BADGE[loan.status] || "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {String(loan.status || "").replace("_", " ")}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                  <div>
                    <p className="text-xs text-gray-500">Due</p>
                    <p className="font-semibold">{KES(due)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Paid</p>
                    <p className="font-semibold text-green-600">
                      {KES(paid)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Balance</p>
                    <p className="font-semibold text-red-600">
                      {KES(balance)}
                    </p>
                  </div>
                </div>
                <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 h-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {progress.toFixed(1)}% repaid · View details →
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </PortalLayout>
  );
}

export default MyLoans;
