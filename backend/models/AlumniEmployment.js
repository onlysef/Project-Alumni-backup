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
    enum:     ['Employed', 'Unemployed', 'Self-employed'],
    required: true,
  },
  company_name:          { type: String, default: '' },
  job_title:             { type: String, default: '' },
  industry:              { type: String, default: '' },
  work_location:         { type: String, default: '' },
  salary_range:          { type: String, default: '' },
  job_related_to_course: { type: Boolean, default: false },
  date_employed:         { type: Date },
  reason_unemployed:     { type: String, default: '' },
  last_updated:          { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('AlumniEmployment', alumniEmploymentSchema);
