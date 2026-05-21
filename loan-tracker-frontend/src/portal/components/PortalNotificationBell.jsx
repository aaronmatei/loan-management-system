import React, { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import portalApi from "../services/portalApi";

const SEEN_KEY = "portal_notifs_seen";

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

// Customer notification bell. Notifications are derived server-side (payments,
// application decisions, disbursals, overdue alerts); "seen" is tracked
// locally so the unread badge clears when the dropdown is opened.
function PortalNotificationBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(
    () => localStorage.getItem(SEEN_KEY) || "1970-01-01",
  );
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

  // Close on outside click.
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((n) => new Date(n.at) > new Date(seen)).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items.length) {
      const now = new Date().toISOString();
      localStorage.setItem(SEEN_KEY, now);
      setSeen(now);
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
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="font-bold text-navy-900">Notifications</p>
          </div>
          <div className="max-h-96 overflow-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Nothing yet — your payments and application updates will show
                here.
              </p>
            ) : (
              items.map((n, i) => {
                const m = META[n.type] || { icon: "🔔", label: n.type };
                const isUnread = new Date(n.at) > new Date(seen);
                return (
                  <div
                    key={i}
                    className={`flex gap-3 px-4 py-3 border-b border-slate-50 last:border-0 ${
                      isUnread ? "bg-sky-50" : ""
                    }`}
                  >
                    <span className="text-lg leading-none mt-0.5">
                      {m.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-navy-900">
                        {m.label}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {n.loan_code}
                        {n.amount != null ? ` · ${KES(n.amount)}` : ""}
                        {n.lender ? ` · ${n.lender}` : ""}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {ago(n.at)}
                      </p>
                    </div>
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
