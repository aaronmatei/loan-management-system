import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import { Crown, BarChart3, Briefcase, Trophy, UserPlus } from "lucide-react";
import Spinner from "../../components/Spinner";

// Full KES figures (no K/M abbreviation) — e.g. KES 2,000,000, not 2.0M.
const M = (v) =>
  `KES ${parseFloat(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const K = (v) =>
  `KES ${parseFloat(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

function PlatformDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    platformApi
      .get("/platform/admin/dashboard")
      .then((r) => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PlatformLayout>
        <Spinner centered className="py-20" label="Loading…" />
      </PlatformLayout>
    );
  }
  if (!data) return <PlatformLayout><div /></PlatformLayout>;

  const { tenants_overview: to, platform_metrics: pm, recent_signups, top_tenants } =
    data;

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <Crown size={28} className="text-gray-700" /> Platform Overview
        </h1>
        <p className="text-gray-600 mt-1 mb-6">Your SaaS at a glance</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-4">
            <p className="text-ocean-100 text-xs uppercase">Total Tenants</p>
            <p className="text-3xl font-bold mt-1">{to.total_tenants}</p>
            <p className="text-xs text-ocean-100 mt-1">
              {to.active_tenants} active
            </p>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-lg p-4">
            <p className="text-green-100 text-xs uppercase">Active Loans</p>
            <p className="text-3xl font-bold mt-1">{pm.total_active_loans}</p>
            <p className="text-xs text-green-100 mt-1">
              of {pm.total_loans_ever} total
            </p>
          </div>
          <div className="bg-gradient-to-br from-ocean-500 to-ocean-600 text-white rounded-xl shadow-lg p-4">
            <p className="text-ocean-100 text-xs uppercase">Total Disbursed</p>
            <p className="text-xl font-bold mt-1">{M(pm.total_disbursed)}</p>
            <p className="text-xs text-ocean-100 mt-1">Across all tenants</p>
          </div>
          <div className="bg-gradient-to-br from-pink-500 to-rose-600 text-white rounded-xl shadow-lg p-4">
            <p className="text-pink-100 text-xs uppercase">Total Clients</p>
            <p className="text-3xl font-bold mt-1">{pm.total_customers}</p>
            <p className="text-xs text-pink-100 mt-1">
              {pm.total_customer_links} tenant links
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><BarChart3 size={18} /> Tenants Status</h2>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">
                  {to.active_tenants}
                </p>
                <p className="text-xs text-green-600">Active</p>
              </div>
              <div className="bg-yellow-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-yellow-700">
                  {to.trial_tenants}
                </p>
                <p className="text-xs text-yellow-600">Trial</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-700">
                  {to.suspended_tenants}
                </p>
                <p className="text-xs text-red-600">Suspended</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2"><Briefcase size={18} /> Platform Activity</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span>Total Clients</span>
                <span className="font-bold">
                  {parseInt(pm.total_clients, 10).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span>Total Collected</span>
                <span className="font-bold text-green-600">
                  {M(pm.total_collected)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span>Staff Users</span>
                <span className="font-bold">{pm.total_staff_users}</span>
              </div>
              <div className="flex justify-between py-2">
                <span>New Tenants (30 days)</span>
                <span className="font-bold text-ocean-600">
                  +{to.new_this_month}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 lg:p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Trophy size={20} /> Top Tenants</h2>
            <button
              onClick={() => navigate("/admin/tenants")}
              className="text-sm text-ocean-600 font-semibold"
            >
              View All →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">Tenant</th>
                  <th className="text-right p-2">Clients</th>
                  <th className="text-right p-2">Loans</th>
                  <th className="text-right p-2">Portfolio</th>
                  <th className="text-right p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {top_tenants.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/admin/tenants/${t.id}`)}
                    className="border-b hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
                          style={{
                            backgroundColor: t.brand_color || "#0e8a6e",
                          }}
                        >
                          {t.business_name?.charAt(0)}
                        </div>
                        <span className="font-semibold">
                          {t.business_name}
                        </span>
                      </div>
                    </td>
                    <td className="text-right p-2">{t.client_count}</td>
                    <td className="text-right p-2">{t.loan_count}</td>
                    <td className="text-right p-2 font-bold">
                      {K(t.active_portfolio)}
                    </td>
                    <td className="text-right p-2">
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${
                          t.status === "active"
                            ? "bg-green-100 text-green-700"
                            : t.status === "trial"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-700"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 lg:p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <UserPlus size={20} /> Recent Signups
          </h2>
          {recent_signups.length === 0 ? (
            <p className="text-gray-500 text-center py-4">
              No recent signups
            </p>
          ) : (
            <div className="space-y-2">
              {recent_signups.map((t) => (
                <div
                  key={t.id}
                  onClick={() => navigate(`/admin/tenants/${t.id}`)}
                  className="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg cursor-pointer"
                >
                  <div>
                    <p className="font-semibold">{t.business_name}</p>
                    <p className="text-xs text-gray-500">
                      {t.subdomain} • Joined{" "}
                      {new Date(t.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p>{t.client_count} clients</p>
                    <p className="text-xs text-gray-500">
                      {t.loan_count} loans
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PlatformLayout>
  );
}

export default PlatformDashboard;
