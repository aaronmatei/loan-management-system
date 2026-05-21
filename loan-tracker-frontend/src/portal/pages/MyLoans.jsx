import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import { getPortalBrand } from "../brand";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

const STATUS_BADGE = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  defaulted: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  under_review: "bg-sky-100 text-sky-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-gray-200 text-gray-600",
};

const TABS = [
  { value: "all", label: "All", emoji: "📋" },
  { value: "active", label: "Active", emoji: "🟢" },
  { value: "completed", label: "Completed", emoji: "✅" },
  { value: "defaulted", label: "Defaulted", emoji: "⚠️" },
  { value: "pending", label: "Pending", emoji: "⏳" },
];

function MyLoans() {
  const navigate = useNavigate();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const { brand, gradient } = getPortalBrand();

  useEffect(() => {
    setLoading(true);
    const url =
      filter === "all"
        ? "/portal/customer/loans"
        : `/portal/customer/loans?status=${filter}`;
    portalApi
      .get(url)
      .then((r) => setLoans(r.data.data || []))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/loanfix/portal/select-tenant");
        } else {
          setError(err.response?.data?.error || "Failed to load loans");
        }
      })
      .finally(() => setLoading(false));
  }, [filter, navigate]);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 mb-1">
          💰 My Loans
        </h1>
        <p className="text-slate-500 mb-5">
          View all your loans and their status
        </p>

        <div className="flex flex-wrap gap-2 mb-4 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value)}
              className={`px-3 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition ${
                filter === t.value
                  ? "text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
              style={filter === t.value ? { backgroundColor: brand } : undefined}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            Loading…
          </div>
        )}
        {error && (
          <div className="bg-white rounded-xl p-12 text-center text-red-600">
            {error}
          </div>
        )}
        {!loading && !error && loans.length === 0 && (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            <p className="text-5xl mb-3">📭</p>
            <p>No loans found.</p>
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
                onClick={() => navigate(`/loanfix/portal/loans/${loan.id}`)}
                className="w-full text-left bg-white rounded-2xl shadow-sm border border-slate-100 p-4 lg:p-6 hover:shadow-md transition"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-mono font-bold" style={{ color: brand }}>
                      {loan.loan_code || `#${loan.id}`}
                    </p>
                    <p className="text-sm text-gray-500">
                      {loan.purpose || "Loan"}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${
                      STATUS_BADGE[loan.status] ||
                      "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {String(loan.status || "").replace("_", " ")}
                  </span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Principal</p>
                    <p className="font-bold">{KES(loan.principal_amount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Due</p>
                    <p className="font-bold">{KES(due)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Paid</p>
                    <p className="font-bold text-green-600">{KES(paid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Balance</p>
                    <p className="font-bold text-red-600">{KES(balance)}</p>
                  </div>
                </div>
                {["active", "completed"].includes(loan.status) && (
                  <>
                    <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full"
                        style={{ width: `${progress}%`, background: gradient }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {progress.toFixed(1)}% repaid
                    </p>
                  </>
                )}
                <div className="mt-3 pt-3 border-t flex justify-between items-center text-xs text-gray-500">
                  <span>
                    📅{" "}
                    {loan.created_at
                      ? new Date(loan.created_at).toLocaleDateString()
                      : "—"}
                  </span>
                  <span className="font-semibold" style={{ color: brand }}>
                    View Details →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </PortalLayout>
  );
}

export default MyLoans;
