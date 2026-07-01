import React, { useEffect, useRef, useState } from "react";
import portalApi from "../services/portalApi";

// Borrower social login (Phase 1: Google). Renders the provider button(s),
// verifies server-side, then either signs the borrower in (onAuthed) or, for
// a brand-new borrower, collects the still-required phone + national ID
// (lending KYC) before creating the account. Self-contained so the portal
// Login and Register pages just drop it in.
//
// Activates when VITE_GOOGLE_CLIENT_ID is set (same Web Client ID the backend
// verifies against). Apple / Facebook buttons slot in here in Phase 2.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function SocialAuth({ onAuthed }) {
  const googleBtn = useRef(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null); // { token, prefill } → complete step

  const submitToken = async (provider, token) => {
    setError("");
    try {
      const res = await portalApi.post("/portal/auth/social", { provider, token });
      const data = res.data;
      if (data.status === "needs_signup") {
        setPending({ token: data.pending_token, prefill: data.prefill });
      } else if (data.token) {
        onAuthed(data);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Sign-in failed. Please try again.");
    }
  };

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const render = () => {
      if (!window.google?.accounts?.id || !googleBtn.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => submitToken("google", resp.credential),
      });
      window.google.accounts.id.renderButton(googleBtn.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 300,
      });
    };
    if (window.google?.accounts?.id) return render();
    const existing = document.getElementById("gsi-client");
    if (existing) {
      existing.addEventListener("load", render);
      return;
    }
    const s = document.createElement("script");
    s.id = "gsi-client";
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = render;
    document.head.appendChild(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!GOOGLE_CLIENT_ID) return null; // nothing configured client-side

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-gray-200 dark:border-slate-700" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-surface px-3 text-gray-400 dark:text-slate-400">or continue with</span>
        </div>
      </div>

      <div ref={googleBtn} className="flex justify-center" />
      {error && <p className="text-rose-600 text-sm text-center">{error}</p>}

      {pending && (
        <CompleteProfile
          pending={pending}
          onCancel={() => setPending(null)}
          onDone={onAuthed}
          onError={setError}
        />
      )}
    </div>
  );
}

// Collects the phone + national ID a borrower account still requires, then
// creates it (server links the verified social identity).
function CompleteProfile({ pending, onCancel, onDone }) {
  const [form, setForm] = useState({
    first_name: pending.prefill.first_name || "",
    last_name: pending.prefill.last_name || "",
    phone_number: "",
    id_number: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await portalApi.post("/portal/auth/social/complete", {
        pending_token: pending.token,
        ...form,
      });
      onDone(res.data);
    } catch (e2) {
      setErr(e2.response?.data?.error || "Could not finish sign-up");
      setBusy(false);
    }
  };

  const input =
    "w-full px-4 py-2.5 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-ocean-500/40 focus:border-ocean-500";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onCancel}
    >
      <div
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-md p-6 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-1">Finish your account</h3>
        <p className="text-gray-600 dark:text-slate-400 text-sm mb-4">
          Welcome{pending.prefill.first_name ? `, ${pending.prefill.first_name}` : ""}!
          We just need your phone and national ID to set up your borrower
          account{pending.prefill.email ? ` (${pending.prefill.email})` : ""}.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input required value={form.first_name} onChange={set("first_name")} placeholder="First name" className={input} />
            <input required value={form.last_name} onChange={set("last_name")} placeholder="Last name" className={input} />
          </div>
          <input required value={form.phone_number} onChange={set("phone_number")} placeholder="Phone (e.g. 0712345678)" className={input} />
          <input required value={form.id_number} onChange={set("id_number")} placeholder="National ID number" className={input} />
          {err && <p className="text-rose-600 text-sm">{err}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onCancel} className="px-5 py-2.5 border border-gray-300 dark:border-slate-700 rounded-lg font-semibold text-gray-700 dark:text-slate-200">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="flex-1 px-5 py-2.5 bg-ocean-gradient text-white rounded-lg font-bold disabled:opacity-60">
              {busy ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
