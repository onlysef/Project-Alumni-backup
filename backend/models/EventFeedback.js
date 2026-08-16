const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  event_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  alumni_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  // Overall event rating — kept as its own top-level field (not nested under
  // `ratings`) because every existing average-rating aggregation in
  // coordinator.js (dashboard summary, reports) already reads $rating
  // directly; changing its shape would silently break those.
  rating:    { type: Number, min: 1, max: 5, required: true },
  // Optional category breakdown — additive only, so any code written before
  // this feature (there was none writing to this collection yet) still sees
  // a valid document either way.
  ratings: {
    organization: { type: Number, min: 1, max: 5 },
    content:      { type: Number, min: 1, max: 5 },
    venue:        { type: Number, min: 1, max: 5 },
    satisfaction: { type: Number, min: 1, max: 5 },
  },
  feedback:  { type: String, default: '' }, // suggestions/comments
}, { timestamps: true });

schema.index({ event_id: 1, alumni_id: 1 }, { unique: true });

module.exports = mongoose.model('EventFeedback', schema);
