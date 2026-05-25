import React from "react";
import { useNavigate } from "react-router-dom";
import { Gamepad2 } from "lucide-react";

// Sticky purple banner shown when a visitor entered via "Try Live
// Demo". Drives conversion (Sign Up Free) and provides a clean
// "Exit" that clears the demo token.
function DemoBanner() {
  const navigate = useNavigate();
  const isDemo = localStorage.getItem("is_demo_session") === "true";
  if (!isDemo) return null;

  const handleSignUp = () => {
    // Track conversion (non-fatal)
    const sessionToken = localStorage.getItem("demo_session_token");
    if (sessionToken) {
      const apiUrl =
        import.meta.env.VITE_API_URL || "http://localhost:3000/api";
      fetch(`${apiUrl}/demo/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: sessionToken }),
      }).catch(() => {});
    }
    clearDemoState();
    navigate("/signup");
  };

  const exitDemo = () => {
    clearDemoState();
    navigate("/");
  };

  return (
    <div className="bg-ocean-gradient text-white px-4 py-2 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm">
      <div className="flex items-center gap-2">
        <Gamepad2 size={18} className="shrink-0" />
        <span className="font-semibold">
          You're exploring the LoanFix demo. Data is sample only and resets nightly.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSignUp}
          className="px-4 py-1.5 bg-white text-ocean-700 rounded-lg font-bold hover:shadow-lg whitespace-nowrap"
        >
          Sign Up Free →
        </button>
        <button
          onClick={exitDemo}
          className="px-3 py-1.5 bg-white/20 rounded-lg hover:bg-white/30 whitespace-nowrap"
        >
          Exit
        </button>
      </div>
    </div>
  );
}

function clearDemoState() {
  localStorage.removeItem("is_demo_session");
  localStorage.removeItem("demo_session_token");
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export default DemoBanner;
