import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Logo from '../components/Logo';
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
    <div className="min-h-screen flex items-center justify-center bg-ocean-gradient p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 sm:p-10 w-full max-w-md">
        <div className="text-center mb-8">
          <Logo
            className="justify-center mb-3"
            markClassName="h-9 w-9"
            textClassName="text-3xl"
          />
          <h2 className="text-gray-600">Login to your account</h2>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
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
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none disabled:bg-gray-100 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              disabled={loading}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none disabled:bg-gray-100 transition"
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
        <p className="text-center mt-4 text-sm text-gray-600">
          Don't have an account?{' '}
          <Link to="/signup" className="text-ocean-600 font-semibold">
            Sign up free
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Login;