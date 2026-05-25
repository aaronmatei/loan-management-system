import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  Coins,
  BarChart3,
  ClipboardList,
  Users,
  CheckCircle,
  AlertTriangle,
  Send,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
// Tenants store the rate annually; customers think monthly.
const PM = (annual) => +(parseFloat(annual || 0) / 12).toFixed(2);

// Apply is always opened in the context of ONE lender — the one the customer
// drilled into (its tenant_id is stashed in portal_current_tenant). There is
// no lender picker here; the chosen lender's details are shown read-only. If
// we arrive without a linked lender in context, bounce to the directory.
function ApplyLoan() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Widget hand-off: ?amount=&duration=&source=widget pre-fills the form.
  const preAmount = searchParams.get("amount") || "";
  const preDuration = searchParams.get("duration") || "6";

  const [lender, setLender] = useState(null);
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

  useEffect(() => {
    let current = null;
    try {
      current = JSON.parse(
        localStorage.getItem("portal_current_tenant") || "null",
      );
    } catch {
      current = null;
    }
    // No lender chosen → send them to pick one.
    if (!current?.tenant_id) {
      navigate("/loanfix/lenders");
      return;
    }
    (async () => {
      try {
        const r = await portalApi.get("/portal/customer/calculator-policies");
        const row = (r.data.data || []).find(
          (x) => x.tenant_id === current.tenant_id,
        );
        // Not linked to this lender (shouldn't happen via the normal flow).
        if (!row) {
          navigate("/loanfix/lenders");
          return;
        }
        // Scope the session to this lender so the submission files there.
        const sel = await portalApi.post("/portal/auth/select-tenant", {
          tenant_id: row.tenant_id,
        });
        localStorage.setItem("portal_token", sel.data.token);
        localStorage.setItem(
          "portal_current_tenant",
          JSON.stringify({
            ...sel.data.current_tenant,
            brand_color: row.brand_color,
          }),
        );
        setLender(row);
        setPolicy({
          default_interest_rate: parseFloat(row.default_interest_rate),
          min_amount: parseFloat(row.min_amount),
          max_amount: parseFloat(row.max_amount),
        });
      } catch (err) {
        alert(err.response?.data?.error || "Failed to load lender");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const brand = lender?.brand_color || "#0086cc";

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
      alert(`${r.data.message}\n\nLoan Code: ${r.data.data.loan_code}`);
      navigate("/loanfix/portal/applications");
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
  if (!lender || !policy) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-500">
          Couldn't load this lender.{" "}
          <button
            onClick={() => navigate("/loanfix/lenders")}
            className="text-ocean-600 font-semibold"
          >
            Back to Lenders
          </button>
        </div>
      </PortalLayout>
    );
  }

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-[var(--brand)] focus:outline-none";

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-3xl mx-auto" style={{ "--brand": brand }}>
        <button
          onClick={() => navigate(`/loanfix/lenders/${lender.tenant_id}`)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-navy-900 mb-3"
        >
          <ArrowLeft size={16} /> {lender.business_name}
        </button>

        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 flex items-center gap-2">
          <FileText size={28} className="text-navy-900" /> Apply for New Loan
        </h1>
        <p className="text-gray-600 mt-1 mb-5">
          You're applying to {lender.business_name}.
        </p>

        {/* Preselected lender — read-only context (no picker) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-5">
          <div className="h-1.5" style={{ backgroundColor: brand }} />
          <div className="p-4 flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
              style={{ backgroundColor: brand }}
            >
              {lender.business_name?.charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-navy-900 truncate">
                {lender.business_name}
              </p>
              <p className="text-xs text-slate-500">
                {KES(policy.min_amount)} – {KES(policy.max_amount)} ·{" "}
                {PM(policy.default_interest_rate)}% p.m.
                {lender.default_duration_months
                  ? ` · up to ${lender.default_duration_months} mo`
                  : ""}
              </p>
            </div>
          </div>
        </div>

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
                    step >= s.n ? "bg-[var(--brand)]" : "bg-gray-200"
                  }`}
                />
              )}
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    step >= s.n
                      ? "bg-[var(--brand)] text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {step > s.n ? <CheckCircle size={18} /> : s.n}
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
            <h2 className="text-xl font-bold flex items-center gap-2"><Coins size={22} className="text-navy-900" /> How much do you need?</h2>
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
                        ? "bg-[var(--brand)] text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {m}mo
                  </button>
                ))}
              </div>
            </div>
            {calc && (
              <div className="bg-[var(--brand)]/10 border-2 border-[var(--brand)]/30 rounded-xl p-4 text-sm space-y-2">
                <h3 className="font-bold text-navy-900 flex items-center gap-1.5"><BarChart3 size={18} /> Loan Summary</h3>
                <div className="flex justify-between">
                  <span>Principal</span>
                  <span className="font-bold">{KES(calc.principal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Interest Rate</span>
                  <span className="font-bold">
                    {+(calc.annualRate / 12).toFixed(2)}% p.m.
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Total Interest</span>
                  <span className="font-bold text-orange-600">
                    {KES(calc.totalInterest)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[var(--brand)]/30">
                  <span className="font-semibold">Total to Repay</span>
                  <span className="font-bold text-[var(--brand)]">
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
              className="w-full py-3 bg-[var(--brand)] text-white font-bold rounded-lg disabled:opacity-50"
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
            <h2 className="text-xl font-bold flex items-center gap-2"><ClipboardList size={22} className="text-navy-900" /> Loan Details</h2>
            <div>
              <label className="block text-sm font-semibold mb-2">
                Loan Purpose *
              </label>
              <select
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
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
              <h3 className="font-bold text-navy-900 mb-3 flex items-center gap-1.5">
                <Users size={18} /> Guarantor (optional)
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
              <h3 className="font-bold text-navy-900 mb-3">
                Collateral (optional)
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
                className="flex-1 py-3 bg-[var(--brand)] text-white font-bold rounded-lg"
              >
                Continue →
              </button>
            </div>
          </form>
        )}

        {step === 3 && calc && (
          <div className="bg-white rounded-2xl shadow p-6 lg:p-8 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2"><CheckCircle size={22} className="text-navy-900" /> Review &amp; Submit</h2>
            <div className="bg-[var(--brand)]/10 rounded-xl p-4 text-sm space-y-2">
              <div className="flex justify-between">
                <span>Lender</span>
                <span className="font-bold">{lender.business_name}</span>
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
                <span className="font-bold">
                  {+(calc.annualRate / 12).toFixed(2)}% p.m.
                </span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span>Total to Repay</span>
                <span className="font-bold text-[var(--brand)]">
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
              <h3 className="font-bold text-navy-900 mb-1">Purpose</h3>
              <p className="text-sm">{form.purpose}</p>
            </div>
            {form.review_notes && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-bold text-navy-900 mb-1">Notes</h3>
                <p className="text-sm">{form.review_notes}</p>
              </div>
            )}
            {form.guarantor_name && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-bold text-navy-900 mb-1">Guarantor</h3>
                <p className="text-sm">
                  {form.guarantor_name} — {form.guarantor_phone}
                </p>
              </div>
            )}
            {form.collateral_description && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-bold text-navy-900 mb-1">Collateral</h3>
                <p className="text-sm">{form.collateral_description}</p>
              </div>
            )}
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800 flex items-start gap-2">
              <AlertTriangle size={16} className="text-yellow-700 shrink-0 mt-0.5" />
              <span><strong>Important:</strong> By submitting you agree to{" "}
              {lender.business_name}'s terms. The lender typically reviews
              within 24–48 hours.</span>
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
                {submitting ? "Submitting…" : <span className="inline-flex items-center gap-1.5"><Send size={15} /> Submit Application</span>}
              </button>
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export default ApplyLoan;
