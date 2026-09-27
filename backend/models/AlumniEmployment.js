const mongoose = require('mongoose');

// One past position, entered by the alumnus separately from their CURRENT
// job (company_name/job_title/date_employed above) — the resume's
// Professional Experience section is built from the current job plus this
// whole list, oldest to newest as entered, instead of only ever being able
// to show a single job.
const workHistoryEntrySchema = new mongoose.Schema({
  title:           { type: String, default: '' },
  company:         { type: String, default: '' },
  employment_type: { type: String, default: '' },
  start_date:      { type: Date },
  end_date:        { type: Date },
  description:     { type: String, default: '' },
}, { _id: false });

const alumniEmploymentSchema = new mongoose.Schema({
  alumni_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    unique:   true,
  },
  employment_status: {
    type:     String,
    enum:     ['Not Yet Updated', 'Employed', 'Unemployed', 'Self-employed'],
    required: true,
  },
  company_name:          { type: String, default: 'N/A' },
  job_title:             { type: String, default: null },
  industry:              { type: String, default: null },
  work_location:         { type: String, default: null },
  salary_range:          { type: String, default: '' },
  job_related_to_course: { type: Boolean, default: null },
  date_employed:         { type: Date },
  employment_type:       { type: String, default: null },
  years_in_current_job:  { type: String, default: null },
  reason_unemployed:     { type: String, default: null },
  skills:                { type: String, default: '' },
  experience:            { type: String, default: '' },
  work_history:          { type: [workHistoryEntrySchema], default: [] },
  // Alumnus-managed contact details, separate from the account's login
  // email (User.email) — a preferred reachable email / phone shown on the
  // profile and to coordinators.
  contact_email:         { type: String, default: '' },
  contact_number:        { type: String, default: '' },
  facebook:              { type: String, default: '' },
  linkedin:              { type: String, default: '' },
  last_updated:          { type: Date, default: Date.now },
  // Set only by syncTracerToEmployment — tracks which version of this
  // alumnus's TracerStudyResponse (by its updatedAt) has already been
  // pulled in, so that admin-controller sync can skip tracers that haven't
  // changed since last time instead of re-processing all of them on every
  // Employment Details page load.
  tracer_synced_at:      { type: Date, default: null },
}, { timestamps: true });

alumniEmploymentSchema.index({ employment_status: 1 });
alumniEmploymentSchema.index({ last_updated: -1 });

module.exports = mongoose.model('AlumniEmployment', alumniEmploymentSchema);
