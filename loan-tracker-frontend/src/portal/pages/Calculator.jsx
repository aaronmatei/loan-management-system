import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Calculator, Coins, BarChart3, Calendar, Lightbulb } from "lucide-react";
import portalApi from "../services/portalApi";
import PortalLayout from "../components/PortalLayout";
import Skeleton from "../../components/Skeleton";

const KES = (v) =>
  `KES ${parseFloat(v || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;

function CustomerCalculator() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tenants, setTenants] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState(params.get("amount") || 50000);
  const [duration, setDuration] = useState(
    parseInt(params.get("duration"), 10) || 6,
  );
  const [calc, setCalc] = useState(null);

  const currentTenant = (() => {
    try {
      return JSON.parse(localStorage.getItem("portal_current_tenant") || "{}");
    } catch {
      return {};
    }
  })();

  useEffect(() => {
    portalApi
      .get("/portal/customer/calculator-policies")
      .then((r) => {
        const list = r.data.data || [];
        setTenants(list);
        const pick =
          list.find((t) => t.tenant_id === currentTenant?.id) || list[0];
        setSelected(pick || null);
      })
      .catch((err) => {
        if (err.response?.data?.action === "select_tenant") {
          navigate("/portal/dashboard");
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calculate = () => {
    if (!amount || !duration || !selected) return;
    const principal = parseFloat(amount);
    const months = parseInt(duration, 10);
    const annualRate = parseFloat(selected.default_interest_rate);
    const monthlyRate = annualRate / 12 / 100;
    const totalInterest = principal * monthlyRate * months;
    const totalAmountDue = principal + totalInterest;
    const monthlyPayment = totalAmountDue / months;
    const today = new Date();
    const schedule = Array.from({ length: months }, (_, i) => {
      const d = new Date(today);
      d.setMonth(d.getMonth() + i + 1);
      return {
        payment_number: i + 1,
        due_date: d.toISOString().split("T")[0],
        amount: monthlyPayment,
      };
    });
    setCalc({
      principal,
      months,
      annualRate,
      totalInterest,
      totalAmountDue,
      monthlyPayment,
      schedule,
    });
  };

  const apply = async () => {
    // If they're calculating for a different tenant than currently
    // selected, switch session first so /portal/apply lands in the
    // right tenant.
    const goApply = () =>
      navigate(`/portal/apply?amount=${amount}&duration=${duration}`);
    if (selected && selected.tenant_id !== currentTenant?.id) {
      try {
        const r = await portalApi.post("/portal/auth/select-tenant", {
          tenant_id: selected.tenant_id,
        });
        localStorage.setItem("portal_token", r.data.token);
        localStorage.setItem(
          "portal_current_tenant",
          JSON.stringify(r.data.current_tenant),
        );
        goApply();
      } catch (err) {
        alert(err.response?.data?.error || "Failed to switch lender");
      }
    } else {
      goApply();
    }
  };

  if (loading) {
    return (
      <PortalLayout>
        <div className="p-4 lg:p-8 max-w-4xl mx-auto">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-4 w-80 mt-2 mb-6" />
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow overflow-hidden mb-6">
            <Skeleton className="h-24 w-full" rounded="rounded-none" />
            <div className="p-5 space-y-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-4 w-32 mt-2" />
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        </div>
      </PortalLayout>
    );
  }
  if (!selected) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-gray-500 dark:text-slate-400">
          No lender available.
        </div>
      </PortalLayout>
    );
  }

  const brand = selected.brand_color || "#0e8a6e";
  const min = parseInt(selected.min_amount, 10);
  const max = parseInt(selected.max_amount, 10);

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto" style={{ "--brand": brand }}>
        <h1 className="text-2xl lg:text-3xl font-bold text-navy-900 dark:text-slate-100 flex items-center gap-2">
          <Calculator size={28} className="text-navy-900 dark:text-slate-100" /> Loan Calculator
        </h1>
        <p className="text-gray-600 dark:text-slate-400 mt-1 mb-6">
          Estimate your loan payments before applying
        </p>

        {tenants.length > 1 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 mb-4">
            <label
              htmlFor="lender-select"
              className="block text-sm font-semibold mb-2 dark:text-slate-200"
            >
              Calculate for which lender?
            </label>
            <select
              id="lender-select"
              value={selected.tenant_id}
              onChange={(e) => {
                const t = tenants.find(
                  (x) => String(x.tenant_id) === e.target.value,
                );
                if (t) {
                  setSelected(t);
                  setCalc(null);
                }
              }}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100 focus:border-[var(--brand)] focus:outline-none font-semibold"
            >
              {tenants.map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.business_name} —{" "}
                  {+(parseFloat(t.default_interest_rate) / 12).toFixed(2)}% p.m.
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow overflow-hidden mb-6">
          <div
            className="p-5 text-white"
            style={{
              background: `linear-gradient(135deg, ${brand}, ${brand}dd)`,
            }}
          >
            <div className="flex items-center gap-3">
              {selected.logo_url ? (
                <img
                  src={selected.logo_url}
                  alt={selected.business_name}
                  className="w-12 h-12 rounded-lg bg-white p-1 object-contain"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center text-2xl font-bold">
                  {selected.business_name?.charAt(0)}
                </div>
              )}
              <div>
                <h2 className="font-bold text-lg flex items-center gap-1.5"><Coins size={20} /> Loan Calculator</h2>
                <p className="text-sm opacity-90">{selected.business_name}</p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">
                Loan Amount (KES)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setCalc(null);
                }}
                min={min}
                max={max}
                step="1000"
                className="w-full px-4 py-3 border-2 rounded-lg focus:outline-none text-3xl font-bold text-navy-900 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
                style={{ borderColor: amount ? brand : "#e5e7eb" }}
              />
              <input
                type="range"
                min={min}
                max={max}
                step="1000"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setCalc(null);
                }}
                className="w-full mt-2"
                style={{ accentColor: brand }}
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400 mt-1">
                <span>KES {min.toLocaleString()}</span>
                <span>KES {max.toLocaleString()}</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">
                Repayment Period
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[1, 3, 6, 12, 18, 24].map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setDuration(m);
                      setCalc(null);
                    }}
                    className="py-3 rounded-lg font-semibold text-sm transition"
                    style={{
                      backgroundColor: duration === m ? brand : "#f3f4f6",
                      color: duration === m ? "#fff" : "#374151",
                    }}
                  >
                    {m}mo
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={calculate}
              disabled={!amount || parseFloat(amount) < min}
              className="w-full py-3 rounded-lg font-bold text-white shadow-md disabled:opacity-50 transition text-lg inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: brand }}
            >
              <BarChart3 size={20} /> Calculate
            </button>

            {calc && (
              <div className="space-y-4">
                <div
                  className="rounded-xl p-5 border-2"
                  style={{
                    borderColor: brand,
                    backgroundColor: `${brand}10`,
                  }}
                >
                  <h3 className="font-bold text-navy-900 dark:text-slate-100 mb-3 text-center text-lg">
                    Your Loan Summary
                  </h3>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500 dark:text-slate-400">Principal</p>
                      <p className="font-bold text-lg dark:text-slate-100">{KES(calc.principal)}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500 dark:text-slate-400">Duration</p>
                      <p className="font-bold text-lg dark:text-slate-100">{calc.months} months</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500 dark:text-slate-400">Interest Rate</p>
                      <p className="font-bold text-lg dark:text-slate-100">
                        {+(calc.annualRate / 12).toFixed(2)}% p.m.
                      </p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500 dark:text-slate-400">Total Interest</p>
                      <p className="font-bold text-lg text-orange-600">
                        {KES(calc.totalInterest)}
                      </p>
                    </div>
                  </div>
                  <div
                    className="rounded-lg p-4 text-center text-white"
                    style={{ backgroundColor: brand }}
                  >
                    <p className="text-sm opacity-90">Monthly Payment</p>
                    <p className="text-3xl font-bold">
                      {KES(calc.monthlyPayment)}
                    </p>
                    <p className="text-xs mt-1 opacity-90">
                      Total to repay: {KES(calc.totalAmountDue)}
                    </p>
                  </div>
                  <button
                    onClick={apply}
                    className="w-full mt-4 py-3 bg-white rounded-lg font-bold shadow-md border-2 hover:shadow-lg transition"
                    style={{ borderColor: brand, color: brand }}
                  >
                    Apply for This Loan →
                  </button>
                  <p className="text-xs text-center text-gray-500 dark:text-slate-400 mt-3 flex items-center justify-center gap-1">
                    <Lightbulb size={13} className="text-gray-400 dark:text-slate-400" /> Final terms will be confirmed by{" "}
                    {selected.business_name}
                  </p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                  <h3 className="font-bold text-navy-900 dark:text-slate-100 mb-3 flex items-center gap-1.5">
                    <Calendar size={18} /> Payment Schedule
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm dark:text-slate-200">
                      <thead className="bg-gray-50 dark:bg-slate-900">
                        <tr>
                          <th className="text-left p-2">#</th>
                          <th className="text-left p-2">Due Date</th>
                          <th className="text-right p-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calc.schedule.map((s) => (
                          <tr key={s.payment_number} className="border-b dark:border-slate-700">
                            <td className="p-2 font-semibold">
                              {s.payment_number}
                            </td>
                            <td className="p-2">
                              {new Date(s.due_date).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </td>
                            <td className="text-right p-2 font-bold">
                              {KES(s.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="font-bold bg-gray-50 dark:bg-slate-900">
                        <tr>
                          <td colSpan="2" className="p-2">
                            Total
                          </td>
                          <td className="text-right p-2">
                            {KES(calc.totalAmountDue)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {tenants.length > 1 && (
                  <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
                    <h3 className="font-bold text-navy-900 dark:text-slate-100 mb-1 flex items-center gap-1.5">
                      <BarChart3 size={18} /> Compare Lenders
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
                      Same loan at each lender. (Rates are placeholders
                      until per-tenant policy is configured.)
                    </p>
                    <div className="space-y-2">
                      {tenants.map((t) => {
                        const rate = parseFloat(t.default_interest_rate);
                        const totalI =
                          calc.principal * (rate / 100 / 12) * calc.months;
                        const total = calc.principal + totalI;
                        const monthly = total / calc.months;
                        const isSel = t.tenant_id === selected.tenant_id;
                        return (
                          <div
                            key={t.tenant_id}
                            className={`flex items-center justify-between p-2 rounded-lg ${
                              isSel
                                ? "bg-[var(--brand)]/10 border border-[var(--brand)]/30"
                                : "bg-gray-50 dark:bg-slate-900"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs"
                                style={{
                                  backgroundColor:
                                    t.brand_color || "#0e8a6e",
                                }}
                              >
                                {t.business_name?.charAt(0)}
                              </div>
                              <div>
                                <p className="font-semibold text-sm dark:text-slate-100">
                                  {t.business_name}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-slate-400">
                                  {+(rate / 12).toFixed(2)}% p.m.
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-sm dark:text-slate-100">
                                {KES(monthly)}/mo
                              </p>
                              <p className="text-xs text-gray-500 dark:text-slate-400">
                                Total: {KES(total)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-ocean-50 border border-ocean-200 rounded-xl p-4">
          <h3 className="font-bold text-ocean-900 mb-2 flex items-center gap-1.5"><Lightbulb size={18} /> Tips</h3>
          <ul className="text-sm text-ocean-800 space-y-1">
            <li>• Shorter periods = less total interest but higher monthly payments</li>
            <li>• Longer periods = more total interest but easier monthly payments</li>
            <li>• Final approval depends on your lender's review</li>
            <li>• Late payments may incur additional fees</li>
          </ul>
        </div>
      </div>
    </PortalLayout>
  );
}

export default CustomerCalculator;
