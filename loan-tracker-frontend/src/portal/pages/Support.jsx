import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  Wallet,
  Building2,
  UserCog,
  MessageCircle,
  LifeBuoy,
} from "lucide-react";
import PortalLayout from "../components/PortalLayout";
import { CARD, INK, MUTED } from "../theme";

// Help & support — design "Borrower Portal" support screen. FAQ accordion +
// guidance cards that route to real destinations. Wording stays lender-neutral
// (fees/penalties vary per lender) since the portal spans many lenders.
const FAQS = [
  {
    q: "How do I pay my loan?",
    a: "Open the loan from “My Loans” and tap “Pay with M-Pesa”. We send an STK push to your phone — just enter your PIN. No paybill or account number to remember, and your payment posts to the loan automatically.",
  },
  {
    q: "What happens if I pay late?",
    a: "Late fees and penalty interest depend on your lender’s terms — open the loan’s schedule to see the exact amount owed on each instalment. Paying as soon as you can keeps extra charges to a minimum.",
  },
  {
    q: "Can I pay off my loan early?",
    a: "In most cases yes — you can clear your balance any time and only pay interest accrued to date. Early-settlement terms are set by each lender, so check your loan details or ask your lender to confirm.",
  },
  {
    q: "When can I borrow again?",
    a: "Once you’ve repaid on time, you build a stronger credit score across the platform. Browse Lenders to apply again — a good repayment history often unlocks higher amounts.",
  },
  {
    q: "My payment isn’t showing — what do I do?",
    a: "M-Pesa payments usually reflect within a few minutes. If it’s been longer, check Payments for the transaction, then reach out to your lender with the M-Pesa confirmation code.",
  },
];

function SupportPage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(0);

  const links = [
    { label: "View my loans", sub: "Balances, schedules & repay", icon: Wallet, onClick: () => navigate("/portal/loans") },
    { label: "Browse lenders", sub: "Apply for a new loan", icon: Building2, onClick: () => navigate("/lenders") },
    { label: "Update my profile", sub: "Contact details & statements", icon: UserCog, onClick: () => navigate("/portal/profile") },
  ];

  return (
    <PortalLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4 items-start">
          {/* FAQ accordion */}
          <div className={`${CARD} p-[22px]`}>
            <div className={`text-[14.5px] font-extrabold ${INK} mb-4`}>Frequently asked</div>
            <div>
              {FAQS.map((f, i) => {
                const isOpen = open === i;
                return (
                  <div key={f.q} className="border-b border-[#f4efe4] dark:border-slate-700 last:border-0">
                    <button
                      onClick={() => setOpen(isOpen ? -1 : i)}
                      className="w-full flex items-center gap-3 py-3.5 text-left"
                    >
                      <span className={`flex-1 text-[13.5px] font-bold ${INK}`}>{f.q}</span>
                      {isOpen ? (
                        <ChevronUp size={16} className="text-[#c3bcab] shrink-0" />
                      ) : (
                        <ChevronDown size={16} className="text-[#c3bcab] shrink-0" />
                      )}
                    </button>
                    {isOpen && (
                      <div className={`text-[13px] ${MUTED} font-medium leading-relaxed pb-4`}>
                        {f.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Contact + quick links */}
          <div className="flex flex-col gap-4">
            <div
              className="rounded-[18px] p-[22px] text-white"
              style={{ background: "linear-gradient(150deg,#123a2c,#0d2a20)" }}
            >
              <div className="flex items-center gap-2 text-[14.5px] font-extrabold">
                <LifeBuoy size={18} /> Need a hand?
              </div>
              <div className="text-[12.5px] font-medium mt-1.5 leading-relaxed" style={{ color: "#8fd3b6" }}>
                Payment questions are best answered by the lender who issued your
                loan — open the loan to see its repayment tools and contact details.
              </div>
              <button
                onClick={() => navigate("/portal/loans")}
                className="w-full mt-4 rounded-[12px] py-3 font-extrabold text-[13.5px] flex items-center justify-center gap-2 transition hover:brightness-105"
                style={{ background: "#2ee0a0", color: "#0c241c" }}
              >
                <MessageCircle size={16} /> Go to my loans
              </button>
            </div>

            <div className={`${CARD} p-2`}>
              {links.map((l) => (
                <button
                  key={l.label}
                  onClick={l.onClick}
                  className="w-full flex items-center gap-3 p-3 rounded-[13px] hover:bg-[#faf6ec] dark:hover:bg-slate-700/60 transition text-left"
                >
                  <span className="w-9 h-9 rounded-[10px] bg-[#eaf6ef] dark:bg-slate-700 flex items-center justify-center shrink-0">
                    <l.icon size={17} className="text-[#0d8f63]" />
                  </span>
                  <div className="min-w-0">
                    <div className={`text-[13.5px] font-bold ${INK}`}>{l.label}</div>
                    <div className={`text-[11.5px] ${MUTED} font-medium`}>{l.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}

export default SupportPage;
