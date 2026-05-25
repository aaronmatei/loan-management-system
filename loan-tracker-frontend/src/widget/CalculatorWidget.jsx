import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Coins, BarChart3, Lightbulb, Phone } from "lucide-react";

// Public, no auth. Designed to be iframed onto third-party sites.
function CalculatorWidget() {
  const { subdomain } = useParams();
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [amount, setAmount] = useState(50000);
  const [duration, setDuration] = useState(6);
  const [calculated, setCalculated] = useState(null);

  const apiUrl =
    import.meta.env.VITE_API_URL || "http://localhost:3000/api";

  const track = (event, data = {}) => {
    fetch(`${apiUrl}/widget/track/${subdomain}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data }),
    }).catch(() => {});
  };

  useEffect(() => {
    fetch(`${apiUrl}/widget/calculator/${subdomain}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to load");
        return data.data;
      })
      .then((d) => {
        setTenant(d);
        track("widget_loaded");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain]);

  const calculate = () => {
    if (!amount || !duration) return;
    const principal = parseFloat(amount);
    const months = parseInt(duration, 10);
    const annualRate = parseFloat(tenant?.default_interest_rate || 50);
    const monthlyRate = annualRate / 12 / 100;
    const totalInterest = principal * monthlyRate * months;
    const totalAmountDue = principal + totalInterest;
    setCalculated({
      principal,
      months,
      annualRate,
      totalInterest,
      totalAmountDue,
      monthlyPayment: totalAmountDue / months,
    });
    track("calculation_performed", { amount: principal, months });
  };

  const applyNow = () => {
    // Where to send the lead. For dev the SPA lives at the parent
    // frontend; in production it's the host (or tenant's custom
    // domain if set).
    const base = tenant?.custom_domain
      ? `https://${tenant.custom_domain}`
      : import.meta.env.VITE_FRONTEND_URL || window.location.origin;
    const params = new URLSearchParams({
      amount: String(amount),
      duration: String(duration),
      source: "widget",
    });
    // Dev: hint portalApi to the right tenant via the same key it uses.
    if (base.includes("localhost")) {
      try {
        localStorage.setItem("dev_tenant_subdomain", subdomain);
      } catch {
        /* ignore */
      }
    }
    track("apply_clicked", { amount, duration });
    const url = `${base}/loanfix/portal/register?${params}`;
    // If we're inside an iframe, open in new tab; otherwise navigate.
    if (window.parent !== window) window.open(url, "_blank");
    else window.location.href = url;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-3 text-gray-600">Loading…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-4">
        <div className="text-center">
          <AlertTriangle size={48} className="text-orange-400 mx-auto mb-3" />
          <p className="text-gray-700 font-semibold">Calculator unavailable</p>
          <p className="text-sm text-gray-500 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const brand = tenant?.brand_color || "#4F46E5";
  const KES = (v) =>
    `KES ${parseFloat(v || 0).toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })}`;

  return (
    <div className="min-h-screen bg-gray-50 p-4 flex items-center justify-center">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div
            className="p-5 text-white"
            style={{ background: `linear-gradient(135deg, ${brand}, ${brand}dd)` }}
          >
            <div className="flex items-center gap-3">
              {tenant.logo_url ? (
                <img
                  src={tenant.logo_url}
                  alt={tenant.business_name}
                  className="w-12 h-12 rounded-lg bg-white p-1 object-contain"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center text-2xl font-bold">
                  {tenant.business_name?.charAt(0)}
                </div>
              )}
              <div>
                <h2 className="font-bold text-lg flex items-center gap-2"><Coins size={18} /> Loan Calculator</h2>
                <p className="text-sm opacity-90">{tenant.business_name}</p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Loan Amount (KES)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={tenant.min_amount}
                max={tenant.max_amount}
                placeholder="50,000"
                className="w-full px-4 py-3 border-2 rounded-lg focus:outline-none text-2xl font-bold text-gray-800"
                style={{ borderColor: amount ? brand : "#e5e7eb" }}
              />
              <p className="text-xs text-gray-500 mt-1">
                Min: KES {parseInt(tenant.min_amount, 10).toLocaleString()} ·
                Max: KES {parseInt(tenant.max_amount, 10).toLocaleString()}
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Repayment Period
              </label>
              <div className="grid grid-cols-6 gap-1">
                {[1, 3, 6, 12, 18, 24].map((m) => (
                  <button
                    key={m}
                    onClick={() => setDuration(m)}
                    className="py-2 rounded-lg font-semibold text-sm transition"
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
              disabled={
                !amount || parseFloat(amount) < parseInt(tenant.min_amount, 10)
              }
              className="w-full py-3 rounded-lg font-bold text-white shadow-md disabled:opacity-50 transition inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: brand }}
            >
              <BarChart3 size={16} /> Calculate
            </button>

            {calculated && (
              <div
                className="rounded-xl p-4 border-2"
                style={{ borderColor: brand, backgroundColor: `${brand}10` }}
              >
                <h3 className="font-bold text-gray-800 mb-3 text-center">
                  Your Loan Summary
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-1 border-b border-gray-200">
                    <span className="text-gray-600">Principal</span>
                    <span className="font-bold">
                      {KES(calculated.principal)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-200">
                    <span className="text-gray-600">Interest Rate</span>
                    <span className="font-bold">
                      {calculated.annualRate}% p.a.
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-200">
                    <span className="text-gray-600">Total Interest</span>
                    <span className="font-bold text-orange-600">
                      {KES(calculated.totalInterest)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-gray-200">
                    <span className="text-gray-600">Total Repayable</span>
                    <span className="font-bold">
                      {KES(calculated.totalAmountDue)}
                    </span>
                  </div>
                  <div
                    className="flex justify-between py-2 mt-2 rounded-lg px-2"
                    style={{ backgroundColor: brand }}
                  >
                    <span className="text-white font-semibold">
                      Monthly Payment
                    </span>
                    <span className="text-white font-bold text-lg">
                      {KES(calculated.monthlyPayment)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={applyNow}
                  className="w-full mt-4 py-3 bg-white rounded-lg font-bold shadow-md border-2 hover:shadow-lg transition"
                  style={{ borderColor: brand, color: brand }}
                >
                  Apply for This Loan →
                </button>
                <p className="text-xs text-center text-gray-500 mt-3 inline-flex items-center gap-1">
                  <Lightbulb size={12} className="text-ocean-500" /> Final terms will be confirmed by {tenant.business_name}
                </p>
              </div>
            )}
          </div>

          <div className="px-5 py-3 bg-gray-50 border-t flex justify-between items-center text-xs">
            <div className="flex items-center gap-2">
              {tenant.support_phone && (
                <a
                  href={`tel:${tenant.support_phone}`}
                  className="text-gray-600 hover:underline inline-flex items-center gap-1"
                >
                  <Phone size={12} /> Contact
                </a>
              )}
            </div>
            {!tenant.hide_platform_branding && (
              <span className="text-gray-400">
                Powered by <strong>LoanFix</strong>
              </span>
            )}
          </div>
        </div>

        {window.parent === window && tenant.physical_address && (
          <div className="mt-4 text-center text-xs text-gray-500">
            {tenant.business_name} · {tenant.physical_address}
            {tenant.city ? `, ${tenant.city}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

export default CalculatorWidget;
