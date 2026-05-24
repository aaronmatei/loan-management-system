import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Camera, IdCard, ShieldCheck, Loader2 } from "lucide-react";
import portalApi from "../services/portalApi";

const MAX_BYTES = 5 * 1024 * 1024;

// The three identity documents we collect, stored on the global customer
// record so every linked lender sees the same verified identity.
const SLOTS = [
  {
    key: "profile_photo",
    urlKey: "profile_photo_url",
    label: "Profile Photo",
    hint: "A clear photo of your face",
    icon: Camera,
    rounded: true,
  },
  {
    key: "id_front",
    urlKey: "id_front_url",
    label: "ID — Front",
    hint: "Front side of your national ID",
    icon: IdCard,
  },
  {
    key: "id_back",
    urlKey: "id_back_url",
    label: "ID — Back",
    hint: "Back side of your national ID",
    icon: IdCard,
  },
];

// Standalone (no portal sidebar) so it works as a hard gate: a customer added
// by a lender — or finishing self-signup — must upload these before reaching
// the dashboard. Reused from Profile to update documents later.
function VerifyIdentity() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");

  const [existing, setExisting] = useState({});
  const [cloudinaryEnabled, setCloudinaryEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState({}); // key -> File
  const [previews, setPreviews] = useState({}); // key -> object URL
  const [submitting, setSubmitting] = useState(false);
  const inputs = useRef({});

  useEffect(() => {
    portalApi
      .get("/portal/customer/kyc")
      .then((r) => {
        const d = r.data.data || {};
        setExisting(d);
        setCloudinaryEnabled(d.cloudinary_enabled !== false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Revoke object URLs on unmount to avoid leaks.
  useEffect(
    () => () => Object.values(previews).forEach((u) => URL.revokeObjectURL(u)),
    [previews],
  );

  const pick = (key) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      alert("Please choose an image file");
      return;
    }
    if (file.size > MAX_BYTES) {
      alert("Each image must be 5 MB or smaller");
      return;
    }
    setFiles((f) => ({ ...f, [key]: file }));
    setPreviews((p) => {
      if (p[key]) URL.revokeObjectURL(p[key]);
      return { ...p, [key]: URL.createObjectURL(file) };
    });
  };

  const shownUrl = (slot) => previews[slot.key] || existing[slot.urlKey];
  const hasAll = SLOTS.every((s) => shownUrl(s));
  const newCount = Object.keys(files).length;

  const finish = () => {
    // Reflect completion locally so the route gate lets the customer through.
    try {
      const stored = JSON.parse(localStorage.getItem("portal_customer") || "{}");
      localStorage.setItem(
        "portal_customer",
        JSON.stringify({ ...stored, needs_kyc: false }),
      );
    } catch {
      /* ignore */
    }
    navigate(next || "/loanfix/portal/dashboard");
  };

  const submit = async () => {
    if (newCount === 0) {
      // Nothing new to upload — already complete, just proceed.
      if (hasAll) finish();
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(files).forEach(([k, file]) => fd.append(k, file));
      const r = await portalApi.post("/portal/customer/kyc", fd);
      const d = r.data.data || {};
      if (d.kyc_complete) {
        finish();
      } else {
        // Persist what was saved, keep them here for the rest.
        setExisting((prev) => ({ ...prev, ...d }));
        setFiles({});
        setPreviews({});
        alert("Saved. Please add the remaining document(s).");
      }
    } catch (err) {
      alert(err.response?.data?.error || "Upload failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

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

        {!cloudinaryEnabled && (
          <div className="mb-5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
            Document upload isn't available right now. You can continue and add
            them later from your profile.
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {SLOTS.map((slot) => {
                const url = shownUrl(slot);
                const Icon = slot.icon;
                return (
                  <div key={slot.key} className="text-center">
                    <input
                      ref={(el) => (inputs.current[slot.key] = el)}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={pick(slot.key)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => inputs.current[slot.key]?.click()}
                      className={`relative w-full aspect-square overflow-hidden border-2 border-dashed transition flex items-center justify-center ${
                        url
                          ? "border-ocean-500"
                          : "border-slate-300 hover:border-ocean-400 bg-slate-50"
                      } ${slot.rounded ? "rounded-full" : "rounded-xl"}`}
                    >
                      {url ? (
                        <img
                          src={url}
                          alt={slot.label}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="flex flex-col items-center gap-1 text-slate-400">
                          <Icon size={26} />
                          <span className="text-xs font-semibold">Upload</span>
                        </span>
                      )}
                      {url && (
                        <span className="absolute bottom-1 right-1 bg-ocean-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          Change
                        </span>
                      )}
                    </button>
                    <p className="text-sm font-semibold text-navy-900 mt-2">
                      {slot.label}
                    </p>
                    <p className="text-xs text-slate-400">{slot.hint}</p>
                  </div>
                );
              })}
            </div>

            <button
              onClick={submit}
              disabled={submitting || (!hasAll && newCount === 0)}
              className="w-full mt-7 py-3 bg-ocean-gradient text-white font-bold rounded-xl shadow-tile disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Uploading…
                </>
              ) : hasAll ? (
                "Continue →"
              ) : (
                `Upload ${3 - SLOTS.filter((s) => shownUrl(s)).length} more to continue`
              )}
            </button>

            {next && (
              <button
                onClick={() => navigate("/loanfix/portal/profile")}
                className="w-full mt-2 py-2 text-sm text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            )}
            <p className="text-center text-xs text-slate-400 mt-4">
              JPG, PNG up to 5 MB each.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default VerifyIdentity;
