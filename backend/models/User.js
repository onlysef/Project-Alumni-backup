const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName:    { type: String, required: true, trim: true },
  middleInitial: { type: String, default: '', trim: true },
  lastName:   { type: String, required: true, trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:   { type: String, required: true },
  role:       { type: String, enum: ['admin', 'alumni', 'coordinator', 'employer'], default: 'alumni' },
  status:     { type: String, enum: ['active', 'pending', 'suspended'], default: 'active' },
  college:        { type: String, default: '' },
  company:        { type: String, default: '' },
  course:         { type: String },
  track:          { type: String, enum: ['TSM', 'WMA', 'NA', ''], default: '' },
  graduationYear: { type: Number },

  firstLogin:             { type: Boolean, default: false },
  tracerStudyCompleted:   { type: Boolean, default: false },

  isTwoFactorEnabled: { type: Boolean, default: true },

  // Stored during the window between password-verified and OTP-verified
  twoFactorOTP:         { type: String },
  twoFactorOTPExpiry:   { type: Date },
  twoFactorToken:       { type: String },
  twoFactorTokenExpiry: { type: Date },

  // Password reset flow
  resetOTP:         { type: String },
  resetOTPExpiry:   { type: Date },
  resetToken:       { type: String },
  resetTokenExpiry: { type: Date },

  // Dashboard settings (theme, notifications, etc.)
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);
