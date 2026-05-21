import React, { useState } from "react";
import api from "../../services/api";

// Calls the NEW /api/onboarding/business-profile endpoint (the spec's
// /settings/business doesn't exist).
function BusinessProfileStep({ data, onNext, onBack }) {
  const [form, setForm] = useState({
    physical_address: data.physical_address || "",
    city: data.city || "",
    county: data.county || "Nairobi",
    business_hours: data.business_hours || "Mon-Fri 8AM-5PM",
    business_description: data.business_description || "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/onboarding/business-profile", form);
      onNext(form);
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-white rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🏢</div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
            Tell Us About Your Business
          </h2>
          <p className="text-gray-600">
            This information appears on receipts and customer communications
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Physical Address *
            </label>
            <input
              type="text"
              value={form.physical_address}
              onChange={(e) =>
                setForm({ ...form, physical_address: e.target.value })
              }
              required
              placeholder="e.g., 5th Floor, ABC Building, Moi Avenue"
              className={fld}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">City *</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                required
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">County *</label>
              <select
                value={form.county}
                onChange={(e) => setForm({ ...form, county: e.target.value })}
                className={`${fld} bg-white`}
              >
                {[
                  "Nairobi",
                  "Mombasa",
                  "Kisumu",
                  "Nakuru",
                  "Eldoret",
                  "Thika",
                  "Machakos",
                  "Meru",
                  "Nyeri",
                  "Other",
                ].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">
              Business Hours
            </label>
            <input
              type="text"
              value={form.business_hours}
              onChange={(e) =>
                setForm({ ...form, business_hours: e.target.value })
              }
              placeholder="e.g., Mon-Fri 8AM-5PM"
              className={fld}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">
              About Your Business (optional)
            </label>
            <textarea
              value={form.business_description}
              onChange={(e) =>
                setForm({ ...form, business_description: e.target.value })
              }
              rows="3"
              placeholder="Brief description of your lending business…"
              className={fld}
            />
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

export default BusinessProfileStep;
