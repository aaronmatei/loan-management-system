import React, { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  CreditCard,
  AlertTriangle,
  Trophy,
  MapPin,
  Lightbulb,
} from "lucide-react";
import api from "../services/api";
import PeriodNavigator, {
  periodToRange,
  periodLabel,
  usePersistentPeriod,
} from "../components/PeriodNavigator";
import Spinner from "../components/Spinner";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

const COLORS = [
  "#4F46E5",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#EC4899",
  "#F97316",
];

function Analytics() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = usePersistentPeriod();
  const [data, setData] = useState({
    kpis: null,
    revenueTrends: [],
    portfolioBreakdown: [],
    topClients: [],
    geographic: [],
    loanDistribution: [],
    defaultTrend: [],
    paymentMethods: [],
  });

  useEffect(() => {
    fetchAllData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.mode, period.value]);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      const { from, to } = periodToRange(period);
      const q = from && to ? `from=${from}&to=${to}` : "";
      const qs = q ? `?${q}` : "";
      const qsAmp = q ? `&${q}` : "";
      const [
        kpis,
        revenueTrends,
        portfolio,
        topClients,
        geo,
        distribution,
        defaultTrend,
        methods,
      ] = await Promise.all([
        api.get(`/analytics/kpis${qs}`),
        api.get(`/analytics/revenue-trends${qs}`),
        api.get(`/analytics/portfolio-breakdown${qs}`),
        api.get(`/analytics/top-clients?metric=borrowed&limit=10${qsAmp}`),
        api.get(`/analytics/geographic${qs}`),
        api.get(`/analytics/loan-distribution${qs}`),
        api.get(`/analytics/default-trend${qs}`),
        api.get(`/analytics/payment-methods${qs}`),
      ]);
      setData({
        kpis: kpis.data.data,
        revenueTrends: revenueTrends.data.data,
        portfolioBreakdown: portfolio.data.data,
        topClients: topClients.data.data,
        geographic: geo.data.data,
        loanDistribution: distribution.data.data,
        defaultTrend: defaultTrend.data.data,
        paymentMethods: methods.data.data,
      });
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatKES = (value) => {
    if (!value && value !== 0) return "KES 0";
    const num = parseFloat(value);
    return `KES ${Math.round(num).toLocaleString("en-KE")}`;
  };
  // Y-axis ticks have ~50px to render in; the long-form labels overflow
  // and clip the chart. Keep the compact form for axis ticks only.
  const formatKESCompact = (value) => {
    if (!value && value !== 0) return "KES 0";
    const num = parseFloat(value);
    if (num >= 1000000) return `KES ${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `KES ${(num / 1000).toFixed(1)}K`;
    return `KES ${num.toFixed(0)}`;
  };

  const CurrencyTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border-2 border-gray-200 rounded-lg shadow-lg">
          <p className="font-bold text-gray-800">{label}</p>
          {payload.map((entry, i) => (
            <p key={i} style={{ color: entry.color }} className="text-sm">
              {entry.name}: KES{" "}
              {parseFloat(entry.value).toLocaleString()}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <Spinner centered className="py-12" label="Loading analytics…" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-6 lg:mb-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 size={28} /> Analytics
          </h1>
          <p className="text-sm lg:text-base text-gray-600 mt-1">
            Insights for{" "}
            <span className="font-semibold">{periodLabel(period)}</span>
          </p>
        </div>
        <PeriodNavigator value={period} onChange={setPeriod} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-ocean-600 text-white rounded-xl shadow-lg p-4 lg:p-6">
          <p className="text-blue-100 text-xs uppercase">Active Portfolio</p>
          <p className="text-xl lg:text-2xl font-bold mt-2">
            {formatKES(data.kpis?.active_portfolio)}
          </p>
          <p className="text-xs text-blue-200 mt-1">
            {data.kpis?.active_loans} active loans
          </p>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl shadow-lg p-4 lg:p-6">
          <p className="text-green-100 text-xs uppercase">Collections</p>
          <p className="text-xl lg:text-2xl font-bold mt-2">
            {formatKES(data.kpis?.collections_30d)}
          </p>
          <p className="text-xs text-green-200 mt-1">in {periodLabel(period)}</p>
        </div>
        <div className="bg-ocean-gradient text-white rounded-xl shadow-lg p-4 lg:p-6">
          <p className="text-ocean-100 text-xs uppercase">New Loans</p>
          <p className="text-xl lg:text-2xl font-bold mt-2">
            {data.kpis?.new_loans_30d || 0}
          </p>
          <p className="text-xs text-ocean-200 mt-1">
            {formatKES(data.kpis?.disbursements_30d)} disbursed
          </p>
        </div>
        <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-xl shadow-lg p-4 lg:p-6">
          <p className="text-orange-100 text-xs uppercase">Overdue</p>
          <p className="text-xl lg:text-2xl font-bold mt-2">
            {data.kpis?.overdue_count || 0}
          </p>
          <p className="text-xs text-orange-200 mt-1">
            {formatKES(data.kpis?.total_overdue_amount)} due
          </p>
        </div>
      </div>

      {/* Revenue Trends */}
      <div className="bg-white rounded-xl shadow-md p-4 lg:p-6 mb-6">
        <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp size={22} /> Revenue Trends ({periodLabel(period)})
        </h2>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data.revenueTrends}>
            <defs>
              <linearGradient id="colorDisbursed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(value) => formatKESCompact(value)} />
            <Tooltip content={<CurrencyTooltip />} />
            <Legend />
            <Area
              type="monotone"
              dataKey="disbursed"
              name="Disbursed"
              stroke="#4F46E5"
              fill="url(#colorDisbursed)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="collected"
              name="Collected"
              stroke="#10B981"
              fill="url(#colorCollected)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Portfolio + Payment Methods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-md p-4 lg:p-6">
          <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <BarChart3 size={22} /> Loan Portfolio
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={data.portfolioBreakdown}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ status, percentage }) =>
                  `${status}: ${percentage}%`
                }
                outerRadius={80}
                fill="#8884d8"
                dataKey="count"
              >
                {data.portfolioBreakdown.map((entry, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-2 mt-4">
            {data.portfolioBreakdown.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded"
                  style={{ background: COLORS[idx % COLORS.length] }}
                />
                <span className="text-sm capitalize">
                  {item.status}: {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-md p-4 lg:p-6">
          <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <CreditCard size={22} /> Payment Methods
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={data.paymentMethods}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ payment_method, percentage }) =>
                  `${payment_method}: ${percentage}%`
                }
                outerRadius={80}
                dataKey="count"
              >
                {data.paymentMethods.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={COLORS[(index + 2) % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-1 gap-2 mt-4">
            {data.paymentMethods.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded"
                    style={{
                      background: COLORS[(idx + 2) % COLORS.length],
                    }}
                  />
                  <span className="text-sm">{item.payment_method}</span>
                </div>
                <span className="text-sm font-semibold">
                  {formatKES(item.total_amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Default Rate Trend */}
      <div className="bg-white rounded-xl shadow-md p-4 lg:p-6 mb-6">
        <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <AlertTriangle size={22} className="text-red-500" /> Default Rate Trend
        </h2>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.defaultTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(value) => `${value}%`} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white p-3 border-2 border-gray-200 rounded-lg shadow-lg">
                      <p className="font-bold text-gray-800">{label}</p>
                      <p className="text-sm text-red-600">
                        Default Rate: {payload[0].value}%
                      </p>
                      <p className="text-xs text-gray-600">
                        Defaulted: {payload[0].payload.defaulted_loans} of{" "}
                        {payload[0].payload.total_loans}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Line
              type="monotone"
              dataKey="default_rate"
              stroke="#EF4444"
              strokeWidth={3}
              dot={{ r: 5 }}
              activeDot={{ r: 8 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Loan Size Distribution */}
      <div className="bg-white rounded-xl shadow-md p-4 lg:p-6 mb-6">
        <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <BarChart3 size={22} /> Loan Size Distribution
        </h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data.loanDistribution}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="range" />
            <YAxis />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white p-3 border-2 border-gray-200 rounded-lg shadow-lg">
                      <p className="font-bold">{label}</p>
                      <p className="text-sm">
                        Loans: {payload[0].payload.count}
                      </p>
                      <p className="text-sm">
                        Total: {formatKES(payload[0].payload.total_value)}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="count" fill="#4F46E5" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top Clients */}
      <div className="bg-white rounded-xl shadow-md p-4 lg:p-6 mb-6">
        <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Trophy size={22} className="text-yellow-500" /> Top 10 Clients by Total Borrowed
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  #
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Loans
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Borrowed
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                  Paid
                </th>
              </tr>
            </thead>
            <tbody>
              {data.topClients.map((client, idx) => (
                <tr
                  key={client.id}
                  className="border-b hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex w-7 h-7 rounded-full items-center justify-center font-bold text-white text-sm ${
                        idx === 0
                          ? "bg-yellow-500"
                          : idx === 1
                            ? "bg-gray-400"
                            : idx === 2
                              ? "bg-orange-600"
                              : "bg-ocean-500"
                      }`}
                    >
                      {idx + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-800">
                      {client.first_name} {client.last_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {client.phone_number}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {client.loan_count}
                  </td>
                  <td className="px-4 py-3 font-bold text-ocean-600">
                    {formatKES(client.total_borrowed)}
                  </td>
                  <td className="px-4 py-3 font-bold text-green-600">
                    {formatKES(client.total_paid)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Geographic Distribution */}
      <div className="bg-white rounded-xl shadow-md p-4 lg:p-6 mb-6">
        <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <MapPin size={22} /> Geographic Distribution (Top 15 Counties)
        </h2>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={data.geographic}
            layout="vertical"
            margin={{ left: 80 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis type="category" dataKey="county" width={80} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white p-3 border-2 border-gray-200 rounded-lg shadow-lg">
                      <p className="font-bold">{label}</p>
                      <p className="text-sm">
                        Clients: {payload[0].payload.client_count}
                      </p>
                      <p className="text-sm">
                        Loans: {payload[0].payload.loan_count}
                      </p>
                      <p className="text-sm">
                        Disbursed:{" "}
                        {formatKES(payload[0].payload.total_disbursed)}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar
              dataKey="client_count"
              fill="#8B5CF6"
              radius={[0, 8, 8, 0]}
              name="Clients"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Insights */}
      <div className="bg-ocean-gradient-soft border border-ocean-200 rounded-xl p-6">
        <h3 className="font-bold text-ocean-900 mb-3 text-lg flex items-center gap-2">
          <Lightbulb size={22} /> Quick Insights
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-ocean-800">
              <strong>Average loan size:</strong>{" "}
              {formatKES(data.kpis?.avg_loan_size)}
            </p>
            <p className="text-ocean-800 mt-1">
              <strong>Average interest rate:</strong>{" "}
              {parseFloat(data.kpis?.avg_interest_rate || 0).toFixed(2)}% per
              annum
            </p>
          </div>
          <div>
            <p className="text-ocean-800">
              <strong>New clients:</strong>{" "}
              {data.kpis?.new_clients_30d}
            </p>
            <p className="text-ocean-800 mt-1">
              <strong>Most popular method:</strong>{" "}
              {data.paymentMethods[0]?.payment_method || "N/A"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Analytics;
