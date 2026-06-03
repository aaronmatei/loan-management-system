import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  User,
  Pencil,
  Check,
  IdCard,
  FileText,
  Download,
  Lock,
  KeyRound,
  Save,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import PasswordInput from "../components/PasswordInput";
import { getPortalBrand } from "../brand";
import Spinner from "../../components/Spinner";

const field =
  "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-[var(--brand)] focus:outline-none";

// Mirrors the backend validatePassword (>=12, upper, digit, symbol).
const PASSWORD_RULE = "Min 12 chars, 1 uppercase, 1 number, 1 symbol";
const validPassword = (p) =>
  p.length >= 12 &&
  /[A-Z]/.test(p) &&
  /[0-9]/.test(p) &&
  /[^A-Za-z0-9]/.test(p);

function Profile() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [dl, setDl] = useState(false);
  const [form, setForm] = useState({});
  const [pwd, setPwd] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });

  const load = () => {
    portalApi
      .get("/portal/customer/profile")
      .then((r) => {
        const d = r.data.data;
        setData(d);
        setForm({
          email: d.customer?.email || "",
          // Fall back to the lender's client record — the customer's own
          // platform_customers DOB/gender are usually unset; the KYC data
          // lives on the tenant's clients row.
          date_of_birth: (d.customer?.date_of_birth || d.client?.date_of_birth)
            ? String(d.customer?.date_of_birth || d.client?.date_of_birth).split("T")[0]
            : "",
          gender: d.customer?.gender || d.client?.gender || "",
        });
      })
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/portal/dashboard");
        } else {
          alert(err.response?.data?.error || "Failed to load profile");
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [navigate]);

  const save = async () => {
    setSaving(true);
    try {
      await portalApi.put("/portal/customer/profile", form);
      alert("Profile updated");
      setEditing(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pwd.new_password !== pwd.confirm_password) {
      alert("Passwords do not match");
      return;
    }
    if (!validPassword(pwd.new_password)) {
      alert(PASSWORD_RULE);
      return;
    }
    setSaving(true);
    try {
      await portalApi.post("/portal/customer/change-password", {
        current_password: pwd.current_password,
        new_password: pwd.new_password,
      });
      alert("Password changed");
      setShowPwd(false);
      setPwd({ current_password: "", new_password: "", confirm_password: "" });
    } catch (err) {
      alert(err.response?.data?.error || "Change failed");
    } finally {
      setSaving(false);
    }
  };

  const downloadStatement = async () => {
    setDl(true);
    try {
      const res = await portalApi.get("/portal/customer/statement", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `account_statement_${
        data?.client?.client_code || "statement"
      }.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download statement");
    } finally {
      setDl(false);
    }
  };

  if (loading) {
    return (
      <PortalLayout>
        <Spinner centered className="py-20" label="Loading…" />
      </PortalLayout>
    );
  }
  if (!data) return <PortalLayout><div /></PortalLayout>;

  const { customer, client } = data;
  const { brand } = getPortalBrand();
  const Row = ({ label, children }) => (
    <div>
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <div className="font-semibold text-gray-800">{children}</div>
    </div>
  );

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-4" style={{ "--brand": brand }}>
        <div className="flex justify-between items-center">
          <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 flex items-center gap-2">
            <User size={28} className="text-navy-900" /> My Profile
          </h1>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--brand)] text-white rounded-lg font-semibold"
            >
              <Pencil size={15} /> Edit
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-5 grid grid-cols-2 gap-4">
          <Row label="Name">
            {customer.first_name} {customer.last_name}
          </Row>
          <Row label="Phone">
            {customer.phone_number}
            {customer.phone_verified && (
              <span className="ml-2 inline-flex items-center gap-0.5 text-green-600 text-xs"><Check size={12} /> Verified</span>
            )}
          </Row>
          <Row label="ID Number">{customer.id_number}</Row>
          <Row label="LoanFix ID">
            <span className="font-mono">{customer.customer_code || "—"}</span>
          </Row>
          <Row label="Member Since">
            {new Date(customer.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
          </Row>
        </div>

        <div className="bg-white rounded-xl shadow p-5 space-y-4">
          <h2 className="font-bold text-navy-900">Personal details</h2>
          <div>
            <label className="block text-sm font-semibold mb-1">Email</label>
            {editing ? (
              <input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm({ ...form, email: e.target.value })
                }
                className={field}
              />
            ) : (
              <p>{customer.email || "—"}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Date of Birth
              </label>
              {editing ? (
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) =>
                    setForm({ ...form, date_of_birth: e.target.value })
                  }
                  className={field}
                />
              ) : (
                <p>
                  {customer.date_of_birth || client?.date_of_birth
                    ? new Date(
                        customer.date_of_birth || client.date_of_birth,
                      ).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
                    : "—"}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Gender
              </label>
              {editing ? (
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
              ) : (
                <p className="capitalize">
                  {customer.gender || client?.gender || "—"}
                </p>
              )}
            </div>
          </div>
          {editing && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  setEditing(false);
                  load();
                }}
                disabled={saving}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2 bg-[var(--brand)] text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {saving ? "Saving…" : <span className="inline-flex items-center gap-1.5"><Save size={15} /> Save Changes</span>}
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-navy-900 flex items-center gap-1.5"><IdCard size={18} /> Identity documents</h2>
            <button
              onClick={() =>
                navigate(
                  "/portal/verify-identity?next=/portal/profile",
                )
              }
              className="text-sm font-semibold text-[var(--brand)]"
            >
              {customer.kyc_complete ? "Update" : "Upload"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["profile_photo_url", "Photo"],
              ["id_front_url", "ID front"],
              ["id_back_url", "ID back"],
            ].map(([k, label]) => (
              <div key={k} className="text-center">
                <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                  {customer[k] ? (
                    <img
                      src={customer[k]}
                      alt={label}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-gray-400">Not uploaded</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <h2 className="font-bold text-navy-900 mb-2 flex items-center gap-1.5"><FileText size={18} /> Statements</h2>
          <p className="text-sm text-gray-600 mb-4">
            Download your full account statement at{" "}
            {client?.tenant_name || "this lender"}.
          </p>
          <button
            onClick={downloadStatement}
            disabled={dl}
            className="px-4 py-2 bg-[var(--brand)] hover:brightness-95 text-white rounded-lg font-semibold disabled:opacity-50"
          >
            {dl ? "Preparing…" : <span className="inline-flex items-center gap-1.5"><Download size={15} /> Download Account Statement</span>}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <h2 className="font-bold text-navy-900 mb-4 flex items-center gap-1.5"><Lock size={18} /> Security</h2>
          {!showPwd ? (
            <button
              onClick={() => setShowPwd(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold"
            >
              <KeyRound size={16} /> Change Password
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Current Password
                </label>
                <PasswordInput
                  value={pwd.current_password}
                  onChange={(e) =>
                    setPwd({ ...pwd, current_password: e.target.value })
                  }
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  New Password
                </label>
                <PasswordInput
                  value={pwd.new_password}
                  onChange={(e) =>
                    setPwd({ ...pwd, new_password: e.target.value })
                  }
                  placeholder={PASSWORD_RULE}
                  className={field}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Confirm New Password
                </label>
                <PasswordInput
                  value={pwd.confirm_password}
                  onChange={(e) =>
                    setPwd({ ...pwd, confirm_password: e.target.value })
                  }
                  className={field}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPwd(false)}
                  className="flex-1 py-2 bg-gray-200 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={changePassword}
                  disabled={saving}
                  className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Change Password"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

export default Profile;
