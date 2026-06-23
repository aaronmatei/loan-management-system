import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Trash2, Check, BellOff } from "lucide-react";
import api from "../services/api";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Skeleton from "../components/Skeleton";

function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchNotifications();
  }, [filter]);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const url =
        filter === "unread"
          ? "/notifications?only_unread=true&limit=100"
          : "/notifications?limit=100";
      const res = await api.get(url);
      setNotifications(res.data.data);
    } catch (err) {
      console.error("Failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = async (notif) => {
    if (!notif.is_read) {
      try {
        await api.put(`/notifications/${notif.id}/read`);
      } catch (err) {
        console.error("Failed to mark read:", err);
      }
    }
    if (notif.link) navigate(notif.link);
  };

  const handleMarkAllRead = async () => {
    try {
      await api.put("/notifications/mark-all-read");
      fetchNotifications();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleClearOld = async () => {
    if (!window.confirm("Delete all read notifications older than 7 days?"))
      return;
    try {
      const res = await api.delete("/notifications/clear-old");
      alert(`Deleted ${res.data.deleted_count} old notifications`);
      fetchNotifications();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const getTimeAgo = (date) => {
    const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(date).toLocaleString("en-GB");
  };

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
      <PageHeader
        icon={Bell}
        title="Notifications"
        subtitle="All your notifications in one place"
        actions={
          <>
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg text-sm font-semibold"
            >
              <Check size={15} /> Mark All Read
            </button>
            <button
              onClick={handleClearOld}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg text-sm font-semibold"
            >
              <Trash2 size={15} /> Clear Old
            </button>
          </>
        }
      />

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            filter === "all"
              ? "bg-ocean-600 text-white"
              : "bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200"
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            filter === "unread"
              ? "bg-ocean-600 text-white"
              : "bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200"
          }`}
        >
          Unread
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl shadow-md p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="h-7 w-7" rounded="rounded-lg" />
                <div className="flex-1 min-w-0 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications"
          description={
            filter === "unread"
              ? "You're all caught up — no unread notifications right now."
              : "Notifications about applications, payments and loans will show up here."
          }
          tone="muted"
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => handleClick(notif)}
              className={`bg-white dark:bg-slate-800 rounded-xl shadow-md p-4 cursor-pointer hover:shadow-lg transition ${
                !notif.is_read ? "border-l-4 border-ocean-600" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl flex items-center">{notif.icon || <Bell size={28} className="text-gray-400 dark:text-slate-400" />}</div>
                <div className="flex-1 min-w-0">
                  <h3
                    className={`${
                      !notif.is_read ? "font-bold" : "font-semibold"
                    }`}
                  >
                    {notif.title}
                  </h3>
                  <p className="text-gray-600 dark:text-slate-400 text-sm mt-1">
                    {notif.message}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-slate-400 mt-2">
                    {getTimeAgo(notif.created_at)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Notifications;
