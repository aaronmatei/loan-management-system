import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  PartyPopper,
  ClipboardList,
  Landmark,
  MapPin,
  Sparkles,
  X,
  Check,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import PasswordInput from "../components/PasswordInput";
import { getPortalBrand } from "../brand";

function AddLender() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { brand } = getPortalBrand();
  const [available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  const customer = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_customer") || "{}");
    } catch {
      return {};
    }
  })();
  const currentTenants = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_tenants") || "[]");
    } catch {
      return [];
    }
  })();

  const loadAvailable = () => {
    setLoading(true);
    portalApi
      .get("/portal/customer/available-tenants")
      .then((r) => setAvailable(r.data.data || []))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/loanfix/portal/dashboard");
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(loadAvailable, [navigate]);

  // Deep-link from the lender directory: ?tenant=<id> opens the confirm
  // modal for that lender as soon as the list has loaded.
  const preTenant = searchParams.get("tenant");
  useEffect(() => {
    if (preTenant && available.length) {
      const t = available.find((x) => String(x.id) === preTenant);
      if (t) setSelected(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available.length]);

  const confirmAdd = async (e) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    try {
      const res = await portalApi.post("/portal/auth/add-tenant", {
        target_tenant_id: selected.id,
        customer_id: customer.id,
        password,
      });
      setSuccess({
        tenant: res.data.tenant,
        client: res.data.client,
        message: res.data.message,
      });
      // Refresh linked tenants (current token still valid for the
      // selected tenant) so the picker shows the new lender.
      try {
        const tr = await portalApi.get("/portal/customer/tenants");
        localStorage.setItem(
          "portal_tenants",
          JSON.stringify(tr.data.data.tenants || []),
        );
      } catch {
        /* non-fatal — picker re-fetches on next login */
      }
      setSelected(null);
      setPassword("");
      loadAvailable();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add lender");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto" style={{ "--brand": brand }}>
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 flex items-center gap-2">
          <Plus size={28} className="text-navy-900" /> Add Another Lender
        </h1>
        <p className="text-gray-600 mt-1 mb-6">
          Link your account to more lenders for one-stop loan management.
        </p>

        {success && (
          <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 mb-6 flex items-start gap-3">
            <PartyPopper size={28} className="text-green-600 shrink-0" />
            <div className="flex-1">
              <h3 className="font-bold text-green-900">Successfully Added!</h3>
              <p className="text-green-700 mt-1">{success.message}</p>
              <p className="text-sm text-green-600 mt-2">
                Client code at {success.tenant?.business_name}:{" "}
                <strong className="font-mono">
                  {success.client?.client_code}
                </strong>
              </p>
              <button
                onClick={() => navigate("/loanfix/lenders")}
                className="mt-3 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold"
              >
                See All Lenders →
              </button>
            </div>
            <button
              onClick={() => setSuccess(null)}
              className="text-green-700"
              aria-label="Dismiss"
            >
              <X size={18} />
            </button>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-1.5">
            <ClipboardList size={18} /> Your Current Lenders
          </h3>
          <div className="flex flex-wrap gap-2">
            {currentTenants.map((t) => (
              <span
                key={t.tenant_id}
                className="px-3 py-1 bg-white rounded-full text-sm font-semibold text-blue-700 border border-blue-200"
              >
                {t.business_name}
              </span>
            ))}
          </div>
          <p className="text-xs text-blue-600 mt-2">
            Linked to {currentTenants.length} lender
            {currentTenants.length !== 1 ? "s" : ""}.
          </p>
        </div>

        <h2 className="text-xl font-bold text-navy-900 mb-4 flex items-center gap-2">
          <Landmark size={22} /> Available Lenders ({available.length})
        </h2>

        {loading ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            Loading…
          </div>
        ) : available.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <div className="flex justify-center mb-3">
              <PartyPopper size={48} className="text-green-400" />
            </div>
            <p className="font-semibold text-gray-800">
              You're linked to all available lenders!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {available.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelected(t);
                  setPassword("");
                }}
                className="text-left bg-white rounded-xl shadow p-5 hover:shadow-lg transition relative overflow-hidden"
              >
                <div
                  className="absolute top-0 left-0 right-0 h-2"
                  style={{ backgroundColor: t.brand_color || "#4F46E5" }}
                />
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0"
                    style={{ backgroundColor: t.brand_color || "#4F46E5" }}
                  >
                    {t.business_name?.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-navy-900">
                      {t.business_name}
                    </h3>
                    <p className="text-xs text-gray-500 capitalize">
                      {t.business_type}
                    </p>
                  </div>
                </div>
                {(t.city || t.county) && (
                  <p className="text-sm text-gray-600 mb-2 flex items-center gap-1">
                    <MapPin size={14} className="text-gray-400 shrink-0" /> {[t.city, t.county].filter(Boolean).join(", ")}
                  </p>
                )}
                {t.is_existing_client && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-2 mt-3">
                    <p className="text-xs font-semibold text-green-800 flex items-center gap-1">
                      <Sparkles size={12} className="text-green-600" /> We found your existing account here!
                    </p>
                    <p className="text-xs text-green-700">
                      Your loans will auto-link.
                    </p>
                  </div>
                )}
                <span
                  className="inline-flex items-center justify-center gap-1.5 w-full mt-4 py-2 rounded-lg font-semibold text-white text-center"
                  style={{ backgroundColor: t.brand_color || "#4F46E5" }}
                >
                  <Plus size={16} /> Add This Lender
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="text-center mb-4">
              <div
                className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-white font-bold text-3xl"
                style={{
                  backgroundColor: selected.brand_color || "#4F46E5",
                }}
              >
                {selected.business_name?.charAt(0)}
              </div>
              <h3 className="text-2xl font-bold mt-3">
                {selected.business_name}
              </h3>
              <p className="text-sm text-gray-500 capitalize">
                {selected.business_type}
              </p>
            </div>
            {selected.is_existing_client && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
                  <Sparkles size={15} className="text-green-600" /> You already have a client account here — your loans
                  will auto-link.
                </p>
              </div>
            )}
            <p className="text-gray-600 mb-4 text-sm">
              Confirm your password to link{" "}
              <strong>{selected.business_name}</strong> to your account.
            </p>
            <form onSubmit={confirmAdd}>
              <label className="block text-sm font-semibold mb-1">
                Confirm Password
              </label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                placeholder="Enter your password"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-[var(--brand)] focus:outline-none mb-4"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setPassword("");
                  }}
                  disabled={submitting}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !password}
                  className="flex-1 py-2 text-white rounded-lg font-semibold disabled:opacity-50"
                  style={{
                    backgroundColor: selected.brand_color || "#4F46E5",
                  }}
                >
                  {submitting ? "Adding…" : <span className="inline-flex items-center gap-1.5"><Check size={15} /> Confirm &amp; Add</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

export default AddLender;
