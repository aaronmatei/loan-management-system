import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import IconTile from "../../components/IconTile";

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
};

// Module-level so it keeps a stable identity across renders (an inline
// component would remount each keystroke).
function SortHeader({ label, sortKey, sort, onToggle, align = "right" }) {
  const activeCol = sort.key === sortKey;
  return (
    <th
      className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        onClick={() => onToggle(sortKey)}
        className={`inline-flex items-center gap-1 font-semibold hover:text-navy-900 ${
          activeCol ? "text-navy-900" : ""
        }`}
      >
        {label}
        {activeCol &&
          (sort.dir === "asc" ? (
            <ChevronUp size={12} />
          ) : (
            <ChevronDown size={12} />
          ))}
      </button>
    </th>
  );
}

// Marketplace directory of every active lender on LoanFix (platform owner +
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
  const [sort, setSort] = useState({ key: "rate", dir: "asc" });
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
    const base = CMP[sort.key] || CMP.rate;
    return [...list].sort((a, b) =>
      sort.dir === "asc" ? base(a, b) : -base(a, b),
    );
  }, [lenders, search, amount, maxRate, sort]);

  // Reset to page 1 whenever the filter/sort changes.
  useEffect(() => setPage(1), [search, amount, maxRate, sort]);

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
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-600 focus:outline-none bg-white";

  // Windowed page numbers around the current page.
  const pages = (() => {
    const span = 2;
    const from = Math.max(1, current - span);
    const to = Math.min(pageCount, current + span);
    const arr = [];
    for (let i = from; i <= to; i++) arr.push(i);
    return arr;
  })();

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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div>
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
            : `${filtered.length} lender${
                filtered.length !== 1 ? "s" : ""
              }${
                filtered.length
                  ? ` · showing ${start + 1}–${start + paged.length}`
                  : ""
              }`}
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
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
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
                    const bc = l.brand_color || "#0086cc";
                    return (
                      <tr
                        key={l.tenant_id}
                        onClick={() =>
                          navigate(`/loanfix/lenders/${l.tenant_id}`)
                        }
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 cursor-pointer"
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
                                <span className="font-semibold text-navy-900 truncate">
                                  {l.business_name}
                                </span>
                                {l.is_linked && (
                                  <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                                    Linked
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 capitalize truncate">
                                {[l.business_type, l.city]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-navy-900">
                          {KES(l.min_amount)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-navy-900">
                          {KES(l.max_amount)}
                        </td>
                        <td
                          className="px-4 py-3 text-right whitespace-nowrap font-semibold"
                          style={{ color: bc }}
                        >
                          {PM(l.default_interest_rate)}% p.m.
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-slate-600">
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

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-1 mt-5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={current === 1}
                  className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                {pages[0] > 1 && (
                  <>
                    <button
                      onClick={() => setPage(1)}
                      className="w-9 h-9 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      1
                    </button>
                    {pages[0] > 2 && (
                      <span className="px-1 text-slate-400">…</span>
                    )}
                  </>
                )}
                {pages.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-9 h-9 rounded-lg text-sm font-semibold ${
                      p === current
                        ? "bg-ocean-gradient text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {p}
                  </button>
                ))}
                {pages[pages.length - 1] < pageCount && (
                  <>
                    {pages[pages.length - 1] < pageCount - 1 && (
                      <span className="px-1 text-slate-400">…</span>
                    )}
                    <button
                      onClick={() => setPage(pageCount)}
                      className="w-9 h-9 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {pageCount}
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={current === pageCount}
                  className="p-2 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Next page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PortalLayout>
  );
}

export default Lenders;
