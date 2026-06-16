import React, { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo";
import { Gift, Building2, User, Lock, Phone, Rocket, Eye, EyeOff } from "lucide-react";
import api from "../services/api";

function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref");
  const [submitting, setSubmitting] = useState(false);
  const [subdomainStatus, setSubdomainStatus] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Populated by /api/referrals/validate/:code — null until we know
  // the code is real. Render-gates the "Referred by X" banner.
  const [referralInfo, setReferralInfo] = useState(null);

  const [formData, setFormData] = useState({
    business_name: "",
    business_type: "microfinance",
    subdomain: "",
    first_name: "",
    last_name: "",
    contact_email: "",
    contact_phone: "",
    admin_password: "",
    confirm_password: "",
    physical_address: "",
    city: "",
    county: "",
    agree_terms: false,
    referral_code: refCode || "",
  });

  // Resolve ?ref= against the public validator. Silently no-ops on
  // miss — invalid codes just don't surface a banner.
  useEffect(() => {
    if (!refCode) return;
    api
      .get(`/referrals/validate/${refCode}`)
      .then((r) => {
        if (r.data?.valid) setReferralInfo(r.data);
      })
      .catch(() => {});
  }, [refCode]);

  useEffect(() => {
    if (formData.subdomain.length < 3) {
      setSubdomainStatus(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setSubdomainStatus("checking");
        const res = await api.get(
          `/tenants/check-subdomain/${formData.subdomain.toLowerCase()}`,
        );
        setSubdomainStatus(res.data.available ? "available" : "taken");
      } catch {
        setSubdomainStatus(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.subdomain]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.admin_password !== formData.confirm_password) {
      alert("Passwords do not match");
      return;
    }
    if (!formData.agree_terms) {
      alert("Please agree to the terms of service");
      return;
    }
    setSubmitting(true);
    try {
      // Backend /signup takes a single contact_name and splits it into
      // first/last — rebuild it from the two fields.
      const payload = {
        ...formData,
        contact_name: `${formData.first_name} ${formData.last_name}`.trim(),
      };
      const res = await api.post("/tenants/signup", payload);
      localStorage.setItem("token", res.data.token);
      localStorage.setItem(
        "user",
        JSON.stringify({ ...res.data.user, tenant: res.data.tenant }),
      );
      alert(
        `Welcome to ${formData.business_name}! Your 14-day trial has started.`,
      );
      // Hard navigation so App.jsx re-reads localStorage and the
      // authed branch (which holds /onboarding) renders. navigate()
      // alone would still see user=null in the AuthContext state.
      window.location.href = "/onboarding";
    } catch (err) {
      alert(
        "Signup failed: " + (err.response?.data?.error || err.message),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const set = (k) => (e) =>
    setFormData({
      ...formData,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    });

  return (
    <div
      className="min-h-screen bg-ocean-gradient bg-cover bg-center bg-no-repeat py-8 px-4"
      style={{ backgroundImage: "url('/lenderfest_hero_login_background.svg')" }}
    >
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center rounded-2xl bg-navy-gradient px-6 py-3 shadow-lg">
            <Logo
              variant="reversed"
              markClassName="h-11 w-11"
              textClassName="text-4xl"
            />
          </div>
          <p className="text-white/90 mt-2">
            Loan Management System for Kenyan Lenders
          </p>
        </div>

        {referralInfo && (
          <div className="bg-ocean-gradient text-white p-3 rounded-lg text-center text-sm mb-4 shadow-lg flex items-center justify-center gap-2">
            <Gift size={16} /> Referred by <strong>{referralInfo.referrer_name}</strong>!
            {referralInfo.bonus ? (
              <>
                {" "}You'll get <strong>{referralInfo.bonus}</strong>.
              </>
            ) : (
              <> Welcome to LenderFest.</>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8">
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-800 mb-2">
            Start Your 14-Day Free Trial
          </h2>
          <p className="text-gray-600 mb-6">
            No credit card required • Cancel anytime
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Building2 size={20} /> Business Information
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    Business Name *
                  </label>
                  <input
                    type="text"
                    value={formData.business_name}
                    onChange={set("business_name")}
                    required
                    placeholder="e.g., ABC Lenders Ltd"
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      Business Type *
                    </label>
                    <select
                      value={formData.business_type}
                      onChange={set("business_type")}
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none bg-white"
                    >
                      <option value="microfinance">Microfinance</option>
                      <option value="sacco">SACCO</option>
                      <option value="chama">Chama</option>
                      <option value="individual">Individual Lender</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      Your Subdomain *
                    </label>
                    <div className="flex items-center">
                      <input
                        type="text"
                        value={formData.subdomain}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            subdomain: e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9-]/g, ""),
                          })
                        }
                        required
                        placeholder="abclenders"
                        className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-l-lg focus:border-ocean-500 focus:outline-none"
                      />
                      <span className="px-3 py-2 bg-gray-100 border-2 border-l-0 border-gray-200 rounded-r-lg text-sm text-gray-600">
                        .lenderfest.loans
                      </span>
                    </div>
                    {subdomainStatus === "checking" && (
                      <p className="text-xs text-gray-500 mt-1">
                        Checking availability...
                      </p>
                    )}
                    {subdomainStatus === "available" && (
                      <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                        Available!
                      </p>
                    )}
                    {subdomainStatus === "taken" && (
                      <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                        Already taken
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <User size={20} /> Admin Account
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      First Name *
                    </label>
                    <input
                      type="text"
                      value={formData.first_name}
                      onChange={set("first_name")}
                      required
                      placeholder={(formData.subdomain || "yourcompany").replace(
                        /^./,
                        (c) => c.toUpperCase(),
                      )}
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      Last Name *
                    </label>
                    <input
                      type="text"
                      value={formData.last_name}
                      onChange={set("last_name")}
                      required
                      placeholder="Admin"
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={formData.contact_email}
                      onChange={set("contact_email")}
                      required
                      placeholder={`${formData.subdomain || "yourcompany"}@admin.com`}
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      Phone *
                    </label>
                    <input
                      type="tel"
                      value={formData.contact_phone}
                      onChange={set("contact_phone")}
                      required
                      placeholder="+254712345678"
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={formData.admin_password}
                        onChange={set("admin_password")}
                        required
                        minLength="12"
                        placeholder="Min 12 chars, 1 upper, 1 number, 1 symbol"
                        className="w-full px-3 py-2 pr-10 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">
                      Confirm Password *
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirm ? "text" : "password"}
                        value={formData.confirm_password}
                        onChange={set("confirm_password")}
                        required
                        className="w-full px-3 py-2 pr-10 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((s) => !s)}
                        aria-label={showConfirm ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                      >
                        {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.agree_terms}
                  onChange={set("agree_terms")}
                  className="mt-1"
                />
                <span className="text-sm text-gray-700">
                  I agree to the{" "}
                  <a href="#" className="text-ocean-600 underline">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#" className="text-ocean-600 underline">
                    Privacy Policy
                  </a>
                  . After my 14-day trial, I'll be charged 5% of monthly
                  interest earned.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || subdomainStatus !== "available"}
              className="w-full py-3 bg-ocean-gradient text-white font-bold rounded-lg hover:shadow-lg transition disabled:opacity-50 text-lg"
            >
              {submitting
                ? "Creating your account..."
                : <span className="inline-flex items-center gap-2"><Rocket size={18} /> Start Free Trial</span>}
            </button>

            <p className="text-center text-gray-600 text-sm">
              Already have an account?{" "}
              <Link to="/login" className="text-ocean-600 font-semibold">
                Sign In
              </Link>
            </p>
          </form>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4 text-center text-white">
          <div>
            <Lock size={28} className="mx-auto" />
            <p className="text-xs mt-1">Bank-grade Security</p>
          </div>
          <div>
            <Rocket size={28} className="mx-auto" />
            <p className="text-xs mt-1">Setup in 5 minutes</p>
          </div>
          <div>
            <Phone size={28} className="mx-auto" />
            <p className="text-xs mt-1">24/7 Support</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Signup;
