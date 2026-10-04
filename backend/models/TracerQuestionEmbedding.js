const mongoose = require('mongoose');

// One row per chart-able CUSTOM tracer question per college — used only to
// semantically match a chatbot question's wording to which custom field
// it's asking about (see services/tracerQuestionCatalogService.js). This is
// deliberately separate from EmbeddingDocument/retrievalService.js's general
// RAG index: that index has no per-college tag and is explicitly never
// reached by a college-scoped caller (see retrievalService.js's own
// comments) to prevent cross-college leaks. Every query against this
// collection is always filtered by `college`, so it carries no such risk.
const tracerQuestionEmbeddingSchema = new mongoose.Schema({
  college:    { type: String, required: true },
  questionId: { type: String, required: true },
  pageId:     { type: String, default: '' },
  label:      { type: String, required: true },
  // radio | select | checkbox | rating_table — see CHARTABLE_TYPES in
  // utils/customQuestionAggregation.js
  type:       { type: String, required: true },
  // Same model/dimensions as EmbeddingDocument — see services/embeddingService.js
  embedding:  { type: [Number], required: true },
}, { timestamps: true });

tracerQuestionEmbeddingSchema.index({ college: 1, questionId: 1 }, { unique: true });

module.exports = mongoose.model('TracerQuestionEmbedding', tracerQuestionEmbeddingSchema);
