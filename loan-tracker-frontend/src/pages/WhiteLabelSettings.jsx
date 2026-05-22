import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

const fld =
  "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";

function WhiteLabelSettings() {
  const navigate = useNavigate();
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("branding");

  const load = () => {
    setLoading(true);
    api
      .get("/white-label/settings")
      .then((r) => setS(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const save = async (payload) => {
    setSaving(true);
    try {
      await api.put("/white-label/settings", payload);
      alert("✅ Settings saved");
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return <div className="p-8 text-center text-gray-500">Loading…</div>;
  if (!s) return null;

  const tier = s.white_label_tier || "basic";
  const isPro = tier === "pro" || tier === "enterprise";
  const isEnt = tier === "enterprise";

  const TIER_TABS = [
    { id: "branding", label: "🎨 Branding", needs: "basic" },
    { id: "communications", label: "📧 Communications", needs: "pro" },
    { id: "reports", label: "📋 Reports", needs: "pro" },
    { id: "domain", label: "🌐 Custom Domain", needs: "enterprise" },
    { id: "portal", label: "👤 Client Portal", needs: "enterprise" },
  ];
  const locked = (need) =>
    (need === "pro" && !isPro) || (need === "enterprise" && !isEnt);

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
          🎨 White-Label Settings
        </h1>
        <p className="text-gray-600 mt-1">
          Customize how your platform looks to customers
        </p>
      </div>

      {/* Tier banner */}
      <div
        className={`rounded-2xl shadow-md p-6 mb-6 ${
          tier === "enterprise"
            ? "bg-gradient-to-r from-ocean-600 to-pink-600 text-white"
            : tier === "pro"
              ? "bg-ocean-gradient text-white"
              : "bg-gradient-to-r from-gray-100 to-gray-200"
        }`}
      >
        <div className="flex justify-between items-center">
          <div>
            <p
              className={`text-sm uppercase tracking-wider ${
                tier === "basic" ? "text-gray-600" : "text-white/80"
              }`}
            >
              Your Plan
            </p>
            <h2
              className={`text-3xl font-bold ${
                tier === "basic" ? "text-gray-800" : "text-white"
              }`}
            >
              {tier === "enterprise"
                ? "👑 Enterprise"
                : tier === "pro"
                  ? "⭐ Pro"
                  : "🆓 Basic"}
            </h2>
          </div>
          {tier === "basic" && (
            <p
              className="text-sm font-semibold text-gray-700 max-w-xs text-right"
              title="Contact your platform admin to upgrade."
            >
              Upgrade to Pro/Enterprise via your platform administrator
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TIER_TABS.map((t) => {
          const isLocked = locked(t.needs);
          return (
            <button
              key={t.id}
              onClick={() => !isLocked && setTab(t.id)}
              disabled={isLocked}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition ${
                tab === t.id
                  ? "bg-ocean-600 text-white"
                  : isLocked
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              {t.label} {isLocked && "🔒"}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        {tab === "branding" && (
          <div className="space-y-4">
            <h2 className="font-bold text-xl mb-2">🎨 Basic Branding</h2>
            <p className="text-sm text-gray-600 mb-4">
              Available on every plan. Logo upload lives under Settings →
              Business Info.
            </p>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Business Name
              </label>
              <input
                value={s.business_name || ""}
                readOnly
                className={`${fld} bg-gray-50`}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Brand Color
              </label>
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-lg border-2 border-gray-200"
                  style={{ backgroundColor: s.brand_color || "#4F46E5" }}
                />
                <input
                  type="color"
                  value={s.brand_color || "#4F46E5"}
                  onChange={(e) =>
                    setS({ ...s, brand_color: e.target.value })
                  }
                  className="h-10"
                />
                <input
                  type="text"
                  value={s.brand_color || "#4F46E5"}
                  onChange={(e) =>
                    setS({ ...s, brand_color: e.target.value })
                  }
                  className={`${fld} font-mono`}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Logo</label>
              {s.logo_url ? (
                <div className="flex items-center gap-3">
                  <img
                    src={s.logo_url}
                    alt="Logo"
                    className="w-16 h-16 object-contain rounded-lg border-2 border-gray-200 bg-gray-50 p-2"
                  />
                  <p className="text-sm text-gray-600">Logo uploaded</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  No logo uploaded. Visit Settings → Business Info to upload.
                </p>
              )}
            </div>
            <SaveRow
              onSave={() => save({ brand_color: s.brand_color })}
              saving={saving}
            />
          </div>
        )}

        {tab === "communications" && isPro && (
          <div className="space-y-4">
            <h2 className="font-bold text-xl mb-2">📧 Communications</h2>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2 text-sm text-blue-800">
              💡 What customers see — your brand, not the platform's, on
              SMS / email / reports.
            </div>
            {[
              ["email_sender_name", "Email Sender Name", "e.g. ABC Lenders"],
              [
                "sms_sender_id",
                "SMS Sender ID",
                "max 11 chars; must be registered with Africastalking",
              ],
              ["support_email", "Support Email", "support@yourco.com"],
              ["support_phone", "Support Phone", "+254 700 000 000"],
            ].map(([k, label, ph]) => (
              <div key={k}>
                <label className="block text-sm font-semibold mb-1">
                  {label}
                </label>
                <input
                  value={s[k] || ""}
                  onChange={(e) => setS({ ...s, [k]: e.target.value })}
                  placeholder={ph}
                  maxLength={k === "sms_sender_id" ? 11 : undefined}
                  className={fld}
                />
              </div>
            ))}
            <div>
              <label className="block text-sm font-semibold mb-1">
                Email Signature
              </label>
              <textarea
                value={s.email_signature || ""}
                onChange={(e) =>
                  setS({ ...s, email_signature: e.target.value })
                }
                rows="4"
                placeholder="Best regards,&#10;The ABC Lenders Team"
                className={fld}
              />
            </div>
            <label className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                checked={s.hide_platform_branding || false}
                onChange={(e) =>
                  setS({ ...s, hide_platform_branding: e.target.checked })
                }
                className="w-4 h-4"
              />
              <span className="font-semibold">
                Hide platform branding everywhere
              </span>
            </label>
            <SaveRow
              onSave={() =>
                save({
                  email_sender_name: s.email_sender_name,
                  sms_sender_id: s.sms_sender_id,
                  email_signature: s.email_signature,
                  support_email: s.support_email,
                  support_phone: s.support_phone,
                  hide_platform_branding: !!s.hide_platform_branding,
                })
              }
              saving={saving}
            />
          </div>
        )}

        {tab === "reports" && isPro && (
          <div className="space-y-4">
            <h2 className="font-bold text-xl mb-2">📋 Reports</h2>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Report Header Text
              </label>
              <textarea
                value={s.report_header_text || ""}
                onChange={(e) =>
                  setS({ ...s, report_header_text: e.target.value })
                }
                rows="2"
                placeholder="ABC Lenders Ltd | License: XXX | KRA PIN: XXX"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Report Footer Text
              </label>
              <textarea
                value={s.report_footer_text || ""}
                onChange={(e) =>
                  setS({ ...s, report_footer_text: e.target.value })
                }
                rows="2"
                placeholder="This is an official document of ABC Lenders Ltd."
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Favicon URL
              </label>
              <input
                value={s.favicon_url || ""}
                onChange={(e) => setS({ ...s, favicon_url: e.target.value })}
                placeholder="https://yoursite.com/favicon.ico"
                className={fld}
              />
            </div>
            <SaveRow
              onSave={() =>
                save({
                  report_header_text: s.report_header_text,
                  report_footer_text: s.report_footer_text,
                  favicon_url: s.favicon_url,
                })
              }
              saving={saving}
            />
          </div>
        )}

        {tab === "domain" && isEnt && (
          <div className="space-y-4">
            <h2 className="font-bold text-xl mb-2">🌐 Custom Domain</h2>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Current URL
              </label>
              <input
                value={`https://${s.subdomain}.loanfix.co.ke`}
                readOnly
                className={`${fld} bg-gray-50 font-mono`}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Custom Domain
              </label>
              <input
                value={s.custom_domain || ""}
                onChange={(e) =>
                  setS({ ...s, custom_domain: e.target.value })
                }
                placeholder="loans.yourcompany.com"
                className={`${fld} font-mono`}
              />
              <p className="text-xs text-gray-500 mt-1">
                Needs a CNAME → <code>loanfix.co.ke</code>.
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Custom Email Domain
              </label>
              <input
                value={s.custom_email_domain || ""}
                onChange={(e) =>
                  setS({ ...s, custom_email_domain: e.target.value })
                }
                placeholder="yourcompany.com"
                className={`${fld} font-mono`}
              />
            </div>
            <SaveRow
              onSave={() =>
                save({
                  custom_domain: s.custom_domain || null,
                  custom_email_domain: s.custom_email_domain || null,
                })
              }
              saving={saving}
            />
          </div>
        )}

        {tab === "portal" && isEnt && (
          <div className="space-y-4">
            <h2 className="font-bold text-xl mb-2">👤 Client Portal</h2>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Portal Title
              </label>
              <input
                value={s.custom_portal_title || ""}
                onChange={(e) =>
                  setS({ ...s, custom_portal_title: e.target.value })
                }
                placeholder="ABC Lenders Client Portal"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Portal Tagline
              </label>
              <input
                value={s.custom_portal_tagline || ""}
                onChange={(e) =>
                  setS({ ...s, custom_portal_tagline: e.target.value })
                }
                placeholder="Manage your loans anywhere, anytime"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Login Image URL
              </label>
              <input
                value={s.custom_login_image_url || ""}
                onChange={(e) =>
                  setS({ ...s, custom_login_image_url: e.target.value })
                }
                placeholder="https://yoursite.com/login-bg.jpg"
                className={fld}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Terms URL
                </label>
                <input
                  value={s.terms_url || ""}
                  onChange={(e) =>
                    setS({ ...s, terms_url: e.target.value })
                  }
                  className={fld}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Privacy URL
                </label>
                <input
                  value={s.privacy_url || ""}
                  onChange={(e) =>
                    setS({ ...s, privacy_url: e.target.value })
                  }
                  className={fld}
                />
              </div>
            </div>
            <SaveRow
              onSave={() =>
                save({
                  custom_portal_title: s.custom_portal_title,
                  custom_portal_tagline: s.custom_portal_tagline,
                  custom_login_image_url: s.custom_login_image_url,
                  terms_url: s.terms_url,
                  privacy_url: s.privacy_url,
                })
              }
              saving={saving}
            />
          </div>
        )}

        {((tab === "communications" || tab === "reports") && !isPro) ||
        ((tab === "domain" || tab === "portal") && !isEnt) ? (
          <div className="text-center py-8">
            <p className="text-6xl mb-4">🔒</p>
            <h3 className="text-xl font-bold mb-2">Upgrade to access</h3>
            <p className="text-gray-600 mb-4">
              This feature needs{" "}
              {tab === "domain" || tab === "portal" ? "Enterprise" : "Pro"}.
              Ask your platform administrator to upgrade your plan.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SaveRow({ onSave, saving }) {
  return (
    <div className="mt-6 pt-4 border-t flex justify-end">
      <button
        onClick={onSave}
        disabled={saving}
        className="px-6 py-3 bg-ocean-gradient text-white rounded-lg font-bold disabled:opacity-50"
      >
        {saving ? "Saving…" : "💾 Save Changes"}
      </button>
    </div>
  );
}

export default WhiteLabelSettings;
