import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Landmark,
  Rocket,
  Gamepad2,
  Check,
  User,
  Users,
  Coins,
  Smartphone,
  BarChart3,
  CreditCard,
  Bell,
  Briefcase,
  Lock,
  TrendingUp,
  Lightbulb,
  Star,
} from "lucide-react";

// NOTE: the testimonials, stats numbers, contact email/phone, and
// /privacy /terms footer links below are MARKETING PLACEHOLDERS —
// replace with real copy/links before going to production.
function LandingHome() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  // "Try Live Demo" — POST /api/demo/start, persist the returned
  // token + flag the session, then hard-nav to the staff dashboard.
  // window.location.href instead of navigate() so AuthContext re-
  // initializes from the just-set localStorage (same pattern as the
  // customer portal register flow).
  const startDemo = async () => {
    setDemoLoading(true);
    try {
      const apiUrl =
        import.meta.env.VITE_API_URL || "http://localhost:3000/api";
      const res = await fetch(`${apiUrl}/demo/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || "Demo unavailable right now. Please try again.");
        setDemoLoading(false);
        return;
      }
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("is_demo_session", "true");
      localStorage.setItem("demo_session_token", data.session_token);
      window.location.href = "/";
    } catch (err) {
      alert("Could not start demo. Please try again.");
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* ============= NAVBAR ============= */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-ocean-gradient flex items-center justify-center shadow-md">
                <Landmark size={20} className="text-white" />
              </span>
              <span className="text-xl font-extrabold bg-ocean-gradient bg-clip-text text-transparent">
                LoanFix
              </span>
            </Link>

            <div className="hidden lg:flex items-center gap-6">
              <a href="#features" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">Features</a>
              <a href="#how-it-works" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">How It Works</a>
              <a href="#for-borrowers" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">For Borrowers</a>
              <a href="#pricing" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">Pricing</a>
              <a href="#faq" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">FAQ</a>
              <span className="h-5 w-px bg-slate-200" />
              <Link to="/loanfix/portal/login" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">Borrower Login</Link>
              <Link to="/login" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">Lender Login</Link>
              <Link
                to="/signup"
                className="px-4 py-2 bg-ocean-gradient text-white rounded-lg font-bold text-sm shadow-md hover:shadow-lg transition"
              >
                Start Free Trial
              </Link>
            </div>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2"
              aria-label="Open menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="lg:hidden mt-3 pb-3 border-t pt-3 space-y-1">
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">Features</a>
              <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">How It Works</a>
              <a href="#for-borrowers" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">For Borrowers</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">Pricing</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">FAQ</a>
              <div className="border-t my-2" />
              <Link to="/loanfix/portal/login" className="block px-3 py-2 hover:bg-slate-100 rounded">Borrower Login</Link>
              <Link to="/login" className="block px-3 py-2 hover:bg-slate-100 rounded">Lender Login</Link>
              <Link
                to="/signup"
                className="block px-3 py-2 bg-ocean-gradient text-white rounded-lg font-bold text-center"
              >
                Start Free Trial →
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* ============= HERO ============= */}
      <section className="relative overflow-hidden bg-gradient-to-br from-ocean-50 via-white to-ocean-100 py-16 lg:py-24">
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="pointer-events-none absolute -top-28 -left-24 w-[28rem] h-[28rem] rounded-full bg-ocean-300/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-20 w-[28rem] h-[28rem] rounded-full bg-pink-200/30 blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 px-4 py-1 bg-ocean-100 text-ocean-700 rounded-full text-sm font-semibold mb-4">
                <Rocket size={14} /> Built for Kenyan Lenders
              </div>
              <h1 className="text-4xl lg:text-6xl font-bold leading-tight text-gray-900 mb-6">
                Run Your{" "}
                <span className="bg-ocean-gradient bg-clip-text text-transparent">
                  Lending Business
                </span>{" "}
                Without the Spreadsheets
              </h1>
              <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                The cloud-based loan management system for microfinance, chamas,
                and individual lenders. Track loans, manage clients, and grow
                your portfolio — all in one place.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  to="/signup"
                  className="px-8 py-4 bg-ocean-gradient text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 text-center"
                >
                  Start Free Trial →
                </Link>
                <button
                  onClick={startDemo}
                  disabled={demoLoading}
                  className="px-8 py-4 bg-ocean-600 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 disabled:opacity-60"
                >
                  {demoLoading ? "Loading demo…" : <span className="inline-flex items-center gap-2"><Gamepad2 size={16} /> Try Live Demo</span>}
                </button>
                <a
                  href="#features"
                  className="px-8 py-4 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-bold text-lg hover:border-ocean-600 hover:text-ocean-600 transition text-center"
                >
                  See How It Works
                </a>
              </div>
              <div className="mt-6 flex items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-1">
                  <Check size={14} className="text-green-500" />
                  No credit card needed
                </div>
                <div className="flex items-center gap-1">
                  <Check size={14} className="text-green-500" />
                  Setup in 5 minutes
                </div>
              </div>
              <p className="mt-5 text-sm text-gray-600 border-t border-slate-200 pt-5 flex items-start gap-1.5">
                <User size={14} className="mt-0.5 shrink-0" /> Borrowing from a LoanFix lender?{" "}
                <Link
                  to="/loanfix/portal/register"
                  className="font-bold text-ocean-600 hover:text-ocean-700"
                >
                  Create a free account
                </Link>{" "}
                or{" "}
                <Link
                  to="/loanfix/portal/login"
                  className="font-bold text-ocean-600 hover:text-ocean-700"
                >
                  log in
                </Link>
                .
              </p>
            </div>

            {/* Hero mockup */}
            <div className="relative">
              <div className="relative bg-white rounded-2xl shadow-2xl p-6 transform rotate-2">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b">
                  <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                  <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                  <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                  <div className="ml-2 text-xs text-gray-500 font-mono">yourbusiness.loanfix.co.ke</div>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gradient-to-br from-ocean-500 to-ocean-600 text-white rounded-lg p-3">
                      <p className="text-xs opacity-80">Active Loans</p>
                      <p className="text-2xl font-bold">127</p>
                    </div>
                    <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-lg p-3">
                      <p className="text-xs opacity-80">Collected Today</p>
                      <p className="text-2xl font-bold">KES 84K</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="bg-gray-50 rounded p-2 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-semibold">LN-2026-145</p>
                        <p className="text-xs text-gray-500">Mary Akinyi</p>
                      </div>
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Active</span>
                    </div>
                    <div className="bg-gray-50 rounded p-2 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-semibold">LN-2026-144</p>
                        <p className="text-xs text-gray-500">Peter Kamau</p>
                      </div>
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">Due</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-4 -right-4 bg-yellow-300 rounded-full px-4 py-2 shadow-lg transform -rotate-12">
                <p className="text-sm font-bold">Made in Kenya</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============= STATS BAR (placeholder numbers — tune before launch) ============= */}
      <section className="bg-ocean-gradient text-white py-8">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
            <div>
              <p className="text-3xl lg:text-4xl font-bold">4+</p>
              <p className="text-ocean-100 text-sm">Active Lenders</p>
            </div>
            <div>
              <p className="text-3xl lg:text-4xl font-bold">1.2K+</p>
              <p className="text-ocean-100 text-sm">Borrowers Served</p>
            </div>
            <div>
              <p className="text-3xl lg:text-4xl font-bold">5M+</p>
              <p className="text-ocean-100 text-sm">KES Disbursed</p>
            </div>
            <div>
              <p className="text-3xl lg:text-4xl font-bold">99.9%</p>
              <p className="text-ocean-100 text-sm">Uptime</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============= FEATURES ============= */}
      <section id="features" className="py-16 lg:py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-5xl font-bold mb-4">
              Everything You Need to{" "}
              <span className="text-ocean-600">Manage Loans</span>
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Built specifically for African lenders. No more spreadsheets, lost
              records, or manual calculations.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: <Users size={28} className="text-white" />, title: "Client Management", description: "Store complete client profiles with KYC documents, business info, and loan history.", color: "from-blue-500 to-cyan-600" },
              { icon: <Coins size={28} className="text-white" />, title: "Loan Tracking", description: "Manage active loans, payment schedules, and automatic interest calculations.", color: "from-green-500 to-emerald-600" },
              { icon: <Smartphone size={28} className="text-white" />, title: "Client Portal", description: "Your borrowers get their own login to view loans and apply online — 24/7.", color: "from-ocean-400 to-pink-600" },
              { icon: <BarChart3 size={28} className="text-white" />, title: "Reports & Analytics", description: "Real-time insights into your portfolio. Export to Excel or PDF anytime.", color: "from-orange-500 to-red-600" },
              { icon: <CreditCard size={28} className="text-white" />, title: "M-Pesa Ready", description: "Built for the Kenyan market. Record M-Pesa payments instantly.", color: "from-yellow-500 to-orange-600" },
              { icon: <Bell size={28} className="text-white" />, title: "SMS Notifications", description: "Automatic SMS for payment reminders, loan approvals, and overdue alerts.", color: "from-ocean-500 to-ocean-600" },
              { icon: <Briefcase size={28} className="text-white" />, title: "Multi-User Roles", description: "Add staff with different permission levels. Track who did what.", color: "from-teal-500 to-cyan-600" },
              { icon: <Lock size={28} className="text-white" />, title: "Secure & Encrypted", description: "Bank-grade security. Your data is encrypted and backed up daily.", color: "from-rose-500 to-red-600" },
              { icon: <TrendingUp size={28} className="text-white" />, title: "Loan Applications", description: "Clients apply online. Review, approve, and disburse — all digital.", color: "from-pink-500 to-rose-600" },
            ].map((feature, idx) => (
              <div
                key={idx}
                className="bg-white rounded-2xl shadow-md hover:shadow-xl p-6 transition-all transform hover:-translate-y-1"
              >
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4`}>
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============= HOW IT WORKS ============= */}
      <section id="how-it-works" className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-5xl font-bold mb-4">
              Get Started in <span className="text-ocean-600">3 Easy Steps</span>
            </h2>
            <p className="text-xl text-gray-600">
              From signup to your first loan in less than 10 minutes
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {[
              { number: "1", title: "Sign Up Free", description: "Create your account and customize your business details. Your own subdomain in 60 seconds.", stepIcon: <Rocket size={40} className="text-ocean-500" /> },
              { number: "2", title: "Add Clients & Loans", description: "Import existing records or start fresh. Track loans, payments, and schedules.", stepIcon: <Users size={40} className="text-ocean-500" /> },
              { number: "3", title: "Grow Your Business", description: "Let customers apply online, manage your portfolio, and watch your business scale.", stepIcon: <TrendingUp size={40} className="text-ocean-500" /> },
            ].map((step, idx, arr) => (
              <div key={idx} className="relative">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto bg-ocean-gradient text-white rounded-full flex items-center justify-center text-3xl font-bold shadow-lg mb-4">
                    {step.number}
                  </div>
                  <div className="flex justify-center mb-3">{step.stepIcon}</div>
                  <h3 className="text-2xl font-bold mb-2">{step.title}</h3>
                  <p className="text-gray-600">{step.description}</p>
                </div>
                {idx < arr.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-full w-full">
                    <div className="border-t-2 border-dashed border-gray-300 -ml-8 mr-8"></div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link
              to="/signup"
              className="inline-block px-8 py-4 bg-ocean-gradient text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition"
            >
              Start Your Free Trial →
            </Link>
          </div>
        </div>
      </section>

      {/* ============= FOR BORROWERS ============= */}
      <section
        id="for-borrowers"
        className="py-16 lg:py-24 bg-navy-gradient text-white relative overflow-hidden"
      >
        <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-ocean-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-ocean-400/10 blur-3xl" />
        <div className="max-w-7xl mx-auto px-4 relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 px-4 py-1 bg-white/10 text-ocean-100 rounded-full text-sm font-semibold mb-4">
                <User size={14} /> For Borrowers
              </div>
              <h2 className="text-3xl lg:text-5xl font-bold mb-4 leading-tight">
                One free account for{" "}
                <span className="bg-gradient-to-r from-ocean-300 to-ocean-100 bg-clip-text text-transparent">
                  every lender
                </span>
              </h2>
              <p className="text-lg text-ocean-100/80 mb-6 leading-relaxed">
                Borrowing from a LoanFix lender? Create one account to apply for
                loans, track repayments, build your credit score, and manage all
                your lenders in a single place.
              </p>
              <ul className="grid sm:grid-cols-2 gap-3 mb-8">
                {[
                  "Apply for loans online, 24/7",
                  "One login for every lender",
                  "Track payments & schedules",
                  "Build your credit score",
                  "SMS & email updates",
                  "Upload your documents once",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-ocean-50">
                    <Check size={14} className="text-ocean-300 shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  to="/loanfix/portal/register"
                  className="px-7 py-3.5 bg-white text-navy-900 rounded-xl font-bold shadow-lg hover:shadow-xl transition transform hover:-translate-y-0.5 text-center"
                >
                  Create free account →
                </Link>
                <Link
                  to="/loanfix/portal/login"
                  className="px-7 py-3.5 bg-white/10 border border-white/20 text-white rounded-xl font-bold hover:bg-white/15 transition text-center"
                >
                  Borrower login
                </Link>
              </div>
            </div>

            {/* Borrower portal mockup */}
            <div className="relative">
              <div className="bg-white text-navy-900 rounded-2xl shadow-2xl p-6">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide">
                      My credit score
                    </p>
                    <p className="text-3xl font-extrabold text-ocean-600">742</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                    Good standing
                  </span>
                </div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                  My loans across lenders
                </p>
                <div className="space-y-2">
                  {[
                    { code: "LN-MFI-2026-031", lender: "Faulu Microfinance", tag: "Active", color: "bg-ocean-100 text-ocean-700" },
                    { code: "LN-SAC-2026-118", lender: "Unity SACCO", tag: "On track", color: "bg-emerald-100 text-emerald-700" },
                    { code: "LN-IND-2026-007", lender: "Jane (Individual)", tag: "Due soon", color: "bg-amber-100 text-amber-700" },
                  ].map((l) => (
                    <div
                      key={l.code}
                      className="bg-slate-50 rounded-lg p-2.5 flex justify-between items-center"
                    >
                      <div>
                        <p className="text-sm font-semibold">{l.code}</p>
                        <p className="text-xs text-slate-500">{l.lender}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${l.color}`}>
                        {l.tag}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="absolute -bottom-4 -left-4 bg-ocean-gradient text-white rounded-full px-4 py-2 shadow-lg text-sm font-bold inline-flex items-center gap-1.5">
                <Lock size={14} /> One secure login
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============= PRICING ============= */}
      <section id="pricing" className="py-16 lg:py-24 bg-gradient-to-br from-ocean-50 to-ocean-100">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-5xl font-bold mb-4">
              Simple, <span className="text-ocean-600">Performance-Based</span>{" "}
              Pricing
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              We only succeed when you do. Pay only when you earn.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <div className="bg-white rounded-2xl shadow-lg p-8 border-2 border-gray-200">
              <h3 className="text-2xl font-bold mb-2">Free Trial</h3>
              <p className="text-gray-500 mb-4">14 days</p>
              <p className="text-5xl font-bold mb-6">
                KES 0
                <span className="text-lg font-normal text-gray-500">/14 days</span>
              </p>
              <ul className="space-y-2 mb-6 text-sm">
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> Full platform access</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> Up to 50 clients</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> Client portal included</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> SMS notifications</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> Email support</li>
              </ul>
              <Link
                to="/signup"
                className="block w-full py-3 text-center border-2 border-ocean-600 text-ocean-600 rounded-lg font-bold hover:bg-ocean-50"
              >
                Start Free Trial
              </Link>
            </div>

            <div className="bg-ocean-gradient text-white rounded-2xl shadow-2xl p-8 transform lg:scale-105 relative">
              <div className="absolute top-0 right-4 -translate-y-1/2 bg-yellow-400 text-gray-900 px-4 py-1 rounded-full text-xs font-bold">
                MOST POPULAR
              </div>
              <h3 className="text-2xl font-bold mb-2">Pay-As-You-Grow</h3>
              <p className="text-ocean-100 mb-4">Everyone uses this</p>
              <p className="text-5xl font-bold mb-2">5%</p>
              <p className="text-ocean-100 text-sm mb-6">of interest earned monthly</p>
              <ul className="space-y-2 mb-6 text-sm">
                <li className="flex items-center gap-2"><Check size={16} className="shrink-0" />Everything in Free Trial</li>
                <li className="flex items-center gap-2"><Check size={16} className="shrink-0" />Unlimited clients</li>
                <li className="flex items-center gap-2"><Check size={16} className="shrink-0" />Unlimited loans</li>
                <li className="flex items-center gap-2"><Check size={16} className="shrink-0" />Custom branding</li>
                <li className="flex items-center gap-2"><Check size={16} className="shrink-0" />Priority support</li>
                <li className="flex items-center gap-2"><Check size={16} className="shrink-0" />All future features</li>
              </ul>
              <Link
                to="/signup"
                className="block w-full py-3 text-center bg-white text-ocean-600 rounded-lg font-bold hover:shadow-lg"
              >
                Start Free Trial
              </Link>
              <p className="text-xs text-ocean-200 text-center mt-3">
                Example: Earn KES 100K interest → Pay KES 5K
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-8 border-2 border-gray-200">
              <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
              <p className="text-gray-500 mb-4">For large operations</p>
              <p className="text-3xl font-bold mb-6">
                Custom
                <span className="text-lg font-normal text-gray-500"> pricing</span>
              </p>
              <ul className="space-y-2 mb-6 text-sm">
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> Everything in Pay-As-You-Grow</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> Custom integrations</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> Dedicated account manager</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> Custom features</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> SLA guarantee</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-green-500 shrink-0" /> White-label option</li>
              </ul>
              <a
                href="mailto:sales@loanfix.co.ke"
                className="block w-full py-3 text-center border-2 border-ocean-600 text-ocean-600 rounded-lg font-bold hover:bg-ocean-50"
              >
                Contact Sales
              </a>
            </div>
          </div>

          <div className="text-center mt-12">
            <p className="text-sm text-gray-600 inline-flex items-start gap-1.5 justify-center">
              <Lightbulb size={14} className="text-ocean-500 mt-0.5 shrink-0" /> <span><strong>Why 5%?</strong> We only earn when you earn interest. No
              upfront costs, no monthly minimums. If you don't have an active
              month, you don't pay.</span>
            </p>
          </div>
        </div>
      </section>

      {/* ============= TESTIMONIALS (placeholders) ============= */}
      <section className="py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-5xl font-bold mb-4">
              Loved by Kenyan Lenders
            </h2>
            <p className="text-xl text-gray-600">
              Real stories from real lenders using LoanFix
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {[
              { quote: "Before LoanFix, I tracked 200 loans in Excel. It took hours. Now I get reports in seconds and my customers love the portal.", author: "Sarah W.", business: "ABC Microfinance, Nairobi", rating: 5 },
              { quote: "The SMS notifications alone are worth it. Clients don't forget to pay anymore. My collection rate is up 30%.", author: "John K.", business: "Quick Loans Co, Mombasa", rating: 5 },
              { quote: "I run a chama with 50 members. LoanFix keeps everything transparent and my members can apply for emergency loans online.", author: "Mary A.", business: "Unity Chama, Kisumu", rating: 5 },
            ].map((t, idx) => (
              <div key={idx} className="bg-gradient-to-br from-white to-gray-50 rounded-2xl shadow-md p-6">
                <div className="flex gap-1 mb-3">
                  {[...Array(t.rating)].map((_, i) => (
                    <Star key={i} size={18} className="text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <p className="text-gray-700 mb-4 italic">"{t.quote}"</p>
                <div className="border-t pt-3">
                  <p className="font-bold">{t.author}</p>
                  <p className="text-sm text-gray-500">{t.business}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============= FAQ ============= */}
      <section id="faq" className="py-16 lg:py-24 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-5xl font-bold mb-4">
              Frequently Asked <span className="text-ocean-600">Questions</span>
            </h2>
          </div>

          <div className="space-y-3">
            {[
              { q: "Is my data safe?", a: "Yes! We use bank-grade encryption. Your data is backed up daily and stored in secure data centers. Only authorized staff at YOUR business can access YOUR data." },
              { q: "How does the 5% pricing work?", a: "At the end of each month, we calculate the interest you earned from loan repayments. You pay 5% of that interest as a platform fee. If you had a quiet month with no payments, you don't pay anything." },
              { q: "Can my customers really apply for loans online?", a: "Yes! Each tenant gets their own customer portal where borrowers can register, apply for new loans, track applications, and view their existing loans 24/7. It's a separate experience from your admin dashboard." },
              { q: "Do I need technical skills?", a: "Not at all. If you can use WhatsApp, you can use LoanFix. We provide free onboarding and training. Most lenders are up and running in less than an hour." },
              { q: "What if I want to leave?", a: "You can export all your data anytime in Excel or CSV format. No vendor lock-in. We're confident you'll love it, but your data is always yours." },
              { q: "Do you integrate with M-Pesa?", a: "Yes, you can record M-Pesa payments manually now. Direct M-Pesa STK Push integration is coming soon for tenants with a business paybill account." },
              { q: "Is there a setup fee?", a: "No. Sign up is free, the 14-day trial is free, and there are no setup fees. You only pay 5% of interest earned after your trial ends." },
            ].map((faq, idx) => (
              <FAQItem key={idx} {...faq} />
            ))}
          </div>
        </div>
      </section>

      {/* ============= FINAL CTA ============= */}
      <section className="py-16 lg:py-24 bg-gradient-to-br from-ocean-500 via-ocean-600 to-pink-600 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-10"></div>
        <div className="max-w-4xl mx-auto px-4 text-center relative">
          <h2 className="text-4xl lg:text-6xl font-bold mb-4">
            Ready to Transform Your Lending Business?
          </h2>
          <p className="text-xl lg:text-2xl text-ocean-100 mb-8">
            Join Kenyan lenders already growing with LoanFix
          </p>
          <Link
            to="/signup"
            className="inline-block px-10 py-5 bg-white text-ocean-700 rounded-xl font-bold text-xl shadow-xl hover:shadow-2xl transition transform hover:-translate-y-1"
          >
            Start Your Free Trial Today →
          </Link>
          <p className="mt-6 text-ocean-100 text-sm inline-flex items-center gap-2 justify-center">
            <Check size={13} /> 14 days free • <Check size={13} /> No credit card • <Check size={13} /> Setup in 5 minutes
          </p>
          <p className="mt-4 text-ocean-100 text-sm">
            Just here to manage your loans?{" "}
            <Link
              to="/loanfix/portal/register"
              className="underline font-semibold text-white hover:text-ocean-100"
            >
              Create a free borrower account
            </Link>
          </p>
        </div>
      </section>

      {/* ============= FOOTER (legal links are placeholders — /privacy /terms not built) ============= */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Landmark size={28} className="text-ocean-400" />
                <span className="text-xl font-bold text-white">LoanFix</span>
              </div>
              <p className="text-sm">
                Cloud-based loan management for African lenders. Built in Kenya,
                for Kenya.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white">Features</a></li>
                <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-white">How It Works</a></li>
                <li><Link to="/signup" className="hover:text-white">Become a Lender</Link></li>
                <li><Link to="/loanfix/portal/login" className="hover:text-white">Borrower Portal</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3">Support</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#faq" className="hover:text-white">FAQ</a></li>
                <li><a href="mailto:support@loanfix.co.ke" className="hover:text-white">Contact Support</a></li>
                <li><a href="tel:+254700000000" className="hover:text-white">+254 700 000 000</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/privacy" className="hover:text-white">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-white">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 flex flex-col lg:flex-row justify-between items-center text-sm">
            <p>© {new Date().getFullYear()} LoanFix. All rights reserved.</p>
            <p>Proudly built in Kenya</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-lg shadow-sm border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left p-4 flex justify-between items-center hover:bg-gray-50"
      >
        <span className="font-semibold text-lg">{q}</span>
        <span className={`text-2xl transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-gray-600 border-t pt-3">{a}</div>
      )}
    </div>
  );
}

export default LandingHome;
