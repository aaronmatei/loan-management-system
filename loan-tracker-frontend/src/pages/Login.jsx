import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Logo from '../components/Logo';
import PasswordInput from '../components/PasswordInput';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { buildAuthHandoff } from '../utils/authHandoff';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setUser } = useAuth();
  // The same login screen serves lenders (/login) and welfare
  // (/welfare/login) — so the "sign up" link must point to the matching
  // register, not always the lender one.
  const { pathname } = useLocation();
  const variant = pathname.startsWith("/welfare") ? "welfare" : "lender";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/auth/login', { email, password });
      const u = response.data.user;
      // Platform admins must use /admin/login. Reject here without
      // persisting credentials so this door stays staff-only.
      if (u?.is_platform_admin) {
        setError('This account is a platform admin. Please use /admin/login.');
        return;
      }
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(u));
      // Send a tenant user to their own subdomain after login. This fires
      // whenever they signed in somewhere other than their own subdomain:
      //   • the apex (lenderfest.loans — where "Lender Login" points)
      //   • the generic app host (app.lenderfest.loans)
      //   • a different tenant's subdomain (kuwazo's URL, payoneer's creds)
      // The token + user are handed to the target via the fragment
      // (#__lf_auth=…) so the target subdomain's localStorage gets this
      // fresh session before its App.jsx reads it — without that, a stale
      // session under a different tenant there would ping-pong us back.
      // currentLabel is '' on the apex, the label on a *.lenderfest.loans
      // host, or null on dev/preview/other hosts (where we never redirect).
      const desired = u?.tenant?.subdomain;
      const host = window.location.hostname;
      const SUFFIX = '.lenderfest.loans';
      const currentLabel =
        host === 'lenderfest.loans'
          ? ''
          : host.endsWith(SUFFIX)
            ? host.slice(0, -SUFFIX.length)
            : null;
      if (desired && currentLabel !== null && currentLabel !== desired) {
        const handoff = buildAuthHandoff(response.data.token, u);
        const hash = handoff ? `#${handoff}` : '';
        window.location.replace(`https://${desired}.lenderfest.loans/${hash}`);
        return;
      }
      setUser(u);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-ocean-gradient bg-cover bg-center bg-no-repeat p-4"
      style={{ backgroundImage: "url('/lenderfest_hero_login_background.svg')" }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6 sm:p-10 w-full max-w-md">
        <div className="text-center mb-8">
          <Logo
            variant="default"
            markClassName="h-9 w-9"
            textClassName="text-3xl"
            className="justify-center mb-3"
          />
          <h2 className="text-slate-500 dark:text-slate-400">Login to your account</h2>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              autoFocus
              disabled={loading}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none disabled:bg-gray-100 dark:disabled:bg-slate-700 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">
              Password
            </label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              disabled={loading}
              autoComplete="current-password"
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none disabled:bg-gray-100 dark:disabled:bg-slate-700 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        {variant === "welfare" ? (
          <p className="text-center mt-4 text-sm text-gray-600 dark:text-slate-400">
            Don't have an account?{' '}
            <Link to="/welfare/register" className="text-emerald-700 font-semibold">
              Register a welfare
            </Link>
          </p>
        ) : (
          <>
            <p className="text-center mt-4 text-sm text-gray-600 dark:text-slate-400">
              Don't have an account?{' '}
              <Link to="/signup" className="text-ocean-600 font-semibold">
                Sign up free
              </Link>
            </p>
            <p className="text-center mt-1 text-sm text-gray-600 dark:text-slate-400">
              Other account types?{' '}
              <Link to="/get-started" className="text-ocean-600 font-semibold">
                Get started
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default Login;