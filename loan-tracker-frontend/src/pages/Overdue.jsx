import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

// Severity colour by days late: 1-7 yellow, 8-30 orange, 30+ red
function daysBadgeClass(days) {
  if (days > 30) return "bg-red-100 text-red-700";
  if (days >= 8) return "bg-orange-100 text-orange-700";
  return "bg-yellow-100 text-yellow-700";
}

const RANGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "1-7", label: "1-7 days" },
  { key: "8-30", label: "8-30 days" },
  { key: "30+", label: "30+ days" },
];

function inRange(days, range) {
  if (range === "1-7") return days >= 1 && days <= 7;
  if (range === "8-30") return days >= 8 && days <= 30;
  if (range === "30+") return days > 30;
  return true; // "all"
}

function Overdue() {
  const navigate = useNavigate();
  const [overdue, setOverdue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchOverdue();
  }, []);

  const fetchOverdue = async () => {
    try {
      setLoading(true);
      const response = await api.get("/overdue");
      setOverdue(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load overdue payments");
    } finally {
      setLoading(false);
    }
  };

  // Client-side filtering: severity range + search by name/phone
  const filtered = overdue.filter((p) => {
    const days = parseInt(p.days_late, 10) || 0;
    if (!inRange(days, range)) return false;

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const haystack = [p.first_name, p.last_name, p.phone_number]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Summary cards reflect the currently displayed set
  const totalAmount = filtered.reduce(
    (sum, p) => sum + parseFloat(p.amount_outstanding || 0),
    0,
  );
  const affectedLoans = new Set(filtered.map((p) => p.loan_id)).size;
  const avgDays = filtered.length
    ? Math.round(
        filtered.reduce((s, p) => s + (parseInt(p.days_late, 10) || 0), 0) /
          filtered.length,
      )
    : 0;

  // Count per range (badges on the filter buttons)
  const rangeCounts = {
    all: overdue.length,
    "1-7": overdue.filter((p) =>
      inRange(parseInt(p.days_late, 10) || 0, "1-7"),
    ).length,
    "8-30": overdue.filter((p) =>
      inRange(parseInt(p.days_late, 10) || 0, "8-30"),
    ).length,
    "30+": overdue.filter((p) =>
      inRange(parseInt(p.days_late, 10) || 0, "30+"),
    ).length,
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800">⚠️ Overdue Payments</h1>
        <p className="text-gray-600 mt-1">
          Installments past their due date that still have a balance owing
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center text-gray-600">
          Loading overdue payments...
        </div>
      ) : overdue.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md p-12 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h3 className="text-xl font-semibold text-gray-600 mb-2">
            No overdue payments
          </h3>
          <p className="text-gray-500">
            Every scheduled installment is on track. Great work!
          </p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-red-500 to-rose-600 text-white rounded-xl shadow-lg p-6">
              <p className="text-red-100 text-sm uppercase font-semibold">
                Overdue Payments
              </p>
              <p className="text-3xl font-bold mt-2">{filtered.length}</p>
              <p className="text-red-100 text-sm mt-2">
                installments past due
              </p>
            </div>
            <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-xl shadow-lg p-6">
              <p className="text-orange-100 text-sm uppercase font-semibold">
                Overdue Amount
              </p>
              <p className="text-3xl font-bold mt-2">
                KES {totalAmount.toLocaleString()}
              </p>
              <p className="text-orange-100 text-sm mt-2">still owed</p>
            </div>
            <div className="bg-gradient-to-br from-amber-500 to-orange-600 text-white rounded-xl shadow-lg p-6">
              <p className="text-amber-100 text-sm uppercase font-semibold">
                Affected Loans
              </p>
              <p className="text-3xl font-bold mt-2">{affectedLoans}</p>
              <p className="text-amber-100 text-sm mt-2">
                loans with arrears
              </p>
            </div>
            <div className="bg-gradient-to-br from-rose-500 to-pink-600 text-white rounded-xl shadow-lg p-6">
              <p className="text-rose-100 text-sm uppercase font-semibold">
                Avg Days Overdue
              </p>
              <p className="text-3xl font-bold mt-2">{avgDays}</p>
              <p className="text-rose-100 text-sm mt-2">days on average</p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2">
                {RANGE_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setRange(f.key)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                      range === f.key
                        ? "bg-gradient-to-r from-red-500 to-rose-600 text-white shadow"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {f.label} ({rangeCounts[f.key]})
                  </button>
                ))}
              </div>

              <div className="flex-1 min-w-[220px]">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    🔍
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by client name or phone..."
                    className="w-full pl-9 pr-3 py-2 border-2 border-gray-200 rounded-lg focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-12 text-center">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-xl font-semibold text-gray-600 mb-2">
                No overdue payments match your filters
              </h3>
              <p className="text-gray-500 mb-4">
                Try a different range or clear your search
              </p>
              <button
                onClick={() => {
                  setRange("all");
                  setSearchQuery("");
                }}
                className="px-6 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg hover:shadow-lg transition"
              >
                ✖ Clear Filters
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b-2 border-gray-200">
                    <tr>
                      <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                        Client
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                        Loan Code
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                        Payment #
                      </th>
                      <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                        Due Date
                      </th>
                      <th className="px-4 py-4 text-center text-xs font-semibold text-gray-600 uppercase">
                        Days Late
                      </th>
                      <th className="px-4 py-4 text-right text-xs font-semibold text-gray-600 uppercase">
                        Amount Due
                      </th>
                      <th className="px-4 py-4 text-center text-xs font-semibold text-gray-600 uppercase">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => {
                      const days = parseInt(p.days_late, 10) || 0;
                      const amount = parseFloat(p.amount_outstanding || 0);
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-gray-100 hover:bg-red-50 transition"
                        >
                          <td className="px-4 py-4">
                            <p className="font-semibold text-gray-800 text-sm">
                              {p.first_name} {p.last_name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {p.phone_number}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <button
                              onClick={() => navigate(`/loans/${p.loan_id}`)}
                              className="font-mono text-sm font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                            >
                              {p.loan_code}
                            </button>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            {p.payment_number} of {p.total_payments}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            {new Date(p.due_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${daysBadgeClass(
                                days,
                              )}`}
                            >
                              {days} {days === 1 ? "day" : "days"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <p className="font-bold text-red-600 text-sm">
                              KES {amount.toLocaleString()}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <button
                              onClick={() => navigate(`/loans/${p.loan_id}`)}
                              className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-700 text-white text-xs font-semibold rounded-lg hover:shadow-lg transition"
                            >
                              View Loan
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  {/* TOTALS ROW */}
                  <tfoot className="bg-gradient-to-r from-red-50 to-rose-50 border-t-2 border-red-200">
                    <tr>
                      <td
                        colSpan="4"
                        className="px-4 py-4 font-bold text-gray-800 text-sm"
                      >
                        📊 TOTALS ({filtered.length} overdue •{" "}
                        {affectedLoans} loans)
                      </td>
                      <td className="px-4 py-4 text-center font-bold text-gray-800 text-sm">
                        {avgDays} avg
                      </td>
                      <td className="px-4 py-4 text-right font-bold text-red-700 text-sm">
                        KES {totalAmount.toLocaleString()}
                      </td>
                      <td className="px-4 py-4"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Overdue;
