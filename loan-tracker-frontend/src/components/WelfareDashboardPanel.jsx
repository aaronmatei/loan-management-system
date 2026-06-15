import React, { useState, useEffect } from "react";
import { LayoutDashboard, Wallet, Users, AlertTriangle, Banknote, Gift, CalendarCheck, FileDown, FileSpreadsheet } from "lucide-react";
import api from "../services/api";
import { downloadFile } from "../utils/bulkExport";

const money = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Welfare dashboard: the group's health at a glance. Read-only.
export default function WelfareDashboardPanel({ welfareId }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/welfares/${welfareId}/reports/summary`).then((r) => setD(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, [welfareId]);

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
  const Stat = ({ icon: Icon, label, value, sub, tone = "slate" }) => {
    const [bg, text] = (TONES[tone] || TONES.slate).split(" ");
    return (
      <div className={`${bg} rounded-lg p-3`}>
        <p className="text-xs text-slate-500 flex items-center gap-1"><Icon size={13} /> {label}</p>
        <p className={`font-bold ${text} text-lg leading-tight`}>{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-100 mb-6 overflow-hidden">
      <div className="bg-slate-50 px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-900 flex items-center gap-2"><LayoutDashboard size={18} className="text-slate-600" /> Dashboard</h2>
        <div className="flex gap-2">
          <button onClick={() => doExport("pdf")} disabled={!!exporting} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
            <FileDown size={14} /> {exporting === "pdf" ? "…" : "Statement PDF"}
          </button>
          <button onClick={() => doExport("csv")} disabled={!!exporting} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
            <FileSpreadsheet size={14} /> {exporting === "csv" ? "…" : "Members CSV"}
          </button>
        </div>
      </div>
      <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat icon={Wallet} label="Pool balance" value={money(d.pool.balance)} sub={`Surplus ${money(d.pool.surplus)}`} tone="emerald" />
        <Stat icon={Users} label="Members" value={d.members.active} sub={d.members.inactive ? `${d.members.inactive} exited` : "all active"} tone="sky" />
        <Stat icon={Banknote} label="Out on loan" value={money(d.loans.outstanding)} sub={`${d.loans.open} open`} tone="indigo" />
        <Stat icon={AlertTriangle} label="Penalties due" value={money(d.penalties.outstanding)} sub={`${money(d.penalties.collected)} collected`} tone="rose" />
        <Stat icon={Wallet} label="Savings" value={money(d.pool.members_savings)} sub={`${money(d.pool.total_contributions)} contributed`} />
        <Stat icon={Gift} label="Dividends" value={money(d.dividends.total)} sub={`${d.dividends.runs} share-out${d.dividends.runs === 1 ? "" : "s"}`} tone="amber" />
        {d.compliance ? (
          <Stat icon={CalendarCheck} label={`Compliance · ${d.compliance.cycle || "cycle"}`} value={`${d.compliance.paid_pct}%`} sub={`${d.compliance.paid}/${d.compliance.total} paid`} tone="emerald" />
        ) : (
          <Stat icon={CalendarCheck} label="Compliance" value="—" sub="no open cycle" />
        )}
        {d.attendance ? (
          <Stat icon={Users} label="Last attendance" value={`${d.attendance.rate_pct}%`} sub={`${d.attendance.attended}/${d.attendance.recorded} present`} tone="sky" />
        ) : (
          <Stat icon={Users} label="Last attendance" value="—" sub="no meetings yet" />
        )}
      </div>
    </div>
  );
}
