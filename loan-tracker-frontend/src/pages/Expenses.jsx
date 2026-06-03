// Expenses & Billing — the cash-out ledger. Tenants record operating
// expenses (salaries, transport, transaction fees, etc.); a banner up
// top links to the existing Platform Billing page since those invoices
// are also an expense to the tenant.
//
// Phase 1: pure ledger. Add/edit/delete + filters + totals.
// No capital-pool integration yet — that's phase 2.

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Receipt,
  Plus,
  Search,
  X,
  Trash2,
  Pencil,
  RefreshCcw,
  Sparkles,
  ArrowUpRight,
  Wallet,
  Calendar,
  PieChart,
  Repeat,
  Tag,
  ChevronRight,
  Settings as SettingsIcon,
  Link2,
} from "lucide-react";
import api from "../services/api";
import PermissionGate from "../components/PermissionGate";
import Spinner from "../components/Spinner";
import PeriodNavigator, {
  periodToRange,
  usePersistentPeriod,
} from "../components/PeriodNavigator";

const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const today = () => new Date().toISOString().split("T")[0];
const ymd = (v) =>
  v ? new Date(v).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—";

const RECURRENCE_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];
const PAYMENT_METHODS = [
  "M-Pesa",
  "Bank Transfer",
  "Cash",
  "Cheque",
  "Card",
  "Other",
];

function Expenses() {
  const navigate = useNavigate();
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  // Month/Year period picker (with back/forward arrows). Drives
  // dateFrom/dateTo automatically — when the user picks April
  // 2026, the period resolves to 2026-04-01 / 2026-04-30 and
  // the table shows only expenses in that range. Persisted in
  // localStorage + URL so a refresh keeps the same window.
  const [period, setPeriod] = usePersistentPeriod();
  const { from: dateFrom, to: dateTo } = periodToRange(period);
  const [recurringFilter, setRecurringFilter] = useState("all");

  // Modals
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [showDeleteId, setShowDeleteId] = useState(null);

  const [form, setForm] = useState({
    category_id: "",
    amount: "",
    description: "",
    expense_date: today(),
    payment_method: "M-Pesa",
    reference: "",
    is_recurring: false,
    recurrence_period: "monthly",
  });
  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async ({ silent = false } = {}) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      // include_system=true so the table renders the category name
      // on auto-imported Platform Billing rows. The Record-expense
      // modal still hides system categories from its dropdown via
      // c.is_system filter on the client.
      const [e, c, s] = await Promise.all([
        api.get("/expenses"),
        api.get("/expenses/categories?include_system=true"),
        api.get("/expenses/stats"),
      ]);
      setExpenses(e.data.data);
      setCategories(c.data.data);
      setStats(s.data.data);
    } catch (err) {
      console.error("Failed to load expenses:", err);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({
      category_id:
        categories
          .find((c) => c.is_active && !c.is_system)
          ?.id?.toString() || "",
      amount: "",
      description: "",
      expense_date: today(),
      payment_method: "M-Pesa",
      reference: "",
      is_recurring: false,
      recurrence_period: "monthly",
    });
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (exp) => {
    setEditing(exp);
    setForm({
      category_id: String(exp.category_id || ""),
      amount: exp.amount,
      description: exp.description || "",
      expense_date: exp.expense_date
        ? new Date(exp.expense_date).toISOString().split("T")[0]
        : today(),
      payment_method: exp.payment_method || "M-Pesa",
      reference: exp.reference || "",
      is_recurring: !!exp.is_recurring,
      recurrence_period: exp.recurrence_period || "monthly",
    });
    setFormError("");
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.category_id) {
      setFormError("Please choose a category.");
      return;
    }
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setFormError("Amount must be greater than zero.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const payload = {
        ...form,
        category_id: parseInt(form.category_id, 10),
        amount: parseFloat(form.amount),
      };
      if (editing) {
        await api.put(`/expenses/${editing.id}`, payload);
      } else {
        await api.post("/expenses", payload);
      }
      setShowForm(false);
      fetchAll({ silent: true });
    } catch (err) {
      setFormError(err.response?.data?.error || "Failed to save expense");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!showDeleteId) return;
    try {
      await api.delete(`/expenses/${showDeleteId}`);
      setShowDeleteId(null);
      fetchAll({ silent: true });
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete");
    }
  };

  // Client-side filter (we already sort server-side by date desc).
  const filteredExpenses = expenses.filter((e) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = [
        e.description,
        e.reference,
        e.category_name,
        e.recorded_by_name,
        e.payment_method,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (categoryFilter !== "all" && String(e.category_id) !== categoryFilter) {
      return false;
    }
    if (dateFrom && e.expense_date < dateFrom) return false;
    if (dateTo && e.expense_date > dateTo) return false;
    if (recurringFilter === "yes" && !e.is_recurring) return false;
    if (recurringFilter === "no" && e.is_recurring) return false;
    return true;
  });

  const filteredTotal = filteredExpenses.reduce(
    (acc, e) => acc + parseFloat(e.amount || 0),
    0,
  );

  // Period is ALWAYS set (defaults to current year, persisted in
  // localStorage), so it's not part of "filters active" — that
  // banner is for non-default search/category/recurring picks.
  // Clearing the filters doesn't reset the period for the same
  // reason: the picker is the primary control, not a filter you
  // turn on and off.
  const filtersActive =
    searchQuery ||
    categoryFilter !== "all" ||
    recurringFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setRecurringFilter("all");
  };

  const topCategory = stats?.by_category?.find((c) => c.total > 0);

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-stone-100 p-12">
          <Spinner centered label="Loading expenses…" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* ── Editorial header ────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-10">
        <div className="max-w-2xl">
          <h1 className="text-4xl lg:text-5xl font-bold text-stone-900 tracking-tight">
            Expenses{" "}
            <span className="font-serif italic font-medium text-amber-700">
              &amp; Billing
            </span>
          </h1>
          <p className="text-stone-500 mt-3 leading-relaxed">
            The other side of the books — salaries, transport, transaction fees,
            and the platform invoices you settle each month. Every shilling out
            that isn't a loan disbursement.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={() => fetchAll({ silent: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-stone-200 text-stone-700 font-semibold rounded-xl hover:bg-stone-50 transition disabled:opacity-50"
          >
            <RefreshCcw
              size={16}
              className={refreshing ? "animate-spin" : ""}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <PermissionGate role={["admin", "manager"]}>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-800 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition"
            >
              <Plus size={16} /> Record Expense
            </button>
          </PermissionGate>
        </div>
      </div>

      {/* ── Stat cards — sunset-to-earth palette (amber → stone) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-amber-100/70 via-white/55 to-orange-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-amber-300/30 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-amber-700">
              Total Recorded
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <Wallet size={16} className="text-amber-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-stone-900 mt-3">
            {fmt(stats?.total_all)}
          </p>
          <p className="relative text-xs text-stone-500 mt-1">
            {stats?.count_all || 0} entries
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-orange-100/70 via-white/55 to-amber-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-orange-300/30 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-orange-700">
              This Month
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <Calendar size={16} className="text-orange-600" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-stone-900 mt-3">
            {fmt(stats?.total_this_month)}
          </p>
          <p className="relative text-xs text-stone-500 mt-1">
            {stats?.count_this_month || 0} entries
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-yellow-100/70 via-white/55 to-amber-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-yellow-300/30 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-yellow-700">
              Last Month
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <Calendar size={16} className="text-yellow-700" />
            </div>
          </div>
          <p className="relative text-3xl lg:text-4xl font-bold text-stone-900 mt-3">
            {fmt(stats?.total_last_month)}
          </p>
          <p className="relative text-xs text-stone-500 mt-1">
            previous calendar month
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl shadow-sm border border-white/60 p-5 bg-gradient-to-br from-stone-100/70 via-white/55 to-amber-100/60 backdrop-blur-md">
          <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-stone-300/30 blur-3xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <p className="text-xs uppercase tracking-wider font-semibold text-stone-700">
              Top Category
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center">
              <PieChart size={16} className="text-stone-600" />
            </div>
          </div>
          <p className="relative text-2xl lg:text-3xl font-bold text-stone-900 mt-3 break-words leading-tight">
            {topCategory?.name || "—"}
          </p>
          <p className="relative text-xs text-stone-500 mt-1">
            {topCategory ? fmt(topCategory.total) : "no expenses yet"}
          </p>
        </div>
      </div>

      {/* ── Quick actions ──────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-6 mb-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <Sparkles size={18} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-stone-900">Quick actions</h2>
            <p className="text-xs text-stone-500">
              Record outflows, manage categories, settle platform billing.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PermissionGate role={["admin", "manager"]}>
            <button
              onClick={openAdd}
              className="group relative text-left p-5 rounded-xl border border-amber-100 bg-amber-50/40 hover:bg-amber-50 hover:border-amber-200 transition"
            >
              <div className="absolute top-4 right-4 text-amber-400 group-hover:text-amber-600 transition">
                <ArrowUpRight size={18} />
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center mb-4">
                <Plus size={20} className="text-amber-700" />
              </div>
              <h3 className="font-semibold text-stone-900 mb-1">
                Record an expense
              </h3>
              <p className="text-sm text-stone-600 leading-relaxed">
                One-off or recurring. Pick a category, amount, and a few notes
                — done.
              </p>
              <p className="text-xs mt-3 text-amber-700 font-medium inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                {categories.filter((c) => c.is_active).length} categories ready
              </p>
            </button>
          </PermissionGate>

          <PermissionGate role={["admin", "manager"]}>
            <button
              onClick={() => setShowCategoriesModal(true)}
              className="group relative text-left p-5 rounded-xl border border-orange-100 bg-orange-50/40 hover:bg-orange-50 hover:border-orange-200 transition"
            >
              <div className="absolute top-4 right-4 text-orange-400 group-hover:text-orange-600 transition">
                <ArrowUpRight size={18} />
              </div>
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center mb-4">
                <SettingsIcon size={20} className="text-orange-700" />
              </div>
              <h3 className="font-semibold text-stone-900 mb-1">
                Manage categories
              </h3>
              <p className="text-sm text-stone-600 leading-relaxed">
                Toggle defaults you don't use, add your own. Keeps the
                drop-down lean.
              </p>
              <p className="text-xs mt-3 text-orange-700 font-medium inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-600" />
                {categories.length} total · {categories.filter((c) => !c.is_active).length} hidden
              </p>
            </button>
          </PermissionGate>

          <button
            onClick={() => navigate("/billing")}
            className="group relative text-left p-5 rounded-xl border border-stone-200 bg-stone-50/60 hover:bg-stone-100 hover:border-stone-300 transition"
          >
            <div className="absolute top-4 right-4 text-stone-400 group-hover:text-stone-700 transition">
              <ArrowUpRight size={18} />
            </div>
            <div className="w-10 h-10 rounded-xl bg-stone-200 flex items-center justify-center mb-4">
              <Receipt size={20} className="text-stone-700" />
            </div>
            <h3 className="font-semibold text-stone-900 mb-1">
              Platform billing
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed">
              The invoices LoanFix sends you. Settle them, then mirror as an
              expense entry under "Platform Billing".
            </p>
            <p className="text-xs mt-3 text-stone-700 font-medium inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-stone-500" />
              View invoices
            </p>
          </button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-stone-600 uppercase mb-1">
              Search
            </label>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Description, reference, category…"
                className="w-full pl-9 pr-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 uppercase mb-1">
              Category
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
            >
              <option value="all">All categories</option>
              {categories
                .filter((c) => c.is_active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          {/* Period picker — Month/Year toggle with back/forward
              arrows. Replaces the previous From/To date pair so
              the user can step through periods with one click
              instead of manually picking two dates. Spans 2
              columns to keep the filter row balanced (Search 2 +
              Category 1 + Period 2 = 5). */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-stone-600 uppercase mb-1">
              Period
            </label>
            <PeriodNavigator value={period} onChange={setPeriod} />
          </div>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3 mt-3 pt-3 border-t border-stone-100">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-600 uppercase">
              Recurring
            </span>
            {["all", "yes", "no"].map((v) => (
              <button
                key={v}
                onClick={() => setRecurringFilter(v)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                  recurringFilter === v
                    ? "bg-amber-600 text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {v === "all" ? "All" : v === "yes" ? "Recurring" : "One-off"}
              </button>
            ))}
          </div>
          {filtersActive && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-800"
            >
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-380px)]">
          <table className="w-full">
            <thead className="bg-stone-50 border-b-2 border-stone-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">
                  Description
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-600 uppercase">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">
                  Method
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-600 uppercase">
                  Recorded By
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-600 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td
                    colSpan="7"
                    className="px-4 py-16 text-center text-stone-500"
                  >
                    {expenses.length === 0
                      ? "No expenses recorded yet — click \"Record Expense\" to start the ledger."
                      : "No expenses match your filters."}
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-stone-100 hover:bg-stone-50/60 transition"
                  >
                    <td className="px-4 py-3 text-sm text-stone-700">
                      {ymd(e.expense_date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-2 flex-wrap">
                        <Tag size={14} className="text-stone-400" />
                        <span className="text-sm font-medium text-stone-900">
                          {e.category_name || "—"}
                        </span>
                        {e.invoice_id && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 text-stone-700"
                            title="Auto-imported from Platform Billing"
                          >
                            <Link2 size={10} /> Auto
                          </span>
                        )}
                        {e.is_recurring && !e.invoice_id && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800"
                            title={`Recurring · ${e.recurrence_period || "monthly"}`}
                          >
                            <Repeat size={10} />
                            {e.recurrence_period || "recurring"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-700 max-w-md">
                      <p className="truncate">{e.description || "—"}</p>
                      {e.reference && (
                        <p className="text-xs text-stone-400 font-mono">
                          Ref · {e.reference}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-rose-700">
                        − {fmt(e.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-600">
                      {e.payment_method || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-600">
                      {e.recorded_by_name || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {e.invoice_id ? (
                          // Auto-synced from Platform Billing — send the user
                          // to the Billing page where they can actually settle it.
                          <button
                            onClick={() => navigate("/billing")}
                            className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition"
                            title="Open the underlying invoice on Billing"
                          >
                            <Link2 size={14} />
                          </button>
                        ) : (
                          <>
                            <PermissionGate role={["admin", "manager"]}>
                              <button
                                onClick={() => openEdit(e)}
                                className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-600 hover:text-amber-700 transition"
                                title="Edit"
                              >
                                <Pencil size={14} />
                              </button>
                            </PermissionGate>
                            <PermissionGate role="admin">
                              <button
                                onClick={() => setShowDeleteId(e.id)}
                                className="p-1.5 rounded-lg hover:bg-rose-50 text-stone-400 hover:text-rose-700 transition"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            </PermissionGate>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredExpenses.length > 0 && (
              <tfoot className="bg-stone-50 border-t-2 border-stone-200">
                <tr>
                  <td
                    colSpan="3"
                    className="px-4 py-3 text-sm font-bold text-stone-800"
                  >
                    TOTALS · {filteredExpenses.length} entr
                    {filteredExpenses.length === 1 ? "y" : "ies"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-bold text-rose-700 text-base">
                      − {fmt(filteredTotal)}
                    </span>
                  </td>
                  <td colSpan="3"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Add/Edit Form Modal ────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-2xl w-full my-8">
            <div className="flex justify-between items-start mb-5">
              <h3 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
                {editing ? <Pencil size={22} /> : <Plus size={22} />}
                {editing ? "Edit expense" : "Record expense"}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                disabled={submitting}
                className="text-stone-400 hover:text-stone-600"
              >
                <X size={22} />
              </button>
            </div>

            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-stone-700 mb-1">
                    Category *
                  </label>
                  <select
                    required
                    value={form.category_id}
                    onChange={(e) =>
                      setForm({ ...form, category_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                  >
                    <option value="">Select a category…</option>
                    {categories
                      .filter((c) => c.is_active && !c.is_system)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-stone-700 mb-1">
                    Amount (KES) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) =>
                      setForm({ ...form, amount: e.target.value })
                    }
                    placeholder="e.g. 5000"
                    className="w-full px-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-1">
                  Description
                </label>
                <textarea
                  rows="2"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="What was this for?"
                  className="w-full px-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-stone-700 mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.expense_date}
                    onChange={(e) =>
                      setForm({ ...form, expense_date: e.target.value })
                    }
                    max={today()}
                    className="w-full px-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-stone-700 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={form.payment_method}
                    onChange={(e) =>
                      setForm({ ...form, payment_method: e.target.value })
                    }
                    className="w-full px-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-stone-700 mb-1">
                    Reference
                  </label>
                  <input
                    type="text"
                    value={form.reference}
                    onChange={(e) =>
                      setForm({ ...form, reference: e.target.value })
                    }
                    placeholder="M-Pesa code, receipt #…"
                    className="w-full px-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="bg-stone-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-sm font-semibold text-stone-700">
                    Recurring expense
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.is_recurring}
                    onClick={() =>
                      setForm({ ...form, is_recurring: !form.is_recurring })
                    }
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                      form.is_recurring ? "bg-amber-600" : "bg-stone-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                        form.is_recurring ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
                {form.is_recurring ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-stone-600">Repeats</span>
                    <select
                      value={form.recurrence_period}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          recurrence_period: e.target.value,
                        })
                      }
                      className="px-3 py-1 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none bg-white text-sm"
                    >
                      {RECURRENCE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-stone-500">
                      (tag only — each one still entered manually)
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-stone-500">
                    One-off expense — won't be tagged for recurrence filters.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={submitting}
                  className="px-5 py-2 bg-stone-500 text-white font-semibold rounded-lg disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-gradient-to-r from-amber-600 to-amber-800 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {editing ? <Pencil size={16} /> : <Plus size={16} />}
                  {submitting ? "Saving…" : editing ? "Save changes" : "Record"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Categories Modal ───────────────────────────────────── */}
      {showCategoriesModal && (
        <CategoriesModal
          categories={categories}
          onClose={() => {
            setShowCategoriesModal(false);
            fetchAll({ silent: true });
          }}
        />
      )}

      {/* ── Delete Confirmation ────────────────────────────────── */}
      {showDeleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-md w-full">
            <h3 className="text-xl font-bold text-stone-900 mb-2 flex items-center gap-2">
              <Trash2 size={20} className="text-rose-700" />
              Delete expense?
            </h3>
            <p className="text-sm text-stone-600 mb-5">
              This permanently removes the entry from the ledger. The capital
              pool isn't affected (Phase 2 will hook those up).
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteId(null)}
                className="px-5 py-2 bg-stone-500 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-5 py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg inline-flex items-center gap-2"
              >
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Categories Modal — manage active state + add custom ────────
function CategoriesModal({ categories, onClose }) {
  const [list, setList] = useState(categories);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  const toggle = async (cat) => {
    try {
      const r = await api.put(`/expenses/categories/${cat.id}`, {
        is_active: !cat.is_active,
      });
      setList((p) => p.map((c) => (c.id === cat.id ? r.data.data : c)));
    } catch (e) {
      setErr(e.response?.data?.error || "Failed to update");
    }
  };

  const addCustom = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setErr("");
    try {
      const r = await api.post("/expenses/categories", {
        name: newName.trim(),
      });
      setList((p) => {
        if (p.some((c) => c.id === r.data.data.id)) {
          return p.map((c) => (c.id === r.data.data.id ? r.data.data : c));
        }
        return [...p, r.data.data];
      });
      setNewName("");
    } catch (e) {
      setErr(e.response?.data?.error || "Failed to add");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl p-6 lg:p-8 max-w-xl w-full my-8">
        <div className="flex justify-between items-start mb-5">
          <h3 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
            <SettingsIcon size={22} /> Expense categories
          </h3>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600"
          >
            <X size={22} />
          </button>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">
            {err}
          </div>
        )}

        <form
          onSubmit={addCustom}
          className="flex gap-2 mb-5 pb-5 border-b border-stone-100"
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a custom category…"
            className="flex-1 px-3 py-2 border-2 border-stone-200 rounded-lg focus:border-amber-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-800 text-white font-semibold rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Plus size={16} /> Add
          </button>
        </form>

        <div className="space-y-1">
          {list
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
            .map((c) => (
              <div
                key={c.id}
                className={`flex items-center justify-between px-3 py-2 rounded-lg transition ${
                  c.is_active ? "bg-stone-50" : "bg-stone-50/60 opacity-60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Tag size={14} className="text-stone-400" />
                  <span className="text-sm font-medium text-stone-900">
                    {c.name}
                  </span>
                  {c.is_system ? (
                    <span
                      className="px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 text-[10px] font-bold uppercase"
                      title="Auto-managed by LoanFix — populated from paid Platform Billing invoices"
                    >
                      Auto
                    </span>
                  ) : c.is_default ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold uppercase">
                      Default
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() => !c.is_system && toggle(c)}
                  role="switch"
                  aria-checked={c.is_active}
                  disabled={c.is_system}
                  title={
                    c.is_system
                      ? "System category — can't be disabled"
                      : c.is_active
                        ? "Hide this category"
                        : "Show this category"
                  }
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    c.is_active ? "bg-amber-600" : "bg-stone-300"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                      c.is_active ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            ))}
        </div>

        <div className="flex justify-end gap-3 pt-5 mt-5 border-t border-stone-100">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-stone-500 text-white font-semibold rounded-lg"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default Expenses;
