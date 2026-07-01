import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, ChevronDown, ArrowDownLeft } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import { lenderColor } from "../lenderColor";
import Skeleton from "../../components/Skeleton";
import { CARD, INK, MUTED } from "../theme";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

// Every payment the customer has made, across all their lenders — grouped by
// loan (each loan shows its transactions + a subtotal). A lender filter (shown
// when the borrower has more than one lender) narrows the view, and the bottom
// total bar always reflects the current filter. Opening a loan scopes the
// session to its lender and goes to the loan detail page.
function Payments() {
  const navigate = useNavigate();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lender, setLender] = useState("all"); // tenant_id or "all"

  useEffect(() => {
    portalApi
      .get("/portal/customer/payments")
      .then((r) => setPayments(r.data.data || []))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load payments"),
      )
      .finally(() => setLoading(false));
  }, []);

  // Distinct lenders for the filter dropdown, with a per-lender payment count.
  const lenders = useMemo(() => {
    const m = new Map();
    for (const p of payments) {
      const e = m.get(p.tenant_id) || {
        id: p.tenant_id,
        name: p.tenant_name,
        color: p.tenant_brand_color,
        count: 0,
      };
      e.count += 1;
      m.set(p.tenant_id, e);
    }
    return [...m.values()].sort((a, b) =>
      (a.name || "").localeCompare(b.name || ""),
    );
  }, [payments]);

  const filtered = useMemo(
    () =>
      lender === "all"
        ? payments
        : payments.filter((p) => String(p.tenant_id) === String(lender)),
    [payments, lender],
  );

  // Group the filtered payments by loan; subtotal each loan; order loans (and
  // the transactions within them) most-recent first.
  const groups = useMemo(() => {
    const m = new Map();
    for (const p of filtered) {
      const g =
        m.get(p.loan_id) || {
          loan_id: p.loan_id,
          loan_code: p.loan_code,
          tenant_id: p.tenant_id,
          tenant_name: p.tenant_name,
          tenant_brand_color: p.tenant_brand_color,
          txns: [],
          subtotal: 0,
        };
      g.txns.push(p);
      g.subtotal += parseFloat(p.amount_paid || 0);
      m.set(p.loan_id, g);
    }
    const arr = [...m.values()].map((g) => ({
      ...g,
      txns: [...g.txns].sort(
        (a, b) => new Date(b.payment_date || 0) - new Date(a.payment_date || 0),
      ),
    }));
    arr.sort(
      (a, b) =>
        new Date(b.txns[0]?.payment_date || 0) -
        new Date(a.txns[0]?.payment_date || 0),
    );
    return arr;
  }, [filtered]);

  const grandTotal = filtered.reduce(
    (s, p) => s + parseFloat(p.amount_paid || 0),
    0,
  );
  const selectedLender = lenders.find((l) => String(l.id) === String(lender));

  // Open the loan a payment was made against (scope session to its lender).
  const openLoan = async (p) => {
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: p.tenant_id,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({
          ...r.data.current_tenant,
          brand_color: p.tenant_brand_color,
        }),
      );
      navigate(`/portal/loans/${p.loan_id}`);
    } catch {
      alert("Failed to open loan");
    }
  };

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-9 w-48 rounded-lg" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-[18px]" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <div className={`${CARD} p-12 text-center ${MUTED}`}>
            <div className="flex justify-center mb-3">
              <FileText size={48} className="text-[#d8cfbd] dark:text-slate-600" />
            </div>
            <p>No payments yet.</p>
          </div>
        ) : (
          <>
            {/* Lender filter (only useful with more than one lender) + count */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              {lenders.length > 1 ? (
                <div className="relative">
                  <select
                    value={lender}
                    onChange={(e) => setLender(e.target.value)}
                    className="appearance-none bg-surface border border-[#e5ddcd] dark:border-slate-600 rounded-[11px] pl-3 pr-9 py-2 text-sm font-semibold text-[#16241d] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0d8f63]/30 cursor-pointer"
                  >
                    <option value="all">All lenders ({payments.length})</option>
                    {lenders.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.count})
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a39b8b] pointer-events-none"
                  />
                </div>
              ) : (
                <span />
              )}
              <p className={`text-sm ${MUTED}`}>
                {filtered.length} payment{filtered.length !== 1 ? "s" : ""} ·{" "}
                {groups.length} loan{groups.length !== 1 ? "s" : ""}
              </p>
            </div>

            {/* One card per loan: header (lender + loan + subtotal) then txns */}
            <div className="space-y-4">
              {groups.map((g) => {
                const bc = lenderColor(g.tenant_brand_color, g.tenant_id);
                return (
                  <div key={g.loan_id} className={`${CARD} overflow-hidden`}>
                    <button
                      onClick={() => openLoan(g.txns[0])}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[#f0ebe0] dark:border-slate-700 hover:bg-[#faf6ec] dark:hover:bg-slate-700/60 text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white text-sm font-bold shrink-0"
                          style={{ backgroundColor: bc }}
                        >
                          {g.tenant_name?.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className={`font-mono font-bold ${INK} truncate`}>
                            {g.loan_code || `Loan #${g.loan_id}`}
                          </p>
                          <p className={`text-xs ${MUTED} truncate`}>
                            {g.tenant_name} · {g.txns.length} payment
                            {g.txns.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-extrabold text-[#0d8f63] whitespace-nowrap">
                          {KES(g.subtotal)}
                        </p>
                        <span className="text-xs font-bold" style={{ color: bc }}>
                          View loan →
                        </span>
                      </div>
                    </button>
                    <div>
                      {g.txns.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-3.5 px-4 py-3 border-b border-[#f4efe4] dark:border-slate-700 last:border-0"
                        >
                          <span className="w-9 h-9 rounded-[10px] bg-[#eaf6ef] dark:bg-slate-700 flex items-center justify-center shrink-0">
                            <ArrowDownLeft size={17} className="text-[#0d8f63]" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className={`text-[13.5px] font-bold ${INK} tabular-nums`}>
                              {KES(p.amount_paid)}
                            </div>
                            <div className={`text-[12px] ${MUTED} font-medium capitalize`}>
                              {(p.payment_method || "—").replace("_", " ")}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`text-[12.5px] font-semibold text-[#33403a] dark:text-slate-300`}>
                              {fmtDate(p.payment_date)}
                            </div>
                            <span
                              className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-lg mt-0.5"
                              style={{ background: "#eaf6ef", color: "#0d8f63" }}
                            >
                              Posted
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom total bar — reflects the active lender filter. */}
            <div
              className="mt-4 flex items-center justify-between gap-3 text-white rounded-[18px] px-5 py-4"
              style={{ background: "linear-gradient(150deg,#123a2c,#0d2a20)" }}
            >
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: "#8fd3b6" }}>
                  Total paid {selectedLender ? `· ${selectedLender.name}` : "· all lenders"}
                </p>
                <p className="text-xs" style={{ color: "#6fae93" }}>
                  {filtered.length} payment{filtered.length !== 1 ? "s" : ""}{" "}
                  across {groups.length} loan{groups.length !== 1 ? "s" : ""}
                </p>
              </div>
              <p className="text-2xl font-extrabold whitespace-nowrap">
                {KES(grandTotal)}
              </p>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  );
}

export default Payments;
