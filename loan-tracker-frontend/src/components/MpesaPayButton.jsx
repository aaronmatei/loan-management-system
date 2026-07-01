import React, { useState, useEffect, useRef } from "react";
import { Smartphone, CheckCircle } from "lucide-react";
import api from "../services/api";

/**
 * Reusable M-Pesa STK Push button + modal: collects a phone number,
 * fires the STK push, then polls /mpesa/status until the PIN flow
 * resolves.
 *
 * Props:
 *  - endpoint:    '/mpesa/stk/loan-repayment' | '/mpesa/stk/invoice'
 *  - payload:     object merged into the POST body (e.g. { loan_id, amount })
 *  - apiClient:   axios instance to use. Defaults to the staff `api`.
 *                 Pass the portal's `portalApi` when used in the customer
 *                 portal so the customer token (and tenant header) is sent.
 *  - defaultPhone, amountLabel, onSuccess, buttonText, brandColor
 */
function MpesaPayButton({
  endpoint,
  payload,
  apiClient = api,
  defaultPhone = "",
  amountLabel = "",
  onSuccess,
  buttonText = "Pay with M-Pesa",
  brandColor = "#16a34a",
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(defaultPhone);
  const [stage, setStage] = useState("idle"); // idle|sending|waiting|success|failed
  const [message, setMessage] = useState("");
  const pollRef = useRef(null);
  const attemptsRef = useRef(0);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const reset = () => {
    clearInterval(pollRef.current);
    setStage("idle");
    setMessage("");
    attemptsRef.current = 0;
  };

  const startPolling = (checkoutRequestId) => {
    attemptsRef.current = 0;
    pollRef.current = setInterval(async () => {
      attemptsRef.current += 1;
      try {
        const res = await apiClient.get(`/mpesa/status/${checkoutRequestId}`);
        const status = res.data.data.status;
        if (status === "success") {
          clearInterval(pollRef.current);
          setStage("success");
          setMessage("Payment confirmed!");
          if (onSuccess) onSuccess(res.data.data);
        } else if (["failed", "cancelled", "timeout"].includes(status)) {
          clearInterval(pollRef.current);
          setStage("failed");
          setMessage(
            status === "cancelled"
              ? "You cancelled the payment."
              : status === "timeout"
                ? "The request timed out. Please try again."
                : res.data.data.result_desc ||
                  "Payment failed. Please try again.",
          );
        }
      } catch {
        // transient — keep polling
      }
      // Stop after ~90s (45 polls × 2s)
      if (attemptsRef.current >= 45) {
        clearInterval(pollRef.current);
        setStage("failed");
        setMessage(
          "No confirmation received. If you were charged, it will reflect shortly.",
        );
      }
    }, 2000);
  };

  const handlePay = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 9) {
      setMessage("Enter a valid M-Pesa phone number");
      setStage("failed");
      return;
    }
    setStage("sending");
    setMessage("");
    try {
      const res = await apiClient.post(endpoint, { ...payload, phone });
      setStage("waiting");
      setMessage(
        res.data.message || "Check your phone and enter your M-Pesa PIN",
      );
      startPolling(res.data.checkout_request_id);
    } catch (err) {
      setStage("failed");
      setMessage(err.response?.data?.error || "Could not start payment");
    }
  };

  return (
    <>
      <button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white shadow-md"
        style={{ backgroundColor: brandColor }}
      >
        <Smartphone size={16} /> {buttonText}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg dark:text-slate-100">Pay with M-Pesa</h3>
              <button
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                className="text-gray-400 dark:text-slate-400 text-xl"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {amountLabel && (
              <div className="text-center mb-4">
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase">Amount</p>
                <p className="text-3xl font-bold text-gray-800 dark:text-slate-100">{amountLabel}</p>
              </div>
            )}

            {(stage === "idle" || stage === "failed") && (
              <>
                <label className="block text-sm font-semibold mb-1">
                  M-Pesa Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0712345678"
                  className="w-full px-3 py-2 border-2 border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:border-green-500 mb-3"
                />
                {message && stage === "failed" && (
                  <p className="text-sm text-red-600 mb-3">{message}</p>
                )}
                <button
                  onClick={handlePay}
                  className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-lg font-bold text-white"
                  style={{ backgroundColor: brandColor }}
                >
                  <Smartphone size={16} /> Send STK Push
                </button>
                <p className="text-xs text-gray-400 dark:text-slate-400 text-center mt-3">
                  A prompt will appear on your phone. Enter your M-Pesa PIN to
                  confirm.
                </p>
              </>
            )}

            {stage === "sending" && (
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto mb-3"></div>
                <p className="text-gray-600 dark:text-slate-400">Sending request…</p>
              </div>
            )}

            {stage === "waiting" && (
              <div className="text-center py-6">
                <div className="animate-pulse flex justify-center mb-3">
                  <Smartphone size={48} className="text-green-500" />
                </div>
                <p className="font-semibold text-gray-800 dark:text-slate-100">Check your phone</p>
                <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{message}</p>
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-slate-400">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                  Waiting for confirmation…
                </div>
              </div>
            )}

            {stage === "success" && (
              <div className="text-center py-6">
                <div className="flex justify-center mb-3">
                  <CheckCircle size={48} className="text-green-600" />
                </div>
                <p className="font-bold text-green-700 text-lg">{message}</p>
                <button
                  onClick={() => {
                    reset();
                    setOpen(false);
                  }}
                  className="mt-4 w-full py-2 bg-gray-100 dark:bg-slate-700 dark:text-slate-100 rounded-lg font-semibold"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default MpesaPayButton;
