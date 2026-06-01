import React, { useState, useEffect } from "react";
import {
  Package as PackageIcon,
  Plus,
  X,
  Pencil,
  Archive,
  ArchiveRestore,
  Check,
} from "lucide-react";
import api from "../services/api";

// Loan packages — per-tenant loan products. A package locks the
// financial mechanics (rate, processing fee, interest method) and
// range-validates amount + duration when staff or a customer applies
// for a loan referencing it. Archived packages stay in the DB so
// historical loans can still resolve via loans.package_id; they're
// just hidden from create-loan dropdowns.
function LoanPackagesSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const blank = {
    name: "",
    description: "",
    annual_interest_rate: "",
    processing_fee_rate: "",
    interest_method: "flat",
    min_amount: "",
    max_amount: "",
    min_duration_months: "",
    max_duration_months: "",
  };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api
      .get("/packages")
      .then((r) => setRows(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const startAdd = () => {
    setEditingId(null);
    setForm(blank);
    setError("");
    setAdding(true);
  };
  const startEdit = (p) => {
    setAdding(false);
    setEditingId(p.id);
    setForm({
      name: p.name || "",
      description: p.description || "",
      annual_interest_rate: p.annual_interest_rate ?? "",
      processing_fee_rate: p.processing_fee_rate ?? "",
      interest_method: p.interest_method || "flat",
      min_amount: p.min_amount ?? "",
      max_amount: p.max_amount ?? "",
      min_duration_months: p.min_duration_months ?? "",
      max_duration_months: p.max_duration_months ?? "",
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">
                Annual Interest Rate (%) *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.annual_interest_rate}
                onChange={(e) =>
                  setForm({ ...form, annual_interest_rate: e.target.value })
                }
                required
                placeholder="18"
                className={fld}
              />
            </div>
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

      {loading ? (
        <div className="text-gray-500 text-sm">Loading packages…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 text-sm">No packages yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b border-gray-200">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Method</th>
                <th className="px-3 py-2 font-semibold text-right">Rate p.a.</th>
                <th className="px-3 py-2 font-semibold text-right">Fee</th>
                <th className="px-3 py-2 font-semibold text-right">Amount</th>
                <th className="px-3 py-2 font-semibold text-right">Months</th>
                <th className="px-3 py-2 font-semibold text-right">Loans</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-gray-100 ${
                    p.active ? "" : "opacity-60"
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-gray-800">
                      {p.name}
                      {!p.active && (
                        <span className="ml-2 text-xs text-gray-500">
                          (archived)
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <div className="text-xs text-gray-500">
                        {p.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                        p.interest_method === "reducing"
                          ? "bg-indigo-100 text-indigo-700"
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
                  <td className="px-3 py-2 text-right">
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default LoanPackagesSection;
