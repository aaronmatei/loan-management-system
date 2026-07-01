import React, { useState } from "react";
import api from "../../services/api";
import { Coins } from "lucide-react";

// IMPORTANT: the staff POST /loans endpoint ALWAYS creates a
// 'pending' loan application (status is hard-coded in loans.js — any
// status field in the body is ignored). The activation requires
// /review -> /approve -> /disburse. So this step "submits the first
// loan application" honestly; after onboarding the tenant will see it
// in their Applications queue and run it through the workflow.
function FirstLoanStep({ data, createdClient, onNext, onBack }) {
  const roundRate = (n) => Math.round(Number(n) * 10000) / 10000;
  const initialAnnual = data.default_interest_rate ?? 50;

  const [form, setForm] = useState({
    principal_amount: 50000,
    loan_duration_months: data.default_duration_months || 6,
    annual_interest_rate: initialAnnual,
    monthly_interest_rate: roundRate(initialAnnual / 12),
    processing_fee_rate: data.processing_fee_rate ?? 0,
    purpose: "Business expansion",
  });
  const [saving, setSaving] = useState(false);

  // Annual ⇄ monthly: typing either updates the other (annual = monthly × 12).
  const onAnnual = (v) =>
    setForm((p) => ({
      ...p,
      annual_interest_rate: v,
      monthly_interest_rate: v === "" ? "" : roundRate(parseFloat(v) / 12),
    }));
  const onMonthly = (v) =>
    setForm((p) => ({
      ...p,
      monthly_interest_rate: v,
      annual_interest_rate: v === "" ? "" : roundRate(parseFloat(v) * 12),
    }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/loans", {
        client_id: createdClient.id,
        principal_amount: form.principal_amount,
        annual_interest_rate: parseFloat(form.annual_interest_rate) || 0,
        loan_duration_months: form.loan_duration_months,
        processing_fee_rate: parseFloat(form.processing_fee_rate) || 0,
        purpose: form.purpose,
        application_source: "onboarding_wizard",
      });
      onNext({ first_loan_created: true });
    } catch (err) {
      alert(err.response?.data?.error || "Failed to submit loan");
    } finally {
      setSaving(false);
    }
  };

  // Local preview only — backend will store/compute these itself.
  const principal = parseFloat(form.principal_amount) || 0;
  const annual = parseFloat(form.annual_interest_rate) || 0;
  const months = parseInt(form.loan_duration_months, 10) || 0;
  const feeRate = parseFloat(form.processing_fee_rate) || 0;
  const interest = principal * (annual / 100 / 12) * months;
  const total = principal + interest;
  const processingFee = Math.round((principal * feeRate) / 100 * 100) / 100;
  const netDisbursed = Math.max(0, principal - processingFee);

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none";

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-surface dark:text-slate-100 rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <Coins size={48} className="text-ocean-500" />
          </div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            Submit First Loan Application
          </h2>
          <p className="text-gray-600 dark:text-slate-400">
            For {createdClient?.first_name} {createdClient?.last_name}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">
            This creates a pending application — review and disburse it
            from the Applications page after setup.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Amount (KES) *
            </label>
            <input
              type="number"
              value={form.principal_amount}
              onChange={(e) =>
                setForm({
                  ...form,
                  principal_amount: parseFloat(e.target.value) || 0,
                })
              }
              required
              className={fld}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Annual Rate (%) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.annual_interest_rate}
                onChange={(e) => onAnnual(e.target.value)}
                required
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Monthly Rate (%) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.monthly_interest_rate}
                onChange={(e) => onMonthly(e.target.value)}
                required
                className={fld}
              />
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Synced with annual.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Duration *
              </label>
              <select
                value={form.loan_duration_months}
                onChange={(e) =>
                  setForm({
                    ...form,
                    loan_duration_months: parseInt(e.target.value, 10),
                  })
                }
                className={`${fld} bg-white dark:bg-slate-900`}
              >
                {[1, 3, 6, 12, 18, 24].map((m) => (
                  <option key={m} value={m}>
                    {m} months
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Processing Fee Rate (%)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.processing_fee_rate}
                onChange={(e) =>
                  setForm({ ...form, processing_fee_rate: e.target.value })
                }
                className={fld}
              />
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Deducted from disbursed amount.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Purpose</label>
            <input
              value={form.purpose}
              onChange={(e) =>
                setForm({ ...form, purpose: e.target.value })
              }
              className={fld}
            />
          </div>

          <div className="bg-ocean-50 rounded-xl p-3 text-sm">
            <div className="flex justify-between">
              <span>Total Interest</span>
              <span className="font-bold">
                KES{" "}
                {interest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span>Total Repayable</span>
              <span className="font-bold text-ocean-700">
                KES{" "}
                {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            {feeRate > 0 && (
              <>
                <div className="flex justify-between mt-2 pt-2 border-t border-ocean-200">
                  <span>Processing Fee ({feeRate}%)</span>
                  <span className="font-bold text-amber-700">
                    − KES {processingFee.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>To Disburse</span>
                  <span className="font-bold text-ocean-700">
                    KES {netDisbursed.toLocaleString()}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-3 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg font-semibold"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 bg-ocean-gradient text-white font-bold rounded-lg disabled:opacity-50"
            >
              {saving ? "Submitting…" : "Submit Application →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default FirstLoanStep;
