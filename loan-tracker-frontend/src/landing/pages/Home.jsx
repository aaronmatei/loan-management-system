import React, { useState } from "react";
import { Link } from "react-router-dom";
import Logo from "../../components/Logo";
import RequestDemoModal from "../components/RequestDemoModal";
import {
  Check,
  Building2,
  Gem,
  UsersRound,
  UserRound,
  Smartphone,
  Bell,
  BarChart3,
  ShieldCheck,
  FileText,
  Scale,
  Layers,
  HandCoins,
  ArrowRight,
} from "lucide-react";

// Landing page. Copy is deliberately concrete (real features, KES, M-Pesa,
// the four account types) and free of invented stats / testimonials.
function LandingHome() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // "Request Demo" — opens the lead-capture form; we email the request and
  // send the demo link by hand after a conversation.
  const [showRequest, setShowRequest] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      {/* ============= NAVBAR ============= */}
      <nav className="bg-white/85 backdrop-blur-md border-b border-slate-100 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            <Link to="/" className="flex items-center">
              <Logo markClassName="h-9 w-9" textClassName="text-xl" />
            </Link>

            <div className="hidden lg:flex items-center gap-7">
              <a href="#who" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">Who it's for</a>
              <a href="#features" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">Features</a>
              <a href="#how-it-works" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">How it works</a>
              <a href="#pricing" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">Pricing</a>
              <a href="#faq" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">FAQ</a>
              <span className="h-5 w-px bg-slate-200" />
              <Link to="/get-started" className="text-slate-600 hover:text-ocean-600 font-semibold text-sm">Sign in</Link>
              <Link
                to="/get-started"
                className="px-4 py-2 bg-ocean-gradient text-white rounded-lg font-bold text-sm shadow-md hover:shadow-lg transition"
              >
                Get started
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
              <a href="#who" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">Who it's for</a>
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">Features</a>
              <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">How it works</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">Pricing</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">FAQ</a>
              <div className="border-t my-2" />
              <Link to="/get-started" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 hover:bg-slate-100 rounded">Sign in</Link>
              <Link
                to="/get-started"
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 bg-ocean-gradient text-white rounded-lg font-bold text-center"
              >
                Get started →
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* ============= HERO ============= */}
      <section className="relative overflow-hidden bg-gradient-to-b from-ocean-50/70 to-white py-16 lg:py-24">
        <div className="pointer-events-none absolute -top-28 -left-24 w-[26rem] h-[26rem] rounded-full bg-ocean-200/40 blur-3xl" />
        <div className="max-w-6xl mx-auto px-4 relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-4xl lg:text-[3.4rem] font-bold leading-[1.08] text-gray-900 mb-5">
                Lending software for how you actually lend.
              </h1>
              <p className="text-lg text-gray-600 mb-7 leading-relaxed">
                Microfinances, SACCOs, pawnshops, chamas and individual lenders run their
                whole book on LenderFest — clients, loans, M-Pesa and cash payments, CRB
                checks, reminders and reports. Borrowers get a free account to apply and
                keep track.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  to="/get-started"
                  className="px-7 py-3.5 bg-ocean-gradient text-white rounded-xl font-bold text-base shadow-lg hover:shadow-xl transition text-center inline-flex items-center justify-center gap-2"
                >
                  Get started <ArrowRight size={18} />
                </Link>
                <button
                  onClick={() => setShowRequest(true)}
                  className="px-7 py-3.5 bg-white border-2 border-slate-200 text-gray-700 rounded-xl font-bold text-base hover:border-ocean-400 hover:text-ocean-700 transition"
                >
                  Request a demo
                </button>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
                <span className="inline-flex items-center gap-1.5"><Check size={15} className="text-emerald-500" /> 14-day free trial</span>
                <span className="inline-flex items-center gap-1.5"><Check size={15} className="text-emerald-500" /> No card required</span>
                <span className="inline-flex items-center gap-1.5"><Check size={15} className="text-emerald-500" /> Your own subdomain</span>
              </div>
            </div>

            {/* Hero mockup — a lender's day, in KES */}
            <div className="relative">
              <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-100 p-6">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <div className="w-2.5 h-2.5 bg-red-400 rounded-full"></div>
                  <div className="w-2.5 h-2.5 bg-yellow-400 rounded-full"></div>
                  <div className="w-2.5 h-2.5 bg-green-400 rounded-full"></div>
                  <div className="ml-2 text-xs text-gray-400 font-mono">wanjikucredit.lenderfest.loans</div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="rounded-lg p-3 bg-ocean-50">
                    <p className="text-xs text-ocean-700/70">Active loans</p>
                    <p className="text-2xl font-bold text-ocean-800">128</p>
                  </div>
                  <div className="rounded-lg p-3 bg-emerald-50">
                    <p className="text-xs text-emerald-700/70">Collected today</p>
                    <p className="text-2xl font-bold text-emerald-800">KES 214,500</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { code: "LN-WC-062026-0142", who: "Mwangi Kamau", tag: "Active", cls: "bg-emerald-100 text-emerald-700" },
                    { code: "LN-WC-062026-0141", who: "Achieng' Otieno", tag: "Due today", cls: "bg-amber-100 text-amber-700" },
                    { code: "LN-WC-062026-0138", who: "Njeri Wambui", tag: "3 days late", cls: "bg-red-100 text-red-700" },
                  ].map((r) => (
                    <div key={r.code} className="bg-slate-50 rounded-lg p-2.5 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{r.code}</p>
                        <p className="text-xs text-slate-500">{r.who}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${r.cls}`}>{r.tag}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============= CAPABILITY STRIP (no fabricated numbers) ============= */}
      <section className="border-y border-slate-100 bg-slate-50/70">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-slate-600">
          <span className="inline-flex items-center gap-1.5"><Smartphone size={15} className="text-ocean-500" /> M-Pesa, bank &amp; cash</span>
          <span className="inline-flex items-center gap-1.5"><Scale size={15} className="text-ocean-500" /> CRB checks (Metropol)</span>
          <span className="inline-flex items-center gap-1.5"><Layers size={15} className="text-ocean-500" /> Personal · logbook · salary · group · pawn</span>
          <span className="inline-flex items-center gap-1.5"><UserRound size={15} className="text-ocean-500" /> Free borrower portal</span>
        </div>
      </section>

      {/* ============= WHO IT'S FOR ============= */}
      <section id="who" className="py-16 lg:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-3">
              One platform, four ways to use it
            </h2>
            <p className="text-lg text-gray-600">
              Each account type opens its own focused workspace — and routes you to the
              right place to sign up or log in.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              {
                icon: Building2, tone: "ocean",
                title: "Lenders",
                who: "Microfinance, SACCOs & individual lenders",
                body: "Issue personal, logbook, salary and group loans. Price products with packages, run CRB checks, disburse from your capital pool, and chase repayments with reminders.",
                register: "/signup", login: "/login", cta: "Start free trial",
              },
              {
                icon: Gem, tone: "amber",
                title: "Pawnshops",
                who: "Cash against pledged items",
                body: "Value an item, advance up to your LTV, and run the bullet fee. Redeem on payment or forfeit on default — with a printable pawn ticket every time.",
                register: "/pawn/register", login: "/pawn/login", cta: "Register pawnshop",
              },
              {
                icon: UsersRound, tone: "emerald",
                title: "Chamas & Welfare",
                who: "Member savings & lending",
                body: "Enrol members, track contributions and each member's balance, and lend from the group's own pool. Run meetings, attendance and lending cycles.",
                register: "/welfare/register", login: "/welfare/login", cta: "Register welfare",
              },
              {
                icon: UserRound, tone: "violet",
                title: "Borrowers",
                who: "Free, for life",
                body: "One account to apply to lenders on LenderFest, track every loan and repayment, get reminders, and build a credit profile that earns you bigger loans.",
                register: "/portal/register", login: "/portal/login", cta: "Create free account",
              },
            ].map((a) => {
              const tone = {
                ocean: { chip: "bg-ocean-50 text-ocean-700", btn: "bg-ocean-600 hover:bg-ocean-700", edge: "hover:border-ocean-200" },
                amber: { chip: "bg-amber-50 text-amber-700", btn: "bg-amber-600 hover:bg-amber-700", edge: "hover:border-amber-200" },
                emerald: { chip: "bg-emerald-50 text-emerald-700", btn: "bg-emerald-600 hover:bg-emerald-700", edge: "hover:border-emerald-200" },
                violet: { chip: "bg-violet-50 text-violet-700", btn: "bg-violet-600 hover:bg-violet-700", edge: "hover:border-violet-200" },
              }[a.tone];
              const Icon = a.icon;
              return (
                <div key={a.title} className={`bg-white rounded-2xl border-2 border-slate-100 ${tone.edge} shadow-sm hover:shadow-md transition p-6 flex flex-col`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center ${tone.chip}`}>
                      <Icon size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{a.title}</h3>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{a.who}</p>
                    </div>
                  </div>
                  <p className="text-gray-600 mt-4 flex-1">{a.body}</p>
                  <div className="flex items-center gap-4 mt-5">
                    <Link to={a.register} className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${tone.btn}`}>
                      {a.cta}
                    </Link>
                    <Link to={a.login} className="text-sm font-semibold text-slate-500 hover:text-slate-800">
                      Log in
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============= FEATURES ============= */}
      <section id="features" className="py-16 lg:py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-3">
              The whole lending workflow, in one place
            </h2>
            <p className="text-lg text-gray-600">
              Everything below ships today — no add-ons, no per-feature pricing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-200 rounded-2xl overflow-hidden">
            {[
              { icon: Layers, title: "Five loan types", body: "Personal, logbook (vehicle), salary check-off, group and pawn — each with the right fields and security record." },
              { icon: HandCoins, title: "Packages & underwriting", body: "Price products once, then range-check every application. Pull a Metropol CRB report before you approve." },
              { icon: Smartphone, title: "Payments your borrowers use", body: "Record M-Pesa, bank and cash repayments in seconds, with a clean receipt your client can keep." },
              { icon: Bell, title: "Reminders & follow-up", body: "Automatic SMS and email for due dates and arrears. Log promises-to-pay and grant waivers when needed." },
              { icon: BarChart3, title: "Capital pool & reports", body: "See available capital, interest earned and collections in real time. Export to Excel or PDF anytime." },
              { icon: UserRound, title: "Borrower portal", body: "Your clients apply, track loans and get reminders 24/7 — on your own branded subdomain." },
              { icon: UsersRound, title: "Groups, chamas & welfare", body: "Run group-guaranteed loans, or a full members' savings pool with contributions, lending, meetings and cycles." },
              { icon: ShieldCheck, title: "Roles, audit & backups", body: "Give staff scoped access, see who did what in the audit log, and rest on daily encrypted backups." },
              { icon: FileText, title: "Documents that look the part", body: "Loan agreements, statements, receipts, pawn tickets and group guarantee forms — generated as tidy PDFs." },
            ].map((f) => (
              <div key={f.title} className="bg-white p-6">
                <f.icon size={22} className="text-ocean-600 mb-3" />
                <h3 className="font-bold text-gray-900 mb-1.5">{f.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============= HOW IT WORKS ============= */}
      <section id="how-it-works" className="py-16 lg:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-3">
              Up and running the same afternoon
            </h2>
            <p className="text-lg text-gray-600">
              No installs, no consultants. Sign up and you have a working system on your
              own subdomain.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {[
              { n: "01", title: "Create your account", body: "Pick your account type, choose a subdomain, and you're in. Your trial starts immediately — no card." },
              { n: "02", title: "Set up your products", body: "Add clients, create loan packages or pawn terms, and set your rates, fees and penalty rules." },
              { n: "03", title: "Lend and collect", body: "Disburse, record M-Pesa and cash repayments, send reminders, and watch your pool and reports update live." },
            ].map((s) => (
              <div key={s.n} className="relative">
                <span className="text-5xl font-extrabold text-ocean-100">{s.n}</span>
                <h3 className="text-xl font-bold text-gray-900 mt-1 mb-2">{s.title}</h3>
                <p className="text-gray-600">{s.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <Link
              to="/get-started"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-ocean-gradient text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition"
            >
              Choose your account <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ============= FOR BORROWERS ============= */}
      <section id="for-borrowers" className="py-16 lg:py-24 bg-navy-gradient text-white relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-ocean-500/20 blur-3xl" />
        <div className="max-w-6xl mx-auto px-4 relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 text-ocean-100 rounded-full text-xs font-bold uppercase tracking-wide mb-4">
                <UserRound size={13} /> For borrowers
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold mb-4 leading-tight">
                One free account. Every lender you borrow from.
              </h2>
              <p className="text-lg text-ocean-100/85 mb-6 leading-relaxed">
                Apply to lenders on LenderFest, track every repayment in one place, and
                build a credit profile that earns you bigger loans and better rates over
                time. Free, and yours to keep.
              </p>
              <ul className="grid sm:grid-cols-2 gap-3 mb-8">
                {[
                  "Apply online, any time",
                  "One login for every lender",
                  "Repayment reminders",
                  "Upload your documents once",
                  "Track schedules & balances",
                  "Build credit for bigger loans",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-ocean-50">
                    <Check size={14} className="text-ocean-300 shrink-0" /> {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link to="/portal/register" className="px-7 py-3.5 bg-white text-navy-900 rounded-xl font-bold shadow-lg hover:shadow-xl transition text-center">
                  Create free account
                </Link>
                <Link to="/portal/login" className="px-7 py-3.5 bg-white/10 border border-white/20 text-white rounded-xl font-bold hover:bg-white/15 transition text-center">
                  Borrower login
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="bg-white text-navy-900 rounded-2xl shadow-2xl p-6">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide">My credit score</p>
                    <p className="text-3xl font-extrabold text-ocean-600">724</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Good standing</span>
                </div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">My loans across lenders</p>
                <div className="space-y-2">
                  {[
                    { code: "Summit Microfinance", tag: "Active", color: "bg-ocean-100 text-ocean-700" },
                    { code: "Mwanzo SACCO", tag: "On track", color: "bg-emerald-100 text-emerald-700" },
                    { code: "Wanjiku Credit", tag: "Due soon", color: "bg-amber-100 text-amber-700" },
                  ].map((l) => (
                    <div key={l.code} className="bg-slate-50 rounded-lg p-2.5 flex justify-between items-center">
                      <p className="text-sm font-semibold">{l.code}</p>
                      <span className={`text-xs px-2 py-1 rounded ${l.color}`}>{l.tag}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============= PRICING ============= */}
      <section id="pricing" className="py-16 lg:py-24 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-3">
              You pay when you earn
            </h2>
            <p className="text-lg text-gray-600">
              Start with 14 days free. After that the fee is a share of the interest you
              actually collect — quiet month, no charge.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-100 p-7 flex flex-col">
              <h3 className="text-lg font-bold text-gray-900">Lenders &amp; Pawnshops</h3>
              <p className="mt-3 text-4xl font-extrabold text-gray-900">5%</p>
              <p className="text-sm text-gray-500 mb-5">of interest earned each month</p>
              <ul className="space-y-2 text-sm text-gray-600 flex-1">
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> 14-day free trial, no card</li>
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Unlimited clients &amp; loans</li>
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Borrower portal &amp; branding</li>
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> No setup or monthly minimum</li>
              </ul>
              <Link to="/get-started" className="mt-6 block text-center py-3 bg-ocean-gradient text-white rounded-lg font-bold">
                Start free
              </Link>
            </div>

            <div className="bg-white rounded-2xl shadow-md ring-2 ring-emerald-200 p-7 flex flex-col">
              <h3 className="text-lg font-bold text-gray-900">Chamas &amp; Welfare</h3>
              <p className="mt-3 text-4xl font-extrabold text-gray-900">
                KES 500<span className="text-base font-semibold text-gray-500">/mo</span>
              </p>
              <p className="text-sm text-gray-500 mb-5">+ 5% of interest on member loans</p>
              <ul className="space-y-2 text-sm text-gray-600 flex-1">
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Members &amp; contributions pool</li>
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Lend from the group's pool</li>
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Meetings, attendance &amp; cycles</li>
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Statements &amp; guarantee forms</li>
              </ul>
              <Link to="/welfare/register" className="mt-6 block text-center py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold">
                Register welfare
              </Link>
            </div>

            <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-100 p-7 flex flex-col">
              <h3 className="text-lg font-bold text-gray-900">Borrowers</h3>
              <p className="mt-3 text-4xl font-extrabold text-gray-900">Free</p>
              <p className="text-sm text-gray-500 mb-5">always</p>
              <ul className="space-y-2 text-sm text-gray-600 flex-1">
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Apply to any lender on LenderFest</li>
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Track loans &amp; repayments</li>
                <li className="flex gap-2"><Check size={15} className="text-emerald-500 shrink-0" /> Reminders &amp; a credit profile</li>
              </ul>
              <Link to="/portal/register" className="mt-6 block text-center py-3 border-2 border-ocean-600 text-ocean-600 rounded-lg font-bold hover:bg-ocean-50">
                Create account
              </Link>
            </div>
          </div>

          <p className="text-sm text-gray-500 mt-8 max-w-3xl">
            Running a large operation and need custom integrations, an SLA or white-label?{" "}
            <a href="mailto:aronique@gmail.com" className="font-semibold text-ocean-600 hover:text-ocean-700">Talk to us</a>.
          </p>
        </div>
      </section>

      {/* ============= WHY (honest, no testimonials) ============= */}
      <section className="py-16 lg:py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid lg:grid-cols-3 gap-8">
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Made for real lending</h3>
              <p className="text-gray-600">M-Pesa and cash, CRB checks, chamas, pawnshops, logbook and check-off loans — modelled on how lending actually works, not a generic template bent to fit.</p>
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Your data, no lock-in</h3>
              <p className="text-gray-600">Export everything to Excel or PDF whenever you want. Daily encrypted backups, and each business only ever sees its own data.</p>
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Priced to be fair</h3>
              <p className="text-gray-600">No setup fees and no monthly minimum for lenders — you pay a share of interest you've already collected, or nothing in a quiet month.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============= FAQ ============= */}
      <section id="faq" className="py-16 lg:py-24 bg-slate-50">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-8">Questions, answered</h2>
          <div className="space-y-3">
            {[
              { q: "Who is LenderFest for?", a: "Microfinances, SACCOs and individual lenders; pawnshops; chamas and welfare groups; and borrowers. Each gets its own workspace — pick your type at sign-up and you're routed to the right place." },
              { q: "Do you support M-Pesa?", a: "You can record M-Pesa, bank and cash repayments today, each with a receipt. Direct STK-push integration is on the roadmap." },
              { q: "Can I run a pawnshop on LenderFest?", a: "Yes. Register a pawnshop account, add your clients, value an item, and advance cash up to your loan-to-value. Redeem on payment or forfeit on default — every pawn gets a printable ticket." },
              { q: "What about a chama or welfare group?", a: "Welfare accounts run a members' savings pool: enrol members, record contributions and balances, and lend from the group's own pool — plus meetings, attendance and lending cycles." },
              { q: "How does pricing work?", a: "Lenders and pawnshops pay 5% of the interest collected each month after a 14-day free trial — nothing in a month with no collections. Chamas/welfare pay a small monthly fee plus 5% of interest on member loans. Borrowers are always free." },
              { q: "Can my borrowers apply online?", a: "Yes. Every lender gets a branded borrower portal where clients register, apply, and track their loans 24/7 — separate from your admin dashboard." },
              { q: "Is my data safe, and can I leave?", a: "Each business only sees its own data, everything is encrypted and backed up daily, and you can export your records to Excel or CSV at any time. No lock-in." },
            ].map((faq, idx) => (
              <FAQItem key={idx} {...faq} />
            ))}
          </div>
        </div>
      </section>

      {/* ============= FINAL CTA ============= */}
      <section className="py-16 lg:py-24 bg-navy-gradient text-white relative overflow-hidden">
        <div className="pointer-events-none absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-ocean-500/20 blur-3xl" />
        <div className="max-w-3xl mx-auto px-4 text-center relative">
          <h2 className="text-3xl lg:text-5xl font-bold mb-4">Set up your account today</h2>
          <p className="text-lg text-ocean-100/85 mb-8">
            Pick your type, claim your subdomain, and start in minutes.
          </p>
          <Link
            to="/get-started"
            className="inline-flex items-center gap-2 px-9 py-4 bg-white text-navy-900 rounded-xl font-bold text-lg shadow-xl hover:shadow-2xl transition"
          >
            Get started <ArrowRight size={20} />
          </Link>
          <p className="mt-5 text-ocean-100/80 text-sm">
            Just here to borrow?{" "}
            <Link to="/portal/register" className="underline font-semibold text-white">Create a free borrower account</Link>
          </p>
        </div>
      </section>

      {/* ============= FOOTER ============= */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
            <div>
              <Logo variant="reversed" markClassName="h-7 w-7" textClassName="text-xl" />
              <p className="text-sm mt-3">Loan management for lenders, pawnshops, chamas and the people who borrow from them.</p>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3">Sign up</h4>
              <ul className="space-y-2 text-sm">
                <li><Link to="/signup" className="hover:text-white">Lenders</Link></li>
                <li><Link to="/pawn/register" className="hover:text-white">Pawnshops</Link></li>
                <li><Link to="/welfare/register" className="hover:text-white">Chamas &amp; Welfare</Link></li>
                <li><Link to="/portal/register" className="hover:text-white">Borrowers</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#who" className="hover:text-white">Who it's for</a></li>
                <li><a href="#features" className="hover:text-white">Features</a></li>
                <li><a href="#pricing" className="hover:text-white">Pricing</a></li>
                <li><a href="#faq" className="hover:text-white">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-white mb-3">Talk to us</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="mailto:aronique@gmail.com" className="hover:text-white">aronique@gmail.com</a></li>
                <li><a href="tel:+254722680861" className="hover:text-white">+254 722 680 861</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-sm">
            <p>© {new Date().getFullYear()} LenderFest</p>
          </div>
        </div>
      </footer>

      <RequestDemoModal open={showRequest} onClose={() => setShowRequest(false)} />
    </div>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-100">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left p-4 flex justify-between items-center gap-4 hover:bg-slate-50"
      >
        <span className="font-semibold">{q}</span>
        <span className={`text-2xl leading-none text-ocean-500 transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      {open && <div className="px-4 pb-4 text-gray-600 border-t border-slate-100 pt-3">{a}</div>}
    </div>
  );
}

export default LandingHome;
