const mongoose = require('mongoose');

// A single-use, email-locked invite link admins send out to onboard a new
// employer account — there is no public "Sign Up" page for employers (see
// registerPartner in authController.js), so this is the only door in.
const employerInviteSchema = new mongoose.Schema({
  email:     { type: String, required: true, trim: true, lowercase: true },
  token:     { type: String, required: true, unique: true },
  used:      { type: Boolean, default: false },
  usedAt:    { type: Date, default: null },
  expiresAt: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('EmployerInvite', employerInviteSchema);
