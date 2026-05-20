import React, { useState } from "react";
import api from "../../services/api";

// IMPORTANT: the staff POST /loans endpoint ALWAYS creates a
// 'pending' loan application (status is hard-coded in loans.js — any
// status field in the body is ignored). The activation requires
// /review -> /approve -> /disburse. So this step "submits the first
// loan application" honestly; after onboarding the tenant will see it
// in their Applications queue and run it through the workflow.
function FirstLoanStep({ data, createdClient, onNext, onBack }) {
  const [form, setForm] = useState({
    principal_amount: 50000,
    loan_duration_months: data.default_duration_months || 6,
    annual_interest_rate: data.default_interest_rate || 50,
    purpose: "Business expansion",
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Send only the fields the real backend accepts. It computes
      // loan_code, totals, monthly rate, dates itself.
      await api.post("/loans", {
        client_id: createdClient.id,
        principal_amount: form.principal_amount,
        annual_interest_rate: form.annual_interest_rate,
        loan_duration_months: form.loan_duration_months,
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
  const interest =
    form.principal_amount *
    (form.annual_interest_rate / 100 / 12) *
    form.loan_duration_months;
  const total = form.principal_amount + interest;

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-white rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">💰</div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
            Submit First Loan Application
          </h2>
          <p className="text-gray-600">
            For {createdClient?.first_name} {createdClient?.last_name}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            This creates a pending application — review and disburse it
            from the Applications page after setup.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Amount (KES) *</label>
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
              <label className="block text-sm font-semibold mb-1">Duration *</label>
              <select
                value={form.loan_duration_months}
                onChange={(e) =>
                  setForm({
                    ...form,
                    loan_duration_months: parseInt(e.target.value, 10),
                  })
                }
                className={`${fld} bg-white`}
              >
                {[1, 3, 6, 12, 18, 24].map((m) => (
                  <option key={m} value={m}>{m} months</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Rate (% p.a.)</label>
              <input
                type="number"
                step="0.5"
                value={form.annual_interest_rate}
                onChange={(e) =>
                  setForm({
                    ...form,
                    annual_interest_rate: parseFloat(e.target.value) || 0,
                  })
                }
                className={fld}
              />
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

          <div className="bg-indigo-50 rounded-xl p-3 text-sm">
            <div className="flex justify-between">
              <span>Total Interest</span>
              <span className="font-bold">
                KES{" "}
                {interest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span>Total Repayable</span>
              <span className="font-bold text-indigo-700">
                KES{" "}
                {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
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
              className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
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
