import React, { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import portalApi from "../services/portalApi";
import PasswordInput from "../components/PasswordInput";
import IdentityUploader from "../components/IdentityUploader";
import { KENYA_COUNTIES } from "../../utils/counties";
import { BUSINESS_TYPES } from "../../utils/businessTypes";

// Two-step: details → OTP + password. Portal registration is scoped
// to a lender (subdomain); in production that comes from the host,
// here we collect it so portalApi can send X-Tenant-Subdomain.
function CustomerRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Widget hand-off: ?amount=&duration=&source=widget pre-fills the
  // apply page after successful registration.
  const widgetAmount = searchParams.get("amount");
  const widgetDuration = searchParams.get("duration");
  const fromWidget = searchParams.get("source") === "widget";
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [customerId, setCustomerId] = useState(null);
  // OTP is currently disabled server-side; the field shows only if the
  // backend says it's required. TODO(OTP): re-enable when SMS is configured.
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [form, setForm] = useState({
    phone_number: "",
    id_number: "",
    first_name: "",
    last_name: "",
    email: "",
    date_of_birth: "",
    gender: "",
    business_name: "",
    business_type: "",
    county: "",
    city: "",
    address: "",
    otp: "",
    password: "",
    confirmPassword: "",
  });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submitDetails = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Tenant-less registration — no lender chosen here. The customer
      // adds a lender after logging in.
      const res = await portalApi.post("/portal/auth/register", {
        phone_number: form.phone_number,
        id_number: form.id_number,
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email || null,
        date_of_birth: form.date_of_birth || null,
        gender: form.gender || null,
        business_name: form.business_name || null,
        business_type: form.business_type || null,
        county: form.county || null,
        city: form.city || null,
        address: form.address || null,
      });
      if (res.data.action === "login") {
        alert("You already have an account. Please log in.");
        navigate("/loanfix/portal/login");
        return;
      }
      // Step 2 collects the password; the OTP field appears only if the
      // backend requires it (disabled for now).
      setCustomerId(res.data.customer_id);
      setRequiresOtp(!!res.data.requires_otp);
      setStep(2);
    } catch (err) {
      alert(err.response?.data?.error || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      alert("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const res = await portalApi.post("/portal/auth/verify-otp", {
        customer_id: customerId,
        otp: form.otp,
        password: form.password,
      });
      localStorage.setItem("portal_token", res.data.token);
      localStorage.setItem(
        "portal_customer",
        JSON.stringify(res.data.customer),
      );
      if (res.data.current_tenant) {
        localStorage.setItem(
          "portal_current_tenant",
          JSON.stringify(res.data.current_tenant),
        );
      }
      // New accounts upload identity documents as the final signup step
      // (only when image storage is live; otherwise needs_kyc is false and
      // we finish straight away).
      if (res.data.customer?.needs_kyc) {
        setStep(3);
      } else {
        alert(
          `Registration successful! 🎉\nYour LoanFix ID: ${res.data.customer?.customer_code || ""}`,
        );
        finishSignup();
      }
    } catch (err) {
      alert(err.response?.data?.error || "Verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    try {
      await portalApi.post("/portal/auth/resend-otp", {
        customer_id: customerId,
        purpose: "registration",
      });
      alert("OTP resent");
    } catch {
      alert("Failed to resend");
    }
  };

  // Land the new customer on the apply page (widget hand-off) or the
  // dashboard once signup — including identity upload — is done.
  const finishSignup = () => {
    const dest =
      fromWidget && widgetAmount
        ? `/loanfix/portal/apply?${new URLSearchParams({
            amount: widgetAmount,
            ...(widgetDuration ? { duration: widgetDuration } : {}),
          })}`
        : "/loanfix/portal/dashboard";
    navigate(dest);
  };

  const field =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full p-6 lg:p-8 ${
          step === 3 ? "max-w-xl" : "max-w-md"
        }`}
      >
        {fromWidget && widgetAmount && (
          <div className="mb-4 bg-indigo-50 border border-indigo-200 text-indigo-900 text-sm rounded-lg py-2 px-3">
            📊 Applying for KES{" "}
            <strong>{parseFloat(widgetAmount).toLocaleString()}</strong>
            {widgetDuration ? ` over ${widgetDuration} months` : ""}. Finish
            sign-up to continue.
          </div>
        )}
        <h2 className="text-3xl font-bold text-gray-800 mb-2">
          Create Account
        </h2>
        <p className="text-gray-600 mb-6">
          {step === 1
            ? "One account works across all your lenders"
            : step === 2
              ? requiresOtp
                ? "Enter the code we texted you"
                : "Set a password to finish"
              : "Upload your photo and ID to verify your identity"}
        </p>

        {step === 1 ? (
          <form onSubmit={submitDetails} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  First Name
                </label>
                <input
                  value={form.first_name}
                  onChange={set("first_name")}
                  required
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Last Name
                </label>
                <input
                  value={form.last_name}
                  onChange={set("last_name")}
                  required
                  className={field}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={form.phone_number}
                onChange={set("phone_number")}
                required
                placeholder="0712345678"
                className={field}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={set("email")}
                required
                placeholder="you@example.com"
                className={field}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                National ID Number
              </label>
              <input
                value={form.id_number}
                onChange={set("id_number")}
                required
                className={field}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={set("date_of_birth")}
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Gender
                </label>
                <select
                  value={form.gender}
                  onChange={set("gender")}
                  className={field}
                >
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Business &amp; location (optional)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Business Name
                </label>
                <input
                  value={form.business_name}
                  onChange={set("business_name")}
                  placeholder="e.g. Mama Mboga Stores"
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Business Type
                </label>
                <select
                  value={form.business_type}
                  onChange={set("business_type")}
                  className={`${field} bg-white`}
                >
                  <option value="">Select type…</option>
                  {BUSINESS_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1">County</label>
                <select
                  value={form.county}
                  onChange={set("county")}
                  className={`${field} bg-white`}
                >
                  <option value="">Select county…</option>
                  {KENYA_COUNTIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Town / City
                </label>
                <input
                  value={form.city}
                  onChange={set("city")}
                  placeholder="e.g. Nairobi"
                  className={field}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Address</label>
              <input
                value={form.address}
                onChange={set("address")}
                placeholder="P.O Box / physical address"
                className={field}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Continue →"}
            </button>
          </form>
        ) : step === 2 ? (
          <form onSubmit={submitOtp} className="space-y-4">
            {requiresOtp && (
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Verification Code
                </label>
                <input
                  value={form.otp}
                  onChange={set("otp")}
                  required
                  maxLength="6"
                  placeholder="6-digit code"
                  className={field}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold mb-1">
                Set a Password
              </label>
              <PasswordInput
                value={form.password}
                onChange={set("password")}
                required
                minLength="12"
                placeholder="Min 12 chars, 1 upper, 1 number, 1 symbol"
                className={field}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Confirm Password
              </label>
              <PasswordInput
                value={form.confirmPassword}
                onChange={set("confirmPassword")}
                required
                placeholder="Re-enter your password"
                className={field}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
            >
              {submitting ? "Verifying..." : "Verify & Finish"}
            </button>
            {requiresOtp && (
              <button
                type="button"
                onClick={resend}
                className="w-full text-sm text-indigo-600"
              >
                Resend code
              </button>
            )}
          </form>
        ) : (
          <IdentityUploader onComplete={finishSignup} />
        )}

        {step !== 3 && (
          <p className="text-center text-sm mt-6">
            Already have an account?{" "}
            <Link
              to="/loanfix/portal/login"
              className="text-indigo-600 font-semibold"
            >
              Login
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

export default CustomerRegister;
