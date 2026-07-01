import React, { useState, useEffect } from "react";
import {
  Banknote,
  Printer,
  Pencil,
  Play,
  Square,
  AlertTriangle,
  CheckCircle2,
  X,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

// Salary check-off panel for a salary advance. Loads employer/payslip details +
// the affordability assessment from /loans/:id/salary-details and lets staff
// add/edit them, activate or stop the employer check-off, and print the
// authorization letter. Calls onChange() after a mutation.
export default function SalaryDetailsPanel({ loanId, loanCode, onChange }) {
  const [details, setDetails] = useState(null);
  const [affordability, setAffordability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const r = await api.get(`/loans/${loanId}/salary-details`);
      setDetails(r.data?.data?.details || null);
      setAffordability(r.data?.data?.affordability || null);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [loanId]);

  const money = (v) =>
    "KES " +
    Number(v || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const printLetter = async () => {
    try {
      const res = await api.get(`/loans/${loanId}/salary-details/check-off-letter`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: "application/pdf" }),
      );
      window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert("Failed to open letter: " + (err.response?.data?.error || err.message));
    }
  };

  const runAction = async (action) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/loans/${loanId}/salary-details/${action}`, {});
      await load();
      onChange?.();
    } catch (err) {
      setError(err.response?.data?.error || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const STATUS_BADGE = {
    pending: "bg-slate-100 text-slate-700",
    active: "bg-emerald-100 text-emerald-800",
    stopped: "bg-red-100 text-red-800",
    completed: "bg-sky-100 text-sky-800",
  };
  const STATUS_LABEL = {
    pending: "Check-off pending",
    active: "Check-off active",
    stopped: "Check-off stopped",
    completed: "Completed",
  };

  return (
    <div className="bg-surface rounded-xl shadow-md border border-violet-100 mb-6 overflow-hidden">
      <div className="bg-violet-50 px-5 py-3 border-b border-violet-100 flex items-center justify-between">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Banknote size={18} className="text-violet-600" /> Salary Check-off
        </h3>
        {details && (
          <button
            onClick={printLetter}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"
          >
            <Printer size={15} /> Check-off Letter
          </button>
        )}
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading salary details…</p>
        ) : !details ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No employer / check-off details on file yet.
            </p>
            <PermissionGate role={["admin", "manager", "loan_officer"]}>
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold text-sm"
              >
                + Add Details
              </button>
            </PermissionGate>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{details.employer_name}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {details.staff_number && <span>Staff no. {details.staff_number}</span>}
                  {details.employer_contact && <span>{details.employer_contact}</span>}
                  {details.payday_day && <span>Payday: {details.payday_day} of month</span>}
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                  STATUS_BADGE[details.check_off_status] || "bg-slate-100 text-slate-700"
                }`}
              >
                {STATUS_LABEL[details.check_off_status] || details.check_off_status}
              </span>
            </div>

            {affordability && (
              <div
                className={`rounded-lg p-3 mb-4 border text-sm ${
                  affordability.affordable
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-amber-50 border-amber-200"
                }`}
              >
                <div className="flex items-center gap-2 font-semibold mb-1">
                  {affordability.affordable ? (
                    <CheckCircle2 size={15} className="text-emerald-600" />
                  ) : (
                    <AlertTriangle size={15} className="text-amber-600" />
                  )}
                  {affordability.affordable
                    ? "Within affordability limit"
                    : "Deduction exceeds the affordability limit"}
                </div>
                <p className="text-slate-600">
                  Monthly deduction <strong>{money(affordability.installment)}</strong>
                  {affordability.deduction_percent != null && (
                    <> ({affordability.deduction_percent}% of net pay)</>
                  )}{" "}
                  vs. ceiling <strong>{money(affordability.affordable_ceiling)}</strong> (
                  {affordability.max_deduction_percent}% of {money(affordability.net_monthly_pay)}).
                </p>
              </div>
            )}

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                <AlertTriangle size={15} /> {error}
              </div>
            )}

            <PermissionGate role={["admin", "manager", "loan_officer"]}>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowForm(true)}
                  className="px-4 py-2 bg-white border-2 border-violet-200 text-violet-700 hover:bg-violet-50 rounded-lg font-semibold inline-flex items-center gap-2"
                >
                  <Pencil size={16} /> Edit
                </button>
                <PermissionGate role={["admin", "manager"]}>
                  {details.check_off_status !== "active" ? (
                    <button
                      onClick={() => runAction("activate")}
                      disabled={busy}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                    >
                      <Play size={16} /> Activate Check-off
                    </button>
                  ) : (
                    <button
                      onClick={() => runAction("stop")}
                      disabled={busy}
                      className="px-4 py-2 bg-white border-2 border-red-200 text-red-700 hover:bg-red-50 rounded-lg font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                    >
                      <Square size={16} /> Stop Check-off
                    </button>
                  )}
                </PermissionGate>
              </div>
            </PermissionGate>
          </>
        )}
      </div>

      {showForm && (
        <SalaryFormModal
          loanId={loanId}
          existing={details}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
            onChange?.();
          }}
        />
      )}
    </div>
  );
}

function SalaryFormModal({ loanId, existing, onClose, onSaved }) {
  const [form, setForm] = useState({
    employer_name: existing?.employer_name || "",
    employer_contact: existing?.employer_contact || "",
    staff_number: existing?.staff_number || "",
    net_monthly_pay: existing?.net_monthly_pay || "",
    payday_day: existing?.payday_day || "",
    max_deduction_percent: existing?.max_deduction_percent || 50,
    notes: existing?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.employer_name.trim()) return setError("Employer name is required.");
    if (!(parseFloat(form.net_monthly_pay) > 0))
      return setError("Enter the net monthly pay.");
    setBusy(true);
    try {
      await api.post(`/loans/${loanId}/salary-details`, {
        ...form,
        net_monthly_pay: parseFloat(form.net_monthly_pay),
        payday_day: form.payday_day ? parseInt(form.payday_day, 10) : null,
        max_deduction_percent: parseFloat(form.max_deduction_percent) || 50,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save.");
      setBusy(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-violet-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Banknote size={18} className="text-violet-600" />
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {existing ? "Edit Salary Details" : "Add Salary Details"}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-100">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          <div>
            <label className={lbl}>Employer name *</label>
            <input
              value={form.employer_name}
              onChange={set("employer_name")}
              placeholder="Acme Ltd"
              className={fld}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Employer contact</label>
              <input
                value={form.employer_contact}
                onChange={set("employer_contact")}
                placeholder="HR email / phone"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Staff / payroll no.</label>
              <input
                value={form.staff_number}
                onChange={set("staff_number")}
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Net monthly pay *</label>
              <input
                type="number"
                value={form.net_monthly_pay}
                onChange={set("net_monthly_pay")}
                placeholder="80000"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Payday (day of month)</label>
              <input
                type="number"
                min="1"
                max="31"
                value={form.payday_day}
                onChange={set("payday_day")}
                placeholder="28"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Max deduction %</label>
              <input
                type="number"
                min="1"
                max="100"
                value={form.max_deduction_percent}
                onChange={set("max_deduction_percent")}
                className={fld}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border-2 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 font-semibold hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save Details"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
