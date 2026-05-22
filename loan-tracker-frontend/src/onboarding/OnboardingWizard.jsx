import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

import WelcomeStep from "./steps/WelcomeStep";
import BusinessProfileStep from "./steps/BusinessProfileStep";
import LoanSettingsStep from "./steps/LoanSettingsStep";
import CapitalStep from "./steps/CapitalStep";
import FirstClientStep from "./steps/FirstClientStep";
import FirstLoanStep from "./steps/FirstLoanStep";
import InviteTeamStep from "./steps/InviteTeamStep";
import CompletionStep from "./steps/CompletionStep";

const STEPS = [
  { component: WelcomeStep, title: "Welcome" },
  { component: BusinessProfileStep, title: "Business Profile" },
  { component: LoanSettingsStep, title: "Loan Settings" },
  { component: CapitalStep, title: "Capital Pool" },
  { component: FirstClientStep, title: "First Client" },
  { component: FirstLoanStep, title: "First Loan" },
  { component: InviteTeamStep, title: "Team (Optional)" },
  { component: CompletionStep, title: "Done!" },
];

function OnboardingWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [createdClient, setCreatedClient] = useState(null);

  useEffect(() => {
    api
      .get("/onboarding/status")
      .then((r) => {
        const s = r.data.data;
        if (s.onboarding_completed) {
          navigate("/");
          return;
        }
        if (s.onboarding_step > 1) setCurrentStep(s.onboarding_step);
        if (s.onboarding_data) setData(s.onboarding_data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleNext = async (stepData = {}) => {
    const newData = { ...data, ...stepData };
    setData(newData);
    const nextStep = currentStep + 1;
    try {
      await api.post("/onboarding/step", { step: nextStep, data: newData });
    } catch {
      /* keep going — server-side persistence is best-effort */
    }
    setCurrentStep(nextStep);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleSkipAll = async () => {
    if (!window.confirm("Skip the setup? You can always come back to this."))
      return;
    try {
      await api.post("/onboarding/skip");
      navigate("/");
    } catch {
      alert("Failed to skip. Please try again.");
    }
  };

  const handleComplete = async () => {
    try {
      await api.post("/onboarding/complete");
      navigate("/?welcome=true");
    } catch {
      alert("Failed to complete. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ocean-600 mx-auto"></div>
          <p className="mt-3 text-gray-600">Loading…</p>
        </div>
      </div>
    );
  }

  const Current = STEPS[currentStep].component;

  return (
    <div className="min-h-screen bg-gradient-to-br from-ocean-50 via-white to-ocean-50">
      {currentStep > 0 && currentStep < STEPS.length - 1 && (
        <div className="bg-white shadow-sm border-b sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-bold text-gray-800">
                Setup Progress: Step {currentStep} of {STEPS.length - 2}
              </h2>
              <button
                onClick={handleSkipAll}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Skip Setup
              </button>
            </div>
            <div className="flex gap-1">
              {STEPS.slice(1, -1).map((_, idx) => (
                <div
                  key={idx}
                  className={`flex-1 h-2 rounded-full transition ${
                    idx < currentStep - 1
                      ? "bg-green-500"
                      : idx === currentStep - 1
                        ? "bg-ocean-600"
                        : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              {STEPS.slice(1, -1).map((s, idx) => (
                <span
                  key={idx}
                  className={
                    idx === currentStep - 1 ? "font-bold text-ocean-600" : ""
                  }
                >
                  {s.title}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="py-8">
        <Current
          data={data}
          createdClient={createdClient}
          setCreatedClient={setCreatedClient}
          onNext={handleNext}
          onBack={handleBack}
          onComplete={handleComplete}
          onSkip={handleSkipAll}
        />
      </div>
    </div>
  );
}

export default OnboardingWizard;
