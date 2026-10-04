// Sparse, exact-term-frequency keyword ranking (Okapi BM25) — the
// complement to embeddingService.js/retrievalService.js's dense vector
// search. Dense embeddings are strong at semantic/cross-lingual similarity
// but can under-rank a chunk that shares an EXACT keyword/phrase with the
// query (a specific company name, job title, skill) if that chunk's overall
// semantic embedding happens to drift elsewhere. BM25 is strong at exactly
// that case. Hand-rolled (no npm dependency) — package.json has no
// text-search library, and this codebase already hand-rolls comparable
// small algorithms (see typoCorrect.js's own Damerau-Levenshtein
// implementation) rather than pulling in a dependency for a self-contained
// scoring formula.

// Simple on purpose — lowercase, strip punctuation, split on whitespace,
// drop 1-character tokens. No stemming: this is the "exact keyword"
// complement to vector search's semantic matching, not a second semantic
// layer — stemming would blur that distinction.
function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9À-ÖØ-öø-ÿ]+/g) || [])
    .filter((t) => t.length > 1);
}

// Standard Okapi BM25 conventional defaults.
const K1 = 1.5;
const B = 0.75;

// Ranks `documents` (each `{ content, ... }`, any extra fields passed
// through untouched) against `queryText`, returning the top `topK` as
// `{ doc, bm25Score, rank }` (rank is 1-based, best match first). Documents
// that share no token with the query at all are never scored or returned —
// a zero-overlap "match" would be noise, not a result.
function bm25Rank(queryText, documents, topK) {
  const queryTokens = [...new Set(tokenize(queryText))];
  if (!queryTokens.length || !documents.length) return [];

  const docTokenLists = documents.map((d) => tokenize(d.content));
  const docLengths = docTokenLists.map((toks) => toks.length);
  const avgDocLength = docLengths.reduce((s, n) => s + n, 0) / docLengths.length || 1;

  // Document frequency per query token — how many documents contain it at
  // least once — needed for IDF.
  const docFreq = new Map();
  for (const term of queryTokens) {
    let count = 0;
    for (const toks of docTokenLists) {
      if (toks.includes(term)) count++;
    }
    docFreq.set(term, count);
  }

  const N = documents.length;
  const scored = [];
  for (let i = 0; i < documents.length; i++) {
    const toks = docTokenLists[i];
    if (!toks.length) continue;
    const termFreq = new Map();
    for (const t of toks) termFreq.set(t, (termFreq.get(t) || 0) + 1);

    let score = 0;
    for (const term of queryTokens) {
      const tf = termFreq.get(term);
      if (!tf) continue;
      const df = docFreq.get(term);
      // Standard BM25 IDF (with the +1 floor so a term appearing in every
      // document still contributes a small positive weight rather than
      // going negative).
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const denom = tf + K1 * (1 - B + B * (toks.length / avgDocLength));
      score += idf * ((tf * (K1 + 1)) / denom);
    }
    if (score > 0) scored.push({ doc: documents[i], bm25Score: score });
  }

  scored.sort((a, b) => b.bm25Score - a.bm25Score);
  return scored.slice(0, topK).map((s, idx) => ({ ...s, rank: idx + 1 }));
}

module.exports = { tokenize, bm25Rank };
