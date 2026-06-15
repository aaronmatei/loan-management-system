import React, { useState, useEffect } from "react";
import { Gift, X, AlertTriangle, TrendingUp, ChevronRight } from "lucide-react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—");

// Welfare share-out: distribute the pool's retained surplus to members.
export default function WelfareDividendsPanel({ welfareId }) {
  const [info, setInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRun, setShowRun] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = async () => {
    try {
      const [d, h] = await Promise.all([
        api.get(`/welfares/${welfareId}/dividends/distributable`),
        api.get(`/welfares/${welfareId}/dividends`),
      ]);
      setInfo(d.data.data);
      setHistory(h.data.data || []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [welfareId]);

  const surplus = info?.surplus ?? 0;

  return (
    <div className="bg-white rounded-xl shadow-md border border-amber-100 mb-6 overflow-hidden">
      <div className="bg-amber-50 px-5 py-3 border-b border-amber-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2">
          <Gift size={18} className="text-amber-600" /> Dividends &amp; share-out
        </h2>
        <PermissionGate role={["admin", "manager"]}>
          <button onClick={() => setShowRun(true)} disabled={surplus <= 0} title={surplus <= 0 ? "No surplus to share out" : ""} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            Run share-out
          </button>
        </PermissionGate>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-5 text-sm">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Pool balance</p>
                <p className="font-bold text-slate-900">{money(info?.pool)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Members' savings</p>
                <p className="font-bold text-slate-900">{money(info?.total_savings)}</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 flex items-center gap-1"><TrendingUp size={13} /> Distributable surplus</p>
                <p className="font-bold text-amber-800">{money(surplus)}</p>
              </div>
            </div>
            {surplus <= 0 && <p className="text-xs text-slate-500 mb-4">Surplus is the pool above members' savings (penalty + loan-interest income). Settle outstanding loans to free it up.</p>}

            {history.length === 0 ? (
              <p className="text-sm text-slate-500">No share-outs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">Date</th>
                      <th className="text-right px-4 py-2">Amount</th>
                      <th className="text-left px-4 py-2">Basis</th>
                      <th className="text-right px-4 py-2">Members</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t border-slate-100 hover:bg-amber-50/50 cursor-pointer" onClick={() => setOpenId(h.id)}>
                        <td className="px-4 py-2 text-slate-600">{fmt(h.created_at)}</td>
                        <td className="px-4 py-2 text-right font-semibold">{money(h.total_amount)}</td>
                        <td className="px-4 py-2 capitalize">{h.basis}</td>
                        <td className="px-4 py-2 text-right">{h.member_count}</td>
                        <td className="px-4 py-2 text-right"><ChevronRight size={16} className="inline text-amber-400" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {showRun && <RunModal welfareId={welfareId} info={info} onClose={() => setShowRun(false)} onDone={() => { setShowRun(false); load(); }} />}
      {openId && <DetailModal welfareId={welfareId} id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function RunModal({ welfareId, info, onClose, onDone }) {
  const [basis, setBasis] = useState("savings");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadPreview = async () => {
    try {
      const params = new URLSearchParams({ basis });
      if (amount) params.set("amount", amount);
      const r = await api.get(`/welfares/${welfareId}/dividends/distributable?${params}`);
      setPreview(r.data.data);
    } catch {/* */}
  };
  useEffect(() => { loadPreview(); }, [basis, amount]);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const r = await api.post(`/welfares/${welfareId}/dividends`, { basis, amount: amount || undefined });
      alert(`Share-out done: ${money(r.data.data.total_amount)} to ${r.data.data.shares.length} member(s).`);
      onDone();
    } catch (err) { setError(err.response?.data?.error || "Failed."); setBusy(false); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-amber-500 focus:outline-none";

  return (
    <Shell title="Run share-out" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={15} /> {error}</div>}
        <p className="text-sm text-slate-600">Distributable surplus: <strong>{money(info?.surplus)}</strong></p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Basis</label>
            <select value={basis} onChange={(e) => setBasis(e.target.value)} className={fld}>
              <option value="savings">Pro-rata by savings</option>
              <option value="equal">Equal split</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Amount <span className="text-gray-500 font-normal">(blank = full surplus)</span></label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(info?.surplus ?? "")} className={fld} />
          </div>
        </div>

        {preview?.preview?.length > 0 && (
          <div className="border border-slate-100 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0">
                <tr><th className="text-left px-3 py-2">Member</th><th className="text-right px-3 py-2">Savings</th><th className="text-right px-3 py-2">Share</th></tr>
              </thead>
              <tbody>
                {preview.preview.map((p) => (
                  <tr key={p.member_id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-800">{p.name}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{money(p.savings)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-700">{money(p.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={busy || !(preview?.amount > 0)} className="px-5 py-2 rounded-lg text-white font-semibold disabled:opacity-50 bg-amber-600 hover:bg-amber-700">{busy ? "Distributing…" : "Distribute"}</button>
        </div>
      </form>
    </Shell>
  );
}

function DetailModal({ welfareId, id, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(`/welfares/${welfareId}/dividends/${id}`).then((r) => setData(r.data.data)).catch(() => {});
  }, [id]);
  return (
    <Shell title={`Share-out #${id}`} onClose={onClose}>
      {!data ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div>
          <p className="text-sm text-slate-600 mb-3">{money(data.total_amount)} · {data.basis} · {data.member_count} members</p>
          <div className="border border-slate-100 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-3 py-2">Member</th><th className="text-right px-3 py-2">Share</th></tr></thead>
              <tbody>
                {data.shares.map((s, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-800">{s.first_name} {s.last_name} <span className="text-slate-400 font-mono text-xs">{s.member_no}</span></td>
                    <td className="px-3 py-2 text-right font-semibold">{money(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-xl" : "max-w-md"} my-10`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
