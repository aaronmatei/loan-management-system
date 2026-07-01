import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Search,
  ArrowUpDown,
  ArrowRight,
  Link2,
  Unlink,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import Seo from "../../components/Seo";
import Skeleton from "../../components/Skeleton";
import { lenderType } from "../lenderType";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
// Tenants store the interest rate annually; borrowers think in months.
const PM = (annual) => +(parseFloat(annual || 0) / 12).toFixed(2);

// Marketplace directory of every active lender. A sticky filter rail (type /
// amount / interest / link status) narrows a grid of lender cards; each card
// opens the lender's detail page where link / apply / unlink live.
// Amount 0 = "Any"; interest 15 = "15%+" — both mean "don't filter", so the
// grid shows everything on first load.
function Lenders() {
  const navigate = useNavigate();
  const [lenders, setLenders] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState(0); // 0 = any
  const [interest, setInterest] = useState(15); // 15 = 15%+ (any)
  const [linkFilter, setLinkFilter] = useState("all"); // all | linked | unlinked
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState("best"); // best (lowest interest) | amount

  useEffect(() => {
    portalApi
      .get("/portal/customer/lenders")
      .then((r) => setLenders(r.data.data || []))
      .catch((err) => alert(err.response?.data?.error || "Failed to load lenders"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const list = lenders.filter((l) => {
      if (linkFilter === "linked" && !l.is_linked) return false;
      if (linkFilter === "unlinked" && l.is_linked) return false;
      if (typeFilter !== "all" && lenderType(l.business_type).label !== typeFilter)
        return false;
      if (search && !l.business_name?.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (amount > 0 && (amount < parseFloat(l.min_amount) || amount > parseFloat(l.max_amount)))
        return false;
      if (interest < 15 && PM(l.default_interest_rate) > interest) return false;
      return true;
    });
    if (sort === "best")
      return [...list].sort((a, b) => PM(a.default_interest_rate) - PM(b.default_interest_rate));
    return [...list].sort((a, b) => parseFloat(b.max_amount) - parseFloat(a.max_amount));
  }, [lenders, search, amount, interest, linkFilter, typeFilter, sort]);

  const bestPM = filtered.length
    ? Math.min(...filtered.map((l) => PM(l.default_interest_rate)))
    : null;

  // Distinct types present + counts, for the filter rail.
  const typeCounts = useMemo(() => {
    const m = new Map();
    for (const l of lenders) {
      const t = lenderType(l.business_type);
      if (!m.has(t.label)) m.set(t.label, { label: t.label, color: t.color, count: 0 });
      m.get(t.label).count += 1;
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [lenders]);

  const resetAll = () => {
    setSearch("");
    setAmount(0);
    setInterest(15);
    setLinkFilter("all");
    setTypeFilter("all");
  };
  const dirty =
    search || amount > 0 || interest < 15 || linkFilter !== "all" || typeFilter !== "all";

  const Label = ({ children }) => (
    <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#a39b8b] mb-2.5">
      {children}
    </div>
  );

  const rail = (
    <div className="bg-white dark:bg-slate-800 border border-[#ece6da] dark:border-slate-700 rounded-[18px] p-5 lg:sticky lg:top-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[13px] font-extrabold text-[#16241d] dark:text-slate-100">Filters</span>
        {dirty && (
          <button onClick={resetAll} className="text-[12px] font-bold text-[#0d8f63]">
            Reset
          </button>
        )}
      </div>

      {/* Lender type */}
      <Label>Lender type</Label>
      <div className="flex flex-col gap-1 mb-5">
        {[{ label: "all", color: "#0f3d2e", count: lenders.length }, ...typeCounts].map((t) => {
          const key = t.label === "all" ? "all" : t.label;
          const active = typeFilter === key;
          return (
            <button
              key={key}
              onClick={() => setTypeFilter(active && key !== "all" ? "all" : key)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13px] transition ${
                active ? "" : "hover:bg-[#faf6ec] dark:hover:bg-slate-700/50"
              }`}
              style={{
                fontWeight: active ? 700 : 600,
                color: active ? "#0f3d2e" : "#5e6b62",
                background: active ? "#eaf6ef" : "transparent",
                border: `1px solid ${active ? "#bfe3d1" : "transparent"}`,
              }}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
              <span className="flex-1 text-left">{t.label === "all" ? "All lenders" : t.label}</span>
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  color: active ? "#0d8f63" : "#a39b8b",
                  background: active ? "#fff" : "#f4efe4",
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Amount */}
      <Label>Amount to borrow</Label>
      <div className="text-[15px] font-extrabold text-[#16241d] dark:text-slate-100 mb-2">
        {amount > 0 ? KES(amount) : "Any amount"}
      </div>
      <input
        type="range"
        min="0"
        max="500000"
        step="1000"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        className="w-full accent-[#0d8f63]"
      />
      <div className="flex justify-between mt-1 text-[11px] text-[#a39b8b] font-semibold mb-5">
        <span>Any</span>
        <span>500K</span>
      </div>

      {/* Max interest */}
      <Label>Max interest (% p.m.)</Label>
      <div className="text-[15px] font-extrabold text-[#16241d] dark:text-slate-100 mb-2">
        {interest >= 15 ? "15%+" : `${interest}%`}
      </div>
      <input
        type="range"
        min="1"
        max="15"
        step="0.5"
        value={interest}
        onChange={(e) => setInterest(Number(e.target.value))}
        className="w-full accent-[#0d8f63]"
      />
      <div className="flex justify-between mt-1 text-[11px] text-[#a39b8b] font-semibold mb-5">
        <span>1%</span>
        <span>15%+</span>
      </div>

      {/* Link status */}
      <Label>Link status</Label>
      <div className="flex bg-[#f4efe4] dark:bg-slate-700 rounded-[11px] p-1">
        {[
          ["all", "All"],
          ["linked", "Linked"],
          ["unlinked", "Not linked"],
        ].map(([v, label]) => {
          const on = linkFilter === v;
          return (
            <button
              key={v}
              onClick={() => setLinkFilter(v)}
              className="flex-1 text-center py-2 rounded-[9px] text-[12.5px] font-bold whitespace-nowrap transition"
              style={{
                background: on ? "#0d8f63" : "transparent",
                color: on ? "#fff" : "#7c7363",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <PortalLayout>
      <Seo
        title="Find a lender — LenderFest"
        description="Browse lenders on LenderFest and apply for a loan online. One account to borrow from multiple lenders, with M-Pesa repayments."
        path="/lenders"
      />
      <div className="p-4 lg:p-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3.5 mb-5">
          <span
            className="w-12 h-12 rounded-[13px] flex items-center justify-center shrink-0"
            style={{ background: "#0f3d2e", color: "#cdeede" }}
          >
            <Building2 size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl lg:text-[26px] font-extrabold tracking-tight text-[#16241d] dark:text-slate-100">
              Lenders
            </h1>
            <p className="text-[13.5px] text-[#7c7363] dark:text-slate-400 font-medium">
              Browse every lender and compare terms · you can borrow once you've linked
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[264px_1fr] gap-4 lg:gap-[18px] items-start">
          {rail}

          {/* Results */}
          <div>
            <div className="flex items-center gap-3 mb-3.5">
              <div className="flex-1 flex items-center gap-2.5 bg-white dark:bg-slate-800 border border-[#ece6da] dark:border-slate-700 rounded-[12px] px-3.5 py-2.5">
                <Search size={17} className="text-[#a39b8b] shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search lender name…"
                  className="bg-transparent outline-none text-[13.5px] w-full text-[#16241d] dark:text-slate-100 placeholder:text-[#a99f8b]"
                />
              </div>
              <button
                onClick={() => setSort((s) => (s === "best" ? "amount" : "best"))}
                className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-[#ece6da] dark:border-slate-700 rounded-[12px] px-4 py-2.5 text-[13px] font-bold text-[#33403a] dark:text-slate-200 whitespace-nowrap"
              >
                <ArrowUpDown size={15} className="text-[#a39b8b]" />
                {sort === "best" ? "Lowest interest" : "Highest amount"}
              </button>
            </div>

            <div className="text-[12.5px] text-[#8a8170] dark:text-slate-400 font-semibold mb-3.5">
              {loading
                ? "Loading…"
                : `${filtered.length} lender${filtered.length === 1 ? "" : "s"} match${filtered.length === 1 ? "es" : ""}`}
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-52 w-full rounded-[18px]" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 border border-[#ece6da] dark:border-slate-700 rounded-[18px] p-[52px] text-center text-[#9a9486] text-sm font-semibold">
                No lenders match these filters.{" "}
                <button onClick={resetAll} className="text-[#0d8f63] font-bold">
                  Reset filters →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((l) => {
                  const ty = lenderType(l.business_type);
                  const bc = ty.color;
                  const pm = PM(l.default_interest_rate);
                  const best = pm === bestPM && filtered.length > 1;
                  const linked = !!l.is_linked;
                  return (
                    <button
                      key={l.tenant_id}
                      onClick={() => navigate(`/lenders/${l.tenant_id}`)}
                      className="text-left bg-white dark:bg-slate-800 rounded-[18px] p-5 flex flex-col transition hover:bg-[#fdfbf6] dark:hover:bg-slate-700/40 hover:shadow-[0_10px_30px_-18px_rgba(15,30,60,0.22)]"
                      style={{ border: `1px solid ${linked ? "#bfe3d1" : "#ece6da"}` }}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center text-[16px] font-extrabold shrink-0"
                          style={{ background: `${bc}1f`, color: bc }}
                        >
                          {(l.business_name || "?").charAt(0)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[15px] font-extrabold text-[#16241d] dark:text-slate-100 truncate">
                              {l.business_name}
                            </span>
                            {best && (
                              <span
                                className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-[5px] tracking-wide shrink-0"
                                style={{ color: "#0d8f63", background: "#eaf6ef" }}
                              >
                                BEST
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="w-2 h-2 rounded-full" style={{ background: bc }} />
                            <span className="text-[11.5px] text-[#9a9486] dark:text-slate-400 font-semibold truncate">
                              {ty.label}
                            </span>
                          </div>
                        </div>
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg whitespace-nowrap shrink-0"
                          style={
                            linked
                              ? { background: "#eaf6ef", color: "#0d8f63" }
                              : { background: "#f0ebe0", color: "#8a8170" }
                          }
                        >
                          {linked ? <Link2 size={12} /> : <Unlink size={12} />}
                          {linked ? "Linked" : "Not linked"}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-[18px] pt-4 border-t border-[#f4efe4] dark:border-slate-700">
                        <Stat label="Borrow up to" value={KES(l.max_amount)} />
                        <Stat label="Interest" value={`${pm}% p.m.`} valueColor="#0d8f63" />
                        <Stat label="From" value={KES(l.min_amount)} muted />
                        <Stat label="Max term" value={`${l.default_duration} mo`} muted />
                      </div>

                      <div
                        className="mt-[18px] w-full rounded-[12px] py-2.5 flex items-center justify-center gap-2 text-[13px] font-bold"
                        style={
                          linked
                            ? { background: "#faf6ec", border: "1px solid #e5ddcd", color: "#33403a" }
                            : { background: "#0d8f63", color: "#fff" }
                        }
                      >
                        {linked ? (
                          <>
                            View terms <ArrowRight size={15} />
                          </>
                        ) : (
                          <>
                            <Link2 size={15} /> Link to borrow
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

// One cell in a card's 2×2 terms grid.
function Stat({ label, value, valueColor, muted }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.03em] text-[#a39b8b]">
        {label}
      </div>
      <div
        className={`${muted ? "text-[13px]" : "text-[14.5px]"} font-extrabold mt-0.5 tabular-nums`}
        style={{ color: valueColor || (muted ? "#33403a" : "#16241d") }}
      >
        {value}
      </div>
    </div>
  );
}

export default Lenders;
