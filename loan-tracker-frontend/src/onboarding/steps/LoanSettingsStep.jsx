import React, { useState } from "react";
import { BarChart3 } from "lucide-react";
import api from "../../services/api";

// Captures the tenant's loan policy during onboarding. Persists to the
// tenant row (PUT /settings/loan-policy) so the New Loan form and the
// customer portal pick up these values straight away — and the wizard
// also threads them through `onboarding_data` for the FirstLoan step.
function LoanSettingsStep({ data, onNext, onBack }) {
  const roundRate = (n) => Math.round(Number(n) * 10000) / 10000;
  const initialAnnual = data.default_interest_rate ?? 50;
  const [form, setForm] = useState({
    default_interest_rate: initialAnnual,
    monthly_interest_rate: roundRate(initialAnnual / 12),
    processing_fee_rate: data.processing_fee_rate ?? 0,
    min_loan_amount: data.min_loan_amount ?? 1000,
    max_loan_amount: data.max_loan_amount ?? 500000,
    default_duration_months: data.default_duration_months ?? 6,
    late_payment_fee: data.late_payment_fee ?? 500,
  });
  const [saving, setSaving] = useState(false);

  // Annual ⇄ monthly: whichever the user types is kept exactly, the
  // other is derived (annual = monthly × 12).
  const onAnnual = (v) =>
    setForm((p) => ({
      ...p,
      default_interest_rate: v,
      monthly_interest_rate: v === "" ? "" : roundRate(parseFloat(v) / 12),
    }));
  const onMonthly = (v) =>
    setForm((p) => ({
      ...p,
      monthly_interest_rate: v,
      default_interest_rate: v === "" ? "" : roundRate(parseFloat(v) * 12),
    }));

  const principal = 50000;
  const annual = parseFloat(form.default_interest_rate) || 0;
  const months = parseInt(form.default_duration_months, 10) || 0;
  const totalInterest = principal * (annual / 100 / 12) * months;
  const monthlyPayment = months > 0 ? (principal + totalInterest) / months : 0;
  const feeRate = parseFloat(form.processing_fee_rate) || 0;
  const processingFeeOnExample = Math.round((principal * feeRate) / 100 * 100) / 100;
  const netDisbursedExample = principal - processingFeeOnExample;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Persist the policy to the tenants row so the rest of the app
      // (Settings → Loan Policy, the New Loan form, the customer portal)
      // picks it up immediately. Best-effort: a failure here doesn't
      // block onboarding — the wizard still forwards the values.
      try {
        await api.put("/settings/loan-policy", {
          default_interest_rate: parseFloat(form.default_interest_rate) || 0,
          processing_fee_rate: parseFloat(form.processing_fee_rate) || 0,
          default_loan_duration: parseInt(form.default_duration_months, 10),
          min_loan_amount: parseFloat(form.min_loan_amount) || 0,
          max_loan_amount: parseFloat(form.max_loan_amount) || 0,
          late_payment_fee: parseFloat(form.late_payment_fee) || 0,
        });
      } catch (err) {
        console.error("Failed to persist loan policy:", err);
      }
      onNext(form);
    } finally {
      setSaving(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-white rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <BarChart3 size={48} className="text-ocean-500" />
          </div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
            Set Your Loan Defaults
          </h2>
          <p className="text-gray-600">
            These become the default values when creating new loans
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Annual Interest Rate (%) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.default_interest_rate}
                onChange={(e) => onAnnual(e.target.value)}
                required
                className={fld}
              />
              <p className="text-xs text-gray-500 mt-1">e.g. 50 = 50% p.a.</p>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Monthly Interest Rate (%) *
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
              <p className="text-xs text-gray-500 mt-1">Synced with annual.</p>
            </div>
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
            <p className="text-xs text-gray-500 mt-1">
              Deducted from the disbursed amount (0 = none).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Min Amount (KES)
              </label>
              <input
                type="number"
                value={form.min_loan_amount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    min_loan_amount: parseFloat(e.target.value) || 0,
                  })
                }
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Max Amount (KES)
              </label>
              <input
                type="number"
                value={form.max_loan_amount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    max_loan_amount: parseFloat(e.target.value) || 0,
                  })
                }
                className={fld}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Default Duration (months)
              </label>
              <select
                value={form.default_duration_months}
                onChange={(e) =>
                  setForm({
                    ...form,
                    default_duration_months: parseInt(e.target.value, 10),
                  })
                }
                className={`${fld} bg-white`}
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
                Late Payment Fee (KES)
              </label>
              <input
                type="number"
                value={form.late_payment_fee}
                onChange={(e) =>
                  setForm({
                    ...form,
                    late_payment_fee: parseFloat(e.target.value) || 0,
                  })
                }
                className={fld}
              />
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-50 to-ocean-50 border-2 border-blue-200 rounded-xl p-4">
            <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
              <BarChart3 size={16} /> Example Calculation
            </h3>
            <p className="text-sm text-blue-800 mb-3">
              For a KES 50,000 loan over {form.default_duration_months} months
              at {annual}% p.a.:
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-white rounded p-2">
                <p className="text-xs text-gray-500">Total Interest</p>
                <p className="font-bold">
                  KES{" "}
                  {totalInterest.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              <div className="bg-white rounded p-2">
                <p className="text-xs text-gray-500">Monthly Payment</p>
                <p className="font-bold text-green-600">
                  KES{" "}
                  {monthlyPayment.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              {feeRate > 0 && (
                <>
                  <div className="bg-white rounded p-2">
                    <p className="text-xs text-gray-500">
                      Processing Fee ({feeRate}%)
                    </p>
                    <p className="font-bold text-amber-700">
                      − KES {processingFeeOnExample.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-white rounded p-2">
                    <p className="text-xs text-gray-500">You disburse</p>
                    <p className="font-bold text-ocean-700">
                      KES {netDisbursedExample.toLocaleString()}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 bg-ocean-gradient text-white font-bold rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Continue →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LoanSettingsStep;
