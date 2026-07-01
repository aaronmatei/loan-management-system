import React, { useState } from "react";
import api from "../../services/api";
import { KENYA_COUNTIES } from "../../utils/counties";
import { BUSINESS_TYPES } from "../../utils/businessTypes";
import { CLIENT_TYPES, businessNameLabel } from "../../utils/clientTypes";
import { User, Shuffle } from "lucide-react";

// Mirrors the fields on the staff Clients "Add New Client" form so the
// onboarding first client is captured with the same shape as everything
// created later.
function FirstClientStep({ onNext, onBack, setCreatedClient }) {
  const [form, setForm] = useState({
    client_type: "individual",
    first_name: "",
    last_name: "",
    phone_number: "",
    email: "",
    id_number: "",
    business_name: "",
    business_type: "",
    address: "",
    city: "",
    county: "Nairobi",
    date_of_birth: "",
    gender: "",
  });
  const [saving, setSaving] = useState(false);

  const setField = (k) => (e) =>
    setForm({ ...form, [k]: e.target.value });

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
      client_type: "business",
      first_name: "Mary",
      last_name: "Wanjiku",
      phone_number: "0712345678",
      email: "mary.wanjiku@example.com",
      id_number: "12345678",
      business_name: "Mary's Salon",
      business_type: "Salon / Barber",
      address: "Ngong Road",
      city: "Nairobi",
      county: "Nairobi",
      date_of_birth: "1990-04-15",
      gender: "female",
    });

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none";

  return (
    <div className="max-w-3xl mx-auto px-4">
      <div className="bg-surface dark:text-slate-100 rounded-3xl shadow-xl p-6 lg:p-10">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <User size={48} className="text-ocean-500" />
          </div>
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 dark:text-slate-100 mb-2">
            Add Your First Client
          </h2>
          <p className="text-gray-600 dark:text-slate-400">
            Add a real client or use sample data to explore
          </p>
        </div>
        <button
          type="button"
          onClick={useSampleData}
          className="w-full mb-4 py-2 bg-ocean-50 text-ocean-700 rounded-lg text-sm font-semibold hover:bg-ocean-100 inline-flex items-center justify-center gap-2"
        >
          <Shuffle size={14} /> Fill with Sample Data (Mary Wanjiku)
        </button>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-2">Client Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {CLIENT_TYPES.map((t) => {
                const Icon = t.icon;
                const selected = form.client_type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() =>
                      setForm({ ...form, client_type: t.value })
                    }
                    className={`text-left p-3 rounded-lg border-2 transition ${
                      selected
                        ? "border-ocean-500 bg-ocean-50"
                        : "border-gray-200 dark:border-slate-600 hover:border-gray-300 bg-white dark:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-slate-100 text-sm">
                      <Icon size={14} />
                      {t.label}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                      {t.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">First Name *</label>
              <input value={form.first_name} onChange={setField("first_name")} required className={fld} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Last Name *</label>
              <input value={form.last_name} onChange={setField("last_name")} required className={fld} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">Phone Number *</label>
              <input
                type="tel"
                value={form.phone_number}
                onChange={setField("phone_number")}
                required
                placeholder="0712345678"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={setField("email")}
                placeholder="mary@example.com"
                className={fld}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">ID Number *</label>
              <input
                value={form.id_number}
                onChange={setField("id_number")}
                required
                placeholder="12345678"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Date of Birth</label>
              <input
                type="date"
                value={form.date_of_birth}
                onChange={setField("date_of_birth")}
                className={fld}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Gender</label>
            <select
              value={form.gender}
              onChange={setField("gender")}
              className={`${fld} bg-white dark:bg-slate-900`}
            >
              <option value="">Select…</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </div>
          {form.client_type !== "individual" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  {businessNameLabel(form.client_type)}
                </label>
                <input
                  value={form.business_name}
                  onChange={setField("business_name")}
                  placeholder={
                    form.client_type === "group"
                      ? "Maendeleo Chama"
                      : "Mary's Salon"
                  }
                  className={fld}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  {form.client_type === "group"
                    ? "Group Activity"
                    : "Business Type"}
                </label>
                <select
                  value={form.business_type}
                  onChange={setField("business_type")}
                  className={`${fld} bg-white dark:bg-slate-900`}
                >
                  <option value="">Select type…</option>
                  {BUSINESS_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold mb-1">Address</label>
              <input
                value={form.address}
                onChange={setField("address")}
                placeholder="Street, building, etc."
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">City</label>
              <input
                value={form.city}
                onChange={setField("city")}
                placeholder="Nairobi"
                className={fld}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">County</label>
            <select
              value={form.county}
              onChange={setField("county")}
              className={`${fld} bg-white dark:bg-slate-900`}
            >
              {KENYA_COUNTIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-3 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg font-semibold"
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
