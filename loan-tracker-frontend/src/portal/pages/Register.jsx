import React, { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import portalApi from "../services/portalApi";
import DevTenantSwitcher from "../components/DevTenantSwitcher";
import PasswordInput from "../components/PasswordInput";

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
  const [form, setForm] = useState({
    lender_subdomain: "",
    phone_number: "",
    id_number: "",
    first_name: "",
    last_name: "",
    otp: "",
    password: "",
    confirmPassword: "",
  });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submitDetails = async (e) => {
    e.preventDefault();
    if (form.lender_subdomain) {
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({ subdomain: form.lender_subdomain.toLowerCase() }),
      );
    }
    setSubmitting(true);
    try {
      const res = await portalApi.post("/portal/auth/register", {
        phone_number: form.phone_number,
        id_number: form.id_number,
        first_name: form.first_name,
        last_name: form.last_name,
      });
      if (res.data.action === "login_to_add_tenant") {
        alert(
          "You already have a platform account. Please log in to add this lender.",
        );
        navigate("/portal/login");
        return;
      }
      if (res.data.requires_otp) {
        setCustomerId(res.data.customer_id);
        setStep(2);
      }
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
      alert("Registration successful! 🎉");
      if (fromWidget && widgetAmount) {
        const p = new URLSearchParams({
          amount: widgetAmount,
          ...(widgetDuration ? { duration: widgetDuration } : {}),
        });
        navigate(`/portal/apply?${p}`);
      } else {
        navigate("/portal/dashboard");
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

  const field =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
      <DevTenantSwitcher />
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 lg:p-8">
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
            : "Enter the code we texted you"}
        </p>

        {step === 1 ? (
          <form onSubmit={submitDetails} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Lender Subdomain
              </label>
              <input
                value={form.lender_subdomain}
                onChange={set("lender_subdomain")}
                required
                placeholder="techtsadong"
                className={field}
              />
            </div>
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
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
            >
              {submitting ? "Sending code..." : "Continue →"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="space-y-4">
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
            <button
              type="button"
              onClick={resend}
              className="w-full text-sm text-indigo-600"
            >
              Resend code
            </button>
          </form>
        )}

        <p className="text-center text-sm mt-6">
          Already have an account?{" "}
          <Link
            to="/portal/login"
            className="text-indigo-600 font-semibold"
          >
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}

export default CustomerRegister;
