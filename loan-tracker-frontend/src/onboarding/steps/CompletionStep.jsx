import React from "react";
import { PartyPopper, Check, Rocket, Lightbulb } from "lucide-react";

function CompletionStep({ onComplete }) {
  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="bg-gradient-to-br from-ocean-600 via-ocean-600 to-pink-600 text-white rounded-3xl shadow-2xl p-8 lg:p-12 text-center">
        <div className="flex justify-center mb-6 animate-bounce"><PartyPopper size={80} className="text-yellow-300" /></div>
        <h1 className="text-3xl lg:text-5xl font-bold mb-4">You're All Set!</h1>
        <p className="text-xl text-white/90 mb-8">
          Your lending platform is ready to use
        </p>
        <div className="bg-white/20 backdrop-blur rounded-2xl p-6 mb-8 text-left">
          <h3 className="font-bold mb-4">Here's what you've accomplished:</h3>
          {[
            "Business profile set up",
            "Loan defaults configured",
            "First client added",
            "First loan application submitted",
          ].map((label, i) => (
            <div className="flex items-center gap-3" key={i}>
              <Check size={18} className="text-green-300 shrink-0" />
              <span>{label}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onComplete}
          className="w-full py-4 bg-white text-ocean-600 font-bold text-lg rounded-xl shadow-xl hover:shadow-2xl transition transform hover:-translate-y-1 inline-flex items-center justify-center gap-2"
        >
          <Rocket size={20} /> Take Me to My Dashboard
        </button>
        <p className="text-sm text-white/80 mt-4 flex items-start justify-center gap-1.5">
          <Lightbulb size={14} className="mt-0.5 shrink-0" /> Your first loan is in the Applications queue — review and disburse it from there.
        </p>
      </div>
    </div>
  );
}

export default CompletionStep;
