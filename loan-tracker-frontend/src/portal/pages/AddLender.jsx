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
  ChevronDown,
  Banknote,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import PasswordInput from "../components/PasswordInput";
import { getPortalBrand } from "../brand";
import Skeleton from "../../components/Skeleton";

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
  const [expanded, setExpanded] = useState(() => new Set());
  const [applyingId, setApplyingId] = useState(null);

  const money = (v) => `KES ${Number(v || 0).toLocaleString()}`;
  const toggleRow = (id) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // Apply for a loan with a linked lender: scope the session to that lender,
  // then go to the apply page (which reads the current tenant).
  const applyToLender = async (t) => {
    setApplyingId(t.tenant_id);
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: t.tenant_id,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({ ...r.data.current_tenant, brand_color: t.brand_color }),
      );
      navigate("/portal/apply");
    } catch {
      alert("Could not start an application. Please try again.");
      setApplyingId(null);
    }
  };

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
          navigate("/portal/dashboard");
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
    setSubmitting(true);
    try {
      const res = await portalApi.post("/portal/auth/add-tenant", {
        target_tenant_id: selected.id,
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
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 dark:text-slate-100 flex items-center gap-2">
          <Plus size={28} className="text-navy-900 dark:text-slate-100" /> Add Another Lender
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mt-1 mb-6">
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
                onClick={() => navigate("/lenders")}
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

        <div className="bg-ocean-50 border border-ocean-200 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-ocean-900 mb-2 flex items-center gap-1.5">
            <ClipboardList size={18} /> Your Current Lenders
          </h3>
          <div className="flex flex-wrap gap-2">
            {currentTenants.map((t) => (
              <div
                key={t.tenant_id}
                className="inline-flex items-center gap-2 bg-white rounded-full pl-3 pr-1 py-1 border border-ocean-200"
              >
                <span className="text-sm font-semibold text-ocean-700">
                  {t.business_name}
                </span>
                <button
                  onClick={() => applyToLender(t)}
                  disabled={applyingId === t.tenant_id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-white bg-ocean-600 hover:bg-ocean-700 disabled:opacity-60"
                >
                  <Banknote size={12} />
                  {applyingId === t.tenant_id ? "Opening…" : "Apply for loan"}
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-ocean-600 mt-2">
            Linked to {currentTenants.length} lender
            {currentTenants.length !== 1 ? "s" : ""}.
          </p>
        </div>

        <h2 className="text-xl font-bold text-navy-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Landmark size={22} /> Available Lenders ({available.length})
        </h2>

        {loading ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden divide-y divide-gray-100 dark:divide-slate-700">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 sm:p-4">
                <Skeleton className="h-10 w-10" rounded="rounded-full" />
                <div className="flex-1 min-w-0">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28 mt-2" />
                </div>
                <Skeleton className="h-9 w-16" rounded="rounded-lg" />
              </div>
            ))}
          </div>
        ) : available.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-12 text-center">
            <div className="flex justify-center mb-3">
              <PartyPopper size={48} className="text-green-400" />
            </div>
            <p className="font-semibold text-gray-800 dark:text-slate-100">
              You're linked to all available lenders!
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow overflow-hidden divide-y divide-gray-100 dark:divide-slate-700">
            {available.map((t) => {
              const open = expanded.has(t.id);
              const accent = t.brand_color || "#0e8a6e";
              return (
                <div key={t.id}>
                  {/* Row */}
                  <div className="flex items-center gap-3 p-3 sm:p-4 hover:bg-[#faf6ec] dark:hover:bg-slate-700 transition">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                      style={{ backgroundColor: accent }}
                    >
                      {t.business_name?.charAt(0)}
                    </div>
                    <button
                      onClick={() => toggleRow(t.id)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="font-bold text-navy-900 dark:text-slate-100 truncate">
                        {t.business_name}
                        {t.is_existing_client && (
                          <span className="ml-2 align-middle text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">
                            existing account
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 capitalize truncate">
                        {t.business_type}
                        {t.city || t.county
                          ? ` · ${[t.city, t.county].filter(Boolean).join(", ")}`
                          : ""}
                      </p>
                    </button>
                    <button
                      onClick={() => toggleRow(t.id)}
                      aria-label={open ? "Collapse" : "Expand"}
                      className="text-gray-400 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-200 p-1 shrink-0"
                    >
                      <ChevronDown
                        size={18}
                        className={`transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                    <button
                      onClick={() => setSelected(t)}
                      className="px-3 py-2 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-1.5 shrink-0"
                      style={{ backgroundColor: accent }}
                    >
                      <Plus size={15} /> Add
                    </button>
                  </div>

                  {/* Expanded detail */}
                  {open && (
                    <div className="px-4 pb-4 pt-1 bg-[#faf6ec]/60 dark:bg-slate-900/60">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Detail label="Interest" value={`${t.default_interest_rate}%`} />
                        <Detail
                          label="Loan range"
                          value={`${money(t.min_amount)} – ${money(t.max_amount)}`}
                        />
                        <Detail label="Typical term" value={`${t.default_duration} mo`} />
                        <Detail label="Type" value={t.business_type} capitalize />
                      </div>
                      {(t.physical_address || t.city || t.county) && (
                        <p className="text-sm text-gray-600 dark:text-slate-400 mt-3 flex items-center gap-1.5">
                          <MapPin size={14} className="text-gray-400 dark:text-slate-400 shrink-0" />
                          {[t.physical_address, t.city, t.county].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {t.is_existing_client && (
                        <p className="mt-2 text-xs text-green-700 flex items-center gap-1">
                          <Sparkles size={12} className="text-green-600" /> We found
                          your existing account here — your loans will auto-link.
                        </p>
                      )}
                      <button
                        onClick={() => setSelected(t)}
                        className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white"
                        style={{ backgroundColor: accent }}
                      >
                        <Plus size={15} /> Add this lender
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="text-center mb-4">
              <div
                className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-white font-bold text-3xl"
                style={{
                  backgroundColor: selected.brand_color || "#0e8a6e",
                }}
              >
                {selected.business_name?.charAt(0)}
              </div>
              <h3 className="text-2xl font-bold mt-3 dark:text-slate-100">
                {selected.business_name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-slate-400 capitalize">
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
            <p className="text-gray-600 dark:text-slate-400 mb-4 text-sm">
              Link <strong>{selected.business_name}</strong> to your account?
              Your loans with them will show up in your portal.
            </p>
            <form onSubmit={confirmAdd}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  disabled={submitting}
                  className="flex-1 py-2 bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 text-white rounded-lg font-semibold disabled:opacity-50"
                  style={{
                    backgroundColor: selected.brand_color || "#0e8a6e",
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

function Detail({ label, value, capitalize }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-400 font-semibold">
        {label}
      </p>
      <p className={`text-sm font-semibold text-gray-800 dark:text-slate-200 ${capitalize ? "capitalize" : ""}`}>
        {value}
      </p>
    </div>
  );
}

export default AddLender;
