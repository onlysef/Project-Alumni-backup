const EmbeddingDocument = require('../models/EmbeddingDocument');
const { getEmbedding }  = require('./embeddingService');
const { getCollegeScopeEmails } = require('../utils/collegeScope');

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
 * @param {number}   options.year          - Pre-filter by metadata.year (optional — see fallback note below)
 * @returns {{chunks: Array, embedMs: number, searchMs: number}}
 */
async function retrieveContext(queryText, options = {}) {
  const topK        = options.topK        || DEFAULT_TOP_K;
  const sourceTypes = options.sourceTypes || [];
  const year         = options.year || null;

  // EmbeddingDocument carries no per-college tag, so there is no safe way to
  // filter a vector search by the AC assistant's college scope (see
  // utils/collegeScope.js). generateAnswer() already routes every
  // college-scoped question through aggregation only and never calls this
  // function in that case — but that guarantee lives in one `if` branch over
  // in ragService.js. Failing closed here too means a future change to that
  // branch can't turn into a cross-college data leak through vector search;
  // worst case it returns nothing instead of unscoped results.
  if (getCollegeScopeEmails()) {
    return { chunks: [], embedMs: 0, searchMs: 0 };
  }

  const embedStart = Date.now();
  const queryEmbedding = await getEmbedding(queryText);
  const embedMs = Date.now() - embedStart;

  // Builds the aggregation pipeline. `withYear` toggles the metadata.year
  // clause on/off — see the try/catch below for why.
  function buildPipeline(withYear) {
    const vectorSearchStage = {
      $vectorSearch: {
        index:         VECTOR_INDEX_NAME,
        path:          'embedding',
        queryVector:   queryEmbedding,
        numCandidates: topK * 10,
        limit:         topK,
      },
    };
    const filterClauses = {};
    if (sourceTypes.length > 0) filterClauses.source_type = { $in: sourceTypes };
    // Only tracer/roster/summary chunks carry a real metadata.year (see
    // fileParser.js) — DOCX/PDF/live-record chunks don't, so this only ever
    // narrows the year-tagged subset, never silently hides everything else.
    if (withYear && year) filterClauses['metadata.year'] = year;
    if (Object.keys(filterClauses).length > 0) vectorSearchStage.$vectorSearch.filter = filterClauses;

    return [
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
  }

  const searchStart = Date.now();
  let results;
  try {
    results = await EmbeddingDocument.aggregate(buildPipeline(true));
  } catch (err) {
    // metadata.year may not be configured as a filterable field on the Atlas
    // Search index itself (that's set in the Atlas UI, outside this
    // codebase — see the VECTOR_INDEX_NAME comment above). Rather than
    // break the whole chat response over an optional narrowing filter,
    // degrade to an unfiltered-by-year search — same result quality as
    // before this feature existed.
    if (!year) throw err;
    results = await EmbeddingDocument.aggregate(buildPipeline(false));
  }
  const searchMs = Date.now() - searchStart;

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
  return { chunks: deduped, embedMs, searchMs };
}

module.exports = { retrieveContext };
