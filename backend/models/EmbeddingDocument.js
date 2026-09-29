const mongoose = require('mongoose');

const embeddingDocumentSchema = new mongoose.Schema({
  source_type: {
    type: String,
    enum: ['tracer', 'employment', 'user', 'announcement', 'event', 'job', 'partnership', 'imported_file'],
    required: true,
  },
  // ObjectId of the original live-collection document (null for imported files)
  source_id: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  // ObjectId of the ImportedFile this chunk came from (null for live collections)
  file_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ImportedFile',
    default: null,
  },
  // Plain-text content that was embedded
  content: {
    type: String,
    required: true,
  },
  // Structured metadata for filtering (batch_year, college, course, etc.)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  // 768-dim float array produced by whichever model HF_EMBED_MODEL resolves
  // to (see services/embeddingService.js) — currently
  // sentence-transformers/paraphrase-multilingual-mpnet-base-v2, previously
  // BAAI/bge-base-en-v1.5. Same dimension count across that switch, so the
  // Atlas index's numDimensions didn't need reconfiguring, but a model swap
  // still requires re-embedding every existing document (see
  // embeddingService.js's own comment) — this line drifting out of sync with
  // the actual model is exactly what silently happened once already.
  embedding: {
    type: [Number],
    required: true,
  },
  // Position within a multi-chunk source document
  chunk_index: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

embeddingDocumentSchema.index({ source_type: 1 });
embeddingDocumentSchema.index({ source_id: 1 });
embeddingDocumentSchema.index({ file_id: 1 });

module.exports = mongoose.model('EmbeddingDocument', embeddingDocumentSchema);
