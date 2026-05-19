import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import portalApi from "../services/portalApi";
import DevTenantSwitcher from "../components/DevTenantSwitcher";
import PasswordInput from "../components/PasswordInput";

// Existing customer links a NEW lender. The target lender is whatever
// portalApi will send as X-Tenant-Subdomain (the dev switcher in dev,
// the host subdomain in prod) — same resolution add-tenant's
// tenantContext uses on the backend. Backend verifies the password,
// auto-links to an existing client at that tenant (or creates one),
// and returns {tenant_id, client_id} (no token) — so afterwards we
// refresh the tenant list and send the customer to the picker, which
// issues a token scoped to the chosen lender.
function AddLender() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [target, setTarget] = useState(null);
  const [currentTenants, setCurrentTenants] = useState([]);

  const customer = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_customer") || "{}");
    } catch {
      return {};
    }
  })();

  useEffect(() => {
    if (!localStorage.getItem("portal_token")) {
      navigate("/portal/login");
      return;
    }
    let tenants = [];
    try {
      tenants = JSON.parse(localStorage.getItem("portal_tenants") || "[]");
    } catch {
      tenants = [];
    }
    setCurrentTenants(tenants);

    // Resolve the lender being added the same way portalApi does.
    const host = window.location.hostname;
    let sub = null;
    if (host !== "localhost" && host !== "127.0.0.1") {
      const parts = host.split(".");
      if (parts.length >= 2 && parts[0] !== "www") sub = parts[0];
    } else {
      sub = localStorage.getItem("dev_tenant_subdomain");
    }
    if (sub && tenants.some((t) => t.subdomain === sub)) {
      alert("You already have an account with this lender.");
      navigate("/portal/select-tenant");
      return;
    }
    setTarget(sub);
  }, [navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await portalApi.post("/portal/auth/add-tenant", {
        customer_id: customer.id,
        password,
      });
      // Refresh the tenant list (current token still valid for the
      // previously-selected tenant) then go pick the new lender.
      const r = await portalApi.get("/portal/customer/tenants");
      localStorage.setItem(
        "portal_tenants",
        JSON.stringify(r.data.data.tenants || []),
      );
      alert("✅ Lender added. Choose it to continue.");
      navigate("/portal/select-tenant");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add lender");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DevTenantSwitcher />
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 lg:p-8">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            Add a Lender
          </h1>
          <p className="text-gray-600 mb-5">
            {target ? (
              <>
                Link <strong className="capitalize">{target}</strong> to your
                account
              </>
            ) : (
              "Select a lender (dev switcher / subdomain) first"
            )}
          </p>

          {currentTenants.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm">
              <p className="text-blue-800 font-semibold">
                You're already a customer at:
              </p>
              <ul className="mt-1 ml-4 list-disc text-blue-900">
                {currentTenants.map((t) => (
                  <li key={t.tenant_id}>{t.business_name}</li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Confirm your password
              </label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !target}
              className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold rounded-lg disabled:opacity-50"
            >
              {submitting
                ? "Adding…"
                : target
                  ? `Add ${target} →`
                  : "Pick a lender first"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/portal/select-tenant")}
              className="w-full py-2 text-gray-600 text-sm"
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export default AddLender;
