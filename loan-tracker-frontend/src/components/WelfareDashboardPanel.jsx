import React, { useState, useEffect } from "react";
import { LayoutDashboard, Wallet, Users, AlertTriangle, Banknote, Gift, CalendarCheck, FileDown, FileSpreadsheet, TrendingUp, Receipt, X, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { downloadFile } from "../utils/bulkExport";
import WelfareCharts from "./WelfareCharts";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Welfare dashboard: the group's health at a glance. Read-only — so it's shared
// by the admin app AND the welfare-member portal (members are equal owners and
// see the same figures). `client`/`summaryUrl`/`chartsUrl` let the member portal
// point it at its own token + endpoints; `showExports` hides the staff exports.
export default function WelfareDashboardPanel({
  welfareId,
  client = api,
  summaryUrl = `/welfares/${welfareId}/reports/summary`,
  chartsUrl = `/welfares/${welfareId}/reports/charts`,
  showExports = true,
  showLoans = true,
  personal = null, // member portal: the caller's own figures, merged into the group cards as a "Mine:" line
  manage = false,  // admin welfare dashboard: enables managing investments
  linkBase = null, // when set (e.g. "/welfare" or "/welfare/member"), cards link to their pages
}) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showInvest, setShowInvest] = useState(false);
  const navigate = useNavigate();
  // A card's destination, or undefined (not clickable). `adminOnly` paths
  // (e.g. expenses) only link from the admin app.
  const link = (path, adminOnly = false) => (!linkBase || (adminOnly && linkBase !== "/welfare")) ? undefined : `${linkBase}/${path}`;

  const loadSummary = () => client.get(summaryUrl).then((r) => setD(r.data.data)).catch(() => {});
  useEffect(() => {
    loadSummary().finally(() => setLoading(false));
  }, [summaryUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const [exporting, setExporting] = useState("");
  const doExport = async (kind) => {
    setExporting(kind);
    try {
      if (kind === "pdf") await downloadFile(`/welfares/${welfareId}/reports/statement.pdf?include=all`, "group-statement.pdf");
      else await downloadFile(`/welfares/${welfareId}/reports/members.csv?include=all`, "members.csv");
    } catch {
      alert("Export failed.");
    } finally {
      setExporting("");
    }
  };

  if (loading) return <div className="bg-white rounded-xl shadow-md border border-slate-100 p-5 mb-6 text-sm text-slate-500">Loading dashboard…</div>;
  if (!d) return null;

  // Static class strings — Tailwind can't see interpolated class names.
  const TONES = {
    slate: "bg-slate-50 text-slate-800",
    emerald: "bg-emerald-50 text-emerald-800",
    sky: "bg-sky-50 text-sky-800",
    indigo: "bg-indigo-50 text-indigo-800",
    rose: "bg-rose-50 text-rose-800",
    amber: "bg-amber-50 text-amber-800",
  };
  const Stat = ({ icon: Icon, label, value, sub, mine, tone = "slate", to }) => {
    const [bg, text] = (TONES[tone] || TONES.slate).split(" ");
    const inner = (
      <>
        <p className="text-xs text-slate-500 flex items-center gap-1"><Icon size={13} /> {label}</p>
        <p className={`font-bold ${text} text-lg leading-tight`}>{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        {mine != null && <p className="text-xs font-semibold text-slate-600 mt-1 border-t border-slate-200/70 pt-1">Mine: {mine}</p>}
      </>
    );
    return to
      ? <button type="button" onClick={() => navigate(to)} className={`${bg} rounded-lg p-3 text-left w-full hover:ring-2 hover:ring-slate-300 transition`}>{inner}</button>
      : <div className={`${bg} rounded-lg p-3`}>{inner}</div>;
  };
  const p = personal;
  const pct = (v, counts) => (v == null ? null : `${v}%${counts ? ` (${counts.paid ?? counts.attended}/${counts.total ?? counts.recorded})` : ""}`);

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-100 mb-6 overflow-hidden">
      <div className="bg-slate-50 px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2"><LayoutDashboard size={18} className="text-slate-600" /> Dashboard</h2>
        {showExports && (
          <div className="flex gap-2">
            <button onClick={() => doExport("pdf")} disabled={!!exporting} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
              <FileDown size={14} /> {exporting === "pdf" ? "…" : "Statement PDF"}
            </button>
            <button onClick={() => doExport("csv")} disabled={!!exporting} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
              <FileSpreadsheet size={14} /> {exporting === "csv" ? "…" : "Members CSV"}
            </button>
          </div>
        )}
      </div>
      <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {/* First row: Pool balance → Savings → Investments → Profit. */}
        <Stat icon={Wallet} label="Pool balance" value={money(d.pool.balance)} sub={`Surplus ${money(d.pool.surplus)}`} tone="emerald" to={link("members")} />
        <Stat icon={Wallet} label="Savings" value={money(d.pool.members_savings)} sub={`${money(d.pool.total_contributions)} contributed`} mine={p && p.savings != null ? money(p.savings) : undefined} to={link("contributions")} />
        {d.investments && (() => {
          const card = (
            <>
              <p className="text-xs text-slate-500 flex items-center gap-1"><TrendingUp size={13} /> Investments</p>
              <p className={`font-bold text-lg leading-tight ${d.investments.income < 0 ? "text-rose-700" : "text-emerald-700"}`}>{money(d.investments.income)} <span className="text-xs font-normal text-slate-400">income</span></p>
              <p className="text-xs text-slate-500 mt-0.5">Invested {money(d.investments.invested)}</p>
              <p className="text-xs text-slate-500">Current balance {money(d.investments.current)}</p>
            </>
          );
          return manage
            ? <button type="button" onClick={() => setShowInvest(true)} className="bg-emerald-50 rounded-lg p-3 text-left w-full hover:ring-2 hover:ring-emerald-300 transition">{card}</button>
            : <div className="bg-emerald-50 rounded-lg p-3">{card}</div>;
        })()}
        <Stat icon={TrendingUp} label="Profit" value={money(d.pool.profit)} sub="pool above member savings" tone={d.pool.profit < 0 ? "rose" : "emerald"} to={link("books")} />
        <Stat icon={Users} label="Members" value={d.members.active} sub={d.members.inactive ? `${d.members.inactive} exited` : "all active"} tone="sky" to={link("members")} />
        <Stat icon={AlertTriangle} label="Penalties due" value={money(d.penalties.outstanding)} sub={`${money(d.penalties.collected)} collected`} mine={p && p.penalties != null ? money(p.penalties) : undefined} tone="rose" to={link("penalties")} />
        <Stat icon={Gift} label="Dividends" value={money(d.dividends.total)} sub={`${d.dividends.runs} share-out${d.dividends.runs === 1 ? "" : "s"}`} tone="amber" to={link("dividends")} />
        <Stat icon={Receipt} label="Expenses" value={money(d.pool.expenses)} sub="spent from the savings pool" tone="rose" to={link("expenses", true)} />
        {showLoans && <Stat icon={Banknote} label="Out on loan" value={money(d.loans.outstanding)} sub={`${d.loans.open} open`} mine={p && p.loan != null ? money(p.loan) : undefined} tone="indigo" to={link("loans")} />}
        {d.compliance ? (
          <Stat icon={CalendarCheck} label={`Compliance · ${d.compliance.cycle || "cycle"}`} value={`${d.compliance.paid_pct}%`} sub={`${d.compliance.paid}/${d.compliance.total} paid`} mine={p ? pct(p.compliance_pct, p.compliance) : undefined} tone="emerald" to={link("contributions")} />
        ) : (
          <Stat icon={CalendarCheck} label="Compliance" value="—" sub="no open cycle" mine={p ? pct(p.compliance_pct, p.compliance) : undefined} to={link("contributions")} />
        )}
        {d.attendance ? (
          <Stat icon={Users} label="Last attendance" value={`${d.attendance.rate_pct}%`} sub={`${d.attendance.attended}/${d.attendance.recorded} present`} mine={p ? pct(p.attendance_pct, p.attendance) : undefined} tone="sky" to={link("meetings")} />
        ) : (
          <Stat icon={Users} label="Last attendance" value="—" sub="no meetings yet" mine={p ? pct(p.attendance_pct, p.attendance) : undefined} to={link("meetings")} />
        )}
      </div>
      <WelfareCharts welfareId={welfareId} client={client} url={chartsUrl} />
      {showInvest && <InvestmentsModal welfareId={welfareId} client={client} onClose={() => { setShowInvest(false); loadSummary(); }} />}
    </div>
  );
}

// Admin-only: record MMF/other investments — amount invested + current balance.
// Income (current − invested) shows on the dashboard card.
function InvestmentsModal({ welfareId, client, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", amount_invested: "", current_balance: "" });
  const [busy, setBusy] = useState(false);

  const load = () => client.get(`/welfares/${welfareId}/investments`).then((r) => setRows(r.data.data.investments || [])).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [amounts, setAmounts] = useState({}); // per-investment action amount

  const add = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return alert("Give the investment a name.");
    setBusy(true);
    try { await client.post(`/welfares/${welfareId}/investments`, form); setForm({ name: "", amount_invested: "", current_balance: "" }); load(); }
    catch (err) { alert(err.response?.data?.error || "Failed to add"); } finally { setBusy(false); }
  };
  // action: 'interest' | 'withdraw' | 'deposit'
  const act = async (inv, action) => {
    const amount = amounts[inv.id];
    if (!(Number(amount) > 0)) return alert("Enter an amount first.");
    try { await client.post(`/welfares/${welfareId}/investments/${inv.id}/${action}`, { amount }); setAmounts((a) => ({ ...a, [inv.id]: "" })); load(); }
    catch (err) { alert(err.response?.data?.error || "Failed."); }
  };
  const del = async (inv) => {
    if (!window.confirm(`Delete "${inv.name}"? Its transaction history is removed too.`)) return;
    try { await client.delete(`/welfares/${welfareId}/investments/${inv.id}`); load(); }
    catch (err) { alert(err.response?.data?.error || "Failed to delete"); }
  };
  const fld = "w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-emerald-500 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">Investments</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-500 mb-4">Record where the chama parks its funds (e.g. a Money Market Fund). Update the interest earned each month; withdraw when you take money out. Income = total interest earned.</p>
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-sm text-slate-400 mb-4">No investments yet.</p> : (
            <div className="space-y-3 mb-5">
              {rows.map((inv) => (
                <div key={inv.id} className="border border-slate-100 rounded-lg px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{inv.name}</p>
                      <p className="text-xs text-slate-500">invested {money(inv.amount_invested)} · interest <span className="text-emerald-700 font-semibold">{money(inv.interest_earned)}</span> · current <span className="font-semibold text-slate-700">{money(inv.current_balance)}</span>{inv.withdrawn > 0 ? ` · withdrawn ${money(inv.withdrawn)}` : ""}</p>
                    </div>
                    <button onClick={() => del(inv)} className="text-slate-400 hover:text-rose-600 shrink-0" title="Delete"><Trash2 size={16} /></button>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input type="number" min="0" value={amounts[inv.id] || ""} onChange={(e) => setAmounts((a) => ({ ...a, [inv.id]: e.target.value }))} placeholder="Amount (KES)" className="w-32 px-2 py-1 border border-slate-200 rounded text-sm" />
                    <button onClick={() => act(inv, "interest")} className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">Record interest</button>
                    <button onClick={() => act(inv, "withdraw")} className="px-2.5 py-1 rounded-md bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 text-xs font-semibold">Withdraw</button>
                    <button onClick={() => act(inv, "deposit")} className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold">Deposit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={add} className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700">Add an investment</p>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. CIC Money Market Fund)" className={fld} />
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Amount invested</label><input type="number" value={form.amount_invested} onChange={(e) => setForm({ ...form, amount_invested: e.target.value })} className={fld} /></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1">Current balance</label><input type="number" value={form.current_balance} onChange={(e) => setForm({ ...form, current_balance: e.target.value })} className={fld} /></div>
            </div>
            <div className="flex justify-end"><button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">{busy ? "Adding…" : "Add"}</button></div>
          </form>
        </div>
      </div>
    </div>
  );
}
