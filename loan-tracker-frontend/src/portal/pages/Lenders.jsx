import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Search, ChevronRight, Info, Link2 } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import IconTile from "../../components/IconTile";
import SortHeader from "../components/SortHeader";
import Pager from "../components/Pager";
import { lenderType } from "../lenderType";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const PAGE_SIZE = 20;

// Tenants store the interest rate annually; customers think in months, so we
// always display (and filter) the monthly equivalent.
const PM = (annual) => +(parseFloat(annual || 0) / 12).toFixed(2);

const CMP = {
  name: (a, b) => a.business_name.localeCompare(b.business_name),
  min: (a, b) => parseFloat(a.min_amount) - parseFloat(b.min_amount),
  max: (a, b) => parseFloat(a.max_amount) - parseFloat(b.max_amount),
  rate: (a, b) =>
    parseFloat(a.default_interest_rate) - parseFloat(b.default_interest_rate),
  term: (a, b) =>
    parseFloat(a.default_duration) - parseFloat(b.default_duration),
  // Default view: linked lenders first, most-recently-linked on top; the
  // rest alphabetical.
  linked: (a, b) => {
    if (!!a.is_linked !== !!b.is_linked) return a.is_linked ? -1 : 1;
    if (a.is_linked)
      return new Date(b.linked_at || 0) - new Date(a.linked_at || 0);
    return a.business_name.localeCompare(b.business_name);
  },
};

// Marketplace directory of every active lender on LenderFest (platform owner +
// demo sandbox excluded server-side). Filter by terms, sort by any column,
// paginate. Each row's arrow opens the lender's detail page where the
// link/apply/unlink actions live.
function Lenders() {
  const navigate = useNavigate();
  const [lenders, setLenders] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState(""); // amount the customer wants
  const [maxRate, setMaxRate] = useState(""); // max acceptable MONTHLY interest
  const [linkFilter, setLinkFilter] = useState("all"); // all | linked | unlinked
  const [typeFilter, setTypeFilter] = useState("all"); // "all" | type label
  const [sort, setSort] = useState({ key: "linked", dir: "asc" });
  const [page, setPage] = useState(1);

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
    const list = lenders.filter((l) => {
      if (linkFilter === "linked" && !l.is_linked) return false;
      if (linkFilter === "unlinked" && l.is_linked) return false;
      if (typeFilter !== "all" && lenderType(l.business_type).label !== typeFilter)
        return false;
      if (
        search &&
        !l.business_name?.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (!Number.isNaN(amt) && amt > 0) {
        if (amt < parseFloat(l.min_amount) || amt > parseFloat(l.max_amount))
          return false;
      }
      if (!Number.isNaN(rate) && rate > 0) {
        if (PM(l.default_interest_rate) > rate) return false;
      }
      return true;
    });
    const base = CMP[sort.key] || CMP.linked;
    return [...list].sort((a, b) =>
      sort.dir === "asc" ? base(a, b) : -base(a, b),
    );
  }, [lenders, search, amount, maxRate, linkFilter, typeFilter, sort]);

  // Reset to page 1 whenever the filter/sort changes.
  useEffect(
    () => setPage(1),
    [search, amount, maxRate, linkFilter, typeFilter, sort],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PAGE_SIZE;
  const paged = filtered.slice(start, start + PAGE_SIZE);

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 rounded-lg focus:border-ocean-600 focus:outline-none bg-white dark:bg-slate-900 dark:text-slate-100";

  // Distinct lender types present, for the colour legend.
  const legendTypes = (() => {
    const m = new Map();
    for (const l of lenders) {
      const t = lenderType(l.business_type);
      if (!m.has(t.label)) m.set(t.label, t.color);
    }
    return [...m.entries()].map(([label, color]) => ({ label, color }));
  })();

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 dark:text-slate-100 mb-1 flex items-center gap-2">
          <Building2 size={28} className="text-navy-900 dark:text-slate-100" /> Lenders
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mb-3">
          Browse every lender on LenderFest and compare their terms.
        </p>
        {/* Borrowing rule — front-and-centre so a customer doesn't
            tap a lender expecting a one-tap apply and bounce off the
            "Link to apply" prompt. Stays visible above the filter
            chips because the answer to "why can't I apply here?"
            should be on the page that triggers the question, not
            on the next screen. */}
        <div
          role="note"
          className="mb-5 flex items-start gap-3 rounded-xl border border-ocean-100 bg-ocean-50/70 p-3 text-sm text-ocean-900"
        >
          <Info size={18} className="mt-0.5 shrink-0 text-ocean-600" />
          <p className="leading-relaxed">
            <span className="font-semibold">You can only borrow from lenders you've linked.</span>{" "}
            Tap a lender to view their terms and{" "}
            <span className="inline-flex items-center gap-1 font-semibold text-ocean-700">
              <Link2 size={13} /> Link
            </span>{" "}
            them — applications and repayments open up once the link
            is active.
          </p>
        </div>

        {/* Filter by lender type — colour-coded cards that double as the legend. */}
        {legendTypes.length > 1 && (
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-400 mb-2">
              Browse by type
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              <button
                onClick={() => setTypeFilter("all")}
                className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition ${
                  typeFilter === "all"
                    ? "border-ocean-500 bg-ocean-50"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300"
                }`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-ocean-gradient shrink-0" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">All lenders</span>
              </button>
              {legendTypes.map((t) => {
                const active = typeFilter === t.label;
                return (
                  <button
                    key={t.label}
                    onClick={() => setTypeFilter(active ? "all" : t.label)}
                    className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition ${
                      active ? "" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300"
                    }`}
                    style={active ? { borderColor: t.color, backgroundColor: `${t.color}14` } : undefined}
                  >
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    <span className="text-sm font-semibold" style={{ color: active ? t.color : "#1e293b" }}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4 mb-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
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
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
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
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Max interest (% p.m.)
              </label>
              <input
                type="number"
                value={maxRate}
                onChange={(e) => setMaxRate(e.target.value)}
                placeholder="e.g. 4"
                className={fld}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Show</span>
            {[
              ["all", "All"],
              ["linked", "Linked"],
              ["unlinked", "Not linked"],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setLinkFilter(v)}
                className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  linkFilter === v
                    ? "bg-ocean-gradient text-white"
                    : "bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
            {(search ||
              amount ||
              maxRate ||
              linkFilter !== "all" ||
              typeFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setAmount("");
                  setMaxRate("");
                  setLinkFilter("all");
                  setTypeFilter("all");
                }}
                className="ml-auto text-xs font-semibold text-ocean-600 hover:text-ocean-700"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
          {loading
            ? "Loading…"
            : `${filtered.length} lender${
                filtered.length !== 1 ? "s" : ""
              }${
                filtered.length
                  ? ` · showing ${start + 1}–${start + paged.length}`
                  : ""
              }`}
        </p>

        {loading ? null : filtered.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-12 text-center">
            <div className="flex justify-center mb-4">
              <IconTile icon={Building2} variant="ocean" size={56} />
            </div>
            <p className="text-navy-900 dark:text-slate-100 font-semibold">No lenders match.</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Try widening your filters.</p>
          </div>
        ) : (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
                    <SortHeader
                      label="Lender"
                      sortKey="name"
                      sort={sort}
                      onToggle={toggleSort}
                      align="left"
                    />
                    <SortHeader
                      label="Min borrow"
                      sortKey="min"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortHeader
                      label="Max borrow"
                      sortKey="max"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortHeader
                      label="Interest"
                      sortKey="rate"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortHeader
                      label="Term"
                      sortKey="term"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((l) => {
                    // Colour each lender by its TYPE so the category reads at a
                    // glance (all microfinances share a colour, etc.).
                    const ty = lenderType(l.business_type);
                    const bc = ty.color;
                    return (
                      <tr
                        key={l.tenant_id}
                        onClick={() =>
                          navigate(`/lenders/${l.tenant_id}`)
                        }
                        className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold shrink-0"
                              style={{ backgroundColor: bc }}
                            >
                              {l.business_name?.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-navy-900 dark:text-slate-100 truncate">
                                  {l.business_name}
                                </span>
                                {l.is_linked && (
                                  <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                                    Linked
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span
                                  className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                                  style={{
                                    color: bc,
                                    backgroundColor: `${bc}1a`,
                                  }}
                                >
                                  {ty.label}
                                </span>
                                {l.city && (
                                  <span className="text-xs text-slate-500 dark:text-slate-400 capitalize truncate">
                                    · {l.city}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-navy-900 dark:text-slate-100">
                          {KES(l.min_amount)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-navy-900 dark:text-slate-100">
                          {KES(l.max_amount)}
                        </td>
                        <td
                          className="px-4 py-3 text-right whitespace-nowrap font-semibold"
                          style={{ color: bc }}
                        >
                          {PM(l.default_interest_rate)}% p.m.
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {l.default_duration} mo
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white"
                            style={{ backgroundColor: bc }}
                            aria-label={`View ${l.business_name}`}
                          >
                            <ChevronRight size={18} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pager page={current} pageCount={pageCount} onChange={setPage} />
          </>
        )}
      </div>
    </PortalLayout>
  );
}

export default Lenders;
