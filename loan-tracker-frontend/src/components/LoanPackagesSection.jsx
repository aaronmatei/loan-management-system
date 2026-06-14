import React, { useState, useEffect } from "react";
import {
  Package as PackageIcon,
  Plus,
  X,
  Pencil,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import api from "../services/api";
import { LOAN_PURPOSES } from "../utils/loanPurposes";
import { LOAN_TYPES, loanTypeLabel } from "../utils/loanTypes";
import Spinner from "./Spinner";

// Loan packages — per-tenant loan products. A package locks the
// financial mechanics (rate, processing fee, interest method) and
// range-validates amount + duration when staff or a customer applies
// for a loan referencing it. Archived packages stay in the DB so
// historical loans can still resolve via loans.package_id; they're
// just hidden from create-loan dropdowns.
const CLIENT_TYPE_CHOICES = [
  { value: "individual", label: "Individual" },
  { value: "group", label: "Group" },
  { value: "business", label: "Business" },
];

// Which optional fields each loan type needs. Core fields (name, amount range,
// duration, rate) show for every type; these flags drive the rest so the form
// only asks for what the chosen type uses. Pawn is a flat-fee bullet secured by
// the item, so it drops interest method, processing fee, credit score, client
// types and purposes; secured types skip the credit-score gate.
const TYPE_FIELDS = {
  personal: { interestMethod: true, processingFee: true, creditScore: true, clientTypes: true, purposes: true },
  pawn: { interestMethod: false, processingFee: false, creditScore: false, clientTypes: false, purposes: false },
  logbook: { interestMethod: true, processingFee: true, creditScore: false, clientTypes: true, purposes: true },
  salary: { interestMethod: true, processingFee: true, creditScore: true, clientTypes: true, purposes: true },
  group: { interestMethod: true, processingFee: true, creditScore: true, clientTypes: true, purposes: false },
};
const fieldsFor = (t) => TYPE_FIELDS[t] || TYPE_FIELDS.personal;

function LoanPackagesSection() {
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const blank = {
    name: "",
    description: "",
    annual_interest_rate: "",
    // Display companion — kept in sync with annual_interest_rate.
    // Backend only stores annual; this is purely UI sugar.
    monthly_interest_rate: "",
    processing_fee_rate: "",
    interest_method: "flat",
    min_amount: "",
    max_amount: "",
    min_duration_months: "",
    max_duration_months: "",
    min_credit_score: "",
    allowed_client_types: [],
    allowed_branch_ids: [],
    allowed_purposes: [],
    loan_type: "personal",
  };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  // Filter the listing by loan type ("all" = no filter).
  const [typeFilter, setTypeFilter] = useState("all");
  // Which rows are expanded — stored as a Set so toggling is O(1)
  // and unrelated rows don't re-render. The whole row is the
  // affordance (click anywhere except the action buttons toggles).
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const toggleExpanded = (id) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get("/packages"),
      api.get("/branches").catch(() => ({ data: { data: [] } })),
    ])
      .then(([pkgs, brs]) => {
        setRows(pkgs.data.data || []);
        setBranches((brs.data.data || []).filter((b) => b.active));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Annual ⇄ monthly two-way sync. Whichever field the admin types is
  // kept verbatim; the other is derived (annual = monthly × 12).
  // Rounding trims trailing zeros so "1.5" doesn't display as
  // "1.5000". Same shape as the Loan Policy form for consistency.
  const roundRate = (n) => Math.round(Number(n) * 10000) / 10000;
  const onAnnualRateChange = (v) =>
    setForm((p) => ({
      ...p,
      annual_interest_rate: v,
      monthly_interest_rate: v === "" ? "" : String(roundRate(parseFloat(v) / 12)),
    }));
  const onMonthlyRateChange = (v) =>
    setForm((p) => ({
      ...p,
      monthly_interest_rate: v,
      annual_interest_rate: v === "" ? "" : String(roundRate(parseFloat(v) * 12)),
    }));

  // Switching loan type neutralises the fields that type doesn't use, so a
  // hidden field can't silently carry a stale value into the saved package.
  const onLoanTypeChange = (v) => {
    const cfg = fieldsFor(v);
    setForm((p) => ({
      ...p,
      loan_type: v,
      interest_method: cfg.interestMethod ? p.interest_method : "flat",
      processing_fee_rate: cfg.processingFee ? p.processing_fee_rate : "",
      min_credit_score: cfg.creditScore ? p.min_credit_score : "",
      allowed_client_types: cfg.clientTypes ? p.allowed_client_types : [],
      allowed_purposes: cfg.purposes ? p.allowed_purposes : [],
    }));
  };

  // Toggle a value in/out of an array field on the form.
  const toggleInArray = (field, value) => {
    setForm((prev) => {
      const cur = prev[field] || [];
      return {
        ...prev,
        [field]: cur.includes(value)
          ? cur.filter((v) => v !== value)
          : [...cur, value],
      };
    });
  };

  const startAdd = () => {
    setEditingId(null);
    setForm(blank);
    setError("");
    setAdding(true);
  };
  const startEdit = (p) => {
    setAdding(false);
    setEditingId(p.id);
    const annual = p.annual_interest_rate ?? "";
    setForm({
      name: p.name || "",
      description: p.description || "",
      annual_interest_rate: annual,
      monthly_interest_rate:
        annual === "" || annual == null
          ? ""
          : String(roundRate(parseFloat(annual) / 12)),
      processing_fee_rate: p.processing_fee_rate ?? "",
      interest_method: p.interest_method || "flat",
      loan_type: p.loan_type || "personal",
      min_amount: p.min_amount ?? "",
      max_amount: p.max_amount ?? "",
      min_duration_months: p.min_duration_months ?? "",
      max_duration_months: p.max_duration_months ?? "",
      min_credit_score: p.min_credit_score ?? "",
      allowed_client_types: Array.isArray(p.allowed_client_types)
        ? p.allowed_client_types
        : [],
      allowed_branch_ids: Array.isArray(p.allowed_branch_ids)
        ? p.allowed_branch_ids.map((id) => Number(id))
        : [],
      allowed_purposes: Array.isArray(p.allowed_purposes)
        ? p.allowed_purposes
        : [],
    });
    setError("");
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setForm(blank);
    setError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (editingId) {
        await api.put(`/packages/${editingId}`, form);
      } else {
        await api.post("/packages", form);
      }
      cancel();
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save package");
    }
  };

  const archive = async (p) => {
    if (!confirm(`Archive package "${p.name}"?`)) return;
    try {
      await api.delete(`/packages/${p.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to archive");
    }
  };
  const restore = async (p) => {
    try {
      await api.put(`/packages/${p.id}`, { active: true });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to restore");
    }
  };

  const fld =
    "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";
  const editingOrAdding = adding || editingId !== null;
  const cfg = fieldsFor(form.loan_type);
  const visibleRows =
    typeFilter === "all"
      ? rows
      : rows.filter((p) => (p.loan_type || "personal") === typeFilter);

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <PackageIcon size={22} /> Loan Packages
        </h2>
        {!editingOrAdding && (
          <button
            onClick={startAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ocean-gradient text-white text-sm font-semibold rounded-lg hover:shadow-lg transition"
          >
            <Plus size={14} /> Add Package
          </button>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Pre-configured loan products. A package locks the rate, fee, and
        interest method, and validates the amount + duration when staff
        apply a loan using it.
      </p>

      {editingOrAdding && (
        <form
          onSubmit={save}
          className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 space-y-3"
        >
          <div>
            <label className="block text-sm font-semibold mb-1">Loan Type *</label>
            <select
              value={form.loan_type}
              onChange={(e) => onLoanTypeChange(e.target.value)}
              className={fld}
            >
              {LOAN_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {(LOAN_TYPES.find((t) => t.key === form.loan_type) || {}).description}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="Quick Cash 30"
                className={fld}
              />
            </div>
            {cfg.interestMethod && (
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Interest Method *
                </label>
                <select
                  value={form.interest_method}
                  onChange={(e) =>
                    setForm({ ...form, interest_method: e.target.value })
                  }
                  className={`${fld} bg-white`}
                >
                  <option value="flat">Flat — interest spread evenly</option>
                  <option value="reducing">
                    Reducing balance — EMI / amortized
                  </option>
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">
              Description
            </label>
            <input
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Short, customer-facing description"
              className={fld}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Min Amount *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.min_amount}
                onChange={(e) =>
                  setForm({ ...form, min_amount: e.target.value })
                }
                required
                placeholder="5000"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Max Amount *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.max_amount}
                onChange={(e) =>
                  setForm({ ...form, max_amount: e.target.value })
                }
                required
                placeholder="50000"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Min Months *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.min_duration_months}
                onChange={(e) =>
                  setForm({ ...form, min_duration_months: e.target.value })
                }
                required
                placeholder="1"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Max Months *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.max_duration_months}
                onChange={(e) =>
                  setForm({ ...form, max_duration_months: e.target.value })
                }
                required
                placeholder="12"
                className={fld}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Annual Interest Rate (%) *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.annual_interest_rate}
                onChange={(e) => onAnnualRateChange(e.target.value)}
                required
                placeholder="18"
                className={fld}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                Monthly Interest Rate (%) *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.monthly_interest_rate}
                onChange={(e) => onMonthlyRateChange(e.target.value)}
                required
                placeholder="1.5"
                className={fld}
              />
              <p className="text-xs text-gray-500 mt-1">
                {form.loan_type === "pawn"
                  ? "For pawn, the monthly rate is the fee charged per month on the amount advanced."
                  : "Synced with annual (annual ÷ 12). Edit either one."}
              </p>
            </div>
            {cfg.processingFee && (
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Processing Fee (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.processing_fee_rate}
                  onChange={(e) =>
                    setForm({ ...form, processing_fee_rate: e.target.value })
                  }
                  placeholder="3"
                  className={fld}
                />
              </div>
            )}
          </div>
          {/* Eligibility — three optional gates that block apply for
              clients who don't qualify. All default to "no restriction"
              so leaving them blank keeps the package open. */}
          <div className="border-t border-gray-200 pt-3 mt-1">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
              Eligibility (optional)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {cfg.creditScore && (
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Min Credit Score (0–100)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={form.min_credit_score}
                  onChange={(e) =>
                    setForm({ ...form, min_credit_score: e.target.value })
                  }
                  placeholder="Leave blank for no minimum"
                  className={fld}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Unrated clients fail any minimum.
                </p>
              </div>
              )}
              {cfg.clientTypes && (
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Allowed Client Types
                </label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {CLIENT_TYPE_CHOICES.map((c) => {
                    const on = form.allowed_client_types.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() =>
                          toggleInArray("allowed_client_types", c.value)
                        }
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                          on
                            ? "bg-ocean-600 text-white border-ocean-600"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  None selected = all types allowed.
                </p>
              </div>
              )}
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Allowed Branches
                </label>
                {branches.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    Add branches in the Branches section first.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {branches.map((b) => {
                      const on = form.allowed_branch_ids.includes(b.id);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() =>
                            toggleInArray("allowed_branch_ids", b.id)
                          }
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                            on
                              ? "bg-ocean-600 text-white border-ocean-600"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          {b.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  None selected = all branches.
                </p>
              </div>
            </div>

            {/* Purposes pin which loan purposes the customer can pick
                on the apply form. None selected = the full canonical
                list (default behavior). */}
            {cfg.purposes && (
            <div className="mt-3">
              <label className="block text-sm font-semibold mb-1">
                Allowed Purposes
              </label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {LOAN_PURPOSES.map((p) => {
                  const on = form.allowed_purposes.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => toggleInArray("allowed_purposes", p)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                        on
                          ? "bg-ocean-600 text-white border-ocean-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                None selected = the customer can pick any purpose.
              </p>
            </div>
            )}
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-ocean-gradient text-white text-sm font-semibold rounded-lg hover:shadow-lg transition"
            >
              <Check size={14} /> {editingId ? "Save Changes" : "Create Package"}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg hover:bg-gray-300 transition"
            >
              <X size={14} /> Cancel
            </button>
          </div>
        </form>
      )}

      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <label className="text-sm font-semibold text-gray-600">Loan type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm bg-white focus:border-ocean-500 focus:outline-none"
          >
            <option value="all">All types</option>
            {LOAN_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">
            {visibleRows.length} of {rows.length}
          </span>
        </div>
      )}

      {loading ? (
        <Spinner centered className="py-6" size={28} label="Loading packages…" />
      ) : rows.length === 0 ? (
        <div className="text-gray-500 text-sm">No packages yet.</div>
      ) : visibleRows.length === 0 ? (
        <div className="text-gray-500 text-sm">
          No {loanTypeLabel(typeFilter)} packages.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b border-gray-200">
                <th className="w-8" aria-hidden="true"></th>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Method</th>
                <th className="px-3 py-2 font-semibold text-right">Rate p.a.</th>
                <th className="px-3 py-2 font-semibold text-right">Rate p.m.</th>
                <th className="px-3 py-2 font-semibold text-right">Fee</th>
                <th className="px-3 py-2 font-semibold text-right">Amount</th>
                <th className="px-3 py-2 font-semibold text-right">Months</th>
                <th className="px-3 py-2 font-semibold text-right">Loans</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((p) => {
                const expanded = expandedIds.has(p.id);
                return (
                  <React.Fragment key={p.id}>
                    <tr
                      onClick={() => toggleExpanded(p.id)}
                      className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition ${
                        p.active ? "" : "opacity-60"
                      }`}
                    >
                      <td className="px-2 py-2 text-gray-400">
                        {expanded ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-gray-800">
                          {p.name}
                          {!p.active && (
                            <span className="ml-2 text-xs text-gray-500">
                              (archived)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                            (p.loan_type || "personal") === "personal"
                              ? "bg-slate-100 text-slate-600"
                              : "bg-violet-100 text-violet-700"
                          }`}
                        >
                          {loanTypeLabel(p.loan_type)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            p.interest_method === "reducing"
                              ? "bg-ocean-100 text-ocean-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {p.interest_method === "reducing"
                            ? "Reducing"
                            : "Flat"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {Number(p.annual_interest_rate).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">
                        {(Number(p.annual_interest_rate) / 12).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        {Number(p.processing_fee_rate).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {Number(p.min_amount).toLocaleString()} –{" "}
                        {Number(p.max_amount).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {p.min_duration_months} – {p.max_duration_months}
                      </td>
                      <td className="px-3 py-2 text-right">{p.loan_count}</td>
                      <td
                        className="px-3 py-2 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => startEdit(p)}
                            className="p-1 text-gray-700 hover:bg-gray-100 rounded"
                            title="Edit"
                          >
                            <Pencil size={16} />
                          </button>
                          {p.active ? (
                            <button
                              onClick={() => archive(p)}
                              className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                              title="Archive"
                            >
                              <Archive size={16} />
                            </button>
                          ) : (
                            <button
                              onClick={() => restore(p)}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                              title="Restore"
                            >
                              <ArchiveRestore size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <td></td>
                        <td colSpan={10} className="px-3 py-3">
                          <div className="space-y-2">
                            {p.description ? (
                              <p className="text-sm text-gray-700">
                                {p.description}
                              </p>
                            ) : (
                              <p className="text-sm text-gray-400 italic">
                                No description.
                              </p>
                            )}
                            {(p.min_credit_score != null ||
                              (p.allowed_client_types || []).length > 0 ||
                              (p.allowed_branch_ids || []).length > 0) && (
                              <div className="flex flex-wrap gap-3 text-xs text-gray-600 pt-1">
                                {p.min_credit_score != null && (
                                  <span>
                                    <span className="font-semibold">
                                      Min score:
                                    </span>{" "}
                                    {p.min_credit_score}
                                  </span>
                                )}
                                {(p.allowed_client_types || []).length > 0 && (
                                  <span>
                                    <span className="font-semibold">
                                      Client types:
                                    </span>{" "}
                                    {p.allowed_client_types.join(", ")}
                                  </span>
                                )}
                                {(p.allowed_branch_ids || []).length > 0 && (
                                  <span>
                                    <span className="font-semibold">
                                      Branches:
                                    </span>{" "}
                                    {p.allowed_branch_ids.length} restricted
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default LoanPackagesSection;
