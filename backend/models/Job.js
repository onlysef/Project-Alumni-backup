const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title:                { type: String, required: true, trim: true },
  jobDescription:       { type: String, default: '' },
  keyResponsibilities:  { type: String, default: '' },
  qualifications:       { type: String, default: '' },
  preferredSkills:      { type: String, default: '' },
  salaryRange:          { type: String, default: '' },
  partnershipId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Partnership', required: true },
  postedBy:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status:               { type: String, enum: ['open', 'closed'], default: 'open' },
  jobType:              { type: String, enum: ['Full-time', 'Part-time', 'Internship', 'Contract'], default: 'Full-time' },
  location:             { type: String, default: '' },
}, { timestamps: true });

jobSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Job', jobSchema);
