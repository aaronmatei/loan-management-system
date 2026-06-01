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
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

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
        navigate("/loanfix/lenders");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stash the lender as the current tenant so ApplyLoan reads it from
  // localStorage and scopes the session correctly. `packageId` is
  // optional — when present, ApplyLoan pre-selects the package and
  // locks its mechanics.
  const apply = (packageId = null) => {
    localStorage.setItem(
      "portal_current_tenant",
      JSON.stringify({
        tenant_id: lender.tenant_id,
        business_name: lender.business_name,
        brand_color: lender.brand_color,
      }),
    );
    navigate(
      packageId
        ? `/loanfix/portal/apply?package=${packageId}`
        : "/loanfix/portal/apply",
    );
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
        <div className="p-8 text-center text-slate-500">Loading…</div>
      </PortalLayout>
    );
  }
  if (!lender) return <PortalLayout><div /></PortalLayout>;

  const bc = lender.brand_color || "#0086cc";

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
          onClick={() => navigate("/loanfix/lenders")}
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-navy-900 mb-4"
        >
          <ArrowLeft size={16} /> Lenders
        </button>

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-5">
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
                  <h1 className="text-2xl font-bold text-navy-900">
                    {lender.business_name}
                  </h1>
                  {lender.is_linked && (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
                      Linked
                    </span>
                  )}
                </div>
                <p className="text-slate-500 capitalize">
                  {lender.business_type || "Lender"}
                </p>
                {lender.is_linked && lender.client_code && (
                  <p className="text-xs text-slate-500 font-mono mt-1">
                    Your client code: {lender.client_code}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Terms */}
        <h2 className="text-sm font-bold text-navy-900 uppercase tracking-wide mb-2">
          Lending terms
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {terms.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.label}
                className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">
                    {t.label}
                  </p>
                  <Icon size={16} style={{ color: bc }} />
                </div>
                <p className="font-bold text-navy-900 mt-2">{t.value}</p>
              </div>
            );
          })}
        </div>

        {/* Loan Products — only shown when the lender has published
            packages. The card-per-product layout lets the customer
            compare rates, terms, and method at a glance; tapping a
            card jumps to ApplyLoan with that package pre-selected. */}
        {lender.is_linked && packages.length > 0 && (
          <>
            <h2 className="text-sm font-bold text-navy-900 uppercase tracking-wide mb-2">
              Loan products
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {packages.map((p) => (
                <div
                  key={p.id}
                  className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex flex-col"
                >
                  <div className="flex items-start gap-2 mb-1">
                    <PackageIcon
                      size={16}
                      style={{ color: bc }}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-navy-900 leading-tight">
                        {p.name}
                      </p>
                      {p.description && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {p.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 my-3">
                    <div>
                      <p className="text-slate-500">Rate</p>
                      <p className="font-semibold">
                        {(parseFloat(p.annual_interest_rate) / 12).toFixed(2)}%
                        p.m.
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Method</p>
                      <p className="font-semibold inline-flex items-center gap-1">
                        {p.interest_method === "reducing" && (
                          <TrendingDown
                            size={12}
                            className="text-indigo-500"
                          />
                        )}
                        {p.interest_method === "reducing"
                          ? "Reducing"
                          : "Flat"}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Amount</p>
                      <p className="font-semibold">
                        {KES(p.min_amount)} – {KES(p.max_amount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Duration</p>
                      <p className="font-semibold">
                        {p.min_duration_months}–{p.max_duration_months} mo
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => apply(p.id)}
                    className="mt-auto py-2 rounded-lg font-semibold text-white text-sm"
                    style={{ backgroundColor: bc }}
                  >
                    Apply with this product
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Contact */}
        {contact.length > 0 && (
          <>
            <h2 className="text-sm font-bold text-navy-900 uppercase tracking-wide mb-2">
              About this lender
            </h2>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 mb-5 space-y-2 text-sm">
              {lender.physical_address && (
                <p className="flex items-start gap-2 text-slate-700">
                  <MapPin size={16} className="mt-0.5 text-slate-400 shrink-0" />
                  {[lender.physical_address, lender.city, lender.county]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}
              {lender.contact_phone && (
                <p className="flex items-center gap-2 text-slate-700">
                  <Phone size={16} className="text-slate-400 shrink-0" />
                  {lender.contact_phone}
                </p>
              )}
              {lender.contact_email && (
                <p className="flex items-center gap-2 text-slate-700">
                  <Mail size={16} className="text-slate-400 shrink-0" />
                  {lender.contact_email}
                </p>
              )}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          {lender.is_linked ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={apply}
                  className="flex-1 py-3 rounded-xl font-bold text-white"
                  style={{ backgroundColor: bc }}
                >
                  Apply for a loan
                </button>
                <button
                  onClick={() =>
                    navigate(
                      `/loanfix/portal/loans?tenant_id=${lender.tenant_id}`,
                    )
                  }
                  className="flex-1 py-3 rounded-xl font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  View my loans
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
                <p className="text-center text-xs text-slate-500">
                  You have {blockers.join(" and ")} here — resolve them before
                  you can unlink.
                </p>
              )}
            </div>
          ) : lender.can_self_signup ? (
            <button
              onClick={() =>
                navigate(`/loanfix/portal/add-lender?tenant=${lender.tenant_id}`)
              }
              className="w-full py-3 rounded-xl font-bold text-white"
              style={{ backgroundColor: bc }}
            >
              + Link this lender
            </button>
          ) : (
            <p className="text-center text-sm text-slate-500 py-2">
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
