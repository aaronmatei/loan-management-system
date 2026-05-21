import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

function NotificationBell() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (showDropdown) fetchNotifications();
  }, [showDropdown]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchUnreadCount = async () => {
    try {
      const res = await api.get("/notifications/unread-count");
      setUnreadCount(res.data.unread_count);
    } catch (err) {
      console.error("Failed to fetch count:", err);
    }
  };

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await api.get("/notifications?limit=10");
      setNotifications(res.data.data);
      setUnreadCount(res.data.unread_count);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      try {
        await api.put(`/notifications/${notification.id}/read`);
        setUnreadCount((p) => Math.max(0, p - 1));
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, is_read: true } : n,
          ),
        );
      } catch (err) {
        console.error("Failed to mark as read:", err);
      }
    }
    if (notification.link) {
      navigate(notification.link);
      setShowDropdown(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.put("/notifications/mark-all-read");
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: true })),
      );
    } catch (err) {
      alert("Failed to mark all as read");
    }
  };

  const handleDelete = async (e, notification) => {
    e.stopPropagation();
    try {
      await api.delete(`/notifications/${notification.id}`);
      setNotifications((prev) =>
        prev.filter((n) => n.id !== notification.id),
      );
      if (!notification.is_read) {
        setUnreadCount((p) => Math.max(0, p - 1));
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const getTimeAgo = (date) => {
    const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(date).toLocaleDateString();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition"
        aria-label="Notifications"
      >
        <svg
          className="w-6 h-6 text-gray-700"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center animate-pulse">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
          <div className="bg-ocean-gradient text-white p-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">🔔 Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-ocean-100 hover:text-white underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <p className="text-xs text-ocean-100 mt-1">
              {unreadCount > 0
                ? `${unreadCount} unread`
                : "All caught up! ✨"}
            </p>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-4xl mb-2">📭</p>
                <p className="text-gray-500">No notifications yet</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition group ${
                    !notif.is_read ? "bg-ocean-50/50" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-2xl flex-shrink-0">
                      {notif.icon || "📢"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm text-gray-800 ${
                            !notif.is_read ? "font-bold" : "font-semibold"
                          }`}
                        >
                          {notif.title}
                        </p>
                        {!notif.is_read && (
                          <span className="w-2 h-2 bg-ocean-600 rounded-full flex-shrink-0 mt-1.5" />
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {notif.message}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-gray-400">
                          {getTimeAgo(notif.created_at)}
                        </p>
                        <button
                          onClick={(e) => handleDelete(e, notif)}
                          className="text-xs text-red-500 opacity-0 group-hover:opacity-100 transition"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div className="p-3 border-t bg-gray-50 text-center">
              <button
                onClick={() => {
                  navigate("/notifications");
                  setShowDropdown(false);
                }}
                className="text-sm text-ocean-600 hover:text-ocean-800 font-semibold"
              >
                View all notifications →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
