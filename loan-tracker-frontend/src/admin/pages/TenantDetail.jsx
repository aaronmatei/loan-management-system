import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import { ArrowLeft, AlertTriangle, Percent, Gem } from "lucide-react";
import Skeleton from "../../components/Skeleton";
import { formatKES } from "../../utils/money";

const K = (v) => formatKES(v);

const STATUS = {
  active: { c: "#16a34a", b: "#e4f5ec" },
  trial: { c: "#0e8a6e", b: "#e0f4ee" },
  suspended: { c: "#e5484d", b: "#fbe6e4" },
  cancelled: { c: "#8b8aa0", b: "#f0f0f7" },
};
function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.cancelled;
  return (
    <span className="inline-flex items-center text-[12px] font-bold px-2.5 py-1 rounded-lg capitalize" style={{ background: s.b, color: s.c }}>
      {status}
    </span>
  );
}

function TenantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feeInput, setFeeInput] = useState("");
  const [savingFee, setSavingFee] = useState(false);
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    platformApi.get("/platform/admin/plans").then((r) => setPlans(r.data.data || [])).catch(() => {});
  }, []);

  const refresh = async () => {
    const r = await platformApi.get(`/platform/admin/tenants/${id}`);
    setData(r.data.data);
    setFeeInput(r.data.data?.tenant?.billing_fee_percentage ?? "");
  };

  useEffect(() => {
    platformApi
      .get(`/platform/admin/tenants/${id}`)
      .then((r) => {
        setData(r.data.data);
        setFeeInput(r.data.data?.tenant?.billing_fee_percentage ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const saveFee = async () => {
    const pct = parseFloat(feeInput);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      alert("Enter a fee percentage between 0 and 100");
      return;
    }
    setSavingFee(true);
    try {
      await platformApi.put(`/platform/admin/tenants/${id}/billing-fee`, { billing_fee_percentage: pct });
      await refresh();
      alert("Platform fee updated");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update fee");
    } finally {
      setSavingFee(false);
    }
  };

  const updateStatus = async (newStatus) => {
    let reason = null;
    if (newStatus === "suspended") {
      reason = window.prompt("Reason for suspension?");
      if (!reason) return;
    }
    if (!window.confirm(`Change status to ${newStatus}?`)) return;
    try {
      await platformApi.put(`/platform/admin/tenants/${id}/status`, { status: newStatus, reason });
      await refresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update status");
    }
  };

  const assignPlan = async (planId) => {
    try {
      await platformApi.put(`/platform/admin/tenants/${id}/plan`, { plan_id: planId || null });
      await refresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to assign plan");
    }
  };

  const setTier = async (tier) => {
    if (!window.confirm(`Change white-label tier to ${tier}?`)) return;
    try {
      await platformApi.put(`/white-label/admin/${id}/tier`, { tier });
      await refresh();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update tier");
    }
  };

  if (loading) {
    return (
      <PlatformLayout>
        <div className="p-4 lg:p-8 max-w-[1240px] mx-auto space-y-3.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-36 w-full rounded-2xl" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            <Skeleton className="h-56 w-full rounded-2xl" />
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        </div>
      </PlatformLayout>
    );
  }
  if (!data) return <PlatformLayout><div /></PlatformLayout>;

  const { tenant, financials, users } = data;
  const brand = tenant.brand_color || "#0e8a6e";
  const stats = [
    { label: "Portfolio", value: K(financials.total_disbursed) },
    { label: "Outstanding", value: K(financials.outstanding_principal) },
    { label: "Collected", value: K(financials.total_collected) },
    { label: "Interest collected", value: K(financials.total_interest_collected) },
  ];

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-[1240px] mx-auto space-y-3.5">
        <button onClick={() => navigate("/admin/tenants")} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ocean-600">
          <ArrowLeft size={15} /> All tenants
        </button>

        {/* Header */}
        <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <span className="w-[54px] h-[54px] rounded-[14px] flex items-center justify-center text-white text-[20px] font-extrabold shrink-0" style={{ background: brand }}>
              {tenant.business_name?.charAt(0)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[20px] font-extrabold text-navy-900 dark:text-slate-100">{tenant.business_name}</span>
                <StatusPill status={tenant.status} />
                {tenant.kind === "welfare" && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-wide">Welfare</span>
                )}
              </div>
              <div className="text-[12.5px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                {[tenant.city, tenant.county].filter(Boolean).join(", ") || tenant.subdomain} · joined{" "}
                {new Date(tenant.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · <span className="font-mono">{tenant.tenant_code}</span>
              </div>
            </div>
            {tenant.id !== 1 && tenant.status === "active" && (
              <button onClick={() => updateStatus("suspended")} className="px-4 py-2 rounded-xl text-[13px] font-bold bg-red-50 text-red-600 hover:bg-red-100">Suspend</button>
            )}
            {tenant.id !== 1 && tenant.status === "suspended" && (
              <button onClick={() => updateStatus("active")} className="px-4 py-2 rounded-xl text-[13px] font-bold bg-green-50 text-green-700 hover:bg-green-100">Activate</button>
            )}
          </div>
          {tenant.suspension_reason && (
            <p className="mt-4 text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle size={16} /> {tenant.suspension_reason}
            </p>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {stats.map((s, i) => (
              <div key={s.label} className={i < stats.length - 1 ? "lg:border-r border-slate-100 dark:border-slate-700" : ""}>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{s.label}</div>
                <div className="text-[19px] font-extrabold text-navy-900 dark:text-slate-100 mt-1 tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {/* Billing & subscription */}
          <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <div className="text-[14px] font-extrabold text-navy-900 dark:text-slate-100 mb-4 flex items-center gap-2"><Percent size={17} /> Billing</div>
            <div className="flex justify-between items-center py-2.5 border-b border-slate-50 dark:border-slate-700">
              <span className="text-[13px] text-slate-500 dark:text-slate-400 font-semibold">Plan</span>
              <select
                value={tenant.plan_id ?? ""}
                onChange={(e) => assignPlan(e.target.value)}
                className="text-[13px] font-bold text-navy-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ocean-500/30 cursor-pointer"
              >
                <option value="">Fee model (no plan)</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {K(p.monthly_price)}/mo
                  </option>
                ))}
              </select>
            </div>
            {[
              ["Platform fee", `${tenant.billing_fee_percentage ?? 5}% of interest earned`],
              ["Base fee", parseFloat(tenant.billing_base_fee) > 0 ? K(tenant.billing_base_fee) : "None"],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between py-2.5 border-b border-slate-50 dark:border-slate-700">
                <span className="text-[13px] text-slate-500 dark:text-slate-400 font-semibold">{l}</span>
                <span className="text-[13px] font-bold text-navy-900 dark:text-slate-100 capitalize">{v}</span>
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-2.5 mt-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Interest-earned fee (%)</label>
                <div className="relative w-36">
                  <input type="number" min="0" max="100" step="0.01" value={feeInput} onChange={(e) => setFeeInput(e.target.value)}
                    className="w-full px-3 py-2 pr-8 border border-slate-200 dark:border-slate-600 rounded-lg dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean-500/30" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
                </div>
              </div>
              <button onClick={saveFee} disabled={savingFee || String(feeInput) === String(tenant.billing_fee_percentage ?? "")}
                className="px-5 py-2 bg-ocean-600 hover:bg-ocean-700 text-white font-bold rounded-lg text-sm disabled:opacity-50">
                {savingFee ? "Saving…" : "Save fee"}
              </button>
            </div>
          </div>

          {/* Usage / stats + white-label */}
          <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <div className="text-[14px] font-extrabold text-navy-900 dark:text-slate-100 mb-3">Usage &amp; contact</div>
            {[
              ["Clients", tenant.client_count],
              ["Loans", `${tenant.active_loans} active · ${tenant.loan_count} total`],
              ["Staff users", tenant.user_count],
              ["Contact", tenant.contact_name || "—"],
              ["Email", tenant.contact_email || "—"],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between py-2 border-b border-slate-50 dark:border-slate-700">
                <span className="text-[13px] text-slate-500 dark:text-slate-400 font-semibold">{l}</span>
                <span className="text-[13px] font-bold text-navy-900 dark:text-slate-100 truncate max-w-[60%]">{v}</span>
              </div>
            ))}
            <div className="mt-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5"><Gem size={13} /> White-label tier</div>
              <div className="flex gap-2">
                {["basic", "pro", "enterprise"].map((t) => {
                  const cur = (tenant.white_label_tier || "basic") === t;
                  return (
                    <button key={t} onClick={() => !cur && setTier(t)} disabled={cur}
                      className={`flex-1 py-2 rounded-lg font-bold text-[13px] capitalize ${cur ? "bg-ocean-600 text-white" : "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200"}`}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Staff users */}
        <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 text-[14px] font-extrabold text-navy-900 dark:text-slate-100">
            Staff users ({users.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="text-left p-3">Name</th><th className="text-left p-3">Email</th>
                  <th className="text-left p-3">Role</th><th className="text-left p-3">Status</th><th className="text-left p-3">Last login</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 dark:border-slate-700 last:border-0">
                    <td className="p-3 font-bold text-navy-900 dark:text-slate-100">{u.first_name} {u.last_name}</td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">{u.email}</td>
                    <td className="p-3 capitalize text-slate-600 dark:text-slate-300">{u.role}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${u.is_active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                        {u.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 dark:text-slate-400">
                      {u.last_login ? new Date(u.last_login).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Never"}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan="5" className="p-4 text-center text-slate-500 dark:text-slate-400">No staff users.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PlatformLayout>
  );
}

export default TenantDetail;
