import React, { useState, useEffect, useMemo } from "react";
import { X, Package, Search, Gem, AlertTriangle, ImagePlus } from "lucide-react";
import api from "../services/api";

// New Pawn Loan. A pawn is created immediately as an ACTIVE loan: the lender
// takes a pledged item, values it, advances cash up to LTV% of the value, and
// books a single bullet repayment (principal + a flat fee) due at maturity.
// This is intentionally a separate flow from the standard loan application —
// there is no approval/disbursement workflow. POSTs to /pawn.
export default function PawnLoanModal({ clients = [], onClose, onCreated, application = null }) {
  const [packages, setPackages] = useState([]);
  const [loadingPkgs, setLoadingPkgs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [photos, setPhotos] = useState([]); // uploaded image URLs
  const [uploading, setUploading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");

  useEffect(() => {
    api.get("/branches").then((r) => setBranches((r.data.data || []).filter((b) => b.active))).catch(() => {});
  }, []);

  const uploadPhotos = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).slice(0, 6).forEach((f) => fd.append("photos", f));
      const r = await api.post("/pawn/photos", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPhotos((p) => [...p, ...(r.data.urls || [])]);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't upload photos.");
    } finally {
      setUploading(false);
    }
  };

  // When converting a customer pawn request, prefill from the application.
  const [form, setForm] = useState({
    client_id: application ? String(application.client_id) : "",
    package_id: "",
    item_category: application?.item_category || "",
    item_description: application?.item_description || "",
    serial_number: application?.serial_number || "",
    item_condition: application?.condition || "",
    storage_location: "",
    appraised_value: application?.offered_amount || application?.estimated_value || "",
    ltv_percent: "50",
    principal_amount: "",
    duration_months: "",
    monthly_fee_percent: "", // used when no package (custom pawn)
  });

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/packages");
        const pawn = (r.data.data || []).filter(
          (p) => p.active && p.loan_type === "pawn",
        );
        setPackages(pawn);
      } catch {
        /* non-fatal */
      } finally {
        setLoadingPkgs(false);
      }
    })();
    // Prefill defaults from the pawnshop's settings (LTV / monthly fee / term).
    api.get("/pawn/settings").then((r) => {
      const s = r.data?.data;
      if (!s) return;
      setForm((f) => ({
        ...f,
        ltv_percent: f.ltv_percent && f.ltv_percent !== "50" ? f.ltv_percent : String(s.default_ltv_percent ?? 50),
        monthly_fee_percent: f.monthly_fee_percent || String(s.default_monthly_fee_percent ?? ""),
        duration_months: f.duration_months || String(s.default_duration_months ?? ""),
      }));
    }).catch(() => {});
  }, []);

  const selectedClient = clients.find(
    (c) => String(c.id) === String(form.client_id),
  );
  const pkg = packages.find((p) => String(p.id) === String(form.package_id));

  // When a package is picked, seed the duration from its configured range.
  useEffect(() => {
    if (!pkg) return;
    setForm((f) => ({
      ...f,
      duration_months:
        f.duration_months ||
        String(pkg.min_duration_months || pkg.max_duration_months || 1),
    }));
  }, [pkg]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const calc = useMemo(() => {
    const value = parseFloat(form.appraised_value) || 0;
    const ltv = parseFloat(form.ltv_percent) || 0;
    const maxLoan = Math.round(value * (ltv / 100) * 100) / 100;
    const principal =
      form.principal_amount !== "" ? parseFloat(form.principal_amount) || 0 : maxLoan;
    const months = parseInt(form.duration_months, 10) || 0;
    const monthlyFeePct = pkg
      ? parseFloat(pkg.annual_interest_rate) / 12
      : parseFloat(form.monthly_fee_percent) || 0;
    const fee = Math.round(principal * (monthlyFeePct / 100) * months * 100) / 100;
    const total = Math.round((principal + fee) * 100) / 100;
    return { value, ltv, maxLoan, principal, months, monthlyFeePct, fee, total };
  }, [form, pkg]);

  const money = (v) =>
    "KES " +
    Number(v || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const filteredClients = clients.filter((c) => {
    if (!clientSearch) return true;
    const s = clientSearch.toLowerCase();
    return (
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(s) ||
      (c.phone_number || "").toLowerCase().includes(s) ||
      (c.client_code || "").toLowerCase().includes(s) ||
      (c.id_number || "").toLowerCase().includes(s)
    );
  });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.client_id) return setError("Select a client.");
    if (!form.item_description.trim())
      return setError("Describe the pledged item.");
    if (!(calc.value > 0)) return setError("Enter the appraised value.");
    if (!form.package_id && !(parseFloat(form.monthly_fee_percent) >= 0))
      return setError("Enter a monthly fee % (or pick a package).");
    if (!(calc.months > 0)) return setError("Enter the term in months.");
    if (!(calc.principal > 0)) return setError("Loan amount must be positive.");
    if (calc.principal > calc.maxLoan)
      return setError(
        `Loan can't exceed ${calc.ltv}% of value (max ${money(calc.maxLoan)}).`,
      );
    setSubmitting(true);
    try {
      const r = await api.post("/pawn", {
        client_id: form.client_id,
        ...(form.package_id
          ? { package_id: form.package_id }
          : { monthly_fee_percent: parseFloat(form.monthly_fee_percent) }),
        appraised_value: calc.value,
        ltv_percent: calc.ltv,
        duration_months: calc.months,
        principal_amount: calc.principal,
        item_category: form.item_category || null,
        item_description: form.item_description,
        serial_number: form.serial_number || null,
        item_condition: form.item_condition || null,
        storage_location: form.storage_location || null,
        ...(photos.length ? { photos } : {}),
        ...(branchId ? { branch_id: branchId } : {}),
        ...(application ? { application_id: application.id } : {}),
      });
      onCreated?.(r.data?.data?.loan);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create pawn loan.");
    } finally {
      setSubmitting(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-amber-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-amber-50 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Gem size={20} className="text-amber-600" />
            <h3 className="text-lg font-bold text-slate-900">New Pawn Loan</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle size={16} className="flex-shrink-0" /> {error}
            </div>
          )}

          {!loadingPkgs && packages.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
              <Package size={16} className="flex-shrink-0" />
              No pawn packages yet — you can still create a custom pawn below by
              setting the monthly fee directly.
            </div>
          )}

          {/* Client */}
          <div className="relative">
            <label className={lbl}>Client *</label>
            {selectedClient ? (
              <div className="flex items-center gap-2 p-3 border-2 border-amber-300 bg-amber-50 rounded-lg">
                <div className="flex-1">
                  <p className="font-semibold text-amber-900">
                    {selectedClient.first_name} {selectedClient.last_name}
                  </p>
                  <p className="text-sm text-amber-700">
                    {selectedClient.client_code} • {selectedClient.phone_number}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, client_id: "" }))}
                  className="text-red-600 hover:text-red-800 px-2"
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-3 text-gray-400"
                  />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Search clients by name, phone, or ID..."
                    className={fld + " pl-9"}
                  />
                </div>
                {showDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {filteredClients.length === 0 ? (
                      <div className="p-3 text-center text-gray-500 text-sm">
                        {clients.length === 0
                          ? "No clients yet — add a client first."
                          : `No clients found matching "${clientSearch}"`}
                      </div>
                    ) : (
                      filteredClients.slice(0, 30).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setForm((f) => ({ ...f, client_id: c.id }));
                            setShowDropdown(false);
                            setClientSearch("");
                          }}
                          className="w-full text-left p-3 hover:bg-amber-50 border-b border-gray-100 last:border-0"
                        >
                          <p className="font-semibold text-gray-800 text-sm">
                            {c.first_name} {c.last_name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {c.client_code} • {c.phone_number}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Package (optional — leave as Custom to set the fee directly) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Pawn Package</label>
              <select
                value={form.package_id}
                onChange={set("package_id")}
                className={fld}
              >
                <option value="">Custom — no package</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {parseFloat(p.annual_interest_rate)}% p.a.
                  </option>
                ))}
              </select>
              {pkg && (
                <p className="text-xs text-gray-500 mt-1">
                  Flat fee ≈ {(parseFloat(pkg.annual_interest_rate) / 12).toFixed(2)}
                  % of principal per month.
                </p>
              )}
            </div>
            {!form.package_id && (
              <div>
                <label className={lbl}>Monthly fee % *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthly_fee_percent}
                  onChange={set("monthly_fee_percent")}
                  placeholder="e.g. 10"
                  className={fld}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Fee charged per month on the amount advanced.
                </p>
              </div>
            )}
          </div>

          {/* Item */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={lbl}>Item Description *</label>
              <input
                type="text"
                value={form.item_description}
                onChange={set("item_description")}
                placeholder="e.g. Apple iPhone 13 Pro 256GB"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Category</label>
              <input
                type="text"
                value={form.item_category}
                onChange={set("item_category")}
                placeholder="Electronics, Jewellery…"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Serial / Identifier</label>
              <input
                type="text"
                value={form.serial_number}
                onChange={set("serial_number")}
                placeholder="IMEI / serial no."
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Condition</label>
              <input
                type="text"
                value={form.item_condition}
                onChange={set("item_condition")}
                placeholder="Good, minor scratches…"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Storage Location</label>
              <input
                type="text"
                value={form.storage_location}
                onChange={set("storage_location")}
                placeholder="Safe A, Shelf 3"
                className={fld}
              />
            </div>
            {branches.length > 1 && (
              <div>
                <label className={lbl}>Branch</label>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={fld}>
                  <option value="">— Default / borrower's branch —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{b.is_default ? " (default)" : ""}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Item photos */}
          <div>
            <label className={lbl}>Photos</label>
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((src, i) => (
                <div key={i} className="relative">
                  <img src={src} alt="" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
                  <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 bg-white rounded-full border border-gray-200 text-slate-500 hover:text-red-600"><X size={13} /></button>
                </div>
              ))}
              <label className="h-16 w-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-slate-400 hover:border-ocean-400 hover:text-ocean-500 cursor-pointer">
                {uploading ? <span className="text-xs">…</span> : <ImagePlus size={20} />}
                <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => { uploadPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-1">Up to 6 images, 5 MB each. The customer sees these in their portal.</p>
          </div>

          {/* Valuation */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={lbl}>Appraised Value *</label>
              <input
                type="number"
                min="0"
                value={form.appraised_value}
                onChange={set("appraised_value")}
                placeholder="20000"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>LTV %</label>
              <input
                type="number"
                min="1"
                max="100"
                value={form.ltv_percent}
                onChange={set("ltv_percent")}
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Term (months)</label>
              <input
                type="number"
                min="1"
                value={form.duration_months}
                onChange={set("duration_months")}
                className={fld}
              />
            </div>
            <div className="sm:col-span-3">
              <label className={lbl}>
                Loan Amount{" "}
                <span className="text-gray-500 font-normal">
                  (max {money(calc.maxLoan)} at {calc.ltv}% LTV)
                </span>
              </label>
              <input
                type="number"
                min="0"
                value={form.principal_amount}
                onChange={set("principal_amount")}
                placeholder={String(calc.maxLoan || "")}
                className={fld}
              />
            </div>
          </div>

          {/* Summary */}
          {calc.monthlyFeePct > 0 && calc.principal > 0 && calc.months > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Loan amount (advanced)</span>
                <span className="font-semibold">{money(calc.principal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">
                  Pawn fee ({calc.monthlyFeePct.toFixed(2)}% × {calc.months} mo)
                </span>
                <span className="font-semibold">{money(calc.fee)}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200">
                <span className="font-bold text-gray-800">
                  Redemption total (due at maturity)
                </span>
                <span className="font-bold text-amber-700">
                  {money(calc.total)}
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Pawn Loan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
