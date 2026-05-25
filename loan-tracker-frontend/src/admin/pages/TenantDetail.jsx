import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import { AlertTriangle, BarChart3, Phone, Users, Gem } from "lucide-react";

const K = (v) => `KES ${(parseFloat(v || 0) / 1_000).toFixed(0)}K`;

function TenantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    platformApi
      .get(`/platform/admin/tenants/${id}`)
      .then((r) => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <PlatformLayout>
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </PlatformLayout>
    );
  }
  if (!data) return <PlatformLayout><div /></PlatformLayout>;

  const { tenant, financials, users } = data;
  const brand = tenant.brand_color || "#4F46E5";

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8">
        <button
          onClick={() => navigate("/admin/tenants")}
          className="text-ocean-600 mb-4 font-semibold text-sm"
        >
          ← Back to Tenants
        </button>

        <div
          className="rounded-2xl shadow-xl p-6 lg:p-8 mb-6 text-white"
          style={{ background: `linear-gradient(135deg, ${brand}, #7C3AED)` }}
        >
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-4xl font-bold">
              {tenant.business_name?.charAt(0)}
            </div>
            <div>
              <h1 className="text-3xl font-bold">{tenant.business_name}</h1>
              <p className="text-white/80 mt-1">
                {tenant.tenant_code} • {tenant.subdomain}
              </p>
              <span className="inline-block mt-2 px-3 py-1 bg-white/20 rounded-full text-xs font-semibold">
                {String(tenant.status || "").toUpperCase()}
              </span>
            </div>
          </div>
          {tenant.suspension_reason && (
            <p className="mt-4 text-sm bg-white/15 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle size={16} /> Reason: {tenant.suspension_reason}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500">Total Disbursed</p>
            <p className="text-2xl font-bold">
              {K(financials.total_disbursed)}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500">Outstanding</p>
            <p className="text-2xl font-bold text-orange-600">
              {K(financials.outstanding_principal)}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500">Collected</p>
            <p className="text-2xl font-bold text-green-600">
              {K(financials.total_collected)}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500">Interest Earned</p>
            <p className="text-2xl font-bold text-ocean-600">
              {K(financials.total_interest_earned)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2"><BarChart3 size={18} /> Tenant Stats</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Clients</span>
                <span className="font-bold">{tenant.client_count}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Loans</span>
                <span className="font-bold">{tenant.loan_count}</span>
              </div>
              <div className="flex justify-between">
                <span>Active Loans</span>
                <span className="font-bold">{tenant.active_loans}</span>
              </div>
              <div className="flex justify-between">
                <span>Transactions</span>
                <span className="font-bold">
                  {tenant.transaction_count}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Users</span>
                <span className="font-bold">{tenant.user_count}</span>
              </div>
              <div className="flex justify-between">
                <span>Joined</span>
                <span className="font-bold">
                  {new Date(tenant.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Phone size={18} /> Contact</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-500">Contact:</span>{" "}
                {tenant.contact_name || "—"}
              </div>
              <div>
                <span className="text-gray-500">Email:</span>{" "}
                {tenant.contact_email || "—"}
              </div>
              <div>
                <span className="text-gray-500">Phone:</span>{" "}
                {tenant.contact_phone || "—"}
              </div>
              <div>
                <span className="text-gray-500">Location:</span>{" "}
                {[tenant.city, tenant.county].filter(Boolean).join(", ") ||
                  "—"}
              </div>
              <div>
                <span className="text-gray-500">Plan:</span>{" "}
                {tenant.plan || "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 lg:p-6 mb-6">
          <h3 className="font-bold mb-1 flex items-center gap-2"><Gem size={18} /> White-Label Tier</h3>
          <p className="text-sm text-gray-600 mb-3">
            Current:{" "}
            <strong className="capitalize">
              {tenant.white_label_tier || "basic"}
            </strong>
          </p>
          <div className="flex gap-2">
            {["basic", "pro", "enterprise"].map((t) => {
              const current = (tenant.white_label_tier || "basic") === t;
              return (
                <button
                  key={t}
                  onClick={async () => {
                    if (current) return;
                    if (!window.confirm(`Change tier to ${t}?`)) return;
                    try {
                      await platformApi.put(
                        `/white-label/admin/${tenant.id}/tier`,
                        { tier: t },
                      );
                      alert("Tier updated");
                      // refresh
                      const r = await platformApi.get(
                        `/platform/admin/tenants/${tenant.id}`,
                      );
                      setData(r.data.data);
                    } catch (err) {
                      alert(
                        err.response?.data?.error ||
                          "Failed to update tier",
                      );
                    }
                  }}
                  disabled={current}
                  className={`flex-1 py-2 rounded-lg font-semibold text-sm capitalize ${
                    current
                      ? "bg-ocean-600 text-white"
                      : "bg-gray-100 hover:bg-gray-200"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4 lg:p-6">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Users size={18} /> Staff Users ({users.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-gray-500">
                <tr>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Email</th>
                  <th className="text-left p-2">Role</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b">
                    <td className="p-2 font-semibold">
                      {u.first_name} {u.last_name}
                    </td>
                    <td className="p-2">{u.email}</td>
                    <td className="p-2 capitalize">{u.role}</td>
                    <td className="p-2">
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${
                          u.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {u.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="p-2 text-gray-500">
                      {u.last_login
                        ? new Date(u.last_login).toLocaleDateString()
                        : "Never"}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td
                      colSpan="5"
                      className="p-4 text-center text-gray-500"
                    >
                      No staff users.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PlatformLayout>
  );
}

export default TenantDetail;
