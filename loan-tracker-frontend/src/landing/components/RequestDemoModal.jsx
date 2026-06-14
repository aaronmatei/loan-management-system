import React, { useState } from "react";
import { X, Send, CheckCircle } from "lucide-react";

// "Request Demo" lead-capture modal on the landing page. POSTs to
// /api/demo/request, which emails the LenderFest team. The team then sends
// the demo link (lenderfest.loans/demo) by hand after a conversation.
const LENDER_TYPES = [
  "Microfinance",
  "SACCO",
  "Chama / Welfare",
  "Pawn lender",
  "Individual lender",
  "Other",
];
const inputCls =
  "w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ocean-500/40 focus:border-ocean-500 text-gray-900 placeholder-gray-400";

export default function RequestDemoModal({ open, onClose }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    business_name: "",
    phone: "",
    lender_type: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const apiUrl =
        import.meta.env.VITE_API_URL || "http://localhost:3000/api";
      const res = await fetch(`${apiUrl}/demo/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Could not submit your request. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 sm:p-8 relative my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={22} />
        </button>

        {done ? (
          <div className="text-center py-6">
            <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Request received</h3>
            <p className="text-gray-600">
              Thanks, {form.name.split(" ")[0] || "there"}! Our team will reach
              out shortly with your personal demo link.
            </p>
            <button
              onClick={onClose}
              className="mt-6 px-6 py-3 bg-ocean-gradient text-white rounded-xl font-bold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h3 className="text-2xl font-bold text-gray-900 mb-1">Request a demo</h3>
            <p className="text-gray-600 mb-5">
              Tell us a little about your lending business and we'll send you a
              guided demo link.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input required value={form.name} onChange={set("name")} placeholder="Your name *" className={inputCls} />
                <input required type="email" value={form.email} onChange={set("email")} placeholder="Email *" className={inputCls} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={form.business_name} onChange={set("business_name")} placeholder="Business name" className={inputCls} />
                <input value={form.phone} onChange={set("phone")} placeholder="Phone" className={inputCls} />
              </div>
              <select value={form.lender_type} onChange={set("lender_type")} className={inputCls}>
                <option value="">Lender type…</option>
                {LENDER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <textarea value={form.message} onChange={set("message")} rows={3} placeholder="Anything specific you'd like to see? (optional)" className={inputCls} />
              {error && <p className="text-rose-600 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-6 py-3 bg-ocean-gradient text-white rounded-xl font-bold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {submitting ? "Sending…" : <><Send size={16} /> Request Demo</>}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
