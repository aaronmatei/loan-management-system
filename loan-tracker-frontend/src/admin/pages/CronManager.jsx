import React, { useEffect, useState } from "react";
import PlatformLayout from "../components/PlatformLayout";
import platformApi from "../services/platformApi";
import {
  Clock,
  Calendar,
  FileText,
  Ban,
  CheckCircle,
  BarChart3,
  Gamepad2,
  Gift,
  Rocket,
  Target,
  CheckCircle2,
  RotateCcw,
  Play,
  X,
} from "lucide-react";

// Platform-admin cockpit for the daily cron jobs. Shows which crons
// are gated on/off via env, and offers per-task manual triggers.
// Mirrors the schedule definitions in:
//   • services/paymentReminderJob.js  (REMINDER_CRON_*)
//   • services/billingCronJob.js      (BILLING_CRON_*)
//   • services/scheduler.js           (BACKUP_SCHEDULE_*)
function CronManager() {
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(null);
  const [last, setLast] = useState(null);

  useEffect(() => {
    platformApi
      .get("/platform/cron/status")
      .then((r) => setStatus(r.data.data))
      .catch(() => {});
  }, []);

  const trigger = async (task, prettyName) => {
    if (!window.confirm(`Run "${prettyName}" now?`)) return;
    setRunning(task);
    setLast(null);
    try {
      const r = await platformApi.post("/platform/cron/trigger", { task });
      setLast({ task, prettyName, ...r.data, at: new Date() });
    } catch (err) {
      setLast({
        task,
        prettyName,
        error: err.response?.data?.error || err.message,
        at: new Date(),
      });
    } finally {
      setRunning(null);
    }
  };

  const TASKS = [
    {
      id: "reminders",
      name: "Payment Reminders + Overdue",
      icon: Calendar,
      blurb:
        "Client side — fires payment_reminder + payment_overdue across all tenants. Dedupes via today's logs.",
    },
    {
      id: "tenant_invoices",
      name: "Mark Overdue Invoices",
      icon: FileText,
      blurb:
        "Flip any invoice past due_date to status='overdue' and email the tenant's billing contact.",
    },
    {
      id: "suspend",
      name: "Auto-Suspend Tenants",
      icon: Ban,
      blurb:
        "Suspend tenants whose oldest overdue invoice is past their billing_suspend_after_days grace. Founding tenant (id=1) is exempt.",
    },
    {
      id: "reactivate",
      name: "Auto-Reactivate Tenants",
      icon: CheckCircle2,
      blurb:
        "Reactivate tenants who were auto-suspended and now have zero outstanding invoices.",
    },
    {
      id: "summary",
      name: "Daily Admin Summary",
      icon: BarChart3,
      blurb:
        "Email every active platform admin a stats snapshot + today's cron activity.",
    },
    {
      id: "reset_demo",
      name: "Reset Demo Tenant",
      icon: Gamepad2,
      blurb:
        "Wipe + reseed the public demo (clients / loans / schedules / payments / applications). Same as the nightly 03:00 reset.",
    },
    {
      id: "referrals",
      name: "Qualify Pending Referrals",
      icon: Gift,
      blurb:
        "Sweep pending referrals and qualify those whose referred tenant has met the configured rule (default: status='active'). Issues free-month credits + sends reward emails.",
    },
    {
      id: "all",
      name: "Run ALL Daily Tasks",
      icon: Rocket,
      blurb:
        "Reminders + billing pipeline + summary in one call. Same as what runs at 08:00.",
    },
  ];

  const cronCard = (label, c) =>
    c ? (
      <div
        className={`rounded-xl p-4 border-2 ${c.enabled ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50"}`}
      >
        <div className="flex items-start gap-3">
          {c.enabled
            ? <CheckCircle size={20} className="text-green-600 mt-0.5 shrink-0" />
            : <Clock size={20} className="text-yellow-600 mt-0.5 shrink-0" />
          }
          <div className="flex-1">
            <p className="font-bold text-gray-800">{label}</p>
            <p className="text-xs text-gray-600 mb-1">{c.description}</p>
            <p className="text-xs font-mono text-gray-500">
              {c.enabled ? `Active · ${c.schedule}` : `Disabled · would run ${c.schedule}`}
            </p>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <Clock size={28} className="text-gray-700" /> Cron Manager
        </h1>
        <p className="text-gray-600 mt-1 mb-6">
          Three independent cron services, each gated by its own env flag.
        </p>

        {/* Status cards */}
        {status && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 mb-6">
            {cronCard("Payment reminders", status.payment_reminders)}
            {cronCard("Billing", status.billing)}
            {cronCard("Backups", status.backups)}
            {cronCard("Demo reset", status.demo_reset)}
          </div>
        )}

        {/* Manual triggers */}
        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h2 className="font-bold text-xl mb-1 flex items-center gap-2"><Target size={20} /> Manual triggers</h2>
          <p className="text-sm text-gray-600 mb-4">
            Run any task on demand. Each is idempotent — re-running on the
            same day skips already-processed rows.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {TASKS.map((t) => {
              const TaskIcon = t.icon;
              return (
              <div
                key={t.id}
                className="border-2 border-gray-200 rounded-lg p-4 hover:border-ocean-300 transition"
              >
                <h3 className="font-bold text-sm mb-1 flex items-center gap-1.5">
                  <TaskIcon size={15} className="text-gray-500 shrink-0" /> {t.name}
                </h3>
                <p className="text-xs text-gray-600 mb-3">{t.blurb}</p>
                <button
                  onClick={() => trigger(t.id, t.name)}
                  disabled={running !== null}
                  className="w-full py-2 bg-ocean-gradient text-white rounded-lg font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {running === t.id
                    ? <><RotateCcw size={14} className="animate-spin" /> Running…</>
                    : <><Play size={14} /> Run now</>}
                </button>
              </div>
              );
            })}
          </div>
        </div>

        {/* Last result */}
        {last && (
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-bold text-xl mb-3 flex items-center gap-2"><BarChart3 size={20} /> Last run</h2>
            <p className="text-xs text-gray-500 mb-3">
              <strong>{last.prettyName}</strong> · {last.at.toLocaleTimeString()}
            </p>
            {last.error ? (
              <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
                <p className="font-bold text-red-800 mb-1 flex items-center gap-1.5"><X size={16} /> Error</p>
                <p className="text-red-700 text-sm">{last.error}</p>
              </div>
            ) : (
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto">
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
