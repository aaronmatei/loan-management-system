import React, { useState, useEffect } from "react";
import { Percent, CheckCircle, SlidersHorizontal } from "lucide-react";
import api from "../services/api";
import LoanPackagesSection from "../components/LoanPackagesSection";
import PageHeader from "../components/PageHeader";
import Skeleton, { SkeletonText } from "../components/Skeleton";
import { formatKES } from "../utils/money";

// Loan-only configuration: tenant-wide policy (default rate + fee)
// and the catalog of pre-configured loan packages. Lives under the
// LOANS sidebar group so it sits next to the workflow it controls
// — separated from /settings which is for company / payment details.
function LoanSettings() {
  const [loanPolicy, setLoanPolicy] = useState({
    default_interest_rate: "", // annual %
    monthly_interest_rate: "", // annual / 12 — display companion, two-way synced
    processing_fee_rate: "",
    penalty_rate: "", // % per month charged on the overdue balance
  });
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySuccess, setPolicySuccess] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/settings/loan-policy");
        const d = r.data.data || {};
        const annual = d.default_interest_rate ?? "";
        setLoanPolicy({
          default_interest_rate: annual,
          monthly_interest_rate: annual === "" ? "" : roundRate(annual / 12),
          processing_fee_rate: d.processing_fee_rate ?? "",
          penalty_rate: d.penalty_rate ?? "",
        });
      } catch (err) {
        console.error("Failed to fetch loan policy:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Keep annual ⇄ monthly in sync. Whichever field the admin types is kept
  // exactly; the other is derived (annual = monthly × 12). Round the derived
  // value for display, trimming trailing zeros.
  const roundRate = (n) => Math.round(n * 10000) / 10000;
  const onAnnualRateChange = (v) =>
    setLoanPolicy((p) => ({
      ...p,
      default_interest_rate: v,
      monthly_interest_rate: v === "" ? "" : roundRate(parseFloat(v) / 12),
    }));
  const onMonthlyRateChange = (v) =>
    setLoanPolicy((p) => ({
      ...p,
      monthly_interest_rate: v,
      default_interest_rate: v === "" ? "" : roundRate(parseFloat(v) * 12),
    }));

  const handleSavePolicy = async (e) => {
    e.preventDefault();
    setSavingPolicy(true);
    try {
      await api.put("/settings/loan-policy", {
        default_interest_rate:
          parseFloat(loanPolicy.default_interest_rate) || 0,
        processing_fee_rate:
          parseFloat(loanPolicy.processing_fee_rate) || 0,
        penalty_rate: parseFloat(loanPolicy.penalty_rate) || 0,
      });
      setPolicySuccess("Loan policy saved successfully!");
      setTimeout(() => setPolicySuccess(""), 3000);
    } catch (err) {
      alert("Failed to save: " + (err.response?.data?.error || err.message));
    } finally {
      setSavingPolicy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-6xl mx-auto">
        <PageHeader
          icon={SlidersHorizontal}
          title="Loan Settings"
          subtitle="Defaults applied to every new loan, plus the catalog of pre-configured loan products you offer."
        />
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6">
          <Skeleton className="h-6 w-40 mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      <PageHeader
        icon={SlidersHorizontal}
        title="Loan Settings"
        subtitle="Defaults applied to every new loan, plus the catalog of pre-configured loan products you offer."
      />

      {policySuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
          {policySuccess}
        </div>
      )}

      <form onSubmit={handleSavePolicy} className="space-y-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100 mb-1 flex items-center gap-2">
            <Percent size={22} /> Loan Policy
          </h2>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
            Applied to every new loan and shown to customers when they
            apply. The processing fee is deducted from the amount the
            borrower receives — they still repay the full principal
            plus interest.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                Annual Interest Rate (%)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={loanPolicy.default_interest_rate}
                  onChange={(e) => onAnnualRateChange(e.target.value)}
                  className="w-full px-3 py-2 pr-9 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400">
                  %
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Charged per year (e.g. 50 = 50% p.a.).
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                Monthly Interest Rate (%)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={loanPolicy.monthly_interest_rate}
                  onChange={(e) => onMonthlyRateChange(e.target.value)}
                  className="w-full px-3 py-2 pr-9 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400">
                  %
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Syncs with annual (annual ÷ 12). Edit either one.
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                Processing Fee Rate (%)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={loanPolicy.processing_fee_rate}
                  onChange={(e) =>
                    setLoanPolicy({
                      ...loanPolicy,
                      processing_fee_rate: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 pr-9 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400">
                  %
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Deducted upfront from the disbursed amount (0 = none).
              </p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">
                Penalty Rate (% p.m.)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={loanPolicy.penalty_rate}
                  onChange={(e) =>
                    setLoanPolicy({
                      ...loanPolicy,
                      penalty_rate: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 pr-9 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-ocean-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-400">
                  %
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Charged monthly on the overdue balance (0 = none).
              </p>
            </div>
          </div>

          {/* Worked example for the current rates */}
          {parseFloat(loanPolicy.processing_fee_rate) > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              Example: on a {formatKES(10000)} loan, a{" "}
              {parseFloat(loanPolicy.processing_fee_rate)}% processing fee
              ={" "}
              {formatKES(
                (10000 * parseFloat(loanPolicy.processing_fee_rate)) / 100,
              )}
              . The borrower receives{" "}
              {formatKES(
                10000 -
                  (10000 * parseFloat(loanPolicy.processing_fee_rate)) / 100,
              )}{" "}
              and repays the full {formatKES(10000)} plus interest.
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={savingPolicy}
          className="px-6 py-3 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50"
        >
          {savingPolicy ? (
            "Saving..."
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle size={16} /> Save Loan Policy
            </span>
          )}
        </button>
      </form>

      <div className="mt-6">
        <LoanPackagesSection />
      </div>
    </div>
  );
}

export default LoanSettings;
