import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import IdentityUploader from "../components/IdentityUploader";

// Standalone (no portal sidebar) so it works as a hard gate: a customer added
// by a lender must upload their documents before reaching the dashboard. Also
// reachable from the profile ("Update") with a ?next so Cancel can return.
function VerifyIdentity() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");

  return (
    <div className="min-h-screen bg-navy-gradient flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl p-6 lg:p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-ocean-gradient mb-3">
            <ShieldCheck size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-navy-900">Verify your identity</h1>
          <p className="text-slate-500 mt-1">
            Upload your photo and both sides of your national ID. Lenders you
            link to will use these to verify you.
          </p>
        </div>

        <IdentityUploader
          onComplete={() => navigate(next || "/portal/dashboard")}
          onCancel={next ? () => navigate(next) : undefined}
        />
      </div>
    </div>
  );
}

export default VerifyIdentity;
