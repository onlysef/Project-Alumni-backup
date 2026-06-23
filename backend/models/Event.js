const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title:          { type: String, required: true, trim: true },
  description:    { type: String, default: '' },
  location:       { type: String, default: '' },
  event_datetime: { type: Date, required: true },
  visibility:     { type: String, enum: ['Public', 'Private', 'CCS Alumni', 'All Alumni'], default: 'Public' },
  created_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
