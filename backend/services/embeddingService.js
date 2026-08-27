const { HfInference } = require('@huggingface/inference');

const hf = new HfInference(process.env.HF_API_KEY);

// Multilingual (was BAAI/bge-base-en-v1.5, English-only) so a Tagalog-phrased
// question can still land near its matching English document content in
// vector-search — a Filipino university portal gets Taglish/Tagalog questions
// constantly (see queryClassifier.js/ragService.js's own Tagalog trigger
// patterns elsewhere), and the old English-only model had no way to align a
// Tagalog query embedding with the English tracer-study text it should match.
// Same 768 dimensions as the old model — swapping models still requires every
// existing EmbeddingDocument to be RE-EMBEDDED (a one-off migration, not
// something this file does), but at least the Atlas Vector Search index
// itself (fixed numDimensions, configured outside this codebase) didn't also
// need reconfiguring.
const EMBED_MODEL = process.env.HF_EMBED_MODEL || 'sentence-transformers/paraphrase-multilingual-mpnet-base-v2';
const MAX_EMBED_CHARS = 2000;

async function getEmbedding(text) {
  const truncated = text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  const result = await hf.featureExtraction({
    model: EMBED_MODEL,
    inputs: truncated,
    // Without an explicit provider, the SDK falls back to auto-selection,
    // which was failing outright ("Failed to fetch inference provider
    // mapping") rather than landing on a working provider. HF's own model
    // API confirms hf-inference is the only provider currently serving
    // feature-extraction for this model (featherless-ai, the provider used
    // for chat, only serves conversational/text-generation and was never a
    // valid choice here) — hardcoded rather than reusing HF_PROVIDER since
    // that env var is for the chat model and the two must not be conflated.
    provider: 'hf-inference',
  });
  // HF returns number[][] (batch) or number[] (single) — normalize to flat array
  const flat = Array.isArray(result[0]) ? result[0] : Array.from(result);
  return flat;
}

async function getEmbeddingsBatch(texts) {
  const results = [];
  for (const text of texts) {
    results.push(await getEmbedding(text));
  }
  return results;
}

module.exports = { getEmbedding, getEmbeddingsBatch };
