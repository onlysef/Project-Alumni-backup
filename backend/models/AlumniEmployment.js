const mongoose = require('mongoose');

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
  last_updated:          { type: Date, default: Date.now },
}, { timestamps: true });

alumniEmploymentSchema.index({ employment_status: 1 });
alumniEmploymentSchema.index({ last_updated: -1 });

module.exports = mongoose.model('AlumniEmployment', alumniEmploymentSchema);
