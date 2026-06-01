const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName:  { type: String, required: true, trim: true },
  lastName:   { type: String, required: true, trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:   { type: String, required: true },
  course:     { type: String, required: true },
  graduationYear: { type: Number, required: true },

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
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
