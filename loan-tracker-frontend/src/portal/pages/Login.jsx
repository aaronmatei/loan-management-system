import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import portalApi from "../services/portalApi";

function CustomerLogin() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [credentials, setCredentials] = useState({
    phone_number: "",
    password: "",
  });

  const handleLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await portalApi.post("/portal/auth/login", credentials);
      localStorage.setItem("portal_token", res.data.token);
      localStorage.setItem(
        "portal_customer",
        JSON.stringify(res.data.customer),
      );
      localStorage.setItem(
        "portal_tenants",
        JSON.stringify(res.data.tenants || []),
      );
      switch (res.data.action) {
        case "dashboard":
          localStorage.setItem(
            "portal_current_tenant",
            JSON.stringify(res.data.current_tenant),
          );
          navigate("/loanfix/portal/dashboard");
          break;
        case "select_tenant":
          navigate("/loanfix/portal/select-tenant");
          break;
        case "add_lender":
          // No lender linked yet — land on the dashboard, which shows the
          // "add your first lender" empty state.
          localStorage.removeItem("portal_current_tenant");
          navigate("/loanfix/portal/dashboard");
          break;
        default:
          navigate("/loanfix/portal/dashboard");
      }
    } catch (err) {
      alert(err.response?.data?.error || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 lg:p-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-2">
          Welcome Back
        </h2>
        <p className="text-gray-600 mb-6">One account, many lenders</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={credentials.phone_number}
              onChange={(e) =>
                setCredentials({
                  ...credentials,
                  phone_number: e.target.value,
                })
              }
              required
              placeholder="0712345678"
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">
              Password
            </label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) =>
                setCredentials({ ...credentials, password: e.target.value })
              }
              required
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
          >
            {submitting ? "Logging in..." : "🔐 Login"}
          </button>
          <div className="text-center text-sm space-y-2">
            <Link
              to="/loanfix/portal/forgot-password"
              className="text-indigo-600 block"
            >
              Forgot password?
            </Link>
            <p>
              New here?{" "}
              <Link
                to="/loanfix/portal/register"
                className="text-indigo-600 font-semibold"
              >
                Register
              </Link>
            </p>
          </div>
        </form>
        <div className="mt-6 pt-6 border-t border-gray-100">
          <p className="text-xs text-center text-gray-500">
            🔒 One login • Many lenders • Secure
          </p>
        </div>
      </div>
    </div>
  );
}

export default CustomerLogin;
