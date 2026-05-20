import React, { useState } from "react";

// These values are stored in onboarding_data (the wizard memo only) so
// they pre-fill the FirstLoan step. We don't write tenant-level loan
// policy here — that lives in customer.js /tenant-policy and Settings.
function LoanSettingsStep({ data, onNext, onBack }) {
  const [form, setForm] = useState({
    default_interest_rate: data.default_interest_rate || 15,
    min_loan_amount: data.min_loan_amount || 1000,
    max_loan_amount: data.max_loan_amount || 500000,
    default_duration_months: data.default_duration_months || 6,
    late_payment_fee: data.late_payment_fee || 500,
  });

  const principal = 50000;
  const totalInterest =
    principal * (form.default_interest_rate / 100 / 12) *
    form.default_duration_months;
  const monthlyPayment =
    (principal + totalInterest) / form.default_duration_months;

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-white rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">📊</div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
            Set Your Loan Defaults
          </h2>
          <p className="text-gray-600">
            These become the default values when creating new loans
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onNext(form);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-semibold mb-1">
              Default Interest Rate (% per annum) *
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={form.default_interest_rate}
              onChange={(e) =>
                setForm({
                  ...form,
                  default_interest_rate: parseFloat(e.target.value) || 0,
                })
              }
              required
              className={fld}
            />
            <p className="text-xs text-gray-500 mt-1">Common range: 10-30% per year</p>
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
                <option key={m} value={m}>{m} months</option>
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

          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-4">
            <h3 className="font-bold text-blue-900 mb-2">
              📊 Example Calculation
            </h3>
            <p className="text-sm text-blue-800 mb-3">
              For a KES 50,000 loan over {form.default_duration_months} months
              at {form.default_interest_rate}% p.a.:
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
              className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg"
            >
              Continue →
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LoanSettingsStep;
