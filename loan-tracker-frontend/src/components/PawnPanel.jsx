import React, { useState, useEffect } from "react";
import {
  Gem,
  Printer,
  PackageCheck,
  Gavel,
  X,
  AlertTriangle,
  MapPin,
  Tag,
  Hash,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

// Collateral panel for a pawn loan. Self-contained: loads the loan's
// collateral from /pawn/:id, shows the pledged item, and exposes the
// pawn-specific actions (print ticket, redeem, forfeit). Calls onChange()
// after a successful redeem/forfeit so the parent loan view refreshes.
export default function PawnPanel({ loanId, loanCode, loanStatus, onChange }) {
  const [collateral, setCollateral] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRedeem, setShowRedeem] = useState(false);
  const [showForfeit, setShowForfeit] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/pawn/${loanId}`);
      setCollateral(r.data?.data?.collateral || null);
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
  const fmtDate = (d) =>
    d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—";

  const printTicket = async () => {
    try {
      const res = await api.get(`/pawn/${loanId}/ticket`, { responseType: "blob" });
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: "application/pdf" }),
      );
      window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert("Failed to open ticket: " + (err.response?.data?.error || err.message));
    }
  };

  const STATUS_BADGE = {
    held: "bg-amber-100 text-amber-800",
    returned: "bg-emerald-100 text-emerald-800",
    forfeited: "bg-red-100 text-red-800",
    sold: "bg-slate-200 text-slate-800",
  };
  const STATUS_LABEL = {
    held: "Held",
    returned: "Returned to borrower",
    forfeited: "Forfeited",
    sold: "Forfeited & sold",
  };

  const isActive = loanStatus === "active";

  return (
    <div className="bg-white rounded-xl shadow-md border border-amber-100 mb-6 overflow-hidden">
      <div className="bg-amber-50 px-5 py-3 border-b border-amber-100 flex items-center justify-between">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Gem size={18} className="text-amber-600" /> Pawned Collateral
        </h3>
        <button
          onClick={printTicket}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg inline-flex items-center gap-1.5"
        >
          <Printer size={15} /> Pawn Ticket
        </button>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading collateral…</p>
        ) : !collateral ? (
          <p className="text-sm text-slate-500">No collateral record found.</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-lg font-bold text-slate-900">
                  {collateral.description}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-slate-600">
                  {collateral.category && (
                    <span className="inline-flex items-center gap-1">
                      <Tag size={13} /> {collateral.category}
                    </span>
                  )}
                  {collateral.serial_number && (
                    <span className="inline-flex items-center gap-1">
                      <Hash size={13} /> {collateral.serial_number}
                    </span>
                  )}
                  {collateral.storage_location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={13} /> {collateral.storage_location}
                    </span>
                  )}
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                  STATUS_BADGE[collateral.status] || "bg-slate-100 text-slate-700"
                }`}
              >
                {STATUS_LABEL[collateral.status] || collateral.status}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Appraised value</p>
                <p className="font-bold text-slate-900">
                  {money(collateral.appraised_value)}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">LTV</p>
                <p className="font-bold text-slate-900">
                  {parseFloat(collateral.ltv_percent || 0)}%
                </p>
              </div>
              {collateral.condition && (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Condition</p>
                  <p className="font-bold text-slate-900">{collateral.condition}</p>
                </div>
              )}
              {collateral.status === "sold" && (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Sold for</p>
                  <p className="font-bold text-slate-900">
                    {money(collateral.sale_amount)} · {fmtDate(collateral.sale_date)}
                  </p>
                </div>
              )}
              {collateral.returned_at && (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Returned</p>
                  <p className="font-bold text-slate-900">
                    {fmtDate(collateral.returned_at)}
                  </p>
                </div>
              )}
            </div>

            {isActive && (
              <PermissionGate role={["admin", "manager", "loan_officer"]}>
                <div className="flex flex-wrap gap-2 mt-5">
                  <button
                    onClick={() => setShowRedeem(true)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold inline-flex items-center gap-2"
                  >
                    <PackageCheck size={16} /> Redeem Item
                  </button>
                  <PermissionGate role={["admin", "manager"]}>
                    <button
                      onClick={() => setShowForfeit(true)}
                      className="px-4 py-2 bg-white border-2 border-red-200 text-red-700 hover:bg-red-50 rounded-lg font-semibold inline-flex items-center gap-2"
                    >
                      <Gavel size={16} /> Forfeit
                    </button>
                  </PermissionGate>
                </div>
              </PermissionGate>
            )}
          </>
        )}
      </div>

      {showRedeem && (
        <RedeemModal
          loanId={loanId}
          onClose={() => setShowRedeem(false)}
          onDone={() => {
            setShowRedeem(false);
            load();
            onChange?.();
          }}
        />
      )}
      {showForfeit && (
        <ForfeitModal
          loanId={loanId}
          loanCode={loanCode}
          onClose={() => setShowForfeit(false)}
          onDone={() => {
            setShowForfeit(false);
            load();
            onChange?.();
          }}
        />
      )}
    </div>
  );
}

function ModalShell({ title, icon: Icon, accent, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Icon size={18} className={accent} />
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function RedeemModal({ loanId, onClose, onDone }) {
  const [form, setForm] = useState({
    amount: "",
    payment_method: "Cash",
    payment_date: new Date().toISOString().split("T")[0],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(`/pawn/${loanId}/redeem`, {
        amount: form.amount === "" ? undefined : parseFloat(form.amount),
        payment_method: form.payment_method,
        payment_date: form.payment_date,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to redeem.");
      setBusy(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";
  const lbl = "block text-sm font-semibold text-gray-700 mb-1";

  return (
    <ModalShell
      title="Redeem Item"
      icon={PackageCheck}
      accent="text-emerald-600"
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Record the redemption payment. Leave the amount blank to settle the full
          outstanding balance. The item is marked returned once the loan is fully
          paid.
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
            <AlertTriangle size={15} /> {error}
          </div>
        )}
        <div>
          <label className={lbl}>Amount (optional)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Full outstanding balance"
            className={fld}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Method</label>
            <select
              value={form.payment_method}
              onChange={(e) =>
                setForm((f) => ({ ...f, payment_method: e.target.value }))
              }
              className={fld}
            >
              <option>Cash</option>
              <option>M-Pesa</option>
              <option>Bank Transfer</option>
              <option>Cheque</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Date</label>
            <input
              type="date"
              value={form.payment_date}
              max={new Date().toISOString().split("T")[0]}
              onChange={(e) =>
                setForm((f) => ({ ...f, payment_date: e.target.value }))
              }
              className={fld}
            />
          </div>
        </div>
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
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
          >
            {busy ? "Processing…" : "Confirm Redemption"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ForfeitModal({ loanId, loanCode, onClose, onDone }) {
  const [saleAmount, setSaleAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(`/pawn/${loanId}/forfeit`, {
        sale_amount: saleAmount === "" ? undefined : parseFloat(saleAmount),
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to forfeit.");
      setBusy(false);
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-red-500 focus:outline-none";

  return (
    <ModalShell title="Forfeit Collateral" icon={Gavel} accent="text-red-600" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2.5 rounded-lg text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            The borrower did not redeem <strong>{loanCode}</strong>. Forfeiting marks
            the loan defaulted and the lender keeps the item. This can't be undone.
          </span>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
            <AlertTriangle size={15} /> {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Sale amount (optional)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={saleAmount}
            onChange={(e) => setSaleAmount(e.target.value)}
            placeholder="If the item was sold to recover capital"
            className={fld}
          />
          <p className="text-xs text-slate-500 mt-1">
            Enter an amount only if you've sold the item — it's booked as capital
            recovered. Leave blank to simply keep the item.
          </p>
        </div>
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
            className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50"
          >
            {busy ? "Processing…" : "Confirm Forfeit"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
