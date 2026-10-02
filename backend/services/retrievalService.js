const EmbeddingDocument = require('../models/EmbeddingDocument');
const { getEmbedding }  = require('./embeddingService');
const { getCollegeScopeEmails } = require('../utils/collegeScope');
const { bm25Rank } = require('./bm25Service');

const DEFAULT_TOP_K     = 8;
// Atlas Vector Search index name (must match what you create in Atlas UI)
const VECTOR_INDEX_NAME = 'alumni_vector_index';

// Reciprocal Rank Fusion constant — the standard IR default. Used ONLY to
// decide which chunks make the final top-K and in what order when combining
// the vector-search ranking with the BM25 ranking below; it never replaces
// a chunk's own `score` field (see cosineSimilarity()'s own comment for why).
const RRF_K = 60;

// Same formula as tracerQuestionCatalogService.js's own cosineSimilarity() —
// duplicated locally rather than imported, matching this codebase's own
// established convention of not sharing small per-module utilities across
// files (see ragService.js's DOMAIN_KEYWORDS comment for the same reasoning
// applied elsewhere). Used to give a BM25-only hit (one $vectorSearch's own
// topK cutoff missed) a REAL cosine score instead of a fused/BM25 score on a
// different scale — every chunk this module returns must stay comparable
// against the SIMILARITY_THRESHOLD/LOW_CONFIDENCE_THRESHOLD gates in
// ragService.js, which are calibrated specifically against cosine
// similarity.
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Retrieve the most relevant EmbeddingDocument chunks for a given query —
 * hybrid: dense $vectorSearch (semantic/cross-lingual) fused with sparse
 * BM25 (exact keyword/term match — see bm25Service.js's own comment for
 * why both matter) via Reciprocal Rank Fusion. Every returned chunk still
 * carries a real cosine-similarity `score` (never a BM25/fused score — see
 * cosineSimilarity()'s own comment above), so ragService.js's
 * SIMILARITY_THRESHOLD/LOW_CONFIDENCE_THRESHOLD gating needs no changes.
 *
 * @param {string}   queryText  - The user's question
 * @param {object}   options
 * @param {number}   options.topK          - Number of results (default 8)
 * @param {string[]} options.sourceTypes   - Filter by source_type values (optional)
 * @param {number}   options.year          - Pre-filter by metadata.year (optional — see fallback note below)
 * @returns {{chunks: Array, embedMs: number, searchMs: number, bm25Ms: number}}
 */
async function retrieveContext(queryText, options = {}) {
  const topK        = options.topK        || DEFAULT_TOP_K;
  const sourceTypes = options.sourceTypes || [];
  const year         = options.year || null;

  // EmbeddingDocument carries no per-college tag, so there is no safe way to
  // filter either search by the AC assistant's college scope (see
  // utils/collegeScope.js). generateAnswer() already routes every
  // college-scoped question through aggregation only and never calls this
  // function in that case — but that guarantee lives in one `if` branch over
  // in ragService.js. Failing closed here too (covering BOTH the vector and
  // BM25 paths, since this check runs before either) means a future change
  // to that branch can't turn into a cross-college data leak; worst case it
  // returns nothing instead of unscoped results.
  if (getCollegeScopeEmails()) {
    return { chunks: [], embedMs: 0, searchMs: 0, bm25Ms: 0 };
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

  async function runVectorSearch() {
    const start = Date.now();
    let results;
    try {
      results = await EmbeddingDocument.aggregate(buildPipeline(true));
    } catch (err) {
      // metadata.year may not be configured as a filterable field on the
      // Atlas Search index itself (set in the Atlas UI, outside this
      // codebase — see the VECTOR_INDEX_NAME comment above). Rather than
      // break the whole chat response over an optional narrowing filter,
      // degrade to an unfiltered-by-year search — same result quality as
      // before this feature existed.
      if (!year) throw err;
      results = await EmbeddingDocument.aggregate(buildPipeline(false));
    }
    return { results, ms: Date.now() - start };
  }

  // BM25's candidate pool mirrors the SAME source_type/year scope the
  // vector search uses — a plain Mongo `.find()`, not Atlas Search, so no
  // out-of-band index/filterable-field setup is needed (unlike
  // $vectorSearch's index, configured outside this codebase — see
  // bm25Service.js's own comment for why a hand-rolled, in-app BM25 was
  // chosen specifically to avoid that dependency). `embedding` is
  // deliberately NOT selected here — measured live: fetching the full
  // 768-float array for every candidate (965 docs in this project's current
  // corpus) transferred ~6MB and roughly DOUBLED this function's total
  // latency, just so the rare BM25-only hit could get a cosine-score
  // fallback. Only the handful of chunks that actually need it (BM25-top
  // but missing from the vector results) fetch their embedding afterward,
  // in one small by-_id query — see below.
  async function runBm25Search() {
    const start = Date.now();
    const mongoFilter = {};
    if (sourceTypes.length > 0) mongoFilter.source_type = { $in: sourceTypes };
    if (year) mongoFilter['metadata.year'] = year;
    const candidates = await EmbeddingDocument
      .find(mongoFilter)
      .select('content source_type source_id file_id metadata chunk_index')
      .lean();
    const ranked = bm25Rank(queryText, candidates, topK * 2);
    return { ranked, ms: Date.now() - start };
  }

  const [{ results: vectorResults, ms: searchMs }, { ranked: bm25Results, ms: bm25Ms }] =
    await Promise.all([runVectorSearch(), runBm25Search()]);

  // Reciprocal Rank Fusion — combines the two independently-ranked lists
  // into one, using ONLY each chunk's RANK POSITION in each list (not its
  // raw score, which isn't comparable across a cosine-similarity ranker and
  // a BM25 ranker). A chunk appearing in both lists accumulates a
  // contribution from each, naturally rewarding agreement between the two
  // retrieval methods. This also subsumes the old near-duplicate dedup step
  // (vector/BM25 hits on the same content merge into one fused entry
  // instead of occupying separate slots) — key on trimmed content, falling
  // back to _id for the rare empty-content case.
  const keyOf = (c) => (c.content || '').trim() || String(c._id);
  const vectorKeys = new Set(vectorResults.map(keyOf));

  // Only BM25 hits NOT already covered by the vector results need their
  // embedding fetched for a cosine-score fallback — typically a handful of
  // chunks, not the whole candidate pool (see runBm25Search()'s own comment).
  const bm25OnlyDocs = bm25Results.filter(({ doc }) => !vectorKeys.has(keyOf(doc)));
  let embeddingById = new Map();
  if (bm25OnlyDocs.length) {
    const ids = bm25OnlyDocs.map(({ doc }) => doc._id);
    const withEmbeddings = await EmbeddingDocument.find({ _id: { $in: ids } }).select('embedding').lean();
    embeddingById = new Map(withEmbeddings.map((d) => [String(d._id), d.embedding]));
  }

  const fused = new Map(); // key -> { chunk, rrfScore }

  vectorResults.forEach((chunk, idx) => {
    const key = keyOf(chunk);
    const contribution = 1 / (RRF_K + idx + 1);
    const entry = fused.get(key);
    if (entry) entry.rrfScore += contribution;
    else fused.set(key, { chunk, rrfScore: contribution });
  });

  bm25Results.forEach(({ doc, rank }) => {
    const key = keyOf(doc);
    const contribution = 1 / (RRF_K + rank);
    const entry = fused.get(key);
    if (entry) {
      entry.rrfScore += contribution;
    } else {
      // BM25-only hit — give it a REAL cosine score (not a BM25/fused
      // score) so it stays comparable against SIMILARITY_THRESHOLD like
      // every other chunk this module returns.
      const embedding = embeddingById.get(String(doc._id));
      const score = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;
      fused.set(key, { chunk: { ...doc, score }, rrfScore: contribution });
    }
  });

  const finalChunks = [...fused.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK)
    // Strip `embedding` from the output — it was only needed internally for
    // the cosine-score fallback above, never part of this module's
    // documented chunk shape.
    .map(({ chunk }) => {
      const { embedding, ...rest } = chunk;
      return rest;
    });

  return { chunks: finalChunks, embedMs, searchMs, bm25Ms };
}

module.exports = { retrieveContext };
