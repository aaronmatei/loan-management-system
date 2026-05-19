import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const day = (d) => (d ? new Date(d).toLocaleDateString() : "—");

const SCHED_BADGE = {
  paid: "bg-green-100 text-green-700",
  pending: "bg-gray-100 text-gray-600",
  overdue: "bg-red-100 text-red-700",
};

function LoanDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    portalApi
      .get(`/portal/customer/loans/${id}`)
      .then((r) => setData(r.data.data))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/portal/select-tenant");
        } else {
          setError(err.response?.data?.error || "Failed to load loan");
        }
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        <button
          onClick={() => navigate("/portal/loans")}
          className="text-indigo-600 text-sm mb-4"
        >
          ← Back to My Loans
        </button>

        {loading && (
          <p className="text-center text-gray-500 py-10">Loading…</p>
        )}
        {error && <p className="text-center text-red-600 py-10">{error}</p>}

        {data && (
          <>
            {(() => {
              const l = data.loan;
              const due = parseFloat(l.total_amount_due || 0);
              const paid = parseFloat(l.total_paid || 0);
              const balance = Math.max(0, due - paid);
              return (
                <div className="bg-white rounded-xl shadow p-5 mb-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="font-mono text-lg font-bold text-indigo-600">
                        {l.loan_code || `#${l.id}`}
                      </p>
                      <p className="text-sm text-gray-500 capitalize">
                        {String(l.status || "").replace("_", " ")} · started{" "}
                        {day(l.start_date)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Principal</p>
                      <p className="font-semibold">
                        {KES(l.principal_amount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Total Due</p>
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
                </div>
              );
            })()}

            <section className="bg-white rounded-xl shadow mb-6">
              <h2 className="px-4 py-3 font-bold text-gray-800 border-b">
                Payment Schedule
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-2">#</th>
                      <th className="text-left px-4 py-2">Due Date</th>
                      <th className="text-right px-4 py-2">Amount Due</th>
                      <th className="text-right px-4 py-2">Paid</th>
                      <th className="text-center px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.schedule || []).map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="px-4 py-2">{s.payment_number}</td>
                        <td className="px-4 py-2">{day(s.due_date)}</td>
                        <td className="px-4 py-2 text-right">
                          {KES(s.amount_due)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {KES(s.amount_paid)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                              SCHED_BADGE[s.status] ||
                              "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {(data.schedule || []).length === 0 && (
                      <tr>
                        <td
                          colSpan="5"
                          className="px-4 py-6 text-center text-gray-500"
                        >
                          No schedule (loan not yet disbursed).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white rounded-xl shadow">
              <h2 className="px-4 py-3 font-bold text-gray-800 border-b">
                Payments ({(data.transactions || []).length})
              </h2>
              {(data.transactions || []).length === 0 ? (
                <p className="px-4 py-6 text-gray-500 text-sm">
                  No payments recorded yet.
                </p>
              ) : (
                (data.transactions || []).map((t) => (
                  <div
                    key={t.id}
                    className="px-4 py-3 border-t flex justify-between text-sm"
                  >
                    <div>
                      <p className="font-mono text-indigo-600">
                        {t.transaction_code}
                      </p>
                      <p className="text-xs text-gray-500">
                        {day(t.payment_date)} · {t.payment_method}
                      </p>
                    </div>
                    <p className="font-semibold text-green-600">
                      {KES(t.amount_paid)}
                    </p>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </PortalLayout>
  );
}

export default LoanDetails;
