import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  X,
  Coins,
  CheckCircle,
  Landmark,
  AlertTriangle,
  Clock,
  Eye,
  Banknote,
  Inbox,
} from "lucide-react";
import portalApi from "../services/portalApi";

const META = {
  application_received: { Icon: Inbox, label: "Application received" },
  payment: { Icon: Coins, label: "Payment received" },
  under_review: { Icon: Eye, label: "Application under review" },
  counter_offered: { Icon: Banknote, label: "Counter-offer received" },
  approved: { Icon: CheckCircle, label: "Application approved" },
  disbursed: { Icon: Landmark, label: "Loan disbursed" },
  rejected: { Icon: X, label: "Application declined" },
  overdue: { Icon: AlertTriangle, label: "Payment overdue" },
  due_soon: { Icon: Clock, label: "Payment due soon" },
};

const ago = (d) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const KES = (v) => `KES ${parseFloat(v || 0).toLocaleString()}`;

// Customer notification bell backed by the server. Notifications, read state
// and dismissals all live in customer_notifications, so they persist across
// devices. Opening the dropdown marks everything read.
function PortalNotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = () => {
    portalApi
      .get("/portal/customer/notifications")
      .then((r) => {
        setItems(r.data.data || []);
        setUnread(r.data.unread || 0);
      })
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

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      portalApi.post("/portal/customer/notifications/read-all").catch(() => {});
    }
  };

  const dismiss = (id) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    portalApi
      .post(`/portal/customer/notifications/${id}/dismiss`)
      .catch(() => {});
  };

  const clearAll = () => {
    setItems([]);
    portalApi.post("/portal/customer/notifications/dismiss-all").catch(() => {});
  };

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
      navigate(`/portal/loans/${n.loan_id}`);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition"
        aria-label="Notifications"
      >
        <Bell size={20} className="text-navy-900 dark:text-slate-100" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <p className="font-bold text-navy-900 dark:text-slate-100">Notifications</p>
            {items.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs font-semibold text-ocean-600 hover:text-ocean-700"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-400">
                Nothing yet — your payments and application updates will show
                here.
              </p>
            ) : (
              items.map((n) => {
                const m = META[n.type] || { Icon: Bell, label: n.type };
                const NIcon = m.Icon;
                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 px-4 py-3 border-b border-slate-50 dark:border-slate-700 last:border-0 ${
                      !n.is_read ? "bg-ocean-50" : ""
                    }`}
                  >
                    <button
                      onClick={() => openNotif(n)}
                      className="flex gap-3 flex-1 min-w-0 text-left"
                    >
                      <span className="flex items-center justify-center w-5 h-5 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400">
                        <NIcon size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-navy-900 dark:text-slate-100">
                          {m.label}
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {n.loan_code}
                          {n.amount != null ? ` · ${KES(n.amount)}` : ""}
                        </p>
                        {n.lender && (
                          <p className="text-xs text-slate-400 dark:text-slate-400">{n.lender}</p>
                        )}
                        <p className="text-[11px] text-slate-400 dark:text-slate-400 mt-0.5">
                          {ago(n.at)}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => dismiss(n.id)}
                      className="self-start p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
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
