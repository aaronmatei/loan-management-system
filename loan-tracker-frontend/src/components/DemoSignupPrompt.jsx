import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Rocket, X } from "lucide-react";

// Sits in the bottom-right corner of any staff page during a demo
// session. Pops 60 seconds after page load to nudge conversion. The
// dismiss persists for the session (sessionStorage) so it doesn't
// re-appear on every navigation.
function DemoSignupPrompt() {
  const navigate = useNavigate();
  const isDemo = localStorage.getItem("is_demo_session") === "true";
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isDemo) return;
    if (sessionStorage.getItem("demo_prompt_dismissed") === "true") return;
    const t = setTimeout(() => setShow(true), 60000);
    return () => clearTimeout(t);
  }, [isDemo]);

  if (!isDemo || !show) return null;

  return (
    <div className="fixed bottom-4 right-4 max-w-sm bg-white rounded-2xl shadow-2xl border-2 border-ocean-200 p-5 z-50">
      <button
        onClick={() => {
          sessionStorage.setItem("demo_prompt_dismissed", "true");
          setShow(false);
        }}
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
        aria-label="Dismiss"
      >
        <X size={18} />
      </button>
      <div className="flex mb-2">
        <Rocket size={32} className="text-ocean-600" />
      </div>
      <h3 className="font-bold text-lg mb-1">Enjoying LenderFest?</h3>
      <p className="text-sm text-gray-600 mb-3">
        Create your own account in 60 seconds. Free 14-day trial, no credit
        card needed.
      </p>
      <button
        onClick={() => {
          localStorage.removeItem("is_demo_session");
          navigate("/signup");
        }}
        className="w-full py-2 bg-ocean-gradient text-white rounded-lg font-bold"
      >
        Start My Free Trial →
      </button>
    </div>
  );
}

export default DemoSignupPrompt;
