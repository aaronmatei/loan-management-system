import React, { useEffect, useState } from "react";

// The shareable demo link — https://lenderfest.loans/demo. Visiting it mints a
// short-lived demo session and drops the visitor straight into the staff
// dashboard. The team sends this link to a lead after engaging their request.
// (hard-nav to "/" so AuthContext re-initialises from the just-set token.)
export default function DemoStart() {
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const apiUrl =
          import.meta.env.VITE_API_URL || "http://localhost:3000/api";
        const res = await fetch(`${apiUrl}/demo/start`, { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setError(
            data.error || "The demo is unavailable right now. Please try again later.",
          );
          return;
        }
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        localStorage.setItem("is_demo_session", "true");
        localStorage.setItem("demo_session_token", data.session_token);
        window.location.href = "/";
      } catch {
        setError("Could not start the demo. Please try again.");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white text-center px-6">
      {error ? (
        <>
          <p className="text-lg font-semibold text-gray-900 mb-2">{error}</p>
          <a
            href={
              window.location.hostname.endsWith("lenderfest.loans")
                ? "https://lenderfest.loans/"
                : "/"
            }
            className="text-ocean-600 font-semibold"
          >
            ← Back to home
          </a>
        </>
      ) : (
        <>
          <div className="w-10 h-10 border-4 border-ocean-200 border-t-ocean-600 rounded-full animate-spin mb-5" />
          <p className="text-gray-600">Starting your LenderFest demo…</p>
        </>
      )}
    </div>
  );
}
