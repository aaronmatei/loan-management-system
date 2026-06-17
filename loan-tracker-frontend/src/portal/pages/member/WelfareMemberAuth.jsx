// Welfare/Chama MEMBER front door — separate from the borrower portal but on
// the same platform_customers identity. Members reach these via an admin email/
// SMS invite, set their password, and log straight into the member desk
// (/welfare/member). A borrower-only account is bounced to the borrower login.
import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Users, Lock, ShieldCheck } from "lucide-react";
import portalApi from "../../services/portalApi";
import PasswordInput from "../../components/PasswordInput";

const SHELL =
  "min-h-screen bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center p-4";
const CARD = "bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 lg:p-8";
const FIELD =
  "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";
const BTN =
  "w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-700 text-white font-bold rounded-lg disabled:opacity-50";

// Persist a member session and route to the member desk. tenants are
// welfare-only (member-login filters them server-side).
async function landMember(navigate, data) {
  localStorage.setItem("portal_token", data.token);
  localStorage.setItem("portal_customer", JSON.stringify(data.customer));
  localStorage.setItem("portal_tenants", JSON.stringify(data.tenants || []));
  localStorage.removeItem("portal_current_tenant");
  const tenants = data.tenants || [];
  if (tenants.length === 1) {
    // One welfare → drill straight in (mint a tenant-scoped token).
    const res = await portalApi.post("/portal/auth/select-tenant", {
      tenant_id: tenants[0].tenant_id,
    });
    localStorage.setItem("portal_token", res.data.token);
    localStorage.setItem(
      "portal_current_tenant",
      JSON.stringify(res.data.current_tenant),
    );
    navigate("/welfare/member");
  } else {
    navigate("/welfare/member/select");
  }
}

export function WelfareMemberLogin() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [creds, setCreds] = useState({ phone_number: "", password: "" });

  const handleLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await portalApi.post("/portal/auth/member-login", creds);
      // Invited with a temporary password → force a change first. Carry the
      // entered credentials in-memory (router state) so they don't re-type.
      if (res.data.must_change_password) {
        navigate("/welfare/member/register", {
          state: {
            phone_number: creds.phone_number,
            current_password: creds.password,
            forced: true,
          },
        });
        return;
      }
      await landMember(navigate, res.data);
    } catch (err) {
      const data = err.response?.data;
      if (data?.action === "use_borrower_login") {
        if (
          window.confirm(
            (data.error || "No chama membership found.") +
              "\n\nGo to the borrower login?",
          )
        )
          navigate("/portal/login");
      } else {
        alert(data?.error || "Login failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={SHELL}>
      <div className={CARD}>
        <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-3">
          <Users className="text-emerald-700" size={22} />
        </div>
        <h2 className="text-3xl font-bold text-gray-800 mb-1">Member login</h2>
        <p className="text-gray-600 mb-6">Your chama / welfare portal</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Phone Number</label>
            <input
              type="tel"
              value={creds.phone_number}
              onChange={(e) => setCreds({ ...creds, phone_number: e.target.value })}
              required
              placeholder="0712345678"
              className={FIELD}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Password</label>
            <PasswordInput
              value={creds.password}
              onChange={(e) => setCreds({ ...creds, password: e.target.value })}
              required
              autoComplete="current-password"
              className={FIELD}
            />
          </div>
          <button type="submit" disabled={submitting} className={BTN}>
            {submitting ? "Logging in..." : (
              <span className="inline-flex items-center gap-1.5"><Lock size={16} /> Login</span>
            )}
          </button>
          <div className="text-center text-sm space-y-2">
            <Link to="/welfare/member/register" className="text-emerald-700 block">
              First time / change your password
            </Link>
            <p className="text-gray-500">
              A borrower?{" "}
              <Link to="/portal/login" className="text-emerald-700 font-semibold">
                Borrower login
              </Link>
            </p>
          </div>
        </form>
        <div className="mt-6 pt-6 border-t border-gray-100">
          <p className="text-xs text-center text-gray-500 flex items-center justify-center gap-1.5">
            <ShieldCheck size={14} className="text-gray-400" /> Invited by your chama admin • Secure
          </p>
        </div>
      </div>
    </div>
  );
}

// Set or change the member's password. Reached from the invite link (fresh) or
// from a forced change right after login (credentials pre-filled via state).
export function WelfareMemberSetPassword() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    phone_number: state?.phone_number || "",
    current_password: state?.current_password || "",
    new_password: "",
    confirm: "",
  });
  const forced = !!state?.forced;

  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) {
      alert("New passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await portalApi.post("/portal/auth/member-set-password", {
        phone_number: form.phone_number,
        current_password: form.current_password,
        new_password: form.new_password,
      });
      // Log straight in with the new password.
      const res = await portalApi.post("/portal/auth/member-login", {
        phone_number: form.phone_number,
        password: form.new_password,
      });
      await landMember(navigate, res.data);
    } catch (err) {
      alert(err.response?.data?.error || "Could not set password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={SHELL}>
      <div className={CARD}>
        <h2 className="text-3xl font-bold text-gray-800 mb-1">
          {forced ? "Set your password" : "Set / change password"}
        </h2>
        <p className="text-gray-600 mb-6">
          {forced
            ? "Choose a password to finish setting up your member account."
            : "Use the temporary password from your invite (email or SMS)."}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Phone Number</label>
            <input
              type="tel"
              value={form.phone_number}
              onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
              required
              placeholder="0712345678"
              className={FIELD}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">
              {forced ? "Temporary password" : "Current / temporary password"}
            </label>
            <PasswordInput
              value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
              required
              autoComplete="current-password"
              className={FIELD}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">New password</label>
            <PasswordInput
              value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })}
              required
              autoComplete="new-password"
              className={FIELD}
            />
            <p className="text-xs text-gray-500 mt-1">
              At least 12 characters, with an uppercase letter, a number, and a symbol.
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Confirm new password</label>
            <PasswordInput
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              required
              autoComplete="new-password"
              className={FIELD}
            />
          </div>
          <button type="submit" disabled={submitting} className={BTN}>
            {submitting ? "Saving..." : "Save & continue"}
          </button>
          <p className="text-center text-sm text-gray-500">
            <Link to="/welfare/member/login" className="text-emerald-700">
              Back to login
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

// Welfare-only picker for a member who belongs to more than one chama.
export function WelfareMemberSelect() {
  const navigate = useNavigate();
  // Read once from the session the login just wrote — no setState-in-effect.
  const [tenants] = useState(() =>
    JSON.parse(localStorage.getItem("portal_tenants") || "[]"),
  );
  const [customer] = useState(() =>
    JSON.parse(localStorage.getItem("portal_customer") || "{}"),
  );
  const [selecting, setSelecting] = useState(null);

  useEffect(() => {
    if (tenants.length === 0) navigate("/welfare/member/login");
  }, [tenants, navigate]);

  const select = async (t) => {
    setSelecting(t.tenant_id);
    try {
      const res = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: t.tenant_id,
      });
      localStorage.setItem("portal_token", res.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify(res.data.current_tenant),
      );
      navigate("/welfare/member");
    } catch {
      alert("Failed to open that chama");
      setSelecting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-600 to-teal-700 p-4">
      <div className="max-w-2xl mx-auto pt-12">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Hi {customer?.first_name}!
          </h1>
          <p className="text-emerald-100 text-lg">
            You're a member of {tenants.length} chamas
          </p>
        </div>
        <div className="space-y-3">
          {tenants.map((t) => (
            <button
              key={t.tenant_id}
              onClick={() => select(t)}
              disabled={selecting === t.tenant_id}
              className="w-full bg-white rounded-2xl shadow-xl p-6 hover:shadow-2xl transition disabled:opacity-50 text-left"
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl"
                  style={{ backgroundColor: t.brand_color || "#0e8a6e" }}
                >
                  {t.business_name?.charAt(0)}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-800">{t.business_name}</h3>
                  <p className="text-sm text-gray-500">
                    Member No: <span className="font-mono font-semibold">{t.client_code}</span>
                  </p>
                </div>
                <span className="ml-auto text-emerald-700 font-semibold">Open →</span>
              </div>
            </button>
          ))}
        </div>
        <div className="mt-8 text-center">
          <button
            onClick={() => {
              localStorage.removeItem("portal_token");
              navigate("/welfare/member/login");
            }}
            className="text-emerald-100 hover:text-white text-sm"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
