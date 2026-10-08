const TracerFormConfig = require('../models/TracerFormConfig');
const TracerQuestionEmbedding = require('../models/TracerQuestionEmbedding');
const { extractChartableCustomQuestions } = require('../utils/customQuestionAggregation');
const { getEmbedding, getEmbeddingsBatch } = require('./embeddingService');

// Below this cosine-similarity score, a match is treated as "not confident
// enough" and the chatbot declines rather than guessing — see
// feedback_ac_clarify_dont_guess. Calibrated against a live test (see
// session notes): genuinely UNRELATED questions ("what is the weather
// today?", "gender breakdown of alumni") scored up to 0.53 against an
// unrelated custom question purely from sharing generic "alumni
// question"-shaped phrasing — a 0.5 cutoff let those through as false
// matches, which is worse than a decline (a confident wrong answer is
// indistinguishable from a correct one). 0.55 was the lowest threshold that
// still cleanly separated every true match from every false one in that
// test — biased toward precision over recall on purpose: a missed genuine
// paraphrase just means the chatbot declines and the user can rephrase; a
// false match silently answers the wrong question with real-but-irrelevant
// numbers, which directly violates the no-hallucination requirement this
// feature exists to satisfy.
const MATCH_THRESHOLD = 0.55;

function toEmbeddableText(q) {
  const options = Array.isArray(q.options) && q.options.length ? ` (options: ${q.options.join(', ')})` : '';
  return `${q.label}${options}`;
}

// Re-embeds every chart-able custom question for one college, replacing
// whatever was there before — same delete-then-recreate pattern
// aiController.js's reembed() already uses. Called whenever that college's
// TracerFormConfig is saved (see tracerFormConfigController.js) so the
// catalog never drifts from the live form. Cheap: colleges typically have a
// handful of custom questions, not hundreds.
async function rebuildCatalogForCollege(college) {
  const cfg = await TracerFormConfig.findOne({ college }).lean();
  const pages = cfg?.config?.pages || [];
  const questions = extractChartableCustomQuestions(pages);

  await TracerQuestionEmbedding.deleteMany({ college });
  if (!questions.length) return;

  const embeddings = await getEmbeddingsBatch(questions.map(toEmbeddableText));
  await TracerQuestionEmbedding.insertMany(
    questions.map((q, i) => ({
      college,
      questionId: q.id,
      pageId: q.pageId,
      label: q.label,
      type: q.type,
      embedding: embeddings[i],
    }))
  );
}

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

// Finds which (if any) of a college's custom questions a natural-language
// chatbot question is asking about. Pure vector-similarity match — no LLM
// call, fully deterministic given the same catalog + question text. Returns
// null below MATCH_THRESHOLD rather than a low-confidence guess. The
// dataset here is always small (one college's custom questions), so this is
// a plain in-memory comparison — no Atlas Search index to configure/depend
// on, unlike retrievalService.js's general RAG path.
async function matchCustomQuestion(questionText, college) {
  const catalog = await TracerQuestionEmbedding.find({ college }).lean();
  if (!catalog.length) return null;

  const queryEmbedding = await getEmbedding(questionText);
  let best = null;
  let bestScore = -Infinity;
  for (const entry of catalog) {
    const score = cosineSimilarity(queryEmbedding, entry.embedding);
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  if (!best || bestScore < MATCH_THRESHOLD) return null;
  return { questionId: best.questionId, type: best.type, label: best.label, similarity: bestScore };
}

// Same matching logic as matchCustomQuestion(), but searched across EVERY
// college's catalog at once instead of one college's — used only when the
// asker has no college context at all (an unscoped admin question with no
// college named), so there's no single catalog to search in the first
// place. Returns each college's best confident match (never more than one
// per college), letting the caller decide: zero colleges matched → this
// genuinely isn't about any custom question; exactly one matched →
// unambiguous, answer it directly; more than one matched → the same
// question exists in more than one college's form, so ask which one is
// meant rather than guessing (see queryCustomQuestionByEmbedding).
async function matchCustomQuestionAcrossColleges(questionText) {
  const catalog = await TracerQuestionEmbedding.find({}).lean();
  if (!catalog.length) return [];

  const queryEmbedding = await getEmbedding(questionText);
  const bestPerCollege = new Map();
  for (const entry of catalog) {
    const score = cosineSimilarity(queryEmbedding, entry.embedding);
    if (score < MATCH_THRESHOLD) continue;
    const existing = bestPerCollege.get(entry.college);
    if (!existing || score > existing.similarity) {
      bestPerCollege.set(entry.college, { college: entry.college, questionId: entry.questionId, type: entry.type, label: entry.label, similarity: score });
    }
  }
  return [...bestPerCollege.values()].sort((a, b) => b.similarity - a.similarity);
}

// Distinct custom-question labels currently in the catalog — used by
// ragService.js to build the "what can you do?" capability list dynamically
// from whatever colleges have actually added to their tracer forms, instead
// of a hardcoded list that drifts out of date as colleges add new questions.
// Scoped to one college for a coordinator, or the whole catalog for an
// admin (scopeCollege null). Order matches insertion order from
// rebuildCatalogForCollege (effectively each college's own form page
// order) — not alphabetized, so earlier-defined questions surface first,
// which tends to match each form's own sense of what matters most.
async function listCapabilityTopics(scopeCollege) {
  const filter = scopeCollege ? { college: scopeCollege } : {};
  const docs = await TracerQuestionEmbedding.find(filter).select('label').lean();
  const seen = new Set();
  const labels = [];
  for (const doc of docs) {
    if (doc.label && !seen.has(doc.label)) {
      seen.add(doc.label);
      labels.push(doc.label);
    }
  }
  return labels;
}

module.exports = { rebuildCatalogForCollege, matchCustomQuestion, matchCustomQuestionAcrossColleges, listCapabilityTopics, MATCH_THRESHOLD };
