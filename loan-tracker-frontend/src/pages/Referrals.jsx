import React, { useState, useEffect } from "react";
import {
  Gift,
  Copy,
  CheckCircle,
  MessageSquare,
  PartyPopper,
  Clock,
  Mail,
} from "lucide-react";
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
  // Invite your CUSTOMERS to the borrower portal — anyone who signs up with
  // your link is automatically added to your client list.
  const referralLink = `${baseUrl}/loanfix/portal/register?ref=${data.referral_code || ""}`;

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    const text = `Apply for loans and manage your repayments online with us on LoanFix. Create your free account here: ${referralLink}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
    );
  };

  const credits = data.credits || 0;

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <Gift size={28} /> Refer &amp; Earn
          </h1>
          <p className="text-gray-600 mt-1">
            Refer other lenders and earn free months
          </p>
        </div>

        {/* Hero card with link + share */}
        <div className="bg-ocean-gradient text-white rounded-2xl shadow-xl p-6 lg:p-8 mb-6">
          <div className="text-center">
            <div className="flex justify-center mb-3"><Gift size={48} className="text-white" /></div>
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
                  className="inline-flex items-center gap-1 px-3 py-1 bg-ocean-600 text-white rounded text-sm font-semibold whitespace-nowrap"
                >
                  {copied ? <><CheckCircle size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={shareWhatsApp}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 bg-green-500 text-white rounded-lg font-semibold text-sm"
                >
                  <MessageSquare size={15} /> Share on WhatsApp
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
            <p className="text-green-800 flex items-center justify-center gap-2">
              <PartyPopper size={18} /> You have{" "}
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
                Send it to your customers via WhatsApp, SMS, or email
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto bg-ocean-100 text-ocean-600 rounded-full flex items-center justify-center text-xl font-bold mb-2">
                2
              </div>
              <p className="font-semibold text-sm">They Sign Up</p>
              <p className="text-xs text-gray-500">
                Your customer creates a free borrower account
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 mx-auto bg-ocean-100 text-ocean-600 rounded-full flex items-center justify-center text-xl font-bold mb-2">
                3
              </div>
              <p className="font-semibold text-sm">You Gain a Client</p>
              <p className="text-xs text-gray-500">
                They're linked to you automatically and ready to borrow
              </p>
            </div>
          </div>
        </div>

        {/* Referral history */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h3 className="font-bold text-lg mb-4">Your Referrals</h3>
          {data.referrals.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Mail size={40} className="mx-auto mb-2 text-gray-400" />
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
                      ? <span className="inline-flex items-center gap-1"><CheckCircle size={13} /> Earned</span>
                      : ref.status === "pending"
                        ? <span className="inline-flex items-center gap-1"><Clock size={13} /> Pending</span>
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
