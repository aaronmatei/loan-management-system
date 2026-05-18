import React, { useState } from "react";
import api from "../services/api";
import PermissionGate from "./PermissionGate";

/**
 * Shared bulk SMS + Email buttons and modals. Identical across the
 * Clients/Loans/Overdue pages, so it lives here once. Renders the two
 * action buttons (place inside <BulkActionBar>) plus their modals.
 *
 * @param {number[]} clientIds  - distinct client ids to message
 * @param {Function} onComplete - called after a successful send
 */
function BulkMessaging({ clientIds, onComplete }) {
  const [showSMS, setShowSMS] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [emailData, setEmailData] = useState({ subject: "", message: "" });
  const [submitting, setSubmitting] = useState(false);

  const count = clientIds.length;

  const handleBulkSMS = async (e) => {
    e.preventDefault();
    if (!smsMessage.trim()) return alert("Please enter a message");
    setSubmitting(true);
    try {
      const res = await api.post("/sms/bulk-send", {
        client_ids: clientIds,
        message: smsMessage,
      });
      alert(`✅ ${res.data.message}`);
      setShowSMS(false);
      setSmsMessage("");
      onComplete?.();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkEmail = async (e) => {
    e.preventDefault();
    if (!emailData.subject.trim() || !emailData.message.trim())
      return alert("Please fill subject and message");
    setSubmitting(true);
    try {
      const res = await api.post("/email/bulk-send", {
        client_ids: clientIds,
        ...emailData,
      });
      alert(`✅ ${res.data.message}`);
      setShowEmail(false);
      setEmailData({ subject: "", message: "" });
      onComplete?.();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PermissionGate permission="sms:send">
        <button
          onClick={() => setShowSMS(true)}
          className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold"
        >
          📱 SMS
        </button>
      </PermissionGate>

      <PermissionGate permission="email:send">
        <button
          onClick={() => setShowEmail(true)}
          className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold"
        >
          ✉️ Email
        </button>
      </PermissionGate>

      {showSMS && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-2xl w-full text-gray-800">
            <h3 className="text-2xl font-bold mb-4">📱 Bulk SMS</h3>
            <p className="text-gray-600 mb-4">
              Sending to <strong>{count}</strong> selected client(s)
            </p>
            <form onSubmit={handleBulkSMS}>
              <textarea
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                rows="5"
                maxLength="160"
                placeholder="Type your message... Use {first_name} for personalization"
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                {smsMessage.length}/160 chars • {"{first_name}"} /{" "}
                {"{last_name}"} are personalized
              </p>
              <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg my-4">
                <p className="text-sm text-yellow-800">
                  ⚠️ Sends SMS to all {count} client(s) (~KES{" "}
                  {(count * 0.8).toFixed(2)} total)
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowSMS(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-700 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting ? "Sending..." : "📱 Send to All"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEmail && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto text-gray-800">
            <h3 className="text-2xl font-bold mb-4">✉️ Bulk Email</h3>
            <p className="text-gray-600 mb-4">
              Sending to <strong>{count}</strong> selected client(s)
            </p>
            <form onSubmit={handleBulkEmail} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Subject *
                </label>
                <input
                  type="text"
                  value={emailData.subject}
                  onChange={(e) =>
                    setEmailData({ ...emailData, subject: e.target.value })
                  }
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">
                  Message *
                </label>
                <textarea
                  value={emailData.message}
                  onChange={(e) =>
                    setEmailData({ ...emailData, message: e.target.value })
                  }
                  rows="8"
                  placeholder="Type your message... Use {first_name} for personalization"
                  required
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {"{first_name}"} / {"{last_name}"} are personalized
                </p>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowEmail(false)}
                  className="px-6 py-2 bg-gray-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting ? "Sending..." : "✉️ Send to All"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default BulkMessaging;
