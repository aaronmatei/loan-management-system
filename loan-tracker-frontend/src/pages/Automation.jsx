import React, { useState, useEffect } from "react";
import { Zap, Clock, BellRing, RotateCcw, CheckCircle } from "lucide-react";
import api from "../services/api";
import PageHeader from "../components/PageHeader";
import Skeleton from "../components/Skeleton";

function Automation() {
  const [settings, setSettings] = useState({
    reminder_days_before: "",
    overdue_reminder_frequency_days: "",
  });
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(null);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const r = await api.get("/automation/status");
      const d = r.data.data || {};
      setSettings({
        reminder_days_before: d.settings?.reminder_days_before ?? 3,
        overdue_reminder_frequency_days:
          d.settings?.overdue_reminder_frequency_days ?? 3,
      });
      setSchedule(d.schedule || null);
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/automation/settings", {
        reminder_days_before: parseInt(settings.reminder_days_before, 10),
        overdue_reminder_frequency_days: parseInt(
          settings.overdue_reminder_frequency_days,
          10,
        ),
      });
      setSuccess("Automation settings saved");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const runTask = async (task, label) => {
    setRunning(task);
    try {
      const r = await api.post("/automation/run", { task });
      const res = r.data.result || {};
      if (task === "reminders") {
        alert(
          `${label} complete.\n\n${res.reminders || 0} due-soon reminder(s)\n${res.overdues || 0} overdue nudge(s) sent.`,
        );
      } else {
        alert(`${label} complete.\n\n${res.marked_overdue || 0} installment(s) newly marked overdue.`);
      }
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setRunning(null);
    }
  };

  if (loading)
    return (
      <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        <div className="mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 mt-3" />
        </div>
        <Skeleton className="h-56 w-full rounded-xl mb-6" />
        <Skeleton className="h-28 w-full rounded-xl mb-6" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
      <PageHeader
        icon={Zap}
        title="Automation"
        subtitle="Automatic reminders and overdue tracking for your borrowers."
      />

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
          {success}
        </div>
      )}

      {/* Cadence settings */}
      <form onSubmit={saveSettings} className="bg-surface rounded-xl shadow-md p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100 mb-1 flex items-center gap-2">
          <BellRing size={20} /> Reminder Cadence
        </h2>
        <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
          Controls when your borrowers are reminded about payments.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
              Remind this many days before a payment is due
            </label>
            <input
              type="number"
              min="0"
              max="30"
              value={settings.reminder_days_before}
              onChange={(e) =>
                setSettings({ ...settings, reminder_days_before: e.target.value })
              }
              className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">e.g. 3 = remind 3 days early.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
              Overdue nudge frequency (days)
            </label>
            <input
              type="number"
              min="1"
              max="30"
              value={settings.overdue_reminder_frequency_days}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  overdue_reminder_frequency_days: e.target.value,
                })
              }
              className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              e.g. 3 = nudge every 3 days while overdue.
            </p>
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-4 px-6 py-2.5 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
        >
          {saving ? "Saving…" : <span className="inline-flex items-center gap-1.5"><CheckCircle size={16} /> Save Settings</span>}
        </button>
      </form>

      {/* Schedule (read-only) */}
      <div className="bg-surface rounded-xl shadow-md p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100 mb-1 flex items-center gap-2">
          <Clock size={20} /> Schedule
        </h2>
        <p className="text-sm text-gray-600 dark:text-slate-400">
          {schedule?.reminders_enabled ? (
            <>
              Reminders and overdue nudges run{" "}
              <span className="font-semibold">automatically every day</span>{" "}
              using your cadence above. You don't need to do anything.
            </>
          ) : (
            <>
              Automatic daily reminders are currently <span className="font-semibold">off</span>{" "}
              for the platform. You can still send them manually below at any
              time.
            </>
          )}
        </p>
      </div>

      {/* Manual run */}
      <div className="bg-surface rounded-xl shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100 mb-1 flex items-center gap-2">
          <RotateCcw size={20} /> Run Now
        </h2>
        <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
          Trigger a job immediately for your borrowers — handy outside the
          daily schedule.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => runTask("reminders", "Send reminders")}
            disabled={running === "reminders"}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold rounded-lg disabled:opacity-50"
          >
            <BellRing size={16} />
            {running === "reminders" ? "Sending…" : "Send reminders now"}
          </button>
          <button
            onClick={() => runTask("overdue", "Refresh overdue")}
            disabled={running === "overdue"}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold rounded-lg disabled:opacity-50"
          >
            <RotateCcw size={16} />
            {running === "overdue" ? "Refreshing…" : "Refresh overdue statuses"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Automation;
