// Safaricom Daraja client — OAuth, STK Push (Lipa Na M-Pesa Online),
// status query, and callback parsing.
//
// Uses the platform's sandbox credentials from env vars for now. The
// per-tenant mpesa_* columns (migration 017) are reserved for future
// production shortcodes; switching to them is a localized change here +
// in routes/mpesa.js, not a rearchitecture.
//
// HTTP via native fetch (Node 18+) — the backend has no axios and the
// convention is SDK-or-builtin (africastalking, nodemailer), so we
// don't add a generic HTTP dependency just for two endpoints.

import logger from "../config/logger.js";

const MPESA_ENV = process.env.MPESA_ENV || "sandbox";
const BASE_URL =
  MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

// Small fetch wrapper: fetch() does NOT throw on 4xx/5xx, so we check
// res.ok ourselves and surface Daraja's error body. The thrown Error
// carries `.daraja` (parsed body) so route handlers can show the real
// Safaricom message (e.g. "Invalid Access Token").
async function darajaFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (netErr) {
    throw new Error(`M-Pesa network error: ${netErr.message}`);
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg =
      body?.errorMessage ||
      body?.ResultDesc ||
      body?.error_description ||
      `Daraja request failed (${res.status})`;
    const err = new Error(msg);
    err.daraja = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

/**
 * Normalize a Kenyan phone number to 2547XXXXXXXX / 2541XXXXXXXX
 * (12 digits, no plus). Accepts 07.., 7.., +2547.., 2547.. forms.
 * Returns null when it can't produce a valid Safaricom/Airtel MSISDN.
 */
export function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).trim().replace(/[\s+\-()]/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  else if ((p.startsWith("7") || p.startsWith("1")) && p.length === 9)
    p = "254" + p;
  else if (p.startsWith("254")) {
    /* already normalized */
  } else if (p.startsWith("+254")) p = p.slice(1);
  if (!/^254[17]\d{8}$/.test(p)) return null;
  return p;
}

// OAuth token cache (tokens last ~1h; refresh 5 min early).
let cachedToken = null;
let cachedTokenExpiry = 0;

export async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) return cachedToken;

  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new Error("M-Pesa consumer key/secret not configured");
  }

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const body = await darajaFetch(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { method: "GET", headers: { Authorization: `Basic ${auth}` } },
  );

  cachedToken = body.access_token;
  cachedTokenExpiry =
    now + (parseInt(body.expires_in || "3600", 10) - 300) * 1000;
  return cachedToken;
}

// YYYYMMDDHHmmss timestamp Daraja expects (local time).
function buildTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Initiate an STK Push. Returns the Daraja identifiers we persist so
 * the async callback can be matched back to our row.
 */
export async function initiateSTKPush({
  phone,
  amount,
  accountReference,
  transactionDesc,
}) {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_CALLBACK_URL;

  if (!shortcode || !passkey)
    throw new Error("M-Pesa shortcode/passkey not configured");
  if (!callbackUrl || !callbackUrl.startsWith("https://")) {
    throw new Error(
      "MPESA_CALLBACK_URL must be a public HTTPS URL (use ngrok for local dev)",
    );
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error("Invalid phone number");

  // Daraja requires a whole-number amount >= 1.
  const amt = Math.round(parseFloat(amount));
  if (!amt || amt < 1) throw new Error("Amount must be at least KES 1");

  const token = await getAccessToken();
  const timestamp = buildTimestamp();
  const password = Buffer.from(
    `${shortcode}${passkey}${timestamp}`,
  ).toString("base64");

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amt,
    PartyA: normalizedPhone,
    PartyB: shortcode,
    PhoneNumber: normalizedPhone,
    CallBackURL: callbackUrl,
    AccountReference: (accountReference || "LoanFix").substring(0, 12),
    TransactionDesc: (transactionDesc || "Payment").substring(0, 13),
  };

  const data = await darajaFetch(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  logger.info(
    `STK push initiated: ${data.CheckoutRequestID} for ${normalizedPhone} KES ${amt}`,
  );

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    customerMessage: data.CustomerMessage,
    responseCode: data.ResponseCode,
    raw: data,
    normalizedPhone,
    amount: amt,
  };
}

/**
 * Query the status of an STK Push (fallback if a callback never arrives).
 */
export async function querySTKStatus(checkoutRequestId) {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const token = await getAccessToken();
  const timestamp = buildTimestamp();
  const password = Buffer.from(
    `${shortcode}${passkey}${timestamp}`,
  ).toString("base64");

  return darajaFetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
}

/**
 * Flatten an STK callback body into a clean result object.
 * Returns null if the shape isn't recognized.
 */
export function parseCallback(body) {
  const stk = body?.Body?.stkCallback;
  if (!stk) return null;

  const result = {
    merchantRequestId: stk.MerchantRequestID,
    checkoutRequestId: stk.CheckoutRequestID,
    resultCode: stk.ResultCode,
    resultDesc: stk.ResultDesc,
    amount: null,
    mpesaReceiptNumber: null,
    transactionDate: null,
    phoneNumber: null,
  };

  if (stk.ResultCode === 0 && stk.CallbackMetadata?.Item) {
    for (const item of stk.CallbackMetadata.Item) {
      if (item.Name === "Amount") result.amount = item.Value;
      if (item.Name === "MpesaReceiptNumber")
        result.mpesaReceiptNumber = item.Value;
      if (item.Name === "TransactionDate") result.transactionDate = item.Value;
      if (item.Name === "PhoneNumber") result.phoneNumber = item.Value;
    }
  }

  return result;
}

export default {
  normalizePhone,
  getAccessToken,
  initiateSTKPush,
  querySTKStatus,
  parseCallback,
};
