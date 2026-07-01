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
  HandHeart,
} from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import MpesaPayButton from "../../components/MpesaPayButton";
import PaymentReceipt from "../../components/PaymentReceipt";
import Skeleton from "../../components/Skeleton";

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "N/A");
// % of (part / whole) for waiver context — rendered as "(45%)".
// Returns "" when whole is 0 so we don't divide-by-zero into NaN
// when a row has no contracted interest or no penalty accrued.
const pct = (part, whole) => {
  const p = parseFloat(part) || 0;
  const w = parseFloat(whole) || 0;
  if (w <= 0 || p <= 0) return "";
  const v = (p / w) * 100;
  return v >= 99.5 ? "100%" : `${v.toFixed(v < 10 ? 1 : 0)}%`;
};

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
  const brand = portalTenant?.brand_color || "#0e8a6e";

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
          navigate("/portal/dashboard");
        } else {
          alert(err.response?.data?.error || "Failed to load loan details");
          navigate("/portal/loans");
        }
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    // Per-lender page — needs a lender selected. Drill in from the dashboard.
    if (!localStorage.getItem("portal_current_tenant")) {
      navigate("/portal/dashboard");
      return;
    }
    fetchLoan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-5xl mx-auto">
          <div className="flex justify-between items-center mb-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-10 w-44 rounded-lg" />
          </div>
          <Skeleton className="h-48 w-full rounded-2xl mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Skeleton className="h-56 w-full rounded-xl" />
            <Skeleton className="h-56 w-full rounded-xl" />
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </PortalLayout>
    );
  }
  if (!data) return <PortalLayout><div /></PortalLayout>;

  const {
    loan,
    schedule,
    transactions,
    waivers = [],
    waivers_summary: waiversSummary = {
      count: 0,
      total_amount: 0,
      total_interest: 0,
      total_penalty: 0,
      total_principal: 0,
    },
    receipt_summary: receiptSummary,
  } = data;
  // Headline penalty figures across the loan, derived from the
  // schedule rows the backend already annotated. Shown so the
  // borrower sees the overall late-fee bill at a glance, with
  // outstanding flagged when there's something to pay down.
  const penaltyAccrued = (schedule || []).reduce(
    (s, r) => s + (parseFloat(r.penalty_total) || 0),
    0,
  );
  const penaltyPaidTotal = (schedule || []).reduce(
    (s, r) => s + (parseFloat(r.penalty_paid) || 0),
    0,
  );
  const penaltyOutstanding = (schedule || []).reduce(
    (s, r) => s + (parseFloat(r.penalty_outstanding) || 0),
    0,
  );
  // Lifetime contractual interest on this loan — the denominator
  // for "what % of your interest did the lender forgive". Comes
  // straight from the loan record; same number the contract was
  // written for.
  const contractedInterest = parseFloat(loan.total_interest || 0);
  const contractedPrincipal = parseFloat(loan.principal_amount || 0);
  const due = parseFloat(loan.total_amount_due || 0);
  const paid = parseFloat(loan.total_paid || 0);
  const balance = Math.max(0, due - paid);
  // Cash actually paid (net of any refundable overpayment) vs
  // total settled against amount_due (which adds waiver coverage
  // on top of cash). The "Paid So Far" tile shows the SETTLED
  // figure (paid), but customers who paid in cash want to see
  // their cash number — relevant when they're holding receipts
  // and reconciling. cashAmountDue = cash that went to
  // principal+interest (not penalty, not refunded). cashPenalty
  // = cash that went to late-fee + penalty-interest.
  //
  // ORDER MATTERS: declared after `paid` because
  // waiverAmountDue derives from it. Inlining these above the
  // paid declaration earlier triggered a TDZ
  // "Cannot access 'paid' before initialization" error in the
  // production bundle — minified to a bare `j=N-A` reference
  // that hoisted out of order.
  const cashPaidTotal = (transactions || []).reduce(
    (s, t) =>
      s +
      Math.max(
        0,
        parseFloat(t.amount_paid || 0) -
          parseFloat(t.overpayment_portion || 0),
      ),
    0,
  );
  const cashPenaltyPaid = (transactions || []).reduce(
    (s, t) => s + parseFloat(t.penalty_portion || 0),
    0,
  );
  const cashAmountDuePaid = Math.max(0, cashPaidTotal - cashPenaltyPaid);
  const waiverAmountDue = paid - cashAmountDuePaid; // amount_due settled by waivers
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
            onClick={() => navigate("/portal/loans")}
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
              {waiverAmountDue > 0.01 && (
                <p className="text-white/70 text-[10px] leading-tight mt-0.5">
                  {KES(cashAmountDuePaid)} cash
                  <br />+ {KES(waiverAmountDue)} waived
                </p>
              )}
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
          <div className="bg-surface rounded-xl shadow p-4 mb-6 border-l-4 border-amber-400">
            <h3 className="font-bold text-navy-900 dark:text-slate-100 mb-3 flex items-center gap-1.5">
              <RotateCcw size={18} className="text-amber-500" /> Overpayment &amp;
              Refund
            </h3>
            <div className="space-y-2 text-sm">
              {parseFloat(loan.overpayment_amount || 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">You overpaid</span>
                  <span className="font-bold text-amber-600">
                    {KES(loan.overpayment_amount)}
                  </span>
                </div>
              )}
              {loan.refund_status && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-slate-400">Refund status</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${
                      /refund|complet|paid/.test(
                        String(loan.refund_status).toLowerCase(),
                      )
                        ? "bg-green-100 text-green-700"
                        : String(loan.refund_status).toLowerCase() === "pending"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-[#faf6ec] text-gray-700"
                    }`}
                  >
                    {String(loan.refund_status).replace(/_/g, " ")}
                  </span>
                </div>
              )}
              {loan.refunded_date && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Refunded on</span>
                  <span className="font-semibold dark:text-slate-100">{day(loan.refunded_date)}</span>
                </div>
              )}
              {loan.refund_method && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Method</span>
                  <span className="font-semibold capitalize dark:text-slate-100">
                    {loan.refund_method}
                  </span>
                </div>
              )}
              {loan.refund_reference && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Reference</span>
                  <span className="font-semibold font-mono dark:text-slate-100">
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
          <div className="bg-surface rounded-xl shadow p-4">
            <h3 className="font-bold text-navy-900 dark:text-slate-100 mb-3 flex items-center gap-1.5">
              <ClipboardList size={18} /> Loan Information
            </h3>
            <div className="space-y-2 text-sm">
              {/* Loan product — only shown when the loan was applied
                  via a published package. Custom apply leaves this
                  row out entirely so the panel stays compact. */}
              {loan.package_name && (
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-400">Product</span>
                  <span className="font-semibold text-navy-900 dark:text-slate-100">
                    {loan.package_name}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Duration</span>
                <span className="font-semibold dark:text-slate-100">
                  {loan.loan_duration_months} months
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Interest Rate</span>
                <span className="font-semibold dark:text-slate-100">{monthlyRate}% p.m.</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Interest Method</span>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                    loan.interest_method === "reducing"
                      ? "bg-ocean-100 text-ocean-700"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {loan.interest_method === "reducing"
                    ? "Reducing"
                    : "Flat"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Start Date</span>
                <span className="font-semibold dark:text-slate-100">{day(loan.start_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">End Date</span>
                <span className="font-semibold dark:text-slate-100">{day(loan.end_date)}</span>
              </div>
            </div>
          </div>
          <div className="bg-surface rounded-xl shadow p-4">
            <h3 className="font-bold text-navy-900 dark:text-slate-100 mb-3 flex items-center gap-1.5">
              <Coins size={18} /> Financial Summary
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Total Interest</span>
                <span className="font-semibold dark:text-slate-100">
                  {KES(loan.total_interest)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Monthly Payment</span>
                <span className="font-semibold dark:text-slate-100">{KES(monthly)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Payments Made</span>
                <span className="font-semibold dark:text-slate-100">
                  {(transactions || []).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-slate-400">Schedule Items</span>
                <span className="font-semibold dark:text-slate-100">
                  {(schedule || []).length}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-xl shadow overflow-hidden">
          <div className="flex border-b dark:border-slate-700">
            <button
              onClick={() => setTab("schedule")}
              className={`flex-1 py-3 px-4 font-semibold inline-flex items-center justify-center gap-1.5 ${
                tab === "schedule"
                  ? "bg-[var(--brand)]/10 text-[var(--brand)] border-b-2 border-[var(--brand)]"
                  : "text-gray-600 dark:text-slate-400"
              }`}
            >
              <Calendar size={16} /> Payment Schedule
            </button>
            <button
              onClick={() => setTab("history")}
              className={`flex-1 py-3 px-4 font-semibold inline-flex items-center justify-center gap-1.5 ${
                tab === "history"
                  ? "bg-[var(--brand)]/10 text-[var(--brand)] border-b-2 border-[var(--brand)]"
                  : "text-gray-600 dark:text-slate-400"
              }`}
            >
              <CreditCard size={16} /> Payment History
            </button>
            {waiversSummary.count > 0 && (
              <button
                onClick={() => setTab("waivers")}
                className={`flex-1 py-3 px-4 font-semibold inline-flex items-center justify-center gap-1.5 ${
                  tab === "waivers"
                    ? "bg-[var(--brand)]/10 text-[var(--brand)] border-b-2 border-[var(--brand)]"
                    : "text-gray-600 dark:text-slate-400"
                }`}
              >
                <HandHeart size={16} /> Waivers
                <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-fuchsia-100 text-fuchsia-700 text-[10px] font-bold">
                  {waiversSummary.count}
                </span>
              </button>
            )}
          </div>

          {tab === "schedule" && (
            <div className="p-4">
              {(penaltyAccrued > 0 || waiversSummary.count > 0) && (
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  {penaltyAccrued > 0 && (
                    <>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-100 text-amber-800">
                        <AlertTriangle size={12} /> {KES(penaltyAccrued)} penalty
                        accrued
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border ${
                          penaltyOutstanding > 0
                            ? "bg-red-50 border-red-100 text-red-700"
                            : "bg-emerald-50 border-emerald-100 text-emerald-700"
                        }`}
                      >
                        {penaltyOutstanding > 0
                          ? `${KES(penaltyOutstanding)} outstanding`
                          : `${KES(penaltyPaidTotal)} paid`}
                      </span>
                    </>
                  )}
                  {/* Per-bucket waived pills — split so the
                      borrower sees what kind of forgiveness was
                      extended (interest vs penalty vs principal)
                      at a glance, not just a single grand total.
                      Each pill is a button that jumps to the
                      Waivers tab; each only renders when its
                      bucket is non-zero. */}
                  {waiversSummary.total_interest > 0 && (
                    <button
                      onClick={() => setTab("waivers")}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-fuchsia-50 border border-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-100 transition"
                    >
                      <HandHeart size={12} />
                      {KES(waiversSummary.total_interest)} interest waived
                    </button>
                  )}
                  {waiversSummary.total_penalty > 0 && (
                    <button
                      onClick={() => setTab("waivers")}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 border border-rose-100 text-rose-700 hover:bg-rose-100 transition"
                    >
                      <HandHeart size={12} />
                      {KES(waiversSummary.total_penalty)} penalty waived
                    </button>
                  )}
                  {waiversSummary.total_principal > 0 && (
                    <button
                      onClick={() => setTab("waivers")}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--brand)]/10 border border-[var(--brand)]/20 text-[var(--brand)] hover:bg-[var(--brand)]/15 transition"
                    >
                      <HandHeart size={12} />
                      {KES(waiversSummary.total_principal)} principal waived
                    </button>
                  )}
                </div>
              )}
              {(schedule || []).length === 0 ? (
                <p className="text-center text-gray-500 dark:text-slate-400 py-6">
                  No schedule (loan not yet disbursed).
                </p>
              ) : (
                <div className="space-y-2">
                  {schedule.map((s) => {
                    // For reducing-balance loans the per-row split is
                    // the headline story (declining interest, rising
                    // principal). For flat loans interest_portion is
                    // constant across rows — still useful to see, so
                    // we show the breakdown either way when populated.
                    const interest = parseFloat(s.interest_portion || 0);
                    const principal = parseFloat(s.principal_portion || 0);
                    const balanceAfter = parseFloat(s.balance_after || 0);
                    const hasBreakdown = interest > 0 || principal > 0;
                    const penaltyTotal = parseFloat(s.penalty_total || 0);
                    const penaltyPaid = parseFloat(s.penalty_paid || 0);
                    const penaltyOut = parseFloat(s.penalty_outstanding || 0);
                    const lateFee = parseFloat(s.late_fee || 0);
                    const penaltyInterest = parseFloat(s.penalty_interest || 0);
                    const interestWaived = parseFloat(s.interest_waived || 0);
                    const penaltyWaived = parseFloat(s.penalty_waived || 0);
                    const hasPenalty = penaltyTotal > 0;
                    const hasWaiver = interestWaived > 0 || penaltyWaived > 0;
                    return (
                      <div
                        key={s.id}
                        className={`p-3 rounded-lg ${
                          s.status === "paid"
                            ? "bg-green-50"
                            : s.status === "overdue"
                              ? "bg-red-50"
                              : "bg-[#faf6ec] dark:bg-slate-900"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center justify-center w-7 h-7 shrink-0">
                              {s.status === "paid"
                                ? <CheckCircle size={20} className="text-green-500" />
                                : s.status === "overdue"
                                  ? <AlertTriangle size={20} className="text-red-500" />
                                  : <Clock size={20} className="text-yellow-500" />}
                            </span>
                            <div>
                              <p className="font-semibold dark:text-slate-100">
                                Payment #{s.payment_number}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-slate-400">
                                Due: {day(s.due_date)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold dark:text-slate-100">{KES(s.amount_due)}</p>
                            <p className="text-xs capitalize text-gray-600 dark:text-slate-400">
                              {s.status}
                            </p>
                          </div>
                        </div>
                        {hasBreakdown && (
                          <div className="mt-2 pt-2 border-t border-[#e5ddcd]/60 dark:border-slate-700 grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">Interest</p>
                              <p className="font-semibold text-emerald-700">
                                {KES(interest)}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">Principal</p>
                              <p className="font-semibold text-[var(--brand)]">
                                {KES(principal)}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">Balance After</p>
                              <p className="font-semibold text-gray-700 dark:text-slate-200">
                                {balanceAfter > 0 ? KES(balanceAfter) : "KES 0"}
                              </p>
                            </div>
                          </div>
                        )}
                        {hasPenalty && (
                          <div className="mt-2 pt-2 border-t border-amber-200/60 grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <p className="text-gray-500 dark:text-slate-400 inline-flex items-center gap-1">
                                <AlertTriangle size={11} /> Late fee
                              </p>
                              <p className="font-semibold text-amber-700">
                                {KES(lateFee)}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">Penalty interest</p>
                              <p className="font-semibold text-amber-700">
                                {KES(penaltyInterest)}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500 dark:text-slate-400">
                                {penaltyOut > 0 ? "Penalty owed" : "Penalty paid"}
                              </p>
                              <p
                                className={`font-semibold ${
                                  penaltyOut > 0 ? "text-red-600" : "text-emerald-700"
                                }`}
                              >
                                {penaltyOut > 0
                                  ? KES(penaltyOut)
                                  : KES(penaltyPaid)}
                              </p>
                            </div>
                          </div>
                        )}
                        {hasWaiver && (
                          <div className="mt-2 pt-2 border-t border-fuchsia-200/60 text-[11px] space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-fuchsia-700 font-semibold">
                                <HandHeart size={12} /> Waived:
                              </span>
                              {interestWaived > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 font-semibold">
                                  Interest {KES(interestWaived)}
                                  {interest > 0 && (
                                    <span className="opacity-70 font-normal">
                                      {" "}· {pct(interestWaived, interest)}
                                    </span>
                                  )}
                                </span>
                              )}
                              {penaltyWaived > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">
                                  Penalty {KES(penaltyWaived)}
                                  {penaltyTotal > 0 && (
                                    <span className="opacity-70 font-normal">
                                      {" "}· {pct(penaltyWaived, penaltyTotal)}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                            {/* "Before vs after" line — shows what
                                the row would have cost without the
                                waiver, so the borrower sees the
                                actual relief in concrete shillings.
                                Before = amount_due + penalty_total
                                (the latter already historical-max'd
                                on the backend, so it captures the
                                penalty that ever existed). After =
                                before − (interest + penalty)
                                waivers. */}
                            {(() => {
                              const before =
                                parseFloat(s.amount_due || 0) + penaltyTotal;
                              const totalWaived =
                                interestWaived + penaltyWaived;
                              const after = Math.max(0, before - totalWaived);
                              return (
                                before > 0 && totalWaived > 0 && (
                                  <p className="text-gray-600 dark:text-slate-400 pl-4">
                                    <span className="line-through text-gray-400 dark:text-slate-500">
                                      {KES(before)}
                                    </span>
                                    {" "}
                                    <span className="font-semibold text-emerald-700">
                                      → {KES(after)}
                                    </span>
                                    <span className="text-gray-500 dark:text-slate-400">
                                      {" "}you save{" "}
                                      <span className="font-semibold text-emerald-700">
                                        {KES(totalWaived)}
                                      </span>
                                      {before > 0 && (
                                        <span className="ml-1 text-emerald-700 font-semibold">
                                          ({pct(totalWaived, before)})
                                        </span>
                                      )}
                                    </span>
                                  </p>
                                )
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="p-4 space-y-3">
              {(transactions || []).length === 0 ? (
                <p className="text-center text-gray-500 dark:text-slate-400 py-6">
                  No payments yet.
                </p>
              ) : (
                <>
                  {transactions.map((t) => (
                    <div
                      key={t.id}
                      className="border-2 border-[#f0ebe0] dark:border-slate-700 rounded-xl p-3 hover:border-[var(--brand)]/30 transition"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-green-600 text-lg">
                            +{KES(t.amount_paid)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400">
                            {day(t.payment_date)} · {t.payment_method}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500 dark:text-slate-400 font-mono">
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
                        <div className="bg-[#faf6ec] dark:bg-slate-900 rounded-lg p-2 mt-2">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-600 dark:text-slate-400">After this</span>
                            <span className="font-bold dark:text-slate-100">
                              {t.receipt.completion_percentage_after_this}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1.5">
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
                              <p className="text-gray-500 dark:text-slate-400">Remaining</p>
                              <p className="font-bold text-orange-600">
                                {KES(t.receipt.remaining_balance_after_this)}
                              </p>
                            </div>
                            <div>
                              <p
                                className="text-gray-500 dark:text-slate-400"
                                title="Includes amount settled by lender waivers, not just cash"
                              >
                                Settled
                              </p>
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
                      <h3 className="font-bold mb-3 text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
                        <BarChart3 size={18} /> Current Status
                      </h3>
                      <div className="grid grid-cols-2 gap-3 text-center">
                        <div>
                          <p className="text-xs text-gray-500 dark:text-slate-400">Total Paid</p>
                          <p className="font-bold text-green-600">
                            {KES(receiptSummary.total_paid)}
                          </p>
                          {waiverAmountDue > 0.01 && (
                            <p className="text-[10px] text-gray-500 dark:text-slate-400 leading-tight mt-0.5">
                              {KES(cashAmountDuePaid)} cash + {KES(waiverAmountDue)} waived
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 dark:text-slate-400">Remaining</p>
                          <p className="font-bold text-orange-600">
                            {KES(receiptSummary.remaining_balance)}
                          </p>
                        </div>
                      </div>
                      {receiptSummary.next_payment_date &&
                        !receiptSummary.is_fully_paid && (
                          <div className="mt-3 pt-3 border-t border-[var(--brand)]/30 text-center">
                            <p className="text-xs text-gray-500 dark:text-slate-400 inline-flex items-center gap-1 justify-center">
                              <Calendar size={12} /> Next Payment
                            </p>
                            <p className="font-bold text-lg text-ocean-600">
                              {KES(receiptSummary.next_payment_amount)}
                            </p>
                            <p className="text-xs text-ocean-600">
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

          {tab === "waivers" && (
            <div className="p-4">
              {/* Header summary: counts + per-bucket totals. The
                  three buckets come straight from the backend
                  (waivers_summary.total_interest + total_penalty +
                  total_principal) so the totals are admin-declared,
                  not ratio-derived. */}
              <div className="rounded-xl bg-fuchsia-50 border border-fuchsia-100 p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <HandHeart size={16} className="text-fuchsia-600" />
                  <p className="font-semibold text-fuchsia-800">
                    Goodwill from your lender
                  </p>
                </div>
                <p className="text-xs text-fuchsia-700/80 mb-2">
                  These are amounts your lender chose not to collect.
                  They've already been applied to your balance — no
                  further action needed.
                </p>
                {/* Each bucket shows what was contracted (the
                    denominator), what's been waived, and the % of
                    the contract the waiver represents. The penalty
                    bucket uses penaltyAccrued (sum of every row's
                    historical penalty_total) as its denominator —
                    that's the total penalty bill that ever existed
                    on this loan. */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white/70 rounded-lg p-2">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">
                      Interest waived
                    </p>
                    <p className="font-bold text-fuchsia-700 text-sm">
                      {KES(waiversSummary.total_interest)}
                    </p>
                    {contractedInterest > 0 && (
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        of {KES(contractedInterest)}{" "}
                        <span className="font-semibold text-fuchsia-700">
                          {pct(waiversSummary.total_interest, contractedInterest)}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="bg-white/70 rounded-lg p-2">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">
                      Penalty waived
                    </p>
                    <p className="font-bold text-rose-700 text-sm">
                      {KES(waiversSummary.total_penalty)}
                    </p>
                    {penaltyAccrued > 0 && (
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        of {KES(penaltyAccrued)}{" "}
                        <span className="font-semibold text-rose-700">
                          {pct(waiversSummary.total_penalty, penaltyAccrued)}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="bg-white/70 rounded-lg p-2">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">
                      Principal waived
                    </p>
                    <p className="font-bold text-[var(--brand)] text-sm">
                      {KES(waiversSummary.total_principal)}
                    </p>
                    {contractedPrincipal > 0 && (
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        of {KES(contractedPrincipal)}{" "}
                        <span className="font-semibold text-[var(--brand)]">
                          {pct(waiversSummary.total_principal, contractedPrincipal)}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* One card per approved waiver. type + reason come
                  from the staff side; the per-row breakdown of which
                  installments were touched comes from allocation. */}
              <div className="space-y-2">
                {waivers.map((w) => {
                  const a = w.allocation || {};
                  const intT = parseFloat(a.interest_total || 0);
                  const penT = parseFloat(a.penalty_total || 0);
                  const prnT = parseFloat(a.principal_total || 0);
                  const rowsTouched = (a.schedules || []).length;
                  const tone =
                    w.type === "penalty"
                      ? "border-rose-200 bg-rose-50/50"
                      : w.type === "principal"
                        ? "border-[var(--brand)]/30 bg-[var(--brand)]/5"
                        : "border-fuchsia-200 bg-fuchsia-50/50";
                  // Pill shows the bucket value and (when a
                  // contract denominator is supplied) the % it
                  // represents — gives the borrower instant
                  // context on whether a 1k waiver was small
                  // potatoes or a near-full forgiveness.
                  const Pill = ({ label, value, denom, klass }) =>
                    value > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${klass}`}
                      >
                        {label} {KES(value)}
                        {denom > 0 && (
                          <span className="opacity-70 font-normal">
                            {" "}· {pct(value, denom)}
                          </span>
                        )}
                      </span>
                    );
                  return (
                    <div
                      key={w.id}
                      className={`rounded-xl border p-3 ${tone}`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-gray-800 capitalize inline-flex items-center gap-1.5">
                            <HandHeart size={14} className="shrink-0" />
                            {w.type} waiver
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {day(w.approved_at || w.created_at)}
                            {rowsTouched > 0 && (
                              <>
                                {" · "}
                                {rowsTouched} installment
                                {rowsTouched !== 1 ? "s" : ""} affected
                              </>
                            )}
                          </p>
                        </div>
                        <p className="font-bold text-fuchsia-700 shrink-0">
                          {KES(w.amount)}
                        </p>
                      </div>
                      {(intT > 0 || penT > 0 || prnT > 0) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Pill
                            label="Interest"
                            value={intT}
                            denom={contractedInterest}
                            klass="bg-fuchsia-100 text-fuchsia-700"
                          />
                          <Pill
                            label="Penalty"
                            value={penT}
                            denom={penaltyAccrued}
                            klass="bg-rose-100 text-rose-700"
                          />
                          <Pill
                            label="Principal"
                            value={prnT}
                            denom={contractedPrincipal}
                            klass="bg-[var(--brand)]/10 text-[var(--brand)]"
                          />
                        </div>
                      )}
                      {w.reason && (
                        <p className="mt-2 text-xs text-gray-600 italic border-t border-[#e5ddcd]/60 pt-2">
                          “{w.reason}”
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
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
