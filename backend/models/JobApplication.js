const mongoose = require('mongoose');

// Careerjet gives no signal on whether an alumnus actually applied or got
// an interview (that all happens on the employer's/Careerjet's site) — this
// is logged client-side the moment "Apply now" is clicked, and the status
// past that point is self-reported by the alumnus.
const jobApplicationSchema = new mongoose.Schema({
  alumni_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:       { type: String, required: true },
  company:     { type: String, default: '' },
  location:    { type: String, default: '' },
  type:        { type: String, default: '' },
  posted:      { type: String, default: '' },
  url:         { type: String, required: true },
  description: { type: String, default: '' },
  salary:      { type: String, default: '' },
  match:       { type: Number, default: null },
  skills:      { type: [{ name: String, matched: Boolean }], default: [] },
  status:      { type: String, enum: ['Applied', 'Interview Scheduled', 'Offer Received', 'Rejected', 'Withdrawn'], default: 'Applied' },
  appliedAt:   { type: Date, default: Date.now },
}, { timestamps: true });

jobApplicationSchema.index({ alumni_id: 1, url: 1 }, { unique: true });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);
