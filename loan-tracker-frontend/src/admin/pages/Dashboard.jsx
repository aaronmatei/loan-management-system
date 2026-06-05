import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import { Crown, BarChart3, Briefcase, Trophy, UserPlus, Banknote } from "lucide-react";
import Spinner from "../../components/Spinner";
import StatCard from "../components/StatCard";

// Full KES figures (no K/M abbreviation) — e.g. KES 2,000,000, not 2.0M.
const M = (v) =>
  `KES ${parseFloat(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const K = (v) =>
  `KES ${parseFloat(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

// One labelled figure in the consolidated Tenants panel.
function Stat({ label, value }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-100">
      <span className="text-gray-600">{label}</span>
      <span className="font-bold text-gray-800">{value}</span>
    </div>
  );
}

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

  const {
    tenants_overview: to,
    platform_metrics: pm,
    recent_signups,
    top_tenants,
    monthly_revenue = [],
  } = data;
  const maxRev = Math.max(...monthly_revenue.map((r) => r.revenue), 1);
  const expectedShare = parseFloat(pm.expected_share || 0);
  const paid = parseFloat(pm.total_revenue || 0);
  const pending = Math.max(0, expectedShare - paid);

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <Crown size={28} className="text-gray-700" /> Platform Overview
        </h1>
        <p className="text-gray-600 mt-1 mb-6">Your SaaS at a glance</p>

        {/* All-Time Revenue — headline, styled like the portal total bar. */}
        <div className="flex items-center justify-between gap-3 bg-navy-900 text-white rounded-2xl px-6 py-5 mb-6">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-ocean-200/70">
              All-Time Revenue
            </p>
            <p className="text-xs text-ocean-200/50">
              Platform fees collected from all tenants
            </p>
          </div>
          <p className="text-3xl lg:text-4xl font-bold whitespace-nowrap">
            {M(pm.total_revenue)}
          </p>
        </div>

        {/* Platform financials — all figures in black. */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <StatCard
            dark
            accent="violet"
            label="Total Disbursed"
            value={M(pm.total_disbursed)}
            sub="Across all tenants"
          />
          <StatCard
            dark
            accent="ocean"
            label="Contract Interest"
            value={M(pm.total_contract_interest)}
            sub="On disbursed loans"
          />
          <StatCard
            dark
            accent="green"
            label="Collected Interest"
            value={M(pm.total_interest_collected)}
            sub="Earned to date"
          />
          <StatCard
            dark
            accent="amber"
            label="My Expected Share"
            value={M(expectedShare)}
            sub="Fee on collected interest"
          />
          <StatCard
            dark
            accent="green"
            label="What I've Been Paid"
            value={M(paid)}
            sub="Fees received"
          />
          <StatCard
            dark
            accent="rose"
            label="What's Pending"
            value={M(pending)}
            sub="Expected − paid"
          />
        </div>

        {/* Per-month platform revenue (fees received), most recent first. */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 mb-6">
          <h2 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
            <Banknote size={18} /> Revenue by Month
          </h2>
          {monthly_revenue.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              No platform revenue recorded yet — it appears here as tenants pay
              their invoices.
            </p>
          ) : (
            <div className="space-y-2.5">
              {monthly_revenue.map((r) => {
                const pct = Math.max(3, Math.round((r.revenue / maxRev) * 100));
                return (
                  <div key={r.month} className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-20 shrink-0">
                      {r.month}
                    </span>
                    <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-ocean-gradient"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-slate-700 w-32 text-right">
                      {M(r.revenue)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Tenants Status — status boxes + the moved count tiles. */}
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
              <BarChart3 size={18} /> Tenants Status
            </h2>
            <div className="grid grid-cols-3 gap-2 mb-3">
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
            <div className="space-y-2 text-sm">
              <Stat label="Total Tenants" value={to.total_tenants} />
              <Stat
                label="Active Loans"
                value={`${pm.total_active_loans} of ${pm.total_loans_ever}`}
              />
              <Stat label="Total Clients" value={pm.total_customers} />
            </div>
          </div>

          {/* Platform Activity — restored. */}
          <div className="bg-white rounded-xl shadow p-4">
            <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
              <Briefcase size={18} /> Platform Activity
            </h2>
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
                <span>Contract Interest</span>
                <span className="font-bold">
                  {M(pm.total_contract_interest)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span>Interest Collected</span>
                <span className="font-bold text-green-600">
                  {M(pm.total_interest_collected)}
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
