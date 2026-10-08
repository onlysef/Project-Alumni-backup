const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title:          { type: String, required: true, trim: true },
  description:    { type: String, default: '' },
  image:          { type: String, default: '' },
  location:       { type: String, default: '' },
  event_datetime: { type: Date, required: true },
  end_datetime:   { type: Date, default: null },
  // Set when a coordinator manually ends attendance early (see
  // attendanceController.js's endEvent) — distinct from end_datetime, which
  // is the event's PLANNED end time. Attendance is closed once EITHER the
  // planned end_datetime has passed OR ended_at is set, whichever comes
  // first; null means attendance hasn't been manually ended.
  ended_at:       { type: Date, default: null },
  visibility:     {
    type: String,
    enum: ['Public', 'Private', 'CCS Alumni', 'All Alumni', 'CPAG', 'CCS', 'COS', 'CIT', 'COE', 'CBA', 'COED', 'CASS', 'CCJE', 'CAFA'],
    default: 'Public',
  },
  capacity:       { type: Number, default: 0 },
  college:        { type: String, default: '' },
  created_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

eventSchema.index({ visibility: 1, event_datetime: 1 });
// Coordinator dashboards/reports filter Event.find({ college, ... }) on
// nearly every load (dashboard, activity feed, reports, events-dashboard) —
// without this, every one of those forces a full collection scan.
eventSchema.index({ college: 1, event_datetime: -1 });

module.exports = mongoose.model('Event', eventSchema);
