const mongoose = require('mongoose');

const employmentActivitySchema = new mongoose.Schema({
  user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  user_name: { type: String, required: true },
  // Free text, not an enum — this is a human-readable log line (e.g.
  // "exported employment list", "edited attendance record"), not a value
  // anything branches on, and an enum here has already silently dropped
  // entries whose action string didn't happen to match it exactly (create()
  // failing validation, swallowed by logActivity's own .catch()).
  action: { type: String, required: true },
  target_name: { type: String, default: '' },
  details:     { type: String, default: '' },
}, { timestamps: true });

employmentActivitySchema.index({ createdAt: -1 });
employmentActivitySchema.index({ user_id: 1 });

module.exports = mongoose.model('EmploymentActivity', employmentActivitySchema);
