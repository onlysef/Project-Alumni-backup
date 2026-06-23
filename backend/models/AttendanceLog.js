const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  event_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  alumni_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  status:      { type: String, enum: ['Present', 'Late', 'Excused', 'Absent'], default: 'Present' },
  time_in:     { type: String, default: '' },
  recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

schema.index({ event_id: 1, alumni_id: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceLog', schema);
