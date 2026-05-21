import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Search, ArrowRight } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import IconTile from "../../components/IconTile";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

// Marketplace directory of every active lender on LoanFix. Customers browse
// and filter by borrowing terms (amount range, interest rate). Contextual
// action per card: Apply (already linked) or Add (self-signup). No customer
// loan data here — that lives in "My Loans".
function Lenders() {
  const navigate = useNavigate();
  const [lenders, setLenders] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState(""); // amount the customer wants
  const [maxRate, setMaxRate] = useState(""); // max acceptable interest
  const [sort, setSort] = useState("rate"); // rate | max | name

  useEffect(() => {
    portalApi
      .get("/portal/customer/lenders")
      .then((r) => setLenders(r.data.data || []))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load lenders"),
      )
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const amt = parseFloat(amount);
    const rate = parseFloat(maxRate);
    let list = lenders.filter((l) => {
      if (search && !l.business_name?.toLowerCase().includes(search.toLowerCase()))
        return false;
      // "I want to borrow KES amt" → lender's range must contain it.
      if (!Number.isNaN(amt) && amt > 0) {
        if (amt < parseFloat(l.min_amount) || amt > parseFloat(l.max_amount))
          return false;
      }
      if (!Number.isNaN(rate) && rate > 0) {
        if (parseFloat(l.default_interest_rate) > rate) return false;
      }
      return true;
    });
    const by = {
      rate: (a, b) =>
        parseFloat(a.default_interest_rate) - parseFloat(b.default_interest_rate),
      max: (a, b) => parseFloat(b.max_amount) - parseFloat(a.max_amount),
      name: (a, b) => a.business_name.localeCompare(b.business_name),
    };
    return [...list].sort(by[sort] || by.rate);
  }, [lenders, search, amount, maxRate, sort]);

  // Apply at a lender the customer already has: prime the apply page's
  // lender pre-selection, then go there.
  const apply = (l) => {
    localStorage.setItem(
      "portal_current_tenant",
      JSON.stringify({
        tenant_id: l.tenant_id,
        business_name: l.business_name,
        brand_color: l.brand_color,
      }),
    );
    navigate("/loanfix/portal/apply");
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-600 focus:outline-none bg-white";

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 mb-1">
          🏦 All Lenders
        </h1>
        <p className="text-slate-500 mb-5">
          Browse every lender on LoanFix and compare their terms.
        </p>

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-5">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Search
              </label>
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Lender name"
                  className={`${fld} pl-9`}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Amount to borrow (KES)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 50000"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Max interest (% p.a.)
              </label>
              <input
                type="number"
                value={maxRate}
                onChange={(e) => setMaxRate(e.target.value)}
                placeholder="e.g. 30"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Sort by
              </label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className={fld}
              >
                <option value="rate">Lowest interest</option>
                <option value="max">Highest max amount</option>
                <option value="name">Name (A–Z)</option>
              </select>
            </div>
          </div>
          {(search || amount || maxRate) && (
            <button
              onClick={() => {
                setSearch("");
                setAmount("");
                setMaxRate("");
              }}
              className="mt-3 text-xs font-semibold text-ocean-600 hover:text-ocean-700"
            >
              Clear filters
            </button>
          )}
        </div>

        <p className="text-sm text-slate-500 mb-3">
          {loading
            ? "Loading…"
            : `${filtered.length} lender${filtered.length !== 1 ? "s" : ""}`}
        </p>

        {loading ? null : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 text-center">
            <div className="flex justify-center mb-4">
              <IconTile icon={Building2} variant="ocean" size={56} />
            </div>
            <p className="text-navy-900 font-semibold">No lenders match.</p>
            <p className="text-slate-500 text-sm">Try widening your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((l) => {
              const bc = l.brand_color || "#0086cc";
              return (
                <div
                  key={l.tenant_id}
                  className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col"
                >
                  <div className="h-1.5" style={{ backgroundColor: bc }} />
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex items-start gap-3 mb-3">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
                        style={{ backgroundColor: bc }}
                      >
                        {l.business_name?.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-navy-900 truncate">
                            {l.business_name}
                          </p>
                          {l.is_linked && (
                            <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                              Linked
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 capitalize truncate">
                          {[l.business_type, l.city].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-sm mb-4">
                      <div>
                        <p className="text-xs text-slate-500">Min borrow</p>
                        <p className="font-semibold text-navy-900">
                          {KES(l.min_amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Max borrow</p>
                        <p className="font-semibold text-navy-900">
                          {KES(l.max_amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Interest</p>
                        <p className="font-semibold" style={{ color: bc }}>
                          {parseFloat(l.default_interest_rate)}% p.a.
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Typical term</p>
                        <p className="font-semibold text-navy-900">
                          {l.default_duration} mo
                        </p>
                      </div>
                    </div>

                    <div className="mt-auto">
                      {l.is_linked ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => apply(l)}
                            className="flex-1 py-2 rounded-lg font-semibold text-white text-sm"
                            style={{ backgroundColor: bc }}
                          >
                            Apply
                          </button>
                          <button
                            onClick={() =>
                              navigate(
                                `/loanfix/portal/loans?tenant_id=${l.tenant_id}`,
                              )
                            }
                            className="px-3 py-2 rounded-lg font-semibold text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center"
                          >
                            Loans
                            <ArrowRight size={14} className="ml-1" />
                          </button>
                        </div>
                      ) : l.can_self_signup ? (
                        <button
                          onClick={() =>
                            navigate(
                              `/loanfix/portal/add-lender?tenant=${l.tenant_id}`,
                            )
                          }
                          className="w-full py-2 rounded-lg font-semibold text-white text-sm"
                          style={{ backgroundColor: bc }}
                        >
                          + Add lender
                        </button>
                      ) : (
                        <p className="text-center text-xs text-slate-400 py-2">
                          Not accepting new clients via portal
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}

export default Lenders;
