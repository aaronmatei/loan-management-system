import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { TrendingUp, BarChart3, Layers, Users, AlertTriangle, Wallet } from "lucide-react";
import api from "../services/api";

const kfmt = (v) => {
  const n = Number(v || 0), a = Math.abs(n);
  const s = a >= 1000 ? (a / 1000).toFixed(a % 1000 ? 1 : 0) + "k" : String(a);
  return (n < 0 ? "-" : "") + s;
};
const ksh = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const COLORS = { collected: "#10b981", expected: "#94a3b8", pool: "#0ea5e9", quarterly: "#8b5cf6", fines: "#f59e0b", accrued: "#ef4444", finePaid: "#10b981", savings: "#6366f1", attend: "#0ea5e9" };

const Card = ({ icon: Icon, title, sub, children, empty }) => (
  <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
    <div className="mb-2">
      <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Icon size={15} className="text-slate-500" /> {title}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
    {empty ? <div className="h-48 flex items-center justify-center text-sm text-slate-400">{empty}</div> : children}
  </div>
);
const axis = { tick: { fontSize: 11, fill: "#94a3b8" }, axisLine: false, tickLine: false };
const tip = { contentStyle: { fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }, formatter: (v) => ksh(v) };

// Dashboard charts for a welfare. Pulls /reports/charts and renders the starter set.
export default function WelfareCharts({ welfareId, client = api, url = `/welfares/${welfareId}/reports/charts` }) {
  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get(url).then((r) => setC(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="text-sm text-slate-500 px-1 py-4">Loading charts…</div>;
  if (!c) return null;

  const finesEmpty = !c.fines?.length;
  const attEmpty = !c.attendance?.length;

  return (
    <div className="px-5 pb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Pool growth */}
      <Card icon={TrendingUp} title="Savings pool growth" sub="Closing balance each month">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={c.pool_growth} margin={{ left: -10, right: 8, top: 5 }}>
            <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.pool} stopOpacity={0.35} /><stop offset="100%" stopColor={COLORS.pool} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} tickFormatter={kfmt} width={42} />
            <Tooltip {...tip} />
            <Area type="monotone" dataKey="balance" stroke={COLORS.pool} strokeWidth={2} fill="url(#pg)" name="Balance" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* 2. Contributions collected vs expected */}
      <Card icon={BarChart3} title={`Monthly contributions ${c.year}`} sub="Collected vs expected, plus late fines, per month">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={c.contributions} margin={{ left: -10, right: 8, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={kfmt} width={42} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="expected" fill={COLORS.expected} name="Expected" radius={[3, 3, 0, 0]} />
            <Bar dataKey="collected" fill={COLORS.collected} name="Collected" radius={[3, 3, 0, 0]} />
            <Bar dataKey="fines" fill={COLORS.fines} name="Fines" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* 3. Quarterly contributions */}
      <Card icon={Layers} title={`Quarterly contributions ${c.year}`} sub="Collected vs expected per quarter" empty={!c.quarterly?.length ? "No quarterly contribution yet" : null}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={c.quarterly} margin={{ left: -10, right: 8, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={kfmt} width={42} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="expected" fill={COLORS.expected} name="Expected" radius={[3, 3, 0, 0]} />
            <Bar dataKey="collected" fill={COLORS.quarterly} name="Collected" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* 4. Attendance */}
      <Card icon={Users} title="Meeting attendance" sub="Present rate per meeting" empty={attEmpty ? "No meetings recorded yet" : null}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={c.attendance} margin={{ left: -10, right: 8, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" {...axis} minTickGap={24} />
            <YAxis {...axis} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={42} />
            <Tooltip contentStyle={tip.contentStyle} formatter={(v) => `${v}%`} />
            <Line type="monotone" dataKey="rate" stroke={COLORS.attend} strokeWidth={2} dot={{ r: 3 }} name="Attendance" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* 5. Fines by activity type */}
      <Card icon={AlertTriangle} title="Fines by activity" sub="Accrued vs collected, by penalty type" empty={finesEmpty ? "No fines recorded yet" : null}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={c.fines} margin={{ left: -10, right: 8, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={kfmt} width={42} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="accrued" fill={COLORS.accrued} name="Accrued" radius={[3, 3, 0, 0]} />
            <Bar dataKey="collected" fill={COLORS.finePaid} name="Collected" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* 6. Pool balances — savings vs each benefit pool */}
      <Card icon={Wallet} title="Pool balances" sub="Savings vs benefit pools (can go negative)" empty={!c.pools?.length ? "No pools yet" : null}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={c.pools} margin={{ left: -10, right: 8, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" {...axis} />
            <YAxis {...axis} tickFormatter={kfmt} width={42} />
            <Tooltip {...tip} />
            <Bar dataKey="balance" radius={[3, 3, 0, 0]} name="Balance">
              {(c.pools || []).map((p, i) => <Cell key={i} fill={p.balance < 0 ? "#ef4444" : p.kind === "savings" ? "#10b981" : COLORS.quarterly} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
