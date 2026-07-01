import React, { useState, useEffect } from "react";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import Skeleton from "../../components/Skeleton";
import { BadgeCheck, CheckCircle2, Check, X, Mail, Phone, MapPin, User, Building2, Calendar } from "lucide-react";

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function Approvals() {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = () => {
    setLoading(true);
    platformApi
      .get("/platform/admin/tenants?status=pending")
      .then((r) => setPending(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const approve = async (t) => {
    if (!window.confirm(`Approve ${t.business_name}? They'll be able to sign in immediately.`)) return;
    setBusy(t.id);
    try {
      await platformApi.post(`/platform/admin/tenants/${t.id}/approve`);
      setPending((p) => p.filter((x) => x.id !== t.id));
    } catch (err) {
      alert(err.response?.data?.error || "Failed to approve");
    } finally {
      setBusy(null);
    }
  };

  const decline = async (t) => {
    const reason = window.prompt(`Decline ${t.business_name}? Optional reason (shown in the audit log):`);
    if (reason === null) return; // cancelled
    setBusy(t.id);
    try {
      await platformApi.post(`/platform/admin/tenants/${t.id}/decline`, { reason });
      setPending((p) => p.filter((x) => x.id !== t.id));
    } catch (err) {
      alert(err.response?.data?.error || "Failed to decline");
    } finally {
      setBusy(null);
    }
  };

  const Field = ({ icon: Icon, label, value }) => (
    <div className="flex items-start gap-2 min-w-0">
      <Icon size={14} className="text-slate-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-[13px] font-semibold text-navy-900 dark:text-slate-100 truncate">{value || "—"}</div>
      </div>
    </div>
  );

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-[1240px] mx-auto">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
          </div>
        ) : pending.length === 0 ? (
          <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-12 text-center shadow-sm">
            <CheckCircle2 size={36} className="text-green-600 mx-auto" />
            <div className="text-[15px] font-extrabold text-navy-900 dark:text-slate-100 mt-3">All caught up</div>
            <div className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">No sign-ups awaiting review.</div>
          </div>
        ) : (
          <>
            <div className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl px-5 py-4 mb-4 flex items-center gap-3 shadow-sm">
              <span className="w-9 h-9 rounded-[10px] bg-ocean-50 flex items-center justify-center shrink-0">
                <BadgeCheck size={18} className="text-ocean-600" />
              </span>
              <div>
                <div className="text-[13.5px] font-extrabold text-navy-900 dark:text-slate-100">
                  {pending.length} sign-up{pending.length === 1 ? "" : "s"} awaiting review
                </div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">Cross-check the submitted details, then approve or decline.</div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {pending.map((t) => (
                <div key={t.id} className="bg-surface border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-start gap-4 flex-wrap">
                    <span className="w-12 h-12 rounded-[13px] flex items-center justify-center text-white text-lg font-extrabold shrink-0" style={{ background: t.brand_color || "#0e8a6e" }}>
                      {t.business_name?.charAt(0)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[16px] font-extrabold text-navy-900 dark:text-slate-100">{t.business_name}</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: t.kind === "welfare" ? "#dcfce7" : "#ecebfd", color: t.kind === "welfare" ? "#166534" : "#4b3fce" }}>
                          {t.kind === "welfare" ? "Welfare" : "Lender"}
                        </span>
                      </div>
                      <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                        <span className="font-mono">{t.tenant_code}</span> · {t.subdomain} · applied {fmtDate(t.created_at)}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => decline(t)} disabled={busy === t.id} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
                        <X size={14} /> Decline
                      </button>
                      <button onClick={() => approve(t)} disabled={busy === t.id} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold bg-ocean-gradient text-white disabled:opacity-50">
                        <Check size={14} /> {busy === t.id ? "…" : "Approve"}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-5 pt-4 border-t border-slate-50 dark:border-slate-700">
                    <Field icon={User} label="Contact" value={t.contact_name} />
                    <Field icon={Mail} label="Email" value={t.contact_email} />
                    <Field icon={Phone} label="Phone" value={t.contact_phone} />
                    <Field icon={MapPin} label="Location" value={[t.city, t.county].filter(Boolean).join(", ")} />
                    <Field icon={Building2} label="Business type" value={t.business_type} />
                    <Field icon={Calendar} label="Reg. number" value={t.registration_number} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </PlatformLayout>
  );
}

export default Approvals;
