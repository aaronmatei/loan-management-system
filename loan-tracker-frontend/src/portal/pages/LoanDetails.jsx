import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const day = (d) => (d ? new Date(d).toLocaleDateString() : "N/A");

function LoanDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("schedule");

  useEffect(() => {
    portalApi
      .get(`/portal/customer/loans/${id}`)
      .then((r) => setData(r.data.data))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/portal/select-tenant");
        } else {
          alert(err.response?.data?.error || "Failed to load loan details");
          navigate("/portal/loans");
        }
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </PortalLayout>
    );
  }
  if (!data) return <PortalLayout><div /></PortalLayout>;

  const { loan, schedule, transactions } = data;
  const due = parseFloat(loan.total_amount_due || 0);
  const paid = parseFloat(loan.total_paid || 0);
  const balance = Math.max(0, due - paid);
  const progress = due > 0 ? Math.min((paid / due) * 100, 100) : 0;
  // interest_rate is the MONTHLY rate as a percent → annual = ×12.
  const annualRate = (parseFloat(loan.interest_rate || 0) * 12).toFixed(2);
  const monthly = loan.loan_duration_months
    ? due / parseInt(loan.loan_duration_months, 10)
    : 0;

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <button
          onClick={() => navigate("/portal/loans")}
          className="text-indigo-600 mb-4 font-semibold"
        >
          ← Back to Loans
        </button>

        <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white rounded-2xl shadow-xl p-6 lg:p-8 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-indigo-200 text-sm">Loan Code</p>
              <h1 className="text-2xl lg:text-3xl font-bold font-mono">
                {loan.loan_code || `#${loan.id}`}
              </h1>
              <p className="text-indigo-100 mt-1">{loan.purpose || "Loan"}</p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/20 capitalize">
              {String(loan.status || "").replace("_", " ")}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-indigo-200 text-xs">Principal</p>
              <p className="text-lg font-bold">
                {KES(loan.principal_amount)}
              </p>
            </div>
            <div>
              <p className="text-indigo-200 text-xs">Total Due</p>
              <p className="text-lg font-bold">{KES(due)}</p>
            </div>
            <div>
              <p className="text-indigo-200 text-xs">Paid So Far</p>
              <p className="text-lg font-bold">{KES(paid)}</p>
            </div>
            <div>
              <p className="text-indigo-200 text-xs">Balance</p>
              <p className="text-lg font-bold">{KES(balance)}</p>
            </div>
          </div>
          {["active", "completed"].includes(loan.status) && (
            <div>
              <div className="bg-white/20 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-white h-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-indigo-100 mt-2">
                {progress.toFixed(1)}% repaid
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-bold text-gray-800 mb-3">
              📋 Loan Information
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Duration</span>
                <span className="font-semibold">
                  {loan.loan_duration_months} months
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Interest Rate</span>
                <span className="font-semibold">{annualRate}% p.a.</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Start Date</span>
                <span className="font-semibold">{day(loan.start_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">End Date</span>
                <span className="font-semibold">{day(loan.end_date)}</span>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-bold text-gray-800 mb-3">
              💰 Financial Summary
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Interest</span>
                <span className="font-semibold">
                  {KES(loan.total_interest)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Monthly Payment</span>
                <span className="font-semibold">{KES(monthly)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Payments Made</span>
                <span className="font-semibold">
                  {(transactions || []).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Schedule Items</span>
                <span className="font-semibold">
                  {(schedule || []).length}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="flex border-b">
            <button
              onClick={() => setTab("schedule")}
              className={`flex-1 py-3 px-4 font-semibold ${
                tab === "schedule"
                  ? "bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600"
                  : "text-gray-600"
              }`}
            >
              📅 Payment Schedule
            </button>
            <button
              onClick={() => setTab("history")}
              className={`flex-1 py-3 px-4 font-semibold ${
                tab === "history"
                  ? "bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600"
                  : "text-gray-600"
              }`}
            >
              💳 Payment History
            </button>
          </div>

          {tab === "schedule" && (
            <div className="p-4">
              {(schedule || []).length === 0 ? (
                <p className="text-center text-gray-500 py-6">
                  No schedule (loan not yet disbursed).
                </p>
              ) : (
                <div className="space-y-2">
                  {schedule.map((s) => (
                    <div
                      key={s.id}
                      className={`flex justify-between items-center p-3 rounded-lg ${
                        s.status === "paid"
                          ? "bg-green-50"
                          : s.status === "overdue"
                            ? "bg-red-50"
                            : "bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">
                          {s.status === "paid"
                            ? "✅"
                            : s.status === "overdue"
                              ? "⚠️"
                              : "⏳"}
                        </span>
                        <div>
                          <p className="font-semibold">
                            Payment #{s.payment_number}
                          </p>
                          <p className="text-xs text-gray-500">
                            Due: {day(s.due_date)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{KES(s.amount_due)}</p>
                        <p className="text-xs capitalize text-gray-600">
                          {s.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="p-4">
              {(transactions || []).length === 0 ? (
                <p className="text-center text-gray-500 py-6">
                  No payments yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {transactions.map((t) => (
                    <div
                      key={t.id}
                      className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-semibold">
                          {KES(t.amount_paid)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {day(t.payment_date)} · {t.payment_method}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 font-mono">
                          {t.transaction_code}
                        </p>
                        <p className="text-xs text-green-600 font-semibold capitalize">
                          {t.payment_status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

export default LoanDetails;
