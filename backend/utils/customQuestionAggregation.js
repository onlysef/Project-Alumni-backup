const { FIXED_KEYS } = require('./tracerFixedKeys');

// Question types the dashboard/chatbot can automatically aggregate for a
// custom/admin-added question — closed-vocabulary answers only. text/
// textarea/static_text have no closed vocabulary to group by, so they're
// deliberately excluded (would just produce noisy per-respondent buckets).
const CHARTABLE_TYPES = new Set(['radio', 'select', 'checkbox', 'rating_table']);

// Returns the chart-able custom questions (i.e. not one of the fixed
// TracerStudyResponse fields) found in an already-fetched TracerFormConfig
// pages array. Shared by the dashboard (employmentController.js) and the
// chatbot's embedding-based catalog (tracerQuestionCatalogService.js) so
// "which questions are custom and chartable" is defined in exactly one
// place. Each question carries its source page's id/order/title.
function extractChartableCustomQuestions(pages) {
  const out = [];
  pages.forEach((page, pageOrder) => {
    (page.questions || []).forEach((q) => {
      if (FIXED_KEYS.has(q.id)) return;
      if (!CHARTABLE_TYPES.has(q.type)) return;
      out.push({ ...q, pageId: page.id, pageOrder, pageTitle: page.title });
    });
  });
  return out;
}

const notBlank = (field) => ({ [field]: { $nin: ['', null] } });

// Groups by a case-INsensitive key so typos like "MAle" merge into "Male"
// instead of showing as a separate bucket. The display label used is
// whichever exact casing occurred most often in that group. Copied from
// employmentController.js's identical helper — kept local here rather than
// exported/shared across files, since it's a tiny, generic Mongo building
// block with no logic specific to custom questions.
const ciGroup = (valueExpr) => [
  { $group: { _id: { norm: { $toLower: valueExpr }, orig: valueExpr }, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $group: { _id: '$_id.norm', label: { $first: '$_id.orig' }, count: { $sum: '$count' } } },
  { $sort: { count: -1 } },
];

// Builds the $facet-branch pipeline for one custom question's answers,
// stored at `extra_answers.<questionId>` on TracerStudyResponse. Shared by
// computeTracerAnalytics (employmentController.js, the dashboard) and
// queryCustomQuestionByEmbedding (aggregationService.js, the chatbot) so a
// given custom question's breakdown is computed identically everywhere —
// one source of truth for this specific aggregation shape.
function buildCustomQuestionFacetPipeline(questionId, type, matchStage) {
  const path = `extra_answers.${questionId}`;
  if (type === 'checkbox') {
    return [
      ...matchStage,
      { $unwind: { path: `$${path}`, preserveNullAndEmptyArrays: false } },
      ...ciGroup(`$${path}`),
    ];
  }
  if (type === 'rating_table') {
    return [
      ...matchStage,
      { $project: { ratings: { $objectToArray: `$${path}` } } },
      { $unwind: '$ratings' },
      { $match: { 'ratings.v': { $nin: ['', null] } } },
      { $group: { _id: { skill: '$ratings.k', rating: '$ratings.v' }, count: { $sum: 1 } } },
    ];
  }
  return [
    ...matchStage,
    { $match: notBlank(path) },
    ...ciGroup(`$${path}`),
  ];
}

module.exports = { CHARTABLE_TYPES, extractChartableCustomQuestions, buildCustomQuestionFacetPipeline };
