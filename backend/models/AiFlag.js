const mongoose = require('mongoose');

// Admin-reviewable queue for the AC assistant's own safety/coverage signals
// — prompt injection detections, RAG fabrication checks, and questions AC
// couldn't actually answer (unclear input, off-topic, no matching data) all
// used to only ever reach logger.warn() (console output, gone the moment
// the process log scrolls past it). This persists the same events so
// they're actually actionable instead of merely detected.
const schema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['injection', 'fabrication', 'unanswered'],
    required: true,
  },
  question: { type: String, default: '' },
  // Offending snippet (injection), unverified phrase(s) (fabrication), or a
  // short fixed reason tag (unanswered — e.g. 'unclear', 'unknown').
  detail:   { type: String, default: '' },
  // The AC answer involved, when there is one (fabrication, unanswered —
  // an injection detection happens before any answer exists).
  answer:   { type: String, default: '' },
  // Null for ingest-time detections (no requesting user in that flow).
  source:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sourceType: { type: String, enum: ['chat', 'ingest_file', 'ingest_tracer'], required: true },
  reviewed:   { type: Boolean, default: false },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ reviewed: 1, createdAt: -1 });

module.exports = mongoose.model('AiFlag', schema);
