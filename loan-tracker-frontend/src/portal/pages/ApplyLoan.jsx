import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

function ApplyLoan() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Widget hand-off: ?amount=&duration=&source=widget pre-fills the
  // form so the customer just confirms purpose and submits.
  const preAmount = searchParams.get("amount") || "";
  const preDuration = searchParams.get("duration") || "6";
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    principal_amount: preAmount,
    loan_duration_months: preDuration,
    purpose: "",
    guarantor_name: "",
    guarantor_phone: "",
    guarantor_id_number: "",
    collateral_description: "",
    review_notes: "",
  });

  const tenant = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_current_tenant") || "{}");
    } catch {
      return {};
    }
  })();

  useEffect(() => {
    portalApi
      .get("/portal/customer/tenant-policy")
      .then((r) => setPolicy(r.data.data.policy))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant")
          navigate("/portal/select-tenant");
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  const calc = (() => {
    if (!form.principal_amount || !form.loan_duration_months || !policy)
      return null;
    const principal = parseFloat(form.principal_amount);
    const months = parseInt(form.loan_duration_months, 10);
    const annualRate = policy.default_interest_rate;
    const totalInterest = principal * (annualRate / 100 / 12) * months;
    const totalDue = principal + totalInterest;
    return {
      principal,
      annualRate,
      totalInterest,
      totalDue,
      monthlyPayment: totalDue / months,
    };
  })();

  const step1 = (e) => {
    e.preventDefault();
    const p = parseFloat(form.principal_amount);
    if (!p || p < policy.min_amount) {
      alert(`Minimum loan amount is ${KES(policy.min_amount)}`);
      return;
    }
    if (p > policy.max_amount) {
      alert(`Maximum loan amount is ${KES(policy.max_amount)}`);
      return;
    }
    setStep(2);
  };

  const step2 = (e) => {
    e.preventDefault();
    if (!form.purpose.trim()) {
      alert("Please select the loan purpose");
      return;
    }
    setStep(3);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await portalApi.post("/portal/customer/applications", form);
      alert(`🎉 ${r.data.message}\n\nLoan Code: ${r.data.data.loan_code}`);
      navigate("/portal/applications");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to submit application");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </PortalLayout>
    );
  }
  if (!policy) return <PortalLayout><div /></PortalLayout>;

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <button
          onClick={() => navigate("/portal/dashboard")}
          className="text-indigo-600 mb-2 font-semibold text-sm"
        >
          ← Back to Dashboard
        </button>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
          📝 Apply for New Loan
        </h1>
        <p className="text-gray-600 mt-1 mb-6">
          From {tenant.business_name}
        </p>

        <div className="flex items-center mb-6">
          {[
            { n: 1, l: "Amount" },
            { n: 2, l: "Details" },
            { n: 3, l: "Review" },
          ].map((s, i) => (
            <React.Fragment key={s.n}>
              {i > 0 && (
                <div
                  className={`flex-1 h-1 ${
                    step >= s.n ? "bg-indigo-600" : "bg-gray-200"
                  }`}
                />
              )}
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    step >= s.n
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {step > s.n ? "✓" : s.n}
                </div>
                <p className="text-xs mt-1 text-gray-600">{s.l}</p>
              </div>
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <form
            onSubmit={step1}
            className="bg-white rounded-2xl shadow p-6 lg:p-8 space-y-6"
          >
            <h2 className="text-xl font-bold">💰 How much do you need?</h2>
            <div>
              <label className="block text-sm font-semibold mb-2">
                Loan Amount (KES)
              </label>
              <input
                type="number"
                value={form.principal_amount}
                onChange={(e) =>
                  setForm({ ...form, principal_amount: e.target.value })
                }
                required
                min={policy.min_amount}
                max={policy.max_amount}
                placeholder={`${policy.min_amount.toLocaleString()} - ${policy.max_amount.toLocaleString()}`}
                className={`${fld} text-2xl font-bold`}
              />
              <p className="text-xs text-gray-500 mt-1">
                Min {KES(policy.min_amount)} • Max {KES(policy.max_amount)}
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">
                Repayment Period
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[1, 3, 6, 12, 18, 24].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setForm({ ...form, loan_duration_months: String(m) })
                    }
                    className={`py-3 rounded-lg font-semibold text-sm ${
                      form.loan_duration_months === String(m)
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {m}mo
                  </button>
                ))}
              </div>
            </div>
            {calc && (
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-xl p-4 text-sm space-y-2">
                <h3 className="font-bold text-indigo-900">📊 Loan Summary</h3>
                <div className="flex justify-between">
                  <span>Principal</span>
                  <span className="font-bold">{KES(calc.principal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Interest Rate</span>
                  <span className="font-bold">{calc.annualRate}% p.a.</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Interest</span>
                  <span className="font-bold text-orange-600">
                    {KES(calc.totalInterest)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-indigo-200">
                  <span className="font-semibold">Total to Repay</span>
                  <span className="font-bold text-indigo-700">
                    {KES(calc.totalDue)}
                  </span>
                </div>
                <div className="flex justify-between bg-white rounded-lg p-3 mt-2">
                  <span className="font-bold">Monthly Payment</span>
                  <span className="font-bold text-green-600">
                    {KES(Math.round(calc.monthlyPayment))}
                  </span>
                </div>
              </div>
            )}
            <button
              type="submit"
              disabled={!calc}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
            >
              Continue →
            </button>
          </form>
        )}

        {step === 2 && (
          <form
            onSubmit={step2}
            className="bg-white rounded-2xl shadow p-6 lg:p-8 space-y-4"
          >
            <h2 className="text-xl font-bold">📋 Loan Details</h2>
            <div>
              <label className="block text-sm font-semibold mb-2">
                Loan Purpose *
              </label>
              <select
                value={form.purpose}
                onChange={(e) =>
                  setForm({ ...form, purpose: e.target.value })
                }
                required
                className={`${fld} bg-white`}
              >
                <option value="">Select purpose…</option>
                {[
                  "Business expansion",
                  "Stock purchase",
                  "Equipment purchase",
                  "School fees",
                  "Medical emergency",
                  "Home improvement",
                  "Vehicle purchase",
                  "Farming inputs",
                  "Working capital",
                  "Wedding expenses",
                  "Funeral expenses",
                  "Other",
                ].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">
                Additional Notes (optional)
              </label>
              <textarea
                value={form.review_notes}
                onChange={(e) =>
                  setForm({ ...form, review_notes: e.target.value })
                }
                rows="3"
                placeholder="Anything the lender should know…"
                className={fld}
              />
            </div>
            <div className="border-t pt-4">
              <h3 className="font-bold text-gray-800 mb-3">
                👥 Guarantor (optional)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={form.guarantor_name}
                  onChange={(e) =>
                    setForm({ ...form, guarantor_name: e.target.value })
                  }
                  placeholder="Guarantor Name"
                  className={fld}
                />
                <input
                  type="tel"
                  value={form.guarantor_phone}
                  onChange={(e) =>
                    setForm({ ...form, guarantor_phone: e.target.value })
                  }
                  placeholder="Guarantor Phone"
                  className={fld}
                />
              </div>
              <input
                value={form.guarantor_id_number}
                onChange={(e) =>
                  setForm({ ...form, guarantor_id_number: e.target.value })
                }
                placeholder="Guarantor ID Number"
                className={`${fld} mt-3`}
              />
            </div>
            <div className="border-t pt-4">
              <h3 className="font-bold text-gray-800 mb-3">
                🏠 Collateral (optional)
              </h3>
              <textarea
                value={form.collateral_description}
                onChange={(e) =>
                  setForm({
                    ...form,
                    collateral_description: e.target.value,
                  })
                }
                rows="2"
                placeholder="Vehicle, land, equipment…"
                className={fld}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold"
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
        )}

        {step === 3 && calc && (
          <div className="bg-white rounded-2xl shadow p-6 lg:p-8 space-y-4">
            <h2 className="text-xl font-bold">✅ Review & Submit</h2>
            <div className="bg-indigo-50 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span>Lender</span>
                <span className="font-bold">{tenant.business_name}</span>
              </div>
              <div className="flex justify-between">
                <span>Amount</span>
                <span className="font-bold">{KES(calc.principal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Duration</span>
                <span className="font-bold">
                  {form.loan_duration_months} months
                </span>
              </div>
              <div className="flex justify-between">
                <span>Interest Rate</span>
                <span className="font-bold">{calc.annualRate}% p.a.</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span>Total to Repay</span>
                <span className="font-bold text-indigo-700">
                  {KES(calc.totalDue)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Monthly Payment</span>
                <span className="font-bold text-green-600">
                  {KES(Math.round(calc.monthlyPayment))}
                </span>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <h3 className="font-bold text-gray-800 mb-1">Purpose</h3>
              <p className="text-sm">{form.purpose}</p>
            </div>
            {form.review_notes && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-bold text-gray-800 mb-1">Notes</h3>
                <p className="text-sm">{form.review_notes}</p>
              </div>
            )}
            {form.guarantor_name && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-bold text-gray-800 mb-1">Guarantor</h3>
                <p className="text-sm">
                  {form.guarantor_name} — {form.guarantor_phone}
                </p>
              </div>
            )}
            {form.collateral_description && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-bold text-gray-800 mb-1">Collateral</h3>
                <p className="text-sm">{form.collateral_description}</p>
              </div>
            )}
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
              ⚠️ <strong>Important:</strong> By submitting you agree to{" "}
              {tenant.business_name}'s terms. The lender typically
              reviews within 24–48 hours.
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={submitting}
                className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold"
              >
                ← Back
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 py-3 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-bold rounded-lg disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "📤 Submit Application"}
              </button>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export default ApplyLoan;
