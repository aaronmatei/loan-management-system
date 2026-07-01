import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
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
import Skeleton from "../../components/Skeleton";
import { CARD, INK, MUTED } from "../theme";

const field =
  "w-full px-3 py-2.5 border border-[#e5ddcd] dark:border-slate-600 rounded-[11px] bg-[#faf6ec] dark:bg-slate-900 dark:text-slate-100 focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20";

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
        <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-4">
          <div className="flex justify-between items-center">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-9 w-20" />
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-5 grid grid-cols-2 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
          <Skeleton rounded="rounded-xl" className="h-44 w-full" />
          <Skeleton rounded="rounded-xl" className="h-40 w-full" />
        </div>
      </PortalLayout>
    );
  }
  if (!data) return <PortalLayout><div /></PortalLayout>;

  const { customer, client } = data;
  const { brand } = getPortalBrand();
  const initials = `${(customer.first_name || "?").charAt(0)}${(customer.last_name || "").charAt(0)}`.toUpperCase();
  const memberSince = customer.created_at
    ? new Date(customer.created_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    : "—";
  const Row = ({ label, children }) => (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#a39b8b] dark:text-slate-500">{label}</p>
      <div className="font-bold text-[#16241d] dark:text-slate-100 mt-0.5">{children}</div>
    </div>
  );

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-4" style={{ "--brand": brand }}>
        {/* Identity header */}
        <div className={`${CARD} p-6 flex items-center gap-[18px]`}>
          {customer.profile_photo_url ? (
            <img src={customer.profile_photo_url} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-[22px] font-extrabold shrink-0"
              style={{ background: "#0f3d2e", color: "#cdeede" }}
            >
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className={`text-[19px] font-extrabold ${INK}`}>
              {customer.first_name} {customer.last_name}
            </div>
            <div className={`text-[12.5px] ${MUTED} font-medium mt-0.5`}>
              Client since {memberSince} · <span className="font-mono">{customer.customer_code || "—"}</span>
            </div>
          </div>
          {(customer.kyc_complete || customer.phone_verified) && (
            <span
              className="inline-flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-full shrink-0"
              style={{ background: "#eaf6ef", color: "#0d8f63" }}
            >
              <Check size={14} /> Verified
            </span>
          )}
        </div>

        <div className={`${CARD} p-5 grid grid-cols-2 gap-4`}>
          <Row label="Phone">
            {customer.phone_number}
            {customer.phone_verified && (
              <span className="ml-2 inline-flex items-center gap-0.5 text-[#0d8f63] text-xs"><Check size={12} /> Verified</span>
            )}
          </Row>
          <Row label="ID Number">{customer.id_number}</Row>
          <Row label="Email">{customer.email || "—"}</Row>
          <Row label="LenderFest ID">
            <span className="font-mono">{customer.customer_code || "—"}</span>
          </Row>
        </div>

        <div className={`${CARD} p-5 space-y-4`}>
          <div className="flex items-center justify-between">
            <h2 className={`font-extrabold ${INK}`}>Personal details</h2>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[var(--brand)] text-white rounded-[10px] text-sm font-bold"
              >
                <Pencil size={14} /> Edit
              </button>
            )}
          </div>
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
                className="flex-1 py-2 bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg font-semibold"
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

        <div className={`${CARD} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className={`font-extrabold ${INK} flex items-center gap-1.5`}><IdCard size={18} /> Identity documents</h2>
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
                <div className="aspect-square rounded-[12px] overflow-hidden bg-[#faf6ec] dark:bg-slate-700 border border-[#f0ebe0] dark:border-slate-600 flex items-center justify-center">
                  {customer[k] ? (
                    <img
                      src={customer[k]}
                      alt={label}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-[#a39b8b] dark:text-slate-400">Not uploaded</span>
                  )}
                </div>
                <p className={`text-xs ${MUTED} mt-1`}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Borrower account statement — only for customers who actually have a
            lender (client) record. A pure welfare/chama member has no borrower
            account here, so this PDF would 404; they get their statement from
            the member dashboard instead. */}
        {client && (
          <div className={`${CARD} p-5`}>
            <h2 className={`font-extrabold ${INK} mb-2 flex items-center gap-1.5`}><FileText size={18} /> Statements</h2>
            <p className={`text-sm ${MUTED} mb-4`}>
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
        )}

        <div className={`${CARD} p-5`}>
          <h2 className={`font-extrabold ${INK} mb-4 flex items-center gap-1.5`}><Lock size={18} /> Security</h2>
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
                  className="flex-1 py-2 bg-gray-200 dark:bg-slate-700 dark:text-slate-200 rounded-lg font-semibold"
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
