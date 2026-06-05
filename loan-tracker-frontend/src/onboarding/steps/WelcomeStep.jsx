import React from "react";
import { PartyPopper, Lightbulb } from "lucide-react";

function WelcomeStep({ onNext, onSkip }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="bg-white rounded-3xl shadow-2xl p-8 lg:p-12 text-center">
        <div className="flex justify-center mb-4"><PartyPopper size={72} className="text-ocean-500" /></div>
        <h1 className="text-3xl lg:text-5xl font-bold text-gray-900 mb-4">
          Welcome to LendFest!
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Let's get you set up in just 5 minutes
        </p>

        <div className="bg-ocean-gradient-soft rounded-2xl p-6 mb-8 text-left">
          <h3 className="font-bold text-gray-800 mb-4">Here's what we'll do:</h3>
          {[
            "Set up your business profile",
            "Configure default loan settings",
            "Add your first client",
            "Submit your first loan application",
            "Invite team members (optional)",
          ].map((label, i) => (
            <div className="flex items-center gap-3 mb-3" key={i}>
              <div className="w-8 h-8 rounded-full bg-ocean-600 text-white flex items-center justify-center font-bold text-sm">
                {i + 1}
              </div>
              <span className="text-gray-700">{label}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => onNext()}
          className="w-full py-4 bg-ocean-gradient text-white font-bold text-lg rounded-xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1"
        >
          Let's Get Started →
        </button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-gray-500 hover:text-gray-700 text-sm mt-2"
        >
          Skip Setup (Not Recommended)
        </button>
        <p className="text-xs text-gray-400 mt-6 flex items-center justify-center gap-1">
          <Lightbulb size={12} className="text-ocean-400" /> You can always come back to setup later
        </p>
      </div>
    </div>
  );
}

export default WelcomeStep;
