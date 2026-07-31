const mongoose = require('mongoose');

// One resume per alumnus, edited/exported from Job Connect's Resume
// Creation tool. Free-text fields (skills, experience, etc.) use the same
// newline-separated convention the frontend's resume editor already writes.
const resumeSchema = new mongoose.Schema({
  alumni_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name:           { type: String, default: '' },
  address:        { type: String, default: '' },
  phone:          { type: String, default: '' },
  email:          { type: String, default: '' },
  linkedin:       { type: String, default: '' },
  summary:        { type: String, default: '' },
  skills:         { type: String, default: '' },
  experience:     { type: String, default: '' },
  education:      { type: String, default: '' },
  certifications: { type: String, default: '' },
  projects:       { type: String, default: '' },
  languages:      { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Resume', resumeSchema);
