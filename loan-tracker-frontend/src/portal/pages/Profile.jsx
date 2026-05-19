import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const field =
  "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none";

function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    email: "",
    date_of_birth: "",
    gender: "",
  });

  useEffect(() => {
    portalApi
      .get("/portal/customer/profile")
      .then((r) => {
        const p = r.data.data;
        setProfile(p);
        setForm({
          email: p.email || "",
          date_of_birth: p.date_of_birth
            ? String(p.date_of_birth).split("T")[0]
            : "",
          gender: p.gender || "",
        });
      })
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/portal/select-tenant");
        } else {
          setError(err.response?.data?.error || "Failed to load profile");
        }
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await portalApi.put("/portal/customer/profile", {
        email: form.email || null,
        date_of_birth: form.date_of_birth || null,
        gender: form.gender || null,
      });
      alert("Profile updated");
    } catch (err) {
      alert(err.response?.data?.error || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const ReadOnly = ({ label, value }) => (
    <div>
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="font-semibold text-gray-800">{value || "—"}</p>
    </div>
  );

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 mb-6">
          👤 My Profile
        </h1>

        {loading && (
          <p className="text-center text-gray-500 py-10">Loading…</p>
        )}
        {error && <p className="text-center text-red-600 py-10">{error}</p>}

        {profile && (
          <>
            <div className="bg-white rounded-xl shadow p-5 mb-6 grid grid-cols-2 gap-4">
              <ReadOnly
                label="Name"
                value={`${profile.first_name} ${profile.last_name}`}
              />
              <ReadOnly label="Phone" value={profile.phone_number} />
              <ReadOnly label="ID Number" value={profile.id_number} />
              <ReadOnly
                label="Client Code (this lender)"
                value={profile.client_code}
              />
            </div>

            <form
              onSubmit={save}
              className="bg-white rounded-xl shadow p-5 space-y-4"
            >
              <h2 className="font-bold text-gray-800">Editable details</h2>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm({ ...form, email: e.target.value })
                  }
                  placeholder="you@example.com"
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) =>
                    setForm({ ...form, date_of_birth: e.target.value })
                  }
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Gender
                </label>
                <select
                  value={form.gender}
                  onChange={(e) =>
                    setForm({ ...form, gender: e.target.value })
                  }
                  className={field}
                >
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </form>
          </>
        )}
      </div>
    </PortalLayout>
  );
}

export default Profile;
