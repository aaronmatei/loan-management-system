import React, { useState } from "react";
import api from "../../services/api";

function FirstClientStep({ onNext, onBack, setCreatedClient }) {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone_number: "",
    id_number: "",
    email: "",
    county: "Nairobi",
    business_type: "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post("/clients", form);
      setCreatedClient(r.data.data);
      onNext({ first_client: r.data.data });
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add client");
    } finally {
      setSaving(false);
    }
  };

  const useSampleData = () =>
    setForm({
      first_name: "Mary",
      last_name: "Wanjiku",
      phone_number: "0712345678",
      id_number: "12345678",
      email: "mary.wanjiku@example.com",
      county: "Nairobi",
      business_type: "Small Shop",
    });

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-white rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">👤</div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
            Add Your First Client
          </h2>
          <p className="text-gray-600">
            Add a real client or use sample data to explore
          </p>
        </div>
        <button
          type="button"
          onClick={useSampleData}
          className="w-full mb-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-100"
        >
          🎲 Fill with Sample Data (Mary Wanjiku)
        </button>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">First Name *</label>
              <input
                value={form.first_name}
                onChange={(e) =>
                  setForm({ ...form, first_name: e.target.value })
                }
                required
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Last Name *</label>
              <input
                value={form.last_name}
                onChange={(e) =>
                  setForm({ ...form, last_name: e.target.value })
                }
                required
                className={fld}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Phone Number *</label>
            <input
              type="tel"
              value={form.phone_number}
              onChange={(e) =>
                setForm({ ...form, phone_number: e.target.value })
              }
              required
              placeholder="0712345678"
              className={fld}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">ID Number *</label>
            <input
              value={form.id_number}
              onChange={(e) =>
                setForm({ ...form, id_number: e.target.value })
              }
              required
              placeholder="12345678"
              className={fld}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">County</label>
              <input
                value={form.county}
                onChange={(e) =>
                  setForm({ ...form, county: e.target.value })
                }
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Business Type
              </label>
              <input
                value={form.business_type}
                onChange={(e) =>
                  setForm({ ...form, business_type: e.target.value })
                }
                placeholder="e.g., Boda Boda"
                className={fld}
              />
            </div>
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
              {saving ? "Saving…" : "Add Client →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default FirstClientStep;
