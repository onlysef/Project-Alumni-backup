const mongoose = require('mongoose');

// Tracks which Careerjet postings the daily job-alert sweep has already
// scored for a given alumnus, so the same listing doesn't get re-evaluated
// (and potentially re-notified) on every run. Entries auto-expire after 60
// days — if a listing somehow resurfaces after that, it's fair game again.
const jobAlertSeenSchema = new mongoose.Schema({
  alumni_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  url:       { type: String, required: true },
  seenAt:    { type: Date, default: Date.now },
});

jobAlertSeenSchema.index({ alumni_id: 1, url: 1 }, { unique: true });
jobAlertSeenSchema.index({ seenAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 });

module.exports = mongoose.model('JobAlertSeen', jobAlertSeenSchema);
