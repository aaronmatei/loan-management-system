import React, { useEffect, useState } from "react";
import PlatformLayout from "../components/PlatformLayout";
import platformApi from "../services/platformApi";
import {
  Calendar,
  FileText,
  Ban,
  BarChart3,
  Gamepad2,
  Gift,
  Rocket,
  Target,
  CheckCircle2,
  RotateCcw,
  Play,
  X,
  Server,
  Activity,
  Zap,
} from "lucide-react";

// Platform-admin System page: real signals only — cron service on/off + schedule
// (from /platform/cron/status) and on-demand triggers. No fabricated
// uptime/latency/incidents (there's no monitoring behind those).
function CronManager() {
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(false);
  const [running, setRunning] = useState(null);
  const [last, setLast] = useState(null);

  useEffect(() => {
    platformApi
      .get("/platform/cron/status")
      .then((r) => setStatus(r.data.data))
      .catch(() => setStatusErr(true));
  }, []);

  const trigger = async (task, prettyName) => {
    if (!window.confirm(`Run "${prettyName}" now?`)) return;
    setRunning(task);
    setLast(null);
    try {
      const r = await platformApi.post("/platform/cron/trigger", { task });
      setLast({ task, prettyName, ...r.data, at: new Date() });
    } catch (err) {
      setLast({ task, prettyName, error: err.response?.data?.error || err.message, at: new Date() });
    } finally {
      setRunning(null);
    }
  };

  const TASKS = [
    { id: "reminders", name: "Payment Reminders + Overdue", icon: Calendar, blurb: "Client side — fires payment_reminder + payment_overdue across all tenants. Dedupes via today's logs." },
    { id: "tenant_invoices", name: "Mark Overdue Invoices", icon: FileText, blurb: "Flip any invoice past due_date to status='overdue' and email the tenant's billing contact." },
    { id: "suspend", name: "Auto-Suspend Tenants", icon: Ban, blurb: "Suspend tenants whose oldest overdue invoice is past their grace. Founding tenant (id=1) is exempt." },
    { id: "reactivate", name: "Auto-Reactivate Tenants", icon: CheckCircle2, blurb: "Reactivate tenants who were auto-suspended and now have zero outstanding invoices." },
    { id: "summary", name: "Daily Admin Summary", icon: BarChart3, blurb: "Email every active platform admin a stats snapshot + today's cron activity." },
    { id: "reset_demo", name: "Reset Demo Tenant", icon: Gamepad2, blurb: "Wipe + reseed the public demo. Same as the nightly 03:00 reset." },
    { id: "referrals", name: "Qualify Pending Referrals", icon: Gift, blurb: "Qualify pending referrals whose referred tenant met the rule. Issues credits + reward emails." },
    { id: "all", name: "Run ALL Daily Tasks", icon: Rocket, blurb: "Reminders + billing pipeline + summary in one call. Same as what runs at 08:00." },
  ];

  // Real services derived from the cron status payload.
  const services = status
    ? [
        ["Payment reminders", status.payment_reminders],
        ["Billing & auto-suspend", status.billing],
        ["Backups", status.backups],
        ["Demo reset", status.demo_reset],
      ].filter(([, c]) => c)
    : [];
  const activeCount = services.filter(([, c]) => c.enabled).length;
  const apiOk = !statusErr && status != null;

  const Kpi = ({ icon: Icon, label, value, dot, accent = "#0e8a6e" }) => (
    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-[18px] shadow-sm">
      <div className="flex items-center gap-2">
        {dot ? (
          <span className="w-2 h-2 rounded-full" style={{ background: dot }} />
        ) : (
          <Icon size={15} style={{ color: accent }} />
        )}
        <span className="text-[12px] font-bold text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <div className="text-[24px] font-extrabold text-navy-900 dark:text-slate-100 mt-2.5 tabular-nums">{value}</div>
    </div>
  );

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-[1240px] mx-auto space-y-3.5">
        {/* Health KPIs (real) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Kpi label="API" value={apiOk ? "Operational" : "Unknown"} dot={apiOk ? "#22a06b" : "#e6a23a"} />
          <Kpi icon={Server} label="Cron services" value={services.length || "—"} accent="#5b6ef0" />
          <Kpi
            label="Active"
            value={status ? `${activeCount}/${services.length}` : "—"}
            dot={status ? (activeCount === services.length ? "#22a06b" : "#e6a23a") : "#8b8aa0"}
          />
          <Kpi icon={Zap} label="Manual jobs" value={TASKS.length} accent="#d9892a" />
        </div>

        {/* Services (real: enabled flag + schedule) */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="text-[14.5px] font-extrabold text-navy-900 dark:text-slate-100 mb-1 flex items-center gap-2">
            <Activity size={17} /> Scheduled services
          </div>
          <div className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-3">
            Each is gated by its own env flag. Times are the configured schedule.
          </div>
          {statusErr ? (
            <p className="text-sm text-amber-600">Couldn't reach the cron status endpoint.</p>
          ) : !status ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <div className="divide-y divide-slate-50 dark:divide-slate-700">
              {services.map(([label, c]) => (
                <div key={label} className="flex items-center gap-3 py-3">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.enabled ? "#22a06b" : "#e6a23a" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-bold text-navy-900 dark:text-slate-100">{label}</div>
                    <div className="text-[12px] text-slate-500 dark:text-slate-400">{c.description}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] font-bold" style={{ color: c.enabled ? "#1a7a4f" : "#b06a16" }}>
                      {c.enabled ? "Active" : "Disabled"}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">{c.schedule}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Manual triggers */}
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
          <div className="text-[14.5px] font-extrabold text-navy-900 dark:text-slate-100 mb-1 flex items-center gap-2">
            <Target size={17} /> Manual triggers
          </div>
          <div className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-4">
            Run any task on demand. Each is idempotent — re-running on the same day skips processed rows.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {TASKS.map((t) => {
              const TaskIcon = t.icon;
              return (
                <div key={t.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 hover:border-ocean-300 transition">
                  <h3 className="font-bold text-sm mb-1 flex items-center gap-1.5 text-navy-900 dark:text-slate-100">
                    <TaskIcon size={15} className="text-slate-400 shrink-0" /> {t.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t.blurb}</p>
                  <button
                    onClick={() => trigger(t.id, t.name)}
                    disabled={running !== null}
                    className="w-full py-2 bg-ocean-gradient text-white rounded-lg font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {running === t.id ? <><RotateCcw size={14} className="animate-spin" /> Running…</> : <><Play size={14} /> Run now</>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Last result */}
        {last && (
          <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm">
            <div className="text-[14.5px] font-extrabold text-navy-900 dark:text-slate-100 mb-2 flex items-center gap-2">
              <BarChart3 size={17} /> Last run
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              <strong>{last.prettyName}</strong> · {last.at.toLocaleTimeString()}
            </p>
            {last.error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="font-bold text-red-800 mb-1 flex items-center gap-1.5"><X size={16} /> Error</p>
                <p className="text-red-700 text-sm">{last.error}</p>
              </div>
            ) : (
              <pre className="bg-slate-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto">
                {JSON.stringify(last.result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </PlatformLayout>
  );
}

export default CronManager;
