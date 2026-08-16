const mongoose = require('mongoose');

// An employer's own interview invite for one specific JobApplication —
// separate from the coordinator/alumni office-visit Appointment model
// (different domain: no staff, no office-hours rules, always employer-initiated).
const interviewSchema = new mongoose.Schema({
  employer_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'JobApplication', required: true },
  alumni_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  alumni_name:    { type: String, required: true, trim: true },
  job_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
  position:       { type: String, required: true, trim: true },
  date:           { type: String, required: true },
  time:           { type: String, required: true },
  mode:           { type: String, enum: ['Face-to-face', 'Online'], default: 'Face-to-face' },
  location:       { type: String, default: '' },
  status:         { type: String, enum: ['Upcoming', 'Completed', 'Cancelled'], default: 'Upcoming' },
}, { timestamps: true });

interviewSchema.index({ employer_id: 1, date: -1 });
interviewSchema.index({ alumni_id: 1 });

module.exports = mongoose.model('Interview', interviewSchema);
