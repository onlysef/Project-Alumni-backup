const { HfInference } = require('@huggingface/inference');

const hf = new HfInference(process.env.HF_API_KEY);

const EMBED_MODEL = process.env.HF_EMBED_MODEL || 'BAAI/bge-base-en-v1.5';
const MAX_EMBED_CHARS = 2000;

async function getEmbedding(text) {
  const truncated = text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  const result = await hf.featureExtraction({
    model: EMBED_MODEL,
    inputs: truncated,
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
