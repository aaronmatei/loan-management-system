import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Trash2, Check, Mail } from "lucide-react";
import api from "../services/api";

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
    return new Date(date).toLocaleString();
  };

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <Bell size={28} /> Notifications
          </h1>
          <p className="text-sm lg:text-base text-gray-600 mt-1">
            All your notifications in one place
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleMarkAllRead}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-ocean-600 hover:bg-ocean-700 text-white rounded-lg text-sm font-semibold"
          >
            <Check size={15} /> Mark All Read
          </button>
          <button
            onClick={handleClearOld}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-semibold"
          >
            <Trash2 size={15} /> Clear Old
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            filter === "all"
              ? "bg-ocean-600 text-white"
              : "bg-white text-gray-700"
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            filter === "unread"
              ? "bg-ocean-600 text-white"
              : "bg-white text-gray-700"
          }`}
        >
          Unread
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl p-12 text-center">Loading...</div>
      ) : notifications.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <Mail size={56} className="mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">No notifications</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => handleClick(notif)}
              className={`bg-white rounded-xl shadow-md p-4 cursor-pointer hover:shadow-lg transition ${
                !notif.is_read ? "border-l-4 border-ocean-600" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl flex items-center">{notif.icon || <Bell size={28} className="text-gray-400" />}</div>
                <div className="flex-1 min-w-0">
                  <h3
                    className={`${
                      !notif.is_read ? "font-bold" : "font-semibold"
                    }`}
                  >
                    {notif.title}
                  </h3>
                  <p className="text-gray-600 text-sm mt-1">
                    {notif.message}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
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
