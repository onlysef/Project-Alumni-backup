const mongoose = require('mongoose');

const importedFileSchema = new mongoose.Schema({
  drive_file_id:  { type: String, default: '' },
  file_name:      { type: String, required: true },
  // SHA-256 of the raw upload — lets ingestFile() detect "you already
  // uploaded this exact file" regardless of what it's named this time,
  // instead of silently double-ingesting the same rows into Graduate/
  // EmbeddingDocument and skewing every stat that reads from them.
  content_hash:   { type: String, index: true, default: null },
  file_type:      { type: String, enum: ['excel', 'csv', 'pdf', 'docx'], required: true },
  drive_url:      { type: String, default: '' },
  // What kind of content was detected inside
  sheet_type: {
    type: String,
    enum: ['roster', 'summary', 'tracer_results', 'accreditation', 'unknown'],
    default: 'unknown',
  },
  status:         { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
  ingested_at:    { type: Date },
  chunk_count:    { type: Number, default: 0 },
  raw_row_count:  { type: Number, default: 0 },
  error_message:  { type: String, default: '' },
  // Which admin triggered the import
  imported_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('ImportedFile', importedFileSchema);
