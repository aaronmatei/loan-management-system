import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Download,
  ClipboardList,
  Coins,
  Calendar,
  CreditCard,
  CheckCircle,
  AlertTriangle,
  Clock,
  BarChart3,
  PartyPopper,
  RotateCcw,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import MpesaPayButton from "../../components/MpesaPayButton";
import PaymentReceipt from "../../components/PaymentReceipt";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "N/A");

function LoanDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("schedule");
  const [downloading, setDownloading] = useState(false);
  // Which past payment's receipt modal is open (the transaction row).
  const [receiptTxn, setReceiptTxn] = useState(null);

  // Tenant branding for the receipt (brand_color, business_name) — the
  // portal keeps the current tenant in localStorage (same source the
  // PortalLayout / banners use).
  const portalTenant = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_current_tenant") || "null");
    } catch {
      return null;
    }
  })();
  const brand = portalTenant?.brand_color || "#0086cc";

  const downloadStatement = async () => {
    setDownloading(true);
    try {
      const res = await portalApi.get(
        `/portal/customer/loans/${id}/statement`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `loan_statement_${data?.loan?.loan_code || id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download statement");
    } finally {
      setDownloading(false);
    }
  };

  // Extracted so the M-Pesa button's onSuccess can re-fetch and the
  // balance / schedule / history reflect the new payment immediately.
  const fetchLoan = () =>
    portalApi
      .get(`/portal/customer/loans/${id}`)
      .then((r) => setData(r.data.data))
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/loanfix/portal/dashboard");
        } else {
          alert(err.response?.data?.error || "Failed to load loan details");
          navigate("/loanfix/portal/loans");
        }
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    // Per-lender page — needs a lender selected. Drill in from the dashboard.
    if (!localStorage.getItem("portal_current_tenant")) {
      navigate("/loanfix/portal/dashboard");
      return;
    }
    fetchLoan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </PortalLayout>
    );
  }
  if (!data) return <PortalLayout><div /></PortalLayout>;

  const {
    loan,
    schedule,
    transactions,
    receipt_summary: receiptSummary,
  } = data;
  const due = parseFloat(loan.total_amount_due || 0);
  const paid = parseFloat(loan.total_paid || 0);
  const balance = Math.max(0, due - paid);
  const progress = due > 0 ? Math.min((paid / due) * 100, 100) : 0;
  // interest_rate is stored as the MONTHLY rate (percent) — show it as-is.
  const monthlyRate = parseFloat(loan.interest_rate || 0).toFixed(2);
  const monthly = loan.loan_duration_months
    ? due / parseInt(loan.loan_duration_months, 10)
    : 0;
  // Repay the next installment if one is pending, else clear the balance.
  const repayAmount =
    receiptSummary?.next_payment_amount > 0
      ? receiptSummary.next_payment_amount
      : balance;

  // Map a transaction (+ its running receipt) into the shape the shared
  // PaymentReceipt expects. Balance figures are AS OF that payment (the
  // backend's running fold); next-payment is loan-level, only surfaced
  // when this payment didn't already clear the loan.
  const buildReceipt = (t) => {
    const remainingAfter = parseFloat(t.receipt?.remaining_balance_after_this ?? balance);
    const fullyPaid = remainingAfter <= 0;
    return {
      client_name: `${loan.client_first_name || ""} ${loan.client_last_name || ""}`.trim(),
      client_phone: loan.client_phone,
      loan_code: loan.loan_code,
      principal: loan.principal_amount,
      total_amount_due: loan.total_amount_due,
      total_paid: t.receipt?.total_paid_after_this,
      remaining_balance: remainingAfter,
      completion_percentage: t.receipt?.completion_percentage_after_this,
      is_fully_paid: fullyPaid,
      next_payment_amount: fullyPaid ? null : receiptSummary?.next_payment_amount,
      next_payment_date: fullyPaid ? null : receiptSummary?.next_payment_date,
      next_payment_number: fullyPaid ? null : receiptSummary?.next_payment_number,
    };
  };

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto" style={{ "--brand": brand }}>
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={() => navigate("/loanfix/portal/loans")}
            className="text-[var(--brand)] font-semibold"
          >
            ← Back to Loans
          </button>
          <div className="flex items-center gap-2">
            {loan.status === "active" && balance > 0 && (
              <MpesaPayButton
                endpoint="/mpesa/stk/loan-repayment"
                payload={{ loan_id: loan.id, amount: repayAmount }}
                apiClient={portalApi}
                amountLabel={KES(repayAmount)}
                buttonText="Repay with M-Pesa"
                onSuccess={fetchLoan}
              />
            )}
            <button
              onClick={downloadStatement}
              disabled={downloading}
              className="px-4 py-2 bg-[var(--brand)] hover:brightness-95 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
            >
              {downloading ? "Preparing…" : <span className="inline-flex items-center gap-1.5"><Download size={15} /> Download Statement</span>}
            </button>
          </div>
        </div>

        <div className="bg-[var(--brand)] text-white rounded-2xl shadow-xl p-6 lg:p-8 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-white/75 text-sm">Loan Code</p>
              <h1 className="text-2xl lg:text-3xl font-bold font-mono">
                {loan.loan_code || `#${loan.id}`}
              </h1>
              <p className="text-white/85 mt-1">{loan.purpose || "Loan"}</p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/20 capitalize">
              {String(loan.status || "").replace("_", " ")}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-white/75 text-xs">Principal</p>
              <p className="text-lg font-bold">
                {KES(loan.principal_amount)}
              </p>
            </div>
            <div>
              <p className="text-white/75 text-xs">Total Due</p>
              <p className="text-lg font-bold">{KES(due)}</p>
            </div>
            <div>
              <p className="text-white/75 text-xs">Paid So Far</p>
              <p className="text-lg font-bold">{KES(paid)}</p>
            </div>
            <div>
              <p className="text-white/75 text-xs">Balance</p>
              <p className="text-lg font-bold">{KES(balance)}</p>
            </div>
          </div>
          {["active", "completed"].includes(loan.status) && (
            <div>
              <div className="bg-white/20 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-white h-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-white/85 mt-2">
                {progress.toFixed(1)}% repaid
              </p>
            </div>
          )}
        </div>

        {/* Overpayment & refund — shown only when the client overpaid or a
            refund is on record. */}
        {(parseFloat(loan.overpayment_amount || 0) > 0 || loan.refund_status) && (
          <div className="bg-white rounded-xl shadow p-4 mb-6 border-l-4 border-amber-400">
            <h3 className="font-bold text-navy-900 mb-3 flex items-center gap-1.5">
              <RotateCcw size={18} className="text-amber-500" /> Overpayment &amp;
              Refund
            </h3>
            <div className="space-y-2 text-sm">
              {parseFloat(loan.overpayment_amount || 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">You overpaid</span>
                  <span className="font-bold text-amber-600">
                    {KES(loan.overpayment_amount)}
                  </span>
                </div>
              )}
              {loan.refund_status && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Refund status</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${
                      /refund|complet|paid/.test(
                        String(loan.refund_status).toLowerCase(),
                      )
                        ? "bg-green-100 text-green-700"
                        : String(loan.refund_status).toLowerCase() === "pending"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {String(loan.refund_status).replace(/_/g, " ")}
                  </span>
                </div>
              )}
              {loan.refunded_date && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Refunded on</span>
                  <span className="font-semibold">{day(loan.refunded_date)}</span>
                </div>
              )}
              {loan.refund_method && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Method</span>
                  <span className="font-semibold capitalize">
                    {loan.refund_method}
                  </span>
                </div>
              )}
              {loan.refund_reference && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Reference</span>
                  <span className="font-semibold font-mono">
                    {loan.refund_reference}
                  </span>
                </div>
              )}
            </div>
            {String(loan.refund_status || "").toLowerCase() === "pending" && (
              <p className="text-xs text-amber-700 mt-3">
                Your refund is being processed by{" "}
                {portalTenant?.business_name || "your lender"}.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-bold text-navy-900 mb-3 flex items-center gap-1.5">
              <ClipboardList size={18} /> Loan Information
            </h3>
            <div className="space-y-2 text-sm">
              {/* Loan product — only shown when the loan was applied
                  via a published package. Custom apply leaves this
                  row out entirely so the panel stays compact. */}
              {loan.package_name && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Product</span>
                  <span className="font-semibold text-navy-900">
                    {loan.package_name}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Duration</span>
                <span className="font-semibold">
                  {loan.loan_duration_months} months
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Interest Rate</span>
                <span className="font-semibold">{monthlyRate}% p.m.</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Interest Method</span>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                    loan.interest_method === "reducing"
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {loan.interest_method === "reducing"
                    ? "Reducing"
                    : "Flat"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Start Date</span>
                <span className="font-semibold">{day(loan.start_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">End Date</span>
                <span className="font-semibold">{day(loan.end_date)}</span>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-bold text-navy-900 mb-3 flex items-center gap-1.5">
              <Coins size={18} /> Financial Summary
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Interest</span>
                <span className="font-semibold">
                  {KES(loan.total_interest)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Monthly Payment</span>
                <span className="font-semibold">{KES(monthly)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Payments Made</span>
                <span className="font-semibold">
                  {(transactions || []).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Schedule Items</span>
                <span className="font-semibold">
                  {(schedule || []).length}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="flex border-b">
            <button
              onClick={() => setTab("schedule")}
              className={`flex-1 py-3 px-4 font-semibold inline-flex items-center justify-center gap-1.5 ${
                tab === "schedule"
                  ? "bg-[var(--brand)]/10 text-[var(--brand)] border-b-2 border-[var(--brand)]"
                  : "text-gray-600"
              }`}
            >
              <Calendar size={16} /> Payment Schedule
            </button>
            <button
              onClick={() => setTab("history")}
              className={`flex-1 py-3 px-4 font-semibold inline-flex items-center justify-center gap-1.5 ${
                tab === "history"
                  ? "bg-[var(--brand)]/10 text-[var(--brand)] border-b-2 border-[var(--brand)]"
                  : "text-gray-600"
              }`}
            >
              <CreditCard size={16} /> Payment History
            </button>
          </div>

          {tab === "schedule" && (
            <div className="p-4">
              {(schedule || []).length === 0 ? (
                <p className="text-center text-gray-500 py-6">
                  No schedule (loan not yet disbursed).
                </p>
              ) : (
                <div className="space-y-2">
                  {schedule.map((s) => (
                    <div
                      key={s.id}
                      className={`flex justify-between items-center p-3 rounded-lg ${
                        s.status === "paid"
                          ? "bg-green-50"
                          : s.status === "overdue"
                            ? "bg-red-50"
                            : "bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-7 h-7 shrink-0">
                          {s.status === "paid"
                            ? <CheckCircle size={20} className="text-green-500" />
                            : s.status === "overdue"
                              ? <AlertTriangle size={20} className="text-red-500" />
                              : <Clock size={20} className="text-yellow-500" />}
                        </span>
                        <div>
                          <p className="font-semibold">
                            Payment #{s.payment_number}
                          </p>
                          <p className="text-xs text-gray-500">
                            Due: {day(s.due_date)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{KES(s.amount_due)}</p>
                        <p className="text-xs capitalize text-gray-600">
                          {s.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="p-4 space-y-3">
              {(transactions || []).length === 0 ? (
                <p className="text-center text-gray-500 py-6">
                  No payments yet.
                </p>
              ) : (
                <>
                  {transactions.map((t) => (
                    <div
                      key={t.id}
                      className="border-2 border-gray-100 rounded-xl p-3 hover:border-[var(--brand)]/30 transition"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-green-600 text-lg">
                            +{KES(t.amount_paid)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {day(t.payment_date)} · {t.payment_method}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500 font-mono">
                            {t.transaction_code}
                          </p>
                          <p className="text-xs text-green-600 font-semibold capitalize">
                            {t.payment_status}
                          </p>
                          <button
                            onClick={() => setReceiptTxn(t)}
                            className="mt-1 text-xs font-semibold text-[var(--brand)] hover:opacity-80"
                          >
                            View receipt →
                          </button>
                        </div>
                      </div>
                      {t.receipt && (
                        <div className="bg-gray-50 rounded-lg p-2 mt-2">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-600">After this</span>
                            <span className="font-bold">
                              {t.receipt.completion_percentage_after_this}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                              className="bg-gradient-to-r from-green-500 to-emerald-600 h-1.5 rounded-full"
                              style={{
                                width: `${Math.min(
                                  parseFloat(
                                    t.receipt
                                      .completion_percentage_after_this,
                                  ),
                                  100,
                                )}%`,
                              }}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3 mt-2 text-xs">
                            <div>
                              <p className="text-gray-500">Remaining</p>
                              <p className="font-bold text-orange-600">
                                {KES(t.receipt.remaining_balance_after_this)}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">Total Paid</p>
                              <p className="font-bold text-green-600">
                                {KES(t.receipt.total_paid_after_this)}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {receiptSummary && (
                    <div className="bg-[var(--brand)]/10 border-2 border-[var(--brand)]/30 rounded-xl p-4 mt-4">
                      <h3 className="font-bold mb-3 text-gray-800 flex items-center gap-1.5">
                        <BarChart3 size={18} /> Current Status
                      </h3>
                      <div className="grid grid-cols-2 gap-3 text-center">
                        <div>
                          <p className="text-xs text-gray-500">Total Paid</p>
                          <p className="font-bold text-green-600">
                            {KES(receiptSummary.total_paid)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Remaining</p>
                          <p className="font-bold text-orange-600">
                            {KES(receiptSummary.remaining_balance)}
                          </p>
                        </div>
                      </div>
                      {receiptSummary.next_payment_date &&
                        !receiptSummary.is_fully_paid && (
                          <div className="mt-3 pt-3 border-t border-[var(--brand)]/30 text-center">
                            <p className="text-xs text-gray-500 inline-flex items-center gap-1 justify-center">
                              <Calendar size={12} /> Next Payment
                            </p>
                            <p className="font-bold text-lg text-blue-600">
                              {KES(receiptSummary.next_payment_amount)}
                            </p>
                            <p className="text-xs text-blue-600">
                              {day(receiptSummary.next_payment_date)}
                            </p>
                          </div>
                        )}
                      {receiptSummary.is_fully_paid && (
                        <p className="mt-3 text-center text-green-700 font-bold flex items-center justify-center gap-1.5">
                          <PartyPopper size={18} className="text-green-600" /> LOAN FULLY PAID!
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {receiptTxn && (
        <PaymentReceipt
          payment={receiptTxn}
          receipt={buildReceipt(receiptTxn)}
          tenant={{
            ...portalTenant,
            business_type: loan.tenant_business_type,
            brand_color: portalTenant?.brand_color || loan.tenant_brand_color,
          }}
          onClose={() => setReceiptTxn(null)}
        />
      )}
    </PortalLayout>
  );
}

export default LoanDetails;
