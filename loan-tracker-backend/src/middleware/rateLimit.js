// Per-route rate limiters. Used on auth surfaces — login, signup,
// forgot-password, reset-password — where unlimited attempts are the
// path of least resistance for brute force / credential stuffing /
// SMS-credit exhaustion. Each limiter is keyed by client IP and
// returns the same JSON shape the rest of the API uses so error
// handling on the frontend doesn't need a special case.
//
// `express` runs behind Render's proxy in production. `app.set('trust
// proxy', 1)` is applied in app.js so req.ip resolves to the real
// client IP rather than the proxy's loopback. Without that the
// limiter would treat every request as coming from the same address
// and either over- or under-limit.

import rateLimit from "express-rate-limit";

// Standard JSON shape returned by every limiter when the window is
// exceeded — same { error: string } the rest of the API uses, plus a
// retry hint the client can show ("try again in N seconds").
const limitedHandler = (req, res, _next, options) => {
  const retryAfterSec = Math.ceil(options.windowMs / 1000);
  res.status(options.statusCode).json({
    error:
      "Too many attempts from this address. Please wait a moment and try again.",
    retry_after_seconds: retryAfterSec,
  });
};

// Auth limiter — login / OTP verify / signup / forgot-password /
// reset-password. Strict: 10 attempts / 15 minutes / IP. That's
// enough headroom for a forgotten password + a couple of typos but
// nowhere near enough to brute a password or harvest valid phone
// numbers from /forgot-password.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitedHandler,
  // Skip counting *successful* responses for login — a real user who
  // signs in 6 times in a day shouldn't get blocked. Failed logins
  // (401/403) and 5xx still count.
  skipSuccessfulRequests: true,
});

// OTP-send limiter — much tighter, because each request can trigger
// an SMS and SMS credits are real money. 3 per 10 minutes / IP.
export const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitedHandler,
});

// Sensitive write limiter — destructive ops (manual payment record,
// loan disburse, waiver apply, etc.) shouldn't see an abnormal burst
// from a single IP either. 30 per minute is loose enough not to
// surprise legitimate batch use but stops a runaway script. Mostly
// a defence in depth — auth-gated routes have a JWT cost too.
export const sensitiveWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitedHandler,
});

export default { authLimiter, otpSendLimiter, sensitiveWriteLimiter };
