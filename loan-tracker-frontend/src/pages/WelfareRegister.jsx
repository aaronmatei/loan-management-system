import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UsersRound, AlertTriangle } from "lucide-react";
import api from "../services/api";
import PasswordInput from "../components/PasswordInput";
import { useAuth } from "../context/AuthContext";

// Public self-registration for a welfare (chama / savings group). Creates a
// welfare account separate from lender tenants and drops the official straight
// into their welfare.
export default function WelfareRegister() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [form, setForm] = useState({
    welfare_name: "",
    subdomain: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    registration_number: "",
    city: "",
    admin_password: "",
    confirm_password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touchedSub, setTouchedSub] = useState(false);

  const slug = (s) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({
      ...f,
      [k]: v,
      // Auto-suggest the subdomain from the name until the user edits it.
      ...(k === "welfare_name" && !touchedSub ? { subdomain: slug(v) } : {}),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.welfare_name.trim()) return setError("Welfare name is required.");
    if (!form.subdomain.trim()) return setError("Choose a portal address (subdomain).");
    if (!form.contact_name.trim() || !form.contact_email.trim()) return setError("Your name and email are required.");
    if (form.admin_password.length < 12) return setError("Password must be at least 12 characters with an uppercase letter, a number, and a special character.");
    if (form.admin_password !== form.confirm_password) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const r = await api.post("/tenants/welfare-signup", form);
      localStorage.setItem("token", r.data.token);
      localStorage.setItem("user", JSON.stringify(r.data.user));
      setUser(r.data.user);
      navigate(r.data.welfare_group_id ? `/groups/${r.data.welfare_group_id}` : "/groups");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create welfare account.");
      setBusy(false);
    }
  };

  const fld = "w-full px-3 py-2.5 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1";

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 bg-cover bg-center bg-no-repeat flex items-center justify-center p-4"
      style={{ backgroundImage: "url('/lenderfest_hero_login_background.svg')" }}
    >
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white text-emerald-600 shadow-md mb-3">
            <UsersRound size={28} />
          </div>
          <h1 className="text-2xl font-bold text-white drop-shadow-sm">Register your Welfare</h1>
          <p className="text-sm text-white/85 mt-1">
            Run your chama / welfare group — members, contributions and loans from your own pool.
          </p>
        </div>

        <form onSubmit={submit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle size={15} className="flex-shrink-0" /> {error}
            </div>
          )}
          <div>
            <label className={lbl}>Welfare name *</label>
            <input value={form.welfare_name} onChange={set("welfare_name")} placeholder="Umoja Welfare Group" className={fld} />
          </div>
          <div>
            <label className={lbl}>Portal address *</label>
            <div className="flex items-center">
              <input
                value={form.subdomain}
                onChange={(e) => { setTouchedSub(true); setForm((f) => ({ ...f, subdomain: slug(e.target.value) })); }}
                placeholder="umoja-welfare"
                className={fld + " rounded-r-none"}
              />
              <span className="px-3 py-2.5 border-2 border-l-0 border-gray-200 dark:border-slate-600 rounded-r-lg bg-gray-50 dark:bg-slate-900 text-gray-500 dark:text-slate-400 text-sm">.lenderfest.loans</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Your name *</label><input value={form.contact_name} onChange={set("contact_name")} className={fld} /></div>
            <div><label className={lbl}>Phone</label><input value={form.contact_phone} onChange={set("contact_phone")} className={fld} /></div>
            <div><label className={lbl}>Email *</label><input type="email" value={form.contact_email} onChange={set("contact_email")} className={fld} /></div>
            <div><label className={lbl}>Registration no.</label><input value={form.registration_number} onChange={set("registration_number")} className={fld} /></div>
          </div>
          <div>
            <label className={lbl}>Password *</label>
            <PasswordInput value={form.admin_password} onChange={set("admin_password")} placeholder="At least 12 characters" autoComplete="new-password" className={fld} />
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">12+ chars with an uppercase letter, a number and a special character.</p>
          </div>
          <div>
            <label className={lbl}>Confirm password *</label>
            <PasswordInput value={form.confirm_password} onChange={set("confirm_password")} placeholder="Re-enter your password" autoComplete="new-password" className={fld} />
          </div>
          <button type="submit" disabled={busy} className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition disabled:opacity-50">
            {busy ? "Creating your welfare…" : "Create Welfare Account"}
          </button>
          <p className="text-center text-sm text-gray-600 dark:text-slate-400">
            Already registered? <Link to="/welfare/login" className="text-emerald-700 font-semibold hover:underline">Log in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
