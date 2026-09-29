const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Login itself has no attempt cap at all — this is the only thing stopping a
// distributed brute-force script from trying passwords against a known
// email indefinitely.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again in a few minutes.' },
});

// Shared by every OTP-issuing/verifying endpoint (2FA verify/resend, forgot-
// password, reset-OTP verify). Each OTP already has its own 5-wrong-guess
// cap once one exists, but nothing capped how many fresh codes/sessions a
// single IP could request per window before this.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

// Every /ai/chat request costs a real, metered Hugging Face API call (an
// embedding call, an aggregation-narration call, or a full RAG call) — this
// had no throttling at all despite being an authenticated-user endpoint, not
// a public one. Keyed per-user (not per-IP, unlike the limiters above) since
// admins/coordinators on the same office network shouldn't share one quota,
// and a legitimate back-and-forth chat session is much burstier than a login
// attempt — 20/minute comfortably covers real usage while still bounding a
// runaway script or compromised session.
const aiChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => req.user?.id || ipKeyGenerator(req, res),
  message: { message: 'Too many questions in a short time — please wait a moment and try again.' },
});

// /ai/ingest and /ai/reembed each trigger a whole file's (or, for reembed,
// the ENTIRE corpus's) worth of individual HF embedding calls — an
// unmetered, per-request-costed external-API loop with no throttle at all,
// unlike /ai/chat above. Admin-only already, so the realistic abuse case is
// a compromised admin session rather than any authenticated user, but a
// script that could fire ingest/reembed in a tight loop would still run up
// real API cost with nothing to stop it. A generous cap — these are
// deliberately infrequent, deliberate admin actions, not routine traffic —
// so it only ever bites a runaway script, never a real admin's normal use.
const aiIngestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => req.user?.id || ipKeyGenerator(req, res),
  message: { message: 'Too many ingest requests this hour — please wait before uploading more files.' },
});

module.exports = { loginLimiter, otpLimiter, aiChatLimiter, aiIngestLimiter };
