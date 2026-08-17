const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName:    { type: String, required: true, trim: true },
  middleInitial: { type: String, default: '', trim: true },
  lastName:   { type: String, required: true, trim: true },
  email:      {
    type: String, required: true, unique: true, lowercase: true, trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address.'],
  },
  password:   { type: String, required: true, select: false },
  role:       { type: String, enum: ['admin', 'alumni', 'coordinator', 'employer'], default: 'alumni' },
  status:     { type: String, enum: ['active', 'pending', 'suspended'], default: 'active' },
  // Stamped into every JWT at sign-time and checked on every request by
  // authMiddleware.protect(). A JWT is otherwise a bearer credential valid
  // for its full life (JWT_EXPIRES_IN, default 7d) with no way to revoke it
  // early — suspending an account, changing its role, or changing its
  // password (e.g. to lock out a stolen device) did nothing to a token
  // already issued. Bumping this on any of those actions makes every
  // previously-issued token fail its tokenVersion check on the very next
  // request, without needing a server-side token blacklist.
  tokenVersion: { type: Number, default: 0 },
  avatarUrl:      { type: String, default: '' },
  college:        { type: String, default: '' },
  company:        { type: String, default: '' },
  // Real FK to the employer's own Partnership record — job posting used to
  // let ANY logged-in employer pick ANY partner company from a free
  // dropdown, since nothing actually tied an employer account to a specific
  // company. Set at signup by registerPartner (or by an admin for
  // manually-created accounts); only meaningful for role: 'employer'.
  partnershipId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Partnership', default: null },
  course:         { type: String },
  track:          { type: String, enum: ['TSM', 'WMA', 'NA', ''], default: '' },
  graduationYear: { type: Number },

  firstLogin:             { type: Boolean, default: false },
  tracerStudyCompleted:   { type: Boolean, default: false },

  isTwoFactorEnabled: { type: Boolean, default: true },

  // Job Connect: whether the daily job-alert sweep (services/jobAlertService)
  // should notify this alumnus about new Careerjet postings matching their
  // profile. Defaults true to match Job Connect's "Job alerts: On" default.
  jobAlertsEnabled: { type: Boolean, default: true },

  // Stored during the window between password-verified and OTP-verified
  twoFactorOTP:         { type: String },
  twoFactorOTPExpiry:   { type: Date },
  twoFactorToken:       { type: String },
  twoFactorTokenExpiry: { type: Date },
  // Wrong-guess counter — the OTP itself is invalidated once this hits the
  // limit, so a phished password alone can't be brute-forced into a full
  // login by scripting guesses against verify-2fa.
  twoFactorOTPAttempts: { type: Number, default: 0 },

  // Password reset flow
  resetOTP:         { type: String },
  resetOTPExpiry:   { type: Date },
  resetToken:       { type: String },
  resetTokenExpiry: { type: Date },
  // Same brute-force guard as twoFactorOTPAttempts, for verify-reset-otp —
  // forgot-password only needs a known email (no auth), so this is the only
  // thing stopping someone from scripting guesses against the reset code.
  resetOTPAttempts: { type: Number, default: 0 },

  // Dashboard settings (theme, notifications, etc.)
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1, course: 1 });

module.exports = mongoose.model('User', userSchema);
