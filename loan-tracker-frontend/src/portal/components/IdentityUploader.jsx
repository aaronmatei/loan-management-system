import React, { useState, useEffect, useRef } from "react";
import { Camera, IdCard, Loader2 } from "lucide-react";
import portalApi from "../services/portalApi";
import Spinner from "../../components/Spinner";

const MAX_BYTES = 5 * 1024 * 1024;

// The three identity documents, stored on the global customer record so every
// linked lender sees the same verified identity.
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

// Reusable DP-photo + ID-front/back uploader. Used both by the standalone
// verify-identity gate and as the final step of customer signup. Calls
// onComplete() once all three documents are on file (and flips the locally
// cached needs_kyc so the route gate lets the customer through).
function IdentityUploader({ onComplete, onCancel }) {
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

  const done = (photoUrl) => {
    // Reflect completion locally so the route gate lets the customer through,
    // and cache the DP photo so the sidebar avatar updates without re-login.
    try {
      const stored = JSON.parse(localStorage.getItem("portal_customer") || "{}");
      localStorage.setItem(
        "portal_customer",
        JSON.stringify({
          ...stored,
          needs_kyc: false,
          ...(photoUrl ? { profile_photo_url: photoUrl } : {}),
        }),
      );
    } catch {
      /* ignore */
    }
    onComplete?.();
  };

  const submit = async () => {
    // Storage off: honour the banner's promise and let them continue.
    if (!cloudinaryEnabled) {
      done(existing.profile_photo_url);
      return;
    }
    if (newCount === 0) {
      if (hasAll) done(existing.profile_photo_url);
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(files).forEach(([k, file]) => fd.append(k, file));
      const r = await portalApi.post("/portal/customer/kyc", fd);
      const d = r.data.data || {};
      if (d.kyc_complete) {
        done(d.profile_photo_url || existing.profile_photo_url);
      } else {
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

  const remaining = 3 - SLOTS.filter((s) => shownUrl(s)).length;
  const buttonLabel = submitting
    ? "Uploading…"
    : !cloudinaryEnabled
      ? "Continue →"
      : hasAll
        ? "Continue →"
        : `Upload ${remaining} more to continue`;

  if (loading) {
    return <Spinner centered className="py-12" label="Loading…" />;
  }

  return (
    <>
      {!cloudinaryEnabled && (
        <div className="mb-5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
          Document upload isn't available right now. You can continue and add
          them later from your profile.
        </div>
      )}

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
                disabled={!cloudinaryEnabled}
                onClick={() => inputs.current[slot.key]?.click()}
                className={`relative w-full aspect-square overflow-hidden border-2 border-dashed transition flex items-center justify-center disabled:opacity-50 ${
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
        disabled={submitting || (cloudinaryEnabled && !hasAll && newCount === 0)}
        className="w-full mt-7 py-3 bg-ocean-gradient text-white font-bold rounded-xl shadow-tile disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 size={18} className="animate-spin" />}
        {buttonLabel}
      </button>

      {onCancel && (
        <button
          onClick={onCancel}
          className="w-full mt-2 py-2 text-sm text-slate-500 hover:text-slate-700"
        >
          Cancel
        </button>
      )}
      <p className="text-center text-xs text-slate-400 mt-4">
        JPG, PNG up to 5 MB each.
      </p>
    </>
  );
}

export default IdentityUploader;
