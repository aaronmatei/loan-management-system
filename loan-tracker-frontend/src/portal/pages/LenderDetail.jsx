import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Coins,
  Wallet,
  Percent,
  CalendarClock,
  MapPin,
  Phone,
  Mail,
  Package as PackageIcon,
  TrendingDown,
  Sparkles,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import Skeleton from "../../components/Skeleton";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
// Lenders store the rate annually; borrowers see the monthly equivalent.
const PM = (annual) => +(parseFloat(annual || 0) / 12).toFixed(2);

// Full profile + terms for a single lender, with link-state-aware actions:
// link (if not linked & self-signup), apply (if linked), and unlink (only
// when the customer has no active loans there).
function LenderDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [lender, setLender] = useState(null);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unlinking, setUnlinking] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      portalApi.get(`/portal/customer/lenders/${id}`),
      portalApi
        .get(`/portal/customer/lenders/${id}/packages`)
        .catch(() => ({ data: { data: [] } })),
    ])
      .then(([detail, pkgs]) => {
        setLender(detail.data.data);
        setPackages(pkgs.data.data || []);
      })
      .catch((err) => {
        alert(err.response?.data?.error || "Lender not found");
        navigate("/lenders");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Select this lender as the current tenant (mints a tenant-scoped token and
  // learns its kind), then route to the right apply flow: pawnbrokers go to the
  // pawn request form (item / cash-loan toggle), everyone else to ApplyLoan.
  // `packageId` (lenders only) pre-selects + locks a package.
  const apply = async (packageId = null) => {
    const fallback = () =>
      navigate(
        packageId
          ? `/portal/apply?lender=${lender.tenant_id}&package=${packageId}`
          : `/portal/apply?lender=${lender.tenant_id}`,
      );
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", { tenant_id: lender.tenant_id });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({ ...r.data.current_tenant, brand_color: lender.brand_color }),
      );
      if (r.data.current_tenant?.kind === "pawnbroker") {
        navigate("/portal/pawn-requests?new=1");
        return;
      }
      fallback();
    } catch {
      fallback();
    }
  };

  const unlink = async () => {
    if (
      !window.confirm(
        `Unlink ${lender.business_name}? You can re-link later if you change your mind.`,
      )
    )
      return;
    setUnlinking(true);
    try {
      await portalApi.delete(`/portal/customer/lenders/${id}/link`);
      // Drop any cached current-tenant pointing at this lender.
      try {
        const cur = JSON.parse(
          localStorage.getItem("portal_current_tenant") || "null",
        );
        if (cur?.tenant_id === lender.tenant_id)
          localStorage.removeItem("portal_current_tenant");
      } catch {
        /* ignore */
      }
      alert("Lender unlinked");
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to unlink");
    } finally {
      setUnlinking(false);
    }
  };

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-3xl mx-auto">
          <Skeleton className="h-5 w-24 mb-4" />
          {/* Header card */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-[#ece6da] dark:border-slate-700 overflow-hidden mb-5">
            <Skeleton rounded="rounded-none" className="h-2 w-full" />
            <div className="p-6 flex items-center gap-4">
              <Skeleton rounded="rounded-2xl" className="h-16 w-16 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>
          {/* Terms grid */}
          <Skeleton className="h-4 w-32 mb-2" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} rounded="rounded-2xl" className="h-24 w-full" />
            ))}
          </div>
          {/* Actions */}
          <Skeleton rounded="rounded-2xl" className="h-32 w-full" />
        </div>
      </PortalLayout>
    );
  }
  if (!lender) return <PortalLayout><div /></PortalLayout>;

  const bc = lender.brand_color || "#0e8a6e";
  const isPawn = String(lender.business_type || "").toLowerCase() === "pawnbroker";
  // Every non-pawn lender also offers its standard flat-rate loan (its base
  // policy, applied for without a package) — shown as a tile alongside any
  // published packages so the borrower can pick either.
  const showFlat = lender.is_linked && !isPawn;

  // "View my loans/pledges" — pawnbrokers view pledges (needs a tenant-scoped
  // token), everyone else the cross-tenant loans list filtered by this lender.
  const viewMine = async () => {
    if (!isPawn) return navigate(`/portal/loans?tenant_id=${lender.tenant_id}`);
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", { tenant_id: lender.tenant_id });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem("portal_current_tenant", JSON.stringify({ ...r.data.current_tenant, brand_color: lender.brand_color }));
      navigate("/portal/pledges");
    } catch {
      navigate(`/portal/loans?tenant_id=${lender.tenant_id}`);
    }
  };

  // Unlinking is blocked while any obligation is still in flight — active
  // loans OR a pending/under-review/approved application.
  const pendingApps = lender.pending_applications || 0;
  const canUnlink = lender.active_loans === 0 && pendingApps === 0;
  const blockers = [];
  if (lender.active_loans > 0)
    blockers.push(
      `${lender.active_loans} active loan${lender.active_loans !== 1 ? "s" : ""}`,
    );
  if (pendingApps > 0)
    blockers.push(
      `${pendingApps} pending application${pendingApps !== 1 ? "s" : ""}`,
    );

  const terms = [
    { label: "Min borrow", value: KES(lender.min_amount), icon: Coins },
    { label: "Max borrow", value: KES(lender.max_amount), icon: Wallet },
    {
      label: "Interest",
      value: `${+(parseFloat(lender.default_interest_rate) / 12).toFixed(2)}% p.m.`,
      icon: Percent,
    },
    {
      label: "Typical term",
      value: `${lender.default_duration} months`,
      icon: CalendarClock,
    },
    // Late-payment penalty the lender has configured (flat fee per missed
    // instalment). Shows KES 0 when the lender hasn't set one.
    {
      label: "Late fee",
      value: KES(lender.late_payment_fee || 0),
      icon: AlertTriangle,
    },
  ];
  const contact = [
    lender.physical_address &&
      [lender.physical_address, lender.city, lender.county]
        .filter(Boolean)
        .join(", "),
    lender.contact_phone,
    lender.contact_email,
  ].filter(Boolean);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <button
          onClick={() => navigate("/lenders")}
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-navy-900 mb-4"
        >
          <ArrowLeft size={16} /> Lenders
        </button>

        {/* Header */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-[#ece6da] dark:border-slate-700 overflow-hidden mb-5">
          <div className="h-2" style={{ backgroundColor: bc }} />
          <div className="p-6">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shrink-0"
                style={{ backgroundColor: bc }}
              >
                {lender.business_name?.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-navy-900 dark:text-slate-100">
                    {lender.business_name}
                  </h1>
                  {lender.is_linked && (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
                      Linked
                    </span>
                  )}
                </div>
                <p className="text-slate-500 dark:text-slate-400 capitalize">
                  {lender.business_type || "Lender"}
                </p>
                {lender.is_linked && lender.client_code && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">
                    Your client code: {lender.client_code}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Terms */}
        <h2 className="text-sm font-bold text-navy-900 dark:text-slate-100 uppercase tracking-wide mb-2">
          Lending terms
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {terms.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.label}
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-[#ece6da] dark:border-slate-700 p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-semibold tracking-wide">
                    {t.label}
                  </p>
                  <Icon size={16} style={{ color: bc }} />
                </div>
                <p className="font-bold text-navy-900 dark:text-slate-100 mt-2">{t.value}</p>
              </div>
            );
          })}
        </div>

        {/* Loan Products — only shown when the lender has published
            packages. The card-per-product layout lets the customer
            compare rates, terms, and method at a glance; tapping a
            card jumps to ApplyLoan with that package pre-selected. */}
        {lender.is_linked && (showFlat || packages.length > 0) && (
          <>
            <h2 className="text-sm font-bold text-navy-900 dark:text-slate-100 uppercase tracking-wide mb-2">
              Loan products
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {/* Standard flat-rate loan — the lender's base policy, always
                  available alongside any packages. */}
              {showFlat && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-[#ece6da] dark:border-slate-700 p-4 flex flex-col">
                  <div className="flex items-start gap-2 mb-1">
                    <Coins size={16} style={{ color: bc }} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-navy-900 dark:text-slate-100 leading-tight">
                          Standard loan
                        </p>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-ocean-100 text-ocean-700 px-1.5 py-0.5 rounded">
                          Flat rate
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Pick your own amount and term at the lender's standard rate.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-200 my-3">
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">Rate</p>
                      <p className="font-semibold">{PM(lender.default_interest_rate)}% p.m.</p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">Method</p>
                      <p className="font-semibold">Flat</p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">Amount</p>
                      <p className="font-semibold">
                        {KES(lender.min_amount)} – {KES(lender.max_amount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">Duration</p>
                      <p className="font-semibold">1–60 mo</p>
                    </div>
                  </div>
                  <button
                    onClick={() => apply()}
                    className="mt-auto py-2 rounded-lg font-semibold text-white text-sm"
                    style={{ backgroundColor: bc }}
                  >
                    Apply for a loan
                  </button>
                </div>
              )}
              {packages.map((p) => {
                const elig = p.eligibility || { eligible: true, reasons: [] };
                return (
                  <div
                    key={p.id}
                    className={`bg-white dark:bg-slate-800 rounded-2xl shadow-sm border p-4 flex flex-col transition ${
                      elig.eligible
                        ? "border-[#ece6da] dark:border-slate-700"
                        : "border-[#ece6da] dark:border-slate-700 opacity-70"
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-1">
                      <PackageIcon
                        size={16}
                        style={{ color: bc }}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-bold text-navy-900 dark:text-slate-100 leading-tight">
                            {p.name}
                          </p>
                          {elig.recommended && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                              <Sparkles size={10} /> Recommended
                            </span>
                          )}
                          {!elig.recommended && elig.eligible && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-ocean-100 text-ocean-700 px-1.5 py-0.5 rounded">
                              <CheckCircle size={10} /> Eligible
                            </span>
                          )}
                          {!elig.eligible && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                              <XCircle size={10} /> Not eligible
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {p.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-200 my-3">
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Rate</p>
                        <p className="font-semibold">
                          {(parseFloat(p.annual_interest_rate) / 12).toFixed(2)}
                          % p.m.
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Method</p>
                        <p className="font-semibold inline-flex items-center gap-1">
                          {p.interest_method === "reducing" && (
                            <TrendingDown
                              size={12}
                              className="text-ocean-500"
                            />
                          )}
                          {p.interest_method === "reducing"
                            ? "Reducing"
                            : "Flat"}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Amount</p>
                        <p className="font-semibold">
                          {KES(p.min_amount)} – {KES(p.max_amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Duration</p>
                        <p className="font-semibold">
                          {p.min_duration_months}–{p.max_duration_months} mo
                        </p>
                      </div>
                    </div>
                    {!elig.eligible && elig.reasons?.length > 0 && (
                      <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border border-[#ece6da] dark:border-slate-700 rounded-lg p-2 mb-2">
                        {elig.reasons.map((r, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className="text-slate-400 mt-0.5">•</span>
                            <span>{r}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => apply(p.id)}
                      disabled={!elig.eligible}
                      className={`mt-auto py-2 rounded-lg font-semibold text-white text-sm transition ${
                        elig.eligible
                          ? ""
                          : "bg-slate-300 cursor-not-allowed"
                      }`}
                      style={
                        elig.eligible ? { backgroundColor: bc } : undefined
                      }
                    >
                      {elig.eligible
                        ? "Apply with this product"
                        : "Not available"}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Contact */}
        {contact.length > 0 && (
          <>
            <h2 className="text-sm font-bold text-navy-900 dark:text-slate-100 uppercase tracking-wide mb-2">
              About this lender
            </h2>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-[#ece6da] dark:border-slate-700 p-5 mb-5 space-y-2 text-sm">
              {lender.physical_address && (
                <p className="flex items-start gap-2 text-slate-700 dark:text-slate-200">
                  <MapPin size={16} className="mt-0.5 text-slate-400 shrink-0" />
                  {[lender.physical_address, lender.city, lender.county]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}
              {lender.contact_phone && (
                <p className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                  <Phone size={16} className="text-slate-400 shrink-0" />
                  {lender.contact_phone}
                </p>
              )}
              {lender.contact_email && (
                <p className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                  <Mail size={16} className="text-slate-400 shrink-0" />
                  {lender.contact_email}
                </p>
              )}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-[#ece6da] dark:border-slate-700 p-5">
          {lender.is_linked ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* The product cards above (flat-rate tile + any packages)
                    already provide the apply entry points. Only fall back to a
                    standalone button when neither is shown — e.g. pawnbrokers,
                    whose apply() routes to the pledge request form. */}
                {packages.length === 0 && !showFlat && (
                  <button
                    onClick={() => apply()}
                    className="flex-1 py-3 rounded-xl font-bold text-white"
                    style={{ backgroundColor: bc }}
                  >
                    Apply for a loan
                  </button>
                )}
                <button
                  onClick={viewMine}
                  className="flex-1 py-3 rounded-xl font-semibold border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  {isPawn ? "View my pledges" : "View my loans"}
                </button>
              </div>
              {canUnlink ? (
                <button
                  onClick={unlink}
                  disabled={unlinking}
                  className="w-full py-2.5 rounded-xl font-semibold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50"
                >
                  {unlinking ? "Unlinking…" : "Unlink this lender"}
                </button>
              ) : (
                <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                  You have {blockers.join(" and ")} here — resolve them before
                  you can unlink.
                </p>
              )}
            </div>
          ) : lender.can_self_signup ? (
            <button
              onClick={() =>
                navigate(`/portal/add-lender?tenant=${lender.tenant_id}`)
              }
              className="w-full py-3 rounded-xl font-bold text-white"
              style={{ backgroundColor: bc }}
            >
              + Link this lender
            </button>
          ) : (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-2">
              {lender.business_name} isn't accepting new clients through the
              portal. Contact them directly to open an account.
            </p>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

export default LenderDetail;
