const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  role:    { type: String, required: true, trim: true },
  email:   { type: String, trim: true, lowercase: true, default: '' },
  status:  { type: String, enum: ['Available', 'Unavailable', 'On Leave'], default: 'Available' },
  deleted: { type: Boolean, default: false },
}, { timestamps: true });

// Plain `unique: true` would break the moment a second staff member is
// added with no email at all (email defaults to '', so two blank emails
// would collide) — a partial index only enforces uniqueness once an email
// is actually set.
staffSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' } } });

module.exports = mongoose.model('Staff', staffSchema);
