import React, { useState, useEffect } from "react";
import api from "../services/api";

function Settings() {
  const [settings, setSettings] = useState({
    company_name: "",
    company_address: "",
    company_phone: "",
    company_email: "",
    company_website: "",
    business_registration_number: "",
    tax_pin: "",
    bank_name: "",
    bank_account_number: "",
    bank_branch: "",
    mpesa_paybill: "",
    mpesa_till_number: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await api.get("/settings/company");
      setSettings(response.data.data);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/settings/company", settings);
      setSuccess("✅ Settings saved successfully!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      alert("Failed to save: " + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800">Company Settings</h1>
        <p className="text-gray-600 mt-2">
          These details appear on loan agreements and PDFs
        </p>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Company Info */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">
            🏢 Company Information
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Company Name *
              </label>
              <input
                type="text"
                value={settings.company_name || ""}
                onChange={(e) =>
                  setSettings({ ...settings, company_name: e.target.value })
                }
                required
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Address
              </label>
              <textarea
                value={settings.company_address || ""}
                onChange={(e) =>
                  setSettings({ ...settings, company_address: e.target.value })
                }
                rows="2"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="text"
                  value={settings.company_phone || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, company_phone: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={settings.company_email || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, company_email: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Business Registration No
                </label>
                <input
                  type="text"
                  value={settings.business_registration_number || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      business_registration_number: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Tax PIN
                </label>
                <input
                  type="text"
                  value={settings.tax_pin || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, tax_pin: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bank Details */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">
            🏦 Payment Details
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            These appear on loan agreements for client payments
          </p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  M-Pesa Paybill
                </label>
                <input
                  type="text"
                  value={settings.mpesa_paybill || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, mpesa_paybill: e.target.value })
                  }
                  placeholder="123456"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  M-Pesa Till Number
                </label>
                <input
                  type="text"
                  value={settings.mpesa_till_number || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      mpesa_till_number: e.target.value,
                    })
                  }
                  placeholder="654321"
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Bank Name
                </label>
                <input
                  type="text"
                  value={settings.bank_name || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, bank_name: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Account Number
                </label>
                <input
                  type="text"
                  value={settings.bank_account_number || ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      bank_account_number: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Branch
                </label>
                <input
                  type="text"
                  value={settings.bank_branch || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, bank_branch: e.target.value })
                  }
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-700 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
        >
          {saving ? "Saving..." : "✓ Save Settings"}
        </button>
      </form>
    </div>
  );
}

export default Settings;
