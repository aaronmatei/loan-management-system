import { Link } from "react-router-dom";
import { Building2, UserRound, UsersRound, ArrowLeft } from "lucide-react";
import Seo from "../../components/Seo";

// Account chooser — routes a visitor to the right signup / login for whichever
// kind of account they are: lender, borrower, or welfare. (Pawnshops are just
// lenders now — collateral is a loan type, offered at lender signup.)
const ACCOUNTS = [
  {
    key: "lender",
    icon: Building2,
    color: "ocean",
    title: "Lender",
    blurb: "Run a microfinance, SACCO, bank or lending business — including loans against collateral.",
    register: "/signup",
    login: "/login",
    cta: "Start free trial",
  },
  {
    key: "welfare",
    icon: UsersRound,
    color: "emerald",
    title: "Welfare / Chama admin",
    blurb: "Run a chama, SACCO or welfare group — set up the shared pool, members and lending. Members are added by you and get an invite.",
    register: "/welfare/register",
    login: "/welfare/login",
    cta: "Register welfare",
    memberLogin: "/welfare/member/login",
  },
  {
    key: "borrower",
    icon: UserRound,
    color: "violet",
    title: "Borrower",
    blurb: "Apply to lenders, track your loans, and never miss a repayment.",
    register: "/portal/register",
    login: "/portal/login",
    cta: "Create account",
  },
];

const TONE = {
  ocean: { ring: "hover:border-ocean-300", chip: "bg-ocean-50 text-ocean-700", btn: "bg-ocean-600 hover:bg-ocean-700" },
  amber: { ring: "hover:border-amber-300", chip: "bg-amber-50 text-amber-700", btn: "bg-amber-600 hover:bg-amber-700" },
  emerald: { ring: "hover:border-emerald-300", chip: "bg-emerald-50 text-emerald-700", btn: "bg-emerald-600 hover:bg-emerald-700" },
  violet: { ring: "hover:border-violet-300", chip: "bg-violet-50 text-violet-700", btn: "bg-violet-600 hover:bg-violet-700" },
};

export default function GetStarted() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-ocean-50 px-4 py-10">
      <Seo
        title="Get started — LenderFest for lenders, chamas & SACCOs"
        description="Choose how to start on LenderFest: register a lending business, a chama/SACCO or welfare group, or sign in as a member. Built for Kenya with M-Pesa."
        path="/get-started"
      />
      <div className="max-w-4xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-1.5 text-slate-600 hover:text-ocean-700 font-semibold text-sm mb-6">
          <ArrowLeft size={16} /> Back to home
        </Link>
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Get started with LenderFest</h1>
          <p className="text-slate-600 mt-2">Choose the account that fits you.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {ACCOUNTS.map((a) => {
            const t = TONE[a.color];
            const Icon = a.icon;
            return (
              <div
                key={a.key}
                className={`bg-white rounded-2xl shadow-md border-2 border-transparent ${t.ring} transition p-6 flex flex-col`}
              >
                <div className={`inline-flex w-12 h-12 items-center justify-center rounded-xl mb-3 ${t.chip}`}>
                  <Icon size={24} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">{a.title}</h2>
                <p className="text-sm text-slate-600 mt-1 flex-1">{a.blurb}</p>
                <div className="flex items-center gap-3 mt-4">
                  <Link
                    to={a.register}
                    className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${t.btn}`}
                  >
                    {a.cta}
                  </Link>
                  <Link to={a.login} className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                    Log in
                  </Link>
                </div>
                {a.memberLogin && (
                  <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
                    A chama member?{" "}
                    <Link to={a.memberLogin} className="font-semibold text-emerald-700 hover:underline">
                      Member login
                    </Link>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
