const EmbeddingDocument = require('../models/EmbeddingDocument');
const { getEmbedding }  = require('./embeddingService');

const DEFAULT_TOP_K     = 8;
// Atlas Vector Search index name (must match what you create in Atlas UI)
const VECTOR_INDEX_NAME = 'alumni_vector_index';

/**
 * Retrieve the most relevant EmbeddingDocument chunks for a given query.
 *
 * @param {string}   queryText  - The user's question
 * @param {object}   options
 * @param {number}   options.topK          - Number of results (default 8)
 * @param {string[]} options.sourceTypes   - Filter by source_type values (optional)
 * @returns {Array}  Retrieved chunks with content, metadata, source_type, score
 */
async function retrieveContext(queryText, options = {}) {
  const topK        = options.topK        || DEFAULT_TOP_K;
  const sourceTypes = options.sourceTypes || [];

  const queryEmbedding = await getEmbedding(queryText);

  // Build the $vectorSearch stage
  const vectorSearchStage = {
    $vectorSearch: {
      index:         VECTOR_INDEX_NAME,
      path:          'embedding',
      queryVector:   queryEmbedding,
      numCandidates: topK * 10,
      limit:         topK,
    },
  };

  // Optional pre-filter by source_type
  if (sourceTypes.length > 0) {
    vectorSearchStage.$vectorSearch.filter = { source_type: { $in: sourceTypes } };
  }

  const pipeline = [
    vectorSearchStage,
    {
      $project: {
        content:     1,
        source_type: 1,
        source_id:   1,
        file_id:     1,
        metadata:    1,
        chunk_index: 1,
        score: { $meta: 'vectorSearchScore' },
        _id: 1,
      },
    },
  ];

  const results = await EmbeddingDocument.aggregate(pipeline);

  // $vectorSearch can return near/exact-duplicate chunks (e.g. the same
  // content re-ingested under a different file_id) as separate hits — both
  // would otherwise occupy separate slots in the top-K context for zero
  // added information. Results already arrive best-score-first, so keeping
  // the first occurrence of each distinct content string keeps the
  // highest-scoring copy and drops the redundant ones.
  const seenContent = new Set();
  const deduped = [];
  for (const chunk of results) {
    const key = (chunk.content || '').trim();
    if (key && seenContent.has(key)) continue;
    if (key) seenContent.add(key);
    deduped.push(chunk);
  }
  return deduped;
}

module.exports = { retrieveContext };
