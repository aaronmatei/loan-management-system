import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, FileText } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import SortHeader from "../components/SortHeader";
import Pager from "../components/Pager";
import { lenderColor } from "../lenderColor";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const PAGE_SIZE = 15;

const CMP = {
  lender: (a, b) => (a.tenant_name || "").localeCompare(b.tenant_name || ""),
  loan: (a, b) => (a.loan_code || "").localeCompare(b.loan_code || ""),
  amount: (a, b) => parseFloat(a.amount_paid || 0) - parseFloat(b.amount_paid || 0),
  method: (a, b) =>
    (a.payment_method || "").localeCompare(b.payment_method || ""),
  date: (a, b) => new Date(a.payment_date || 0) - new Date(b.payment_date || 0),
};

// Every payment the customer has made, across all their lenders — a sortable,
// paginated table. Rows open the loan the payment was made against.
function Payments() {
  const navigate = useNavigate();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: "date", dir: "desc" });
  const [page, setPage] = useState(1);

  useEffect(() => {
    portalApi
      .get("/portal/customer/payments")
      .then((r) => setPayments(r.data.data || []))
      .catch((err) =>
        alert(err.response?.data?.error || "Failed to load payments"),
      )
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => {
    const base = CMP[sort.key] || CMP.date;
    return [...payments].sort((a, b) =>
      sort.dir === "asc" ? base(a, b) : -base(a, b),
    );
  }, [payments, sort]);

  useEffect(() => setPage(1), [sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const startIdx = (current - 1) * PAGE_SIZE;
  const paged = sorted.slice(startIdx, startIdx + PAGE_SIZE);

  const total = payments.reduce((s, p) => s + parseFloat(p.amount_paid || 0), 0);

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );

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
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 mb-1 flex items-center gap-2">
          <CreditCard size={28} className="text-navy-900" /> Payments
        </h1>
        <p className="text-slate-500 mb-5">
          Every payment you've made, across all your lenders
        </p>

        {loading ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-500">
            <div className="flex justify-center mb-3">
              <FileText size={48} className="text-slate-300" />
            </div>
            <p>No payments yet.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
              <p className="text-sm text-slate-500">
                {sorted.length} payment{sorted.length !== 1 ? "s" : ""} · showing{" "}
                {startIdx + 1}–{startIdx + paged.length}
              </p>
              <p className="text-sm text-slate-500">
                Total paid:{" "}
                <span className="font-bold text-navy-900">{KES(total)}</span>
              </p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                    <SortHeader
                      label="Lender"
                      sortKey="lender"
                      sort={sort}
                      onToggle={toggleSort}
                      align="left"
                    />
                    <SortHeader
                      label="Loan"
                      sortKey="loan"
                      sort={sort}
                      onToggle={toggleSort}
                      align="left"
                    />
                    <SortHeader
                      label="Amount"
                      sortKey="amount"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <SortHeader
                      label="Method"
                      sortKey="method"
                      sort={sort}
                      onToggle={toggleSort}
                      align="left"
                    />
                    <SortHeader
                      label="Date"
                      sortKey="date"
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((p) => {
                    const bc = lenderColor(p.tenant_brand_color, p.tenant_id);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => openLoan(p)}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                              style={{ backgroundColor: bc }}
                            >
                              {p.tenant_name?.charAt(0)}
                            </div>
                            <span className="font-medium text-navy-900 truncate">
                              {p.tenant_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold text-navy-900">
                          {p.loan_code}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-green-600">
                          {KES(p.amount_paid)}
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-600">
                          {(p.payment_method || "—").replace("_", " ")}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap text-slate-500">
                          {p.payment_date
                            ? new Date(p.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className="text-xs font-semibold"
                            style={{ color: bc }}
                          >
                            View →
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

export default Payments;
