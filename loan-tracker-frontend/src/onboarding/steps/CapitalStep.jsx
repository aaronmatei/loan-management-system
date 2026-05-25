import React, { useState } from "react";
import api from "../../services/api";
import { Coins } from "lucide-react";

// Fund the capital pool during onboarding. Loans can only be approved/
// disbursed against available capital, so this unblocks the first approval.
// Optional — can be topped up later from the dashboard.
function CapitalStep({ onNext, onBack }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      onNext(); // nothing entered → treat as skip
      return;
    }
    setSaving(true);
    try {
      await api.post("/capital/adjust", {
        type: "add",
        amount: value,
        description: "Initial capital",
      });
    } catch (err) {
      alert(err.response?.data?.error || "Failed to set capital");
      setSaving(false);
      return;
    }
    setSaving(false);
    onNext();
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-white rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3"><Coins size={48} className="text-ocean-500" /></div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
            Fund Your Capital Pool
          </h2>
          <p className="text-gray-600">
            This is the money you lend out. Loans can only be approved and
            disbursed against available capital — you can top up anytime from
            the dashboard.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Starting capital (KES)
            </label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500000"
              className={fld}
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave blank to skip and add it later.
            </p>
          </div>
          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => onNext()}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3 bg-ocean-gradient text-white font-bold rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Continue →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CapitalStep;
