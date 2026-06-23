import React, { useState, useEffect, useCallback } from "react";
import { MessageSquare, Mail, Coins } from "lucide-react";
import platformApi from "../services/platformApi";
import PlatformLayout from "../components/PlatformLayout";
import Skeleton from "../../components/Skeleton";
import EmptyState from "../../components/EmptyState";
import { formatKES } from "../../utils/money";

const KES = (v) => formatKES(v);
const today = () => new Date().toISOString().split("T")[0];
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
};

function CommunicationCosts() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchCosts = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const r = await platformApi.get(
        `/platform/billing/communication-costs?from=${from}&to=${to}`,
      );
      setData(r.data.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  return (
    <PlatformLayout>
      <div className="p-4 lg:p-8">
        <div className="mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <MessageSquare size={28} /> Communication Costs
          </h1>
          <p className="text-gray-600 dark:text-slate-400 mt-1">
            SMS + email charges per tenant (1 KES per message).
          </p>
        </div>

        {/* Date range */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 mb-6 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 mb-1">
              From
            </label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 dark:border-slate-700 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 mb-1">
              To
            </label>
            <input
              type="date"
              value={to}
              min={from}
              max={today()}
              onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 dark:border-slate-700 rounded-lg focus:border-ocean-500 focus:outline-none dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100"
            />
          </div>
          <button
            onClick={() => {
              setFrom(firstOfMonth());
              setTo(today());
            }}
            className="px-4 py-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg text-sm font-semibold"
          >
            This month
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 border-l-4 border-gray-100 dark:border-slate-700"
                >
                  <Skeleton className="h-3 w-24 mb-3" />
                  <Skeleton className="h-8 w-20 mb-2" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          </>
        ) : !data ? null : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 border-l-4 border-ocean-500">
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold flex items-center gap-1.5">
                  <MessageSquare size={14} /> SMS Sent
                </p>
                <p className="text-3xl font-bold mt-2 text-gray-800 dark:text-slate-100">
                  {data.totals.sms_count.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  @ {KES(data.rates.sms_kes)} each
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 border-l-4 border-ocean-500">
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase font-semibold flex items-center gap-1.5">
                  <Mail size={14} /> Emails Sent
                </p>
                <p className="text-3xl font-bold mt-2 text-gray-800 dark:text-slate-100">
                  {data.totals.email_count.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  @ {KES(data.rates.email_kes)} each
                </p>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-6 border-l-4 border-emerald-500">
                <p className="text-gray-500 dark:text-slate-400 text-xs uppercase font-semibold flex items-center gap-1.5">
                  <Coins size={14} /> Total Charges
                </p>
                <p className="text-3xl font-bold mt-2">
                  {KES(data.totals.total_kes)}
                </p>
                <p className="text-gray-400 dark:text-slate-400 text-xs mt-1">
                  Across {data.tenants.length} tenant
                  {data.tenants.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            {/* Per-tenant table */}
            {data.tenants.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                tone="muted"
                title="No communication activity"
                description="No SMS or email was sent by any tenant in this period."
              />
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-md overflow-hidden">
                <div className="overflow-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-slate-900 border-b-2 border-gray-200 dark:border-slate-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">
                          Tenant
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">
                          SMS
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">
                          Email
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">
                          Total (KES)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tenants.map((t) => (
                        <tr
                          key={t.tenant_id}
                          className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700"
                        >
                          <td className="px-4 py-3 font-semibold text-gray-800 dark:text-slate-100 text-sm">
                            {t.business_name}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-slate-200">
                            {t.sms_count.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-gray-700 dark:text-slate-200">
                            {t.email_count.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-emerald-700">
                            {KES(t.total_kes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 dark:bg-slate-900 border-t-2 border-gray-200 dark:border-slate-700">
                      <tr>
                        <td className="px-4 py-3 text-sm font-bold text-gray-800 dark:text-slate-100">
                          TOTAL
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-gray-800 dark:text-slate-100">
                          {data.totals.sms_count.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-gray-800 dark:text-slate-100">
                          {data.totals.email_count.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-emerald-700">
                          {KES(data.totals.total_kes)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PlatformLayout>
  );
}

export default CommunicationCosts;
