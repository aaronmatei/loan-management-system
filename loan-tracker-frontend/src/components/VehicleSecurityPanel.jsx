import React, { useState, useEffect } from "react";
import {
  Car,
  Printer,
  Pencil,
  KeyRound,
  ShieldCheck,
  AlertTriangle,
  X,
  MapPin,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

// Vehicle security panel for a logbook loan. Loads the pledged vehicle from
// /loans/:id/vehicle-security and lets staff add/edit it, release the lien
// (loan paid off → logbook returned), repossess on default, or print the lien
// certificate. Calls onChange() after a mutation so the parent loan refreshes.
export default function VehicleSecurityPanel({ loanId, loanCode, loanStatus, onChange }) {
  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirm, setConfirm] = useState(null); // "release" | "repossess"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const r = await api.get(`/loans/${loanId}/vehicle-security`);
      setVehicle(r.data?.data?.vehicle || null);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [loanId]);

  const money = (v) =>
    "KES " +
    Number(v || 0).toLocaleString("en-KE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const printCertificate = async () => {
    try {
      const res = await api.get(`/loans/${loanId}/vehicle-security/certificate`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: "application/pdf" }),
      );
      window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert("Failed to open certificate: " + (err.response?.data?.error || err.message));
    }
  };

  const runAction = async (action) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/loans/${loanId}/vehicle-security/${action}`, {});
      setConfirm(null);
      await load();
      onChange?.();
    } catch (err) {
      setError(err.response?.data?.error || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const STATUS_BADGE = {
    active: "bg-amber-100 text-amber-800",
    released: "bg-emerald-100 text-emerald-800",
    repossessed: "bg-red-100 text-red-800",
  };
  const STATUS_LABEL = {
    active: "Lien active",
    released: "Lien released",
    repossessed: "Repossessed",
  };

  const vehicleName = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"
    : "";

  return (
    <div className="bg-white rounded-xl shadow-md border border-sky-100 mb-6 overflow-hidden">
      <div className="bg-sky-50 px-5 py-3 border-b border-sky-100 flex items-center justify-between">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Car size={18} className="text-sky-600" /> Vehicle Security (Logbook)
        </h3>
        {vehicle && (
          <button
            onClick={printCertificate}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"
          >
            <Printer size={15} /> Certificate
          </button>
        )}
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading vehicle…</p>
        ) : !vehicle ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              No vehicle on file yet for this logbook loan.
            </p>
            <PermissionGate role={["admin", "manager", "loan_officer"]}>
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold text-sm"
              >
                + Add Vehicle
              </button>
            </PermissionGate>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-lg font-bold text-slate-900">{vehicleName}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-slate-600">
                  <span className="font-mono font-semibold">
                    {vehicle.registration_number}
                  </span>
                  {vehicle.color && <span>{vehicle.color}</span>}
                  {vehicle.storage_location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={13} /> Logbook: {vehicle.storage_location}
                    </span>
                  )}
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                  STATUS_BADGE[vehicle.lien_status] || "bg-slate-100 text-slate-700"
                }`}
              >
                {STATUS_LABEL[vehicle.lien_status] || vehicle.lien_status}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Valuation</p>
                <p className="font-bold text-slate-900">{money(vehicle.valuation)}</p>
              </div>
              {vehicle.logbook_number && (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Logbook no.</p>
                  <p className="font-bold text-slate-900 font-mono text-xs">
                    {vehicle.logbook_number}
                  </p>
                </div>
              )}
              {vehicle.chassis_number && (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Chassis</p>
                  <p className="font-bold text-slate-900 font-mono text-xs">
                    {vehicle.chassis_number}
                  </p>
                </div>
              )}
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Logbook</p>
                <p className="font-bold text-slate-900">
                  {vehicle.logbook_held ? "Held by lender" : "With borrower"}
                </p>
              </div>
            </div>

            {error && (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                <AlertTriangle size={15} /> {error}
              </div>
            )}

            {vehicle.lien_status === "active" && (
              <PermissionGate role={["admin", "manager", "loan_officer"]}>
                <div className="flex flex-wrap gap-2 mt-5">
                  <button
                    onClick={() => setShowForm(true)}
                    className="px-4 py-2 bg-white border-2 border-sky-200 text-sky-700 hover:bg-sky-50 rounded-lg font-semibold inline-flex items-center gap-2"
                  >
                    <Pencil size={16} /> Edit
                  </button>
                  <PermissionGate role={["admin", "manager"]}>
                    <button
                      onClick={() => setConfirm("release")}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center gap-2"
                    >
                      <ShieldCheck size={16} /> Release Lien
                    </button>
                    <button
                      onClick={() => setConfirm("repossess")}
                      className="px-4 py-2 bg-white border-2 border-red-200 text-red-700 hover:bg-red-50 rounded-lg font-semibold inline-flex items-center gap-2"
                    >
                      <KeyRound size={16} /> Repossess
                    </button>
                  </PermissionGate>
                </div>
              </PermissionGate>
            )}
          </>
        )}
      </div>

      {showForm && (
        <VehicleFormModal
          loanId={loanId}
          existing={vehicle}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
            onChange?.();
          }}
        />
      )}

      {confirm && (
        <ConfirmModal
          kind={confirm}
          loanCode={loanCode}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => runAction(confirm)}
        />
      )}
    </div>
  );
}

function VehicleFormModal({ loanId, existing, onClose, onSaved }) {
  const [form, setForm] = useState({
    make: existing?.make || "",
    model: existing?.model || "",
    year: existing?.year || "",
    registration_number: existing?.registration_number || "",
    logbook_number: existing?.logbook_number || "",
    chassis_number: existing?.chassis_number || "",
    engine_number: existing?.engine_number || "",
    color: existing?.color || "",
    valuation: existing?.valuation || "",
    storage_location: existing?.storage_location || "",
    logbook_held: existing ? existing.logbook_held : true,
    notes: existing?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.registration_number.trim())
      return setError("Registration number is required.");
    if (!(parseFloat(form.valuation) > 0))
      return setError("Enter the vehicle valuation.");
    setBusy(true);
    try {
      await api.post(`/loans/${loanId}/vehicle-security`, {
        ...form,
        year: form.year ? parseInt(form.year, 10) : null,
        valuation: parseFloat(form.valuation),
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save.");
      setBusy(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-sky-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Car size={18} className="text-sky-600" />
            <h3 className="text-lg font-bold text-slate-900">
              {existing ? "Edit Vehicle" : "Add Vehicle"}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className={lbl}>Make</label>
              <input value={form.make} onChange={set("make")} placeholder="Toyota" className={fld} />
            </div>
            <div>
              <label className={lbl}>Model</label>
              <input value={form.model} onChange={set("model")} placeholder="Premio" className={fld} />
            </div>
            <div>
              <label className={lbl}>Year</label>
              <input
                type="number"
                value={form.year}
                onChange={set("year")}
                placeholder="2015"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Registration *</label>
              <input
                value={form.registration_number}
                onChange={set("registration_number")}
                placeholder="KCA 123A"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Colour</label>
              <input value={form.color} onChange={set("color")} placeholder="Silver" className={fld} />
            </div>
            <div>
              <label className={lbl}>Valuation *</label>
              <input
                type="number"
                value={form.valuation}
                onChange={set("valuation")}
                placeholder="800000"
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Logbook no.</label>
              <input
                value={form.logbook_number}
                onChange={set("logbook_number")}
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Chassis no.</label>
              <input
                value={form.chassis_number}
                onChange={set("chassis_number")}
                className={fld}
              />
            </div>
            <div>
              <label className={lbl}>Engine no.</label>
              <input
                value={form.engine_number}
                onChange={set("engine_number")}
                className={fld}
              />
            </div>
          </div>
          <div>
            <label className={lbl}>Logbook storage location</label>
            <input
              value={form.storage_location}
              onChange={set("storage_location")}
              placeholder="Safe / file reference"
              className={fld}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={!!form.logbook_held}
              onChange={(e) => setForm((f) => ({ ...f, logbook_held: e.target.checked }))}
            />
            Logbook is physically held by the lender
          </label>
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save Vehicle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({ kind, loanCode, busy, onCancel, onConfirm }) {
  const isRelease = kind === "release";
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-12"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          {isRelease ? (
            <ShieldCheck size={18} className="text-emerald-600" />
          ) : (
            <KeyRound size={18} className="text-red-600" />
          )}
          <h3 className="text-lg font-bold text-slate-900">
            {isRelease ? "Release Lien" : "Repossess Vehicle"}
          </h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            {isRelease ? (
              <>
                Confirm the loan <strong>{loanCode}</strong> is settled. The lien is
                cleared and the logbook is handed back to the borrower.
              </>
            ) : (
              <>
                The borrower defaulted on <strong>{loanCode}</strong>. The lender
                exercises the lien and repossesses the vehicle. This can't be undone.
              </>
            )}
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className={`px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 ${
                isRelease ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {busy ? "Processing…" : isRelease ? "Release" : "Repossess"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
