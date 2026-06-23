const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  event_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  alumni_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  rating:    { type: Number, min: 1, max: 5 },
  feedback:  { type: String, default: '' },
}, { timestamps: true });

schema.index({ event_id: 1, alumni_id: 1 }, { unique: true });

module.exports = mongoose.model('EventFeedback', schema);
