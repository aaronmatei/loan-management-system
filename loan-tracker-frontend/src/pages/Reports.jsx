import React, { useState } from "react";
import api from "../services/api";

function Reports() {
  const [exporting, setExporting] = useState(null);
  const [dateRange, setDateRange] = useState({
    from: "",
    to: new Date().toISOString().split("T")[0],
  });

  const downloadFile = async (url, filename) => {
    setExporting(url);
    try {
      const response = await api.get(url, {
        responseType: "blob",
      });

      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert(
        "Failed to download: " +
          (err.response?.data?.error || err.message),
      );
    } finally {
      setExporting(null);
    }
  };

  const reports = [
    {
      title: "All Clients",
      description:
        "Complete client database with contact details and statistics",
      icon: "👥",
      color: "from-blue-500 to-indigo-600",
      url: "/reports/export/clients",
      filename: `clients_${new Date().toISOString().split("T")[0]}.xlsx`,
    },
    {
      title: "All Loans",
      description: "Comprehensive loans report with status and balances",
      icon: "💰",
      color: "from-purple-500 to-indigo-600",
      url: "/reports/export/loans",
      filename: `loans_${new Date().toISOString().split("T")[0]}.xlsx`,
    },
    {
      title: "Active Loans Only",
      description: "All currently active loans for collection management",
      icon: "🟢",
      color: "from-green-500 to-emerald-600",
      url: "/reports/export/loans?status=active",
      filename: `active_loans_${new Date().toISOString().split("T")[0]}.xlsx`,
    },
    {
      title: "Completed Loans",
      description: "Successfully repaid loans for records",
      icon: "✅",
      color: "from-cyan-500 to-blue-600",
      url: "/reports/export/loans?status=completed",
      filename: `completed_loans_${new Date().toISOString().split("T")[0]}.xlsx`,
    },
    {
      title: "Defaulted Loans",
      description: "Loans marked as defaulted for follow-up",
      icon: "🔴",
      color: "from-red-500 to-pink-600",
      url: "/reports/export/loans?status=defaulted",
      filename: `defaulted_loans_${new Date().toISOString().split("T")[0]}.xlsx`,
    },
    {
      title: "Overdue Payments",
      description: "All overdue payment schedules with days late",
      icon: "⚠️",
      color: "from-orange-500 to-red-600",
      url: "/reports/export/overdue",
      filename: `overdue_${new Date().toISOString().split("T")[0]}.xlsx`,
    },
  ];

  const downloadPayments = () => {
    const params = new URLSearchParams();
    if (dateRange.from) params.append("date_from", dateRange.from);
    if (dateRange.to) params.append("date_to", dateRange.to);

    const url = `/reports/export/payments${
      params.toString() ? "?" + params.toString() : ""
    }`;
    downloadFile(
      url,
      `payments_${dateRange.from || "all"}_to_${dateRange.to}.xlsx`,
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800">
          Reports &amp; Exports
        </h1>
        <p className="text-gray-600 mt-2">
          Download data for analysis, accounting, and compliance
        </p>
      </div>

      {/* Excel Exports */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-4">
          📊 Excel Exports
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((report, idx) => (
            <div
              key={idx}
              className={`bg-gradient-to-br ${report.color} text-white rounded-xl shadow-lg p-6`}
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-4xl">{report.icon}</span>
                {exporting === report.url && (
                  <span className="text-sm">Downloading...</span>
                )}
              </div>
              <h3 className="text-lg font-bold mb-2">{report.title}</h3>
              <p className="text-sm text-white/80 mb-4">
                {report.description}
              </p>
              <button
                onClick={() => downloadFile(report.url, report.filename)}
                disabled={exporting !== null}
                className="w-full px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition font-semibold disabled:opacity-50"
              >
                ⬇️ Download Excel
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Date Range Payments */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-4">
          📅 Payments by Date Range
        </h2>
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) =>
                  setDateRange({ ...dateRange, from: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) =>
                  setDateRange({ ...dateRange, to: e.target.value })
                }
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <button
              onClick={downloadPayments}
              disabled={exporting !== null}
              className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
            >
              ⬇️ Download Payments
            </button>
          </div>
        </div>
      </div>

      {/* Info Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
        <h3 className="font-bold text-blue-900 mb-2">💡 About Reports</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Excel files include filters and formatting for easy analysis</li>
          <li>
            • PDF statements available from individual Client and Loan pages
          </li>
          <li>• All exports respect current data - generate fresh anytime</li>
          <li>• Use date ranges for monthly/quarterly reports</li>
        </ul>
      </div>
    </div>
  );
}

export default Reports;
