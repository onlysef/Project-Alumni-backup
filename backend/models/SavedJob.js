const mongoose = require('mongoose');

// Snapshots the Careerjet listing at save time (title, match %, skill gap,
// etc.) rather than just a url reference — Careerjet has no stable job ID
// to re-fetch by later, and a re-search isn't guaranteed to surface the
// same posting again.
const savedJobSchema = new mongoose.Schema({
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
}, { timestamps: true });

savedJobSchema.index({ alumni_id: 1, url: 1 }, { unique: true });

module.exports = mongoose.model('SavedJob', savedJobSchema);
