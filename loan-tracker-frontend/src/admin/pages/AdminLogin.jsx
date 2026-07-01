import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../../components/Logo";
import PasswordInput from "../../components/PasswordInput";
import { useAuth } from "../../context/AuthContext";
import api from "../../services/api";
import { ShieldCheck } from "lucide-react";

// Dedicated platform-admin door. Uses the same /api/auth/login
// endpoint as the staff login (one credential store), but rejects
// non-platform-admin users with a clear "use /login instead" message.
// The staff Login.jsx does the inverse — together they keep the two
// audiences on their own URLs.
function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", { email, password });
      const u = res.data.user;
      if (!u?.is_platform_admin) {
        // Don't persist anything — they aren't allowed in this door.
        setError(
          "This account isn't a platform admin. Use /login for tenant staff accounts.",
        );
        return;
      }
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(u));
      setUser(u);
      navigate("/admin/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-slate-800 p-4">
      <div className="bg-surface rounded-xl shadow-2xl p-6 sm:p-10 w-full max-w-md">
        <div className="text-center mb-8">
          <Logo
            className="justify-center mb-3"
            markClassName="h-8 w-8"
            textClassName="text-2xl"
          />
          <h1 className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center justify-center gap-1.5">
            <ShieldCheck size={18} className="text-slate-500 dark:text-slate-400" /> Platform Admin
          </h1>
          <h2 className="text-gray-600 dark:text-slate-400 text-sm">
            Restricted area — platform administrators only
          </h2>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@lenderfest.loans"
              required
              autoFocus
              disabled={loading}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-700 rounded-lg focus:border-slate-700 focus:outline-none disabled:bg-gray-100 transition dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">
              Password
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-700 rounded-lg focus:border-slate-700 focus:outline-none disabled:bg-gray-100 transition dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-gray-900 to-slate-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Authenticating..." : "Sign in"}
          </button>
        </form>

        <p className="text-center mt-6 text-xs text-gray-500 dark:text-slate-400">
          Tenant staff?{" "}
          <a href="/login" className="text-slate-700 dark:text-slate-200 font-semibold">
            Use the regular login
          </a>
        </p>
      </div>
    </div>
  );
}

export default AdminLogin;
