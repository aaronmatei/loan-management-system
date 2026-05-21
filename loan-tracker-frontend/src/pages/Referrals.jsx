import React, { useState, useEffect } from "react";
import api from "../services/api";

// Refer & Earn dashboard. Every tenant has a deterministic referral
// code stamped at signup (routes/tenants.js) and a credit balance
// that redeems against future platform-fee invoices
// (billingService.generateInvoice).
function Referrals() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await api.get("/referrals/me");
      setData(res.data.data);
    } catch (err) {
      console.error("Failed to load referrals:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading…</div>;
  }
  if (!data) return null;

  // Prefer an explicit VITE_FRONTEND_URL when the platform domain is
  // different from where the staff dashboard is hosted; otherwise the
  // browser's origin is the correct share target.
  const baseUrl =
    import.meta.env.VITE_FRONTEND_URL || window.location.origin;
  const referralLink = `${baseUrl}/signup?ref=${data.referral_code || ""}`;

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    const text = `Hey! I use LoanFix to manage my lending business and it's amazing. Sign up with my link: ${referralLink}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
    );
  };

  const credits = data.credits || 0;

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">
            🎁 Refer & Earn
          </h1>
          <p className="text-gray-600 mt-1">
            Refer other lenders and earn free months
          </p>
        </div>

        {/* Hero card with link + share */}
        <div className="bg-ocean-gradient text-white rounded-2xl shadow-xl p-6 lg:p-8 mb-6">
          <div className="text-center">
            <div className="text-5xl mb-3">🎁</div>
            <h2 className="text-2xl font-bold mb-2">
              Earn Rewards for Every Referral!
            </h2>
            <p className="text-ocean-100 mb-6">
              When a lender you refer becomes active, you earn a reward.
              Share your link and start earning.
            </p>

            <div className="bg-white/10 backdrop-blur rounded-xl p-4">
              <p className="text-xs text-ocean-200 uppercase mb-2">
                Your Referral Link
              </p>
              <div className="bg-white rounded-lg p-3 flex items-center gap-2">
                <span className="flex-1 text-gray-800 text-sm font-mono truncate text-left">
                  {referralLink}
                </span>
                <button
                  onClick={copyLink}
                  className="px-3 py-1 bg-ocean-600 text-white rounded text-sm font-semibold whitespace-nowrap"
                >
                  {copied ? "✅ Copied" : "📋 Copy"}
                </button>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={shareWhatsApp}
                  className="flex-1 py-2 bg-green-500 text-white rounded-lg font-semibold text-sm"
                >
                  💬 Share on WhatsApp
                </button>
              </div>
            </div>

            <p className="text-xs text-ocean-200 mt-4">
              Your code:{" "}
              <strong className="font-mono text-lg">
                {data.referral_code || "—"}
              </strong>
            </p>
          </div>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl shadow-md p-4 text-center">
            <p className="text-3xl font-bold text-ocean-600">
              {data.stats?.total_referrals ?? 0}
            </p>
            <p className="text-xs text-gray-500 uppercase">Total Referrals</p>
          </div>
          <div className="bg-white rounded-xl shadow-md p-4 text-center">
            <p className="text-3xl font-bold text-green-600">
              {data.stats?.qualified ?? 0}
            </p>
            <p className="text-xs text-gray-500 uppercase">Qualified</p>
          </div>
          <div className="bg-white rounded-xl shadow-md p-4 text-center">
            <p className="text-3xl font-bold text-orange-600">{credits}</p>
            <p className="text-xs text-gray-500 uppercase">Free Months</p>
          </div>
        </div>

        {/* Credit banner — only when redemption is pending */}
        {credits > 0 && (
          <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 mb-6 text-center">
            <p className="text-green-800">
              🎉 You have{" "}
              <strong>
                {credits} free month{credits > 1 ? "s" : ""}
              </strong>{" "}
              available! Your next invoice
              {credits > 1 ? "s" : ""} will be automatically waived.
            </p>
          </div>
        )}

        {/* How it works */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <h3 className="font-bold text-lg mb-4">How It Works</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto bg-ocean-100 text-ocean-600 rounded-full flex items-center justify-center text-xl font-bold mb-2">
                1
              </div>
              <p className="font-semibold text-sm">Share Your Link</p>
              <p className="text-xs text-gray-500">
                Send to other lenders via WhatsApp, SMS, or email
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto bg-ocean-100 text-ocean-600 rounded-full flex items-center justify-center text-xl font-bold mb-2">
                2
              </div>
              <p className="font-semibold text-sm">They Sign Up</p>
              <p className="text-xs text-gray-500">
                They create their LoanFix account using your link
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto bg-ocean-100 text-ocean-600 rounded-full flex items-center justify-center text-xl font-bold mb-2">
                3
              </div>
              <p className="font-semibold text-sm">You Earn</p>
              <p className="text-xs text-gray-500">
                Get 1 free month when they become active
              </p>
            </div>
          </div>
        </div>

        {/* Referral history */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="font-bold text-lg mb-4">Your Referrals</h3>
          {data.referrals.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-4xl mb-2">📭</p>
              <p>No referrals yet. Share your link to start earning!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.referrals.map((ref, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-semibold">
                      {ref.referred_business_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      Signed up{" "}
                      {new Date(ref.signed_up_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      ref.status === "qualified"
                        ? "bg-green-100 text-green-700"
                        : ref.status === "pending"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {ref.status === "qualified"
                      ? "✅ Earned"
                      : ref.status === "pending"
                        ? "⏳ Pending"
                        : ref.status}
                  </span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

export default Referrals;
