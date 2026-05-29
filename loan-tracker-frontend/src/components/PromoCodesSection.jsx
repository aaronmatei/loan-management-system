import React, { useState, useEffect } from "react";
import { Ticket, Copy, CheckCircle, Users, Plus, X } from "lucide-react";
import api from "../services/api";

// Promo / campaign codes for the customer sign-up link. A tenant creates named
// codes and shares /loanfix/portal/register?promo=<code>; customers who sign up
// with a code are auto-linked to the tenant AND tagged, so the tenant can see
// who came from each campaign.
function PromoCodesSection() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: "", label: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(null);
  const [viewing, setViewing] = useState(null); // { code } being viewed
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);

  const baseUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
  const linkFor = (code) =>
    `${baseUrl}/loanfix/portal/register?promo=${code}`;

  const load = () => {
    api
      .get("/promos")
      .then((r) => setCodes(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async (e) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const r = await api.post("/promos", form);
      setCodes((c) => [r.data.data, ...c]);
      setForm({ code: "", label: "" });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create promo code");
    } finally {
      setCreating(false);
    }
  };

  const copy = (code) => {
    navigator.clipboard.writeText(linkFor(code));
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const toggle = async (p) => {
    try {
      await api.patch(`/promos/${p.id}`, { is_active: !p.is_active });
      setCodes((c) =>
        c.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)),
      );
    } catch {
      /* ignore */
    }
  };

  const viewClients = async (p) => {
    setViewing(p);
    setClientsLoading(true);
    try {
      const r = await api.get(`/promos/${p.id}/clients`);
      setClients(r.data.data || []);
    } catch {
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  };

  const fld =
    "px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-ocean-500 focus:outline-none";

  return (
    <div className="bg-white rounded-xl shadow-md p-6 mb-6">
      <h3 className="font-bold text-lg flex items-center gap-2">
        <Ticket size={20} className="text-ocean-600" /> Promo Codes
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        Create a code per campaign, share its sign-up link, and see who joined
        through it.
      </p>

      {/* Create */}
      <form onSubmit={create} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          placeholder="CODE (e.g. RADIO)"
          required
          className={`${fld} uppercase sm:w-44`}
        />
        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="Label (optional, e.g. Radio campaign)"
          className={`${fld} flex-1`}
        />
        <button
          type="submit"
          disabled={creating}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-ocean-gradient text-white font-semibold rounded-lg disabled:opacity-50"
        >
          <Plus size={16} /> Create
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {/* List */}
      {loading ? (
        <p className="text-sm text-gray-400 py-4">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">
          No promo codes yet. Create one above to start tracking sign-ups.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="p-2">Code</th>
                <th className="p-2">Label</th>
                <th className="p-2 text-center">Sign-ups</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-2 font-mono font-semibold text-navy-900">
                    {p.code}
                    {!p.is_active && (
                      <span className="ml-2 text-[10px] font-bold uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                        Off
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-gray-600">{p.label || "—"}</td>
                  <td className="p-2 text-center">
                    <span className="font-bold text-ocean-600">{p.signups}</span>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => copy(p.code)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-semibold"
                      >
                        {copied === p.code ? (
                          <>
                            <CheckCircle size={13} className="text-green-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={13} /> Link
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => viewClients(p)}
                        disabled={!p.signups}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-semibold disabled:opacity-40"
                      >
                        <Users size={13} /> Clients
                      </button>
                      <button
                        onClick={() => toggle(p)}
                        className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-1"
                      >
                        {p.is_active ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Clients-per-code modal */}
      {viewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h3 className="font-bold text-navy-900">
                  Clients via{" "}
                  <span className="font-mono text-ocean-600">{viewing.code}</span>
                </h3>
                <p className="text-xs text-gray-500">
                  {viewing.label || "Promo code"} · {clients.length} sign-up
                  {clients.length !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={() => setViewing(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              {clientsLoading ? (
                <p className="text-sm text-gray-400 p-4">Loading…</p>
              ) : clients.length === 0 ? (
                <p className="text-sm text-gray-400 p-4">No sign-ups yet.</p>
              ) : (
                clients.map((c) => (
                  <div
                    key={c.id}
                    className="flex justify-between items-center p-3 hover:bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-semibold text-navy-900">
                        {c.first_name} {c.last_name}
                      </p>
                      <p className="text-xs text-gray-500 font-mono">
                        {c.client_code} · {c.phone_number}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PromoCodesSection;
