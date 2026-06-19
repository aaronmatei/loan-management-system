import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { TrendingUp, BarChart3, PieChart as PieIcon, Users, AlertTriangle, Wallet } from "lucide-react";
import api from "../services/api";

const kfmt = (v) => {
  const n = Number(v || 0), a = Math.abs(n);
  const s = a >= 1000 ? (a / 1000).toFixed(a % 1000 ? 1 : 0) + "k" : String(a);
  return (n < 0 ? "-" : "") + s;
};
const ksh = (v) => "KES " + Number(v || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const COLORS = { collected: "#10b981", expected: "#94a3b8", pool: "#0ea5e9", on_time: "#10b981", late: "#f59e0b", unpaid: "#ef4444", accrued: "#ef4444", finePaid: "#10b981", savings: "#6366f1", attend: "#0ea5e9" };

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
export default function WelfareCharts({ welfareId }) {
  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/welfares/${welfareId}/reports/charts`).then((r) => setC(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, [welfareId]);

  if (loading) return <div className="text-sm text-slate-500 px-1 py-4">Loading charts…</div>;
  if (!c) return null;

  const cb = c.cycle_breakdown;
  const donut = cb ? [
    { name: "On time", value: cb.on_time, key: "on_time" },
    { name: "Late", value: cb.late, key: "late" },
    { name: "Unpaid", value: cb.unpaid, key: "unpaid" },
  ].filter((d) => d.value > 0) : [];
  const finesEmpty = !c.fines?.length;
  const attEmpty = !c.attendance?.length;
  const savH = Math.max(220, (c.savings_per_member?.length || 0) * 22);

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
      <Card icon={BarChart3} title={`Contributions ${c.year}`} sub="Collected vs expected per month (all pools)">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={c.contributions} margin={{ left: -10, right: 8, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={kfmt} width={42} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="expected" fill={COLORS.expected} name="Expected" radius={[3, 3, 0, 0]} />
            <Bar dataKey="collected" fill={COLORS.collected} name="Collected" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* 3. Latest cycle timeliness */}
      <Card icon={PieIcon} title="Latest cycle timeliness" sub={cb ? cb.name : "No due cycle yet"} empty={!cb || donut.length === 0 ? "No due cycle yet" : null}>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={75} paddingAngle={2}>
              {donut.map((d) => <Cell key={d.key} fill={COLORS[d.key]} />)}
            </Pie>
            <Tooltip contentStyle={tip.contentStyle} formatter={(v, n) => [`${v} member${v === 1 ? "" : "s"}`, n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
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

      {/* 5. Fines */}
      <Card icon={AlertTriangle} title="Fines" sub="Accrued vs collected, by month" empty={finesEmpty ? "No fines recorded yet" : null}>
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

      {/* 6. Savings per member */}
      <Card icon={Wallet} title="Savings per member" sub="Members' equity in the savings pool">
        <ResponsiveContainer width="100%" height={Math.min(savH, 360)}>
          <BarChart data={c.savings_per_member} layout="vertical" margin={{ left: 8, right: 12, top: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" {...axis} tickFormatter={kfmt} />
            <YAxis type="category" dataKey="name" {...axis} width={70} interval={0} />
            <Tooltip {...tip} />
            <Bar dataKey="savings" fill={COLORS.savings} radius={[0, 3, 3, 0]} name="Savings" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
