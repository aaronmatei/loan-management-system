import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import portalApi from "../services/portalApi";
import PasswordInput from "../components/PasswordInput";

// Mirrors the backend validatePassword used by /portal/auth/
// reset-password: >=12 chars, an uppercase letter, a digit, and a
// special character. (The spec's 6-char rule would just get a 400.)
const PASSWORD_RULE = "Min 12 chars, 1 uppercase, 1 number, 1 symbol";
const validPassword = (p) =>
  p.length >= 12 &&
  /[A-Z]/.test(p) &&
  /[0-9]/.test(p) &&
  /[^A-Za-z0-9]/.test(p);

const field =
  "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";

function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState("");
  const [customerId, setCustomerId] = useState(null);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const requestOtp = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await portalApi.post("/portal/auth/forgot-password", {
        phone_number: phone,
      });
      // Backend always returns a generic message; customer_id is only
      // present when the account actually exists.
      if (res.data.customer_id) {
        setCustomerId(res.data.customer_id);
        setStep(2);
      } else {
        alert(
          res.data.message ||
            "If an account exists for that number, an OTP was sent.",
        );
      }
    } catch (err) {
      alert(err.response?.data?.error || "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      alert("Passwords do not match");
      return;
    }
    if (!validPassword(password)) {
      alert(PASSWORD_RULE);
      return;
    }
    setSubmitting(true);
    try {
      await portalApi.post("/portal/auth/reset-password", {
        customer_id: customerId,
        otp,
        new_password: password,
      });
      alert("Password reset. Please log in.");
      navigate("/portal/login");
    } catch (err) {
      alert(err.response?.data?.error || "Reset failed");
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    try {
      await portalApi.post("/portal/auth/resend-otp", {
        customer_id: customerId,
        purpose: "password_reset",
      });
      alert("OTP resent");
    } catch {
      alert("Failed to resend");
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 lg:p-8">
          <h2 className="text-3xl font-bold text-gray-800 mb-2">
            Reset Password
          </h2>
          <p className="text-gray-600 mb-6">
            {step === 1
              ? "Enter your phone number to get a reset code"
              : "Enter the code we texted you and a new password"}
          </p>

          {step === 1 ? (
            <form onSubmit={requestOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="0712345678"
                  className={field}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send reset code →"}
              </button>
            </form>
          ) : (
            <form onSubmit={resetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Verification Code
                </label>
                <input
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                  maxLength="6"
                  placeholder="6-digit code"
                  className={`${field} text-center text-2xl tracking-widest font-bold`}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  New Password
                </label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder={PASSWORD_RULE}
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Confirm Password
                </label>
                <PasswordInput
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className={field}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
              >
                {submitting ? "Resetting…" : "Reset password"}
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
            <Link to="/portal/login" className="text-indigo-600 font-semibold">
              ← Back to login
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}

export default ForgotPassword;
