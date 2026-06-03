import React, { useState, useEffect } from "react";
import {
  MapPin,
  Plus,
  X,
  Star,
  Pencil,
  Archive,
  ArchiveRestore,
  Check,
} from "lucide-react";
import api from "../services/api";
import Spinner from "./Spinner";

// Branches — per-tenant operational units. Lender adds them from
// Settings; create-client dropdowns then offer them as options. Every
// tenant has one default branch (seeded by migration 036), which is
// auto-assigned to clients when no branch is picked.
function BranchesSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    name: "",
    code: "",
    location: "",
    phone: "",
    is_default: false,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  const load = () => {
    setLoading(true);
    api
      .get("/branches")
      .then((r) => setRows(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await api.post("/branches", form);
      setForm({ name: "", code: "", location: "", phone: "", is_default: false });
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create branch");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (b) => {
    setEditingId(b.id);
    setEditDraft({
      name: b.name || "",
      code: b.code || "",
      location: b.location || "",
      phone: b.phone || "",
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft({});
  };
  const saveEdit = async (id) => {
    try {
      await api.put(`/branches/${id}`, editDraft);
      cancelEdit();
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update branch");
    }
  };

  const setDefault = async (b) => {
    try {
      await api.put(`/branches/${b.id}`, { is_default: true });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to set default");
    }
  };

  const archive = async (b) => {
    if (!confirm(`Archive branch "${b.name}"?`)) return;
    try {
      await api.delete(`/branches/${b.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to archive branch");
    }
  };

  const restore = async (b) => {
    try {
      await api.put(`/branches/${b.id}`, { active: true });
      load();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to restore branch");
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
        <MapPin size={22} /> Branches
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Operational units (e.g. Westlands, CBD). Each client is assigned to
        one branch. The default branch is used when no branch is picked.
      </p>

      {/* Add new */}
      <form
        onSubmit={create}
        className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-4"
      >
        <input
          type="text"
          placeholder="Name *"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          className="md:col-span-3 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
        />
        <input
          type="text"
          placeholder="Code"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          className="md:col-span-2 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
        />
        <input
          type="text"
          placeholder="Location"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          className="md:col-span-3 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
        />
        <input
          type="text"
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="md:col-span-2 px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating}
          className="md:col-span-2 px-3 py-2 bg-ocean-gradient text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          <Plus size={16} /> {creating ? "Adding..." : "Add"}
        </button>
      </form>
      {error && (
        <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <Spinner centered className="py-6" size={28} label="Loading branches…" />
      ) : rows.length === 0 ? (
        <div className="text-gray-500 text-sm">No branches yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b border-gray-200">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Location</th>
                <th className="px-3 py-2 font-semibold">Phone</th>
                <th className="px-3 py-2 font-semibold text-right">Clients</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const isEditing = editingId === b.id;
                return (
                  <tr
                    key={b.id}
                    className={`border-b border-gray-100 ${
                      b.active ? "" : "opacity-60"
                    }`}
                  >
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDraft.name}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, name: e.target.value })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {b.is_default && (
                            <Star
                              size={14}
                              className="text-amber-500 fill-amber-500"
                              title="Default branch"
                            />
                          )}
                          {b.name}
                          {!b.active && (
                            <span className="text-xs text-gray-500">
                              (archived)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDraft.code}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, code: e.target.value })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded"
                        />
                      ) : (
                        b.code || "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDraft.location}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              location: e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded"
                        />
                      ) : (
                        b.location || "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDraft.phone}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              phone: e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 border border-gray-300 rounded"
                        />
                      ) : (
                        b.phone || "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{b.client_count}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => saveEdit(b.id)}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                              title="Save"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                              title="Cancel"
                            >
                              <X size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            {!b.is_default && b.active && (
                              <button
                                onClick={() => setDefault(b)}
                                className="p-1 text-amber-600 hover:bg-amber-50 rounded"
                                title="Make default"
                              >
                                <Star size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => startEdit(b)}
                              className="p-1 text-gray-700 hover:bg-gray-100 rounded"
                              title="Edit"
                            >
                              <Pencil size={16} />
                            </button>
                            {b.active && !b.is_default && (
                              <button
                                onClick={() => archive(b)}
                                className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                                title="Archive"
                              >
                                <Archive size={16} />
                              </button>
                            )}
                            {!b.active && (
                              <button
                                onClick={() => restore(b)}
                                className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                title="Restore"
                              >
                                <ArchiveRestore size={16} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default BranchesSection;
