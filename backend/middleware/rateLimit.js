const rateLimit = require('express-rate-limit');

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

module.exports = { loginLimiter, otpLimiter };
