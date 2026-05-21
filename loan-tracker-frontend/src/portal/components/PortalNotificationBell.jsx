import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";
import portalApi from "../services/portalApi";

const SEEN_KEY = "portal_notifs_seen";
const DISMISSED_KEY = "portal_notifs_dismissed";

const META = {
  payment: { icon: "💵", label: "Payment received" },
  approved: { icon: "✅", label: "Application approved" },
  disbursed: { icon: "💰", label: "Loan disbursed" },
  rejected: { icon: "❌", label: "Application declined" },
  overdue: { icon: "⚠️", label: "Payment overdue" },
};

const ago = (d) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString();
};

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;
const keyOf = (n) => `${n.type}:${n.loan_id}:${n.at}`;
const readDismissed = () => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
  } catch {
    return [];
  }
};

// Customer notification bell. Notifications are derived server-side (payments,
// application decisions, disbursals, overdue alerts). "Seen" (unread badge)
// and "dismissed" (deleted items) are tracked locally since there is no
// notifications table to write to.
function PortalNotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(
    () => localStorage.getItem(SEEN_KEY) || "1970-01-01",
  );
  const [dismissed, setDismissed] = useState(readDismissed);
  const ref = useRef(null);

  const load = () => {
    portalApi
      .get("/portal/customer/notifications")
      .then((r) => setItems(r.data.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const visible = items.filter((n) => !dismissed.includes(keyOf(n)));
  const unread = visible.filter((n) => new Date(n.at) > new Date(seen)).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && visible.length) {
      const now = new Date().toISOString();
      localStorage.setItem(SEEN_KEY, now);
      setSeen(now);
    }
  };

  const persistDismissed = (list) => {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(list));
    setDismissed(list);
  };

  const dismiss = (n) => persistDismissed([...dismissed, keyOf(n)]);
  const clearAll = () =>
    persistDismissed([...dismissed, ...visible.map(keyOf)]);

  // Open the loan a notification refers to (scope the session to its lender).
  const openNotif = async (n) => {
    setOpen(false);
    if (!n.loan_id || !n.tenant_id) return;
    try {
      const r = await portalApi.post("/portal/auth/select-tenant", {
        tenant_id: n.tenant_id,
      });
      localStorage.setItem("portal_token", r.data.token);
      localStorage.setItem(
        "portal_current_tenant",
        JSON.stringify({ ...r.data.current_tenant, brand_color: n.brand_color }),
      );
      navigate(`/loanfix/portal/loans/${n.loan_id}`);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition"
        aria-label="Notifications"
      >
        <Bell size={20} className="text-navy-900" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="font-bold text-navy-900">Notifications</p>
            {visible.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs font-semibold text-ocean-600 hover:text-ocean-700"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-auto">
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Nothing yet — your payments and application updates will show
                here.
              </p>
            ) : (
              visible.map((n) => {
                const m = META[n.type] || { icon: "🔔", label: n.type };
                const isUnread = new Date(n.at) > new Date(seen);
                return (
                  <div
                    key={keyOf(n)}
                    className={`flex gap-3 px-4 py-3 border-b border-slate-50 last:border-0 ${
                      isUnread ? "bg-sky-50" : ""
                    }`}
                  >
                    <button
                      onClick={() => openNotif(n)}
                      className="flex gap-3 flex-1 min-w-0 text-left"
                    >
                      <span className="text-lg leading-none mt-0.5">
                        {m.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-navy-900">
                          {m.label}
                        </p>
                        <p className="text-xs text-slate-600">
                          {n.loan_code}
                          {n.amount != null ? ` · ${KES(n.amount)}` : ""}
                        </p>
                        {n.lender && (
                          <p className="text-xs text-slate-400">{n.lender}</p>
                        )}
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {ago(n.at)}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => dismiss(n)}
                      className="self-start p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                      aria-label="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PortalNotificationBell;
