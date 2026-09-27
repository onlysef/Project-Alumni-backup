const mongoose = require('mongoose');

// One experience entry — a current or past job. `experience` on the resume
// below is always a list of these (built by resumeBuilder.deriveFromProfile
// from AlumniEmployment's current job + work_history), never hand-typed —
// same reasoning as name/email/phone already being profile-derived rather
// than resume-editor fields.
const resumeExperienceEntrySchema = new mongoose.Schema({
  title:           { type: String, default: '' },
  company:         { type: String, default: '' },
  employment_type: { type: String, default: '' },
  meta:            { type: String, default: '' }, // pre-formatted date range, e.g. "March 2025 - Present"
  description:     { type: String, default: '' },
}, { _id: false });

// One resume per alumnus, edited/exported from Job Connect's Resume
// Creation tool. Free-text fields (skills, summary, etc.) use the same
// newline-separated convention the frontend's resume editor already writes;
// `experience` is the one structured (array) field — see above.
const resumeSchema = new mongoose.Schema({
  alumni_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name:           { type: String, default: '' },
  address:        { type: String, default: '' },
  phone:          { type: String, default: '' },
  email:          { type: String, default: '' },
  linkedin:       { type: String, default: '' },
  avatarUrl:      { type: String, default: '' },
  summary:        { type: String, default: '' },
  skills:         { type: String, default: '' },
  experience:     { type: [resumeExperienceEntrySchema], default: [] },
  education:      { type: String, default: '' },
  certifications: { type: String, default: '' },
  projects:       { type: String, default: '' },
  languages:      { type: String, default: '' },
  // Optional uploaded resume file (PDF/DOC/DOCX), stored as a base64 data
  // URI the same way avatars and announcement media are. When present, both
  // the alumnus's Job Connect tool and the employer's applicant view show
  // this file instead of the field-built resume above.
  fileName:       { type: String, default: '' },
  fileType:       { type: String, default: '' },
  fileData:       { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Resume', resumeSchema);
