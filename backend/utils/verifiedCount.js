// Minimal, targeted deterministic statistics for numeric questions (count,
// percentage, highest/lowest) — NOT a return of the old 11,000-line
// aggregationService.js. This exists because the chatbot's guardrails
// (services/chatbotGuardrails.js) require that any number given to an admin
// be a VERIFIED system result, never an LLM guess — an LLM cannot reliably
// count, divide, or rank rows on its own, so a real MongoDB query is the
// only trustworthy source for a number.
//
// IMPORTANT — source of truth: this queries TracerStudyResponse, matching
// the exact same collection and bucket logic as the Admin Dashboard's own
// "Total Employed"/KPI tiles (see computeTracerAnalytics in
// controllers/employmentController.js). Two earlier versions of this file
// got this wrong and each gave a DIFFERENT number for "how many are
// employed": first Graduate.employmentStatus (undercounts badly — only set
// on a tracer-submit event that silently no-ops on failure), then
// AlumniEmployment.employment_status (a separately-synced profile copy that
// can drift from the survey data). TracerStudyResponse.employmentStatus is
// the alumnus's own raw survey answer ("Yes"/"No"/"Never Employed") and is
// what the Dashboard itself treats as ground truth — querying anything else
// here just reproduces the exact "two surfaces silently disagree" bug class
// CLAUDE.md documents. If the Dashboard's own source ever changes, update
// here too.
//
// FILTER EXTRACTION — this used to be a pile of hand-written regexes
// (findCourseMatch/findCollegeMatch/findEmploymentStatusMatch/findBestMatch/
// SCOPE_INTENT_PATTERN/a COUNT_QUESTION_PATTERN-style trigger per intent),
// each needing a new hand-coded pattern for every new phrasing or filter
// COMBINATION — it didn't scale past one filter at a time. Extraction is now
// delegated to an LLM (services/queryPlanExtractor.js), which returns intent
// + every filter in one JSON object per question. Every extracted value is
// still re-checked against the real catalog/DB by utils/queryPlanValidator.js
// before it's used — the LLM only ever proposes candidate filter values, it
// never decides the final answer, and the actual count/percentage/ranking
// number always comes from a real MongoDB query below, never from the LLM.
const TracerStudyResponse = require('../models/TracerStudyResponse');
const User = require('../models/User');
const TracerFormConfig = require('../models/TracerFormConfig');
const { FIXED_KEYS } = require('./tracerFixedKeys');
const { COLLEGE_CODES, COLLEGE_NAMES, ALL_COURSES, COURSE_TO_COLLEGE } = require('./collegesCourses');
const { extractQueryPlan } = require('../services/queryPlanExtractor');
const { validateQueryPlan } = require('./queryPlanValidator');
const {
  FIELD_REGISTRY, FIELD_REGISTRY_BY_KEY, PLACEHOLDER_VALUE_PATTERN, dropPlaceholders,
  resolveSpecializationRankingTarget, buildRankingFieldMap, PROGRAM_MAJOR_GROUPS, SKILL_RATING_VALUES, SKILL_FIELD_LABELS, exactMatch,
  detectUnsupportedConditions, unresolvedScopeMessage,
} = require('./fieldRegistry');

// "who are they" (no filter words of its own) is a FOLLOW-UP to whatever
// was just asked — handled by reusing the previous user turn's filters, see
// computeVerifiedNames. "who are the BSIT alumni that are employed" already
// carries its own filters and doesn't need history at all. Names-intent
// detection stays a cheap local regex (not routed through the LLM plan)
// since computeVerifiedNames is called directly by ragService.js, outside
// computeVerifiedStat's plan-based dispatch — see that file's own comment.
// "sino ang ___?" is dropped from here deliberately — it's just ordinary
// Tagalog grammar for "who is ___?" with ANY noun phrase, not specifically
// anaphoric (unlike "sino sila" = "who are THEY", which really does refer
// back to an established group). Caught live: "sino ang president ng
// Fliptop?" (a plainly off-topic, brand-new question with no connection to
// the conversation at all) matched this pattern's old "sino (...|ang)"
// alternative, got treated as a pronoun-style continuation, and
// computeVerifiedNames below reused a completely unrelated PREVIOUS
// question's filters to "answer" it — this pattern is the one that decides
// that reuse, so it has to be the narrow, truly-anaphoric set only. The
// bare /\bsino\b/i fallback in isNamesQuestion (below) still exists for the
// broader "is this a names question at all" hard-gate check — only the
// reuse-triggering pattern needed tightening.
const NAMES_QUESTION_PATTERN = /\b(who are (they|those|these)|who is (he|she|that|this)|list (them|their names)|name them|show (me )?(their )?names|can you (list|name) them|sino (sila|yung))\b/i;
// Default cap for a plain names question with no explicit "show N"/"show
// all" wording of its own — the user asked this be lowered from 20 to 10 so
// a long matching list doesn't flood the chat by default; "would you like
// to see all of them, or a specific number?" (ragService.js, gated on
// `truncated` below) still offers the rest instead of silently cutting them.
const MAX_NAMES_LISTED = 10;
// A reply to the chatbot's OWN "would you like to see all of them, or a
// specific number?" offer (see chatbotGuardrails.js rule 25) — e.g. "yes, I
// want to see them all", "show more", "the rest". This carries no filter
// words or even the word "who"/"sino" of its own, so NAMES_QUESTION_PATTERN
// alone never recognized it as a names-continuation at all — it fell
// through every names-handling path and hit ragService.js's generic
// off-topic short-circuit instead (no alumni-domain vocabulary either),
// producing a confusing "I am designed to assist with..." decline right
// after the bot itself had just offered to show more. Same bug class
// CLAUDE.md documents: a bare continuation with no topic words of its own
// needs its own explicit signal added everywhere a topic-less turn is
// checked.
const SHOW_ALL_PATTERN = /\b(all of (them|those)|see (them |everyone )?all|show (them |me )?all|list (them )?all|the rest(?: of (them|the list))?|show more|see more|more names|everyone else)\b/i;
// Caught live: "show me 40 of them" (a completely natural reply to the
// bot's own "would you like to see all of them, or a specific number?"
// offer) did NOT match — the old pattern only accepted "show 40"/"give me
// 40" verbatim, with no "show ME 40" case at all despite "give me" being
// explicitly supported for the same verb-then-number shape. Missing this
// match meant isNamesQuestion/isContinuationOnly were both false, so this
// reply got routed all the way through to the generic off-topic decline
// instead of being recognized as a names-list continuation at all — see
// SHOW_ALL_PATTERN's own "show (them |me )?all" for the equivalent optional-
// filler-word pattern already used one line above this one.
const SHOW_N_PATTERN = /\b(?:show|see|list|give)\s+(?:me\s+|them\s+)?(\d+)/i;
// A bare "yes"/"oo"/"sige" with NO other words — carries even less content
// than SHOW_ALL_PATTERN's phrasing and is only ever safe to treat as "yes,
// show all" when the PREVIOUS user turn was itself a names question (see
// computeVerifiedNames) — i.e. this is specifically a reply to the bot's
// own "would you like to see all of them, or a specific number?" offer, not
// a bare "yes" answering some unrelated bot question.
const BARE_AFFIRMATIVE_PATTERN = /^(yes|yeah|yep|sure|ok(ay)?|go ahead|oo|opo|sige)[.!]?$/i;
// A reply carrying NO filter content of its own — purely a request to
// expand/narrow how many results from the PREVIOUS turn's own scope to
// show (see computeVerifiedNames's own continuation handling below).
// Exported so ragService.js can detect a CHAIN of these — e.g. "show me 40
// of them" followed later by "show all" — and walk back PAST all of them
// to the true anchor question. Caught live: "show all" sent right after
// "show me 40 of them" found THAT reply as its own "previous turn" (itself
// contentless) and re-extracted a plan from ITS bare text instead of the
// real original question — producing a confident but entirely unrelated
// "Tracer Study Overview" summary, not the names list that was asked for.
function isNamesContinuationOnly(question) {
  const trimmed = (question || '').trim();
  return SHOW_ALL_PATTERN.test(trimmed) || SHOW_N_PATTERN.test(trimmed) || BARE_AFFIRMATIVE_PATTERN.test(trimmed);
}
// Upper bound even for an explicit "show all" — prevents a single reply
// from dumping an unbounded table scan into the chat.
const MAX_NAMES_SHOW_ALL = 200;

const TOTAL_POPULATION_PATTERN = /\b(alumni|alumnus|alumna|graduates?|records?|respondents?)\b/i;

// Attaches a REAL chart (built from already-computed, verified rows — never
// a second query and never numbers the LLM composed) only when the admin
// actually asked for one. See computeVerifiedRanking's own comment for how
// this is used — chart/graph/visualization requests scoped to employment
// status specifically already get one via computeVerifiedSummary's own
// summaryTopics mechanism (confirmed live: the extractor already classifies
// "chart of employment status" as a summary request), so this pattern's
// remaining job is the RANKING-shaped case (top industries/programs/
// companies/job titles), which had no chart support at all before this.
const CHART_REQUEST_PATTERN = /\b(chart|graph|visuali[sz]e|visualization|plot)\b/i;

// Moved to fieldRegistry.js (single source of truth, see that file's own
// comment) — now also merged into queryPlanValidator.js's own
// unsupportedConditions array, not just used as this file's/ragService.js's
// standalone hard-refusal gate.

// PLACEHOLDER_VALUE_PATTERN, dropPlaceholders, PROGRAM_MAJOR_GROUPS, and the
// ranking field map now live in utils/fieldRegistry.js (imported above) —
// see that file's own comments for the "N/A"-placeholder and BSIT-track-vs-
// course-suffix specialization reasoning that used to live here.
const RANKING_FIELD_MAP = buildRankingFieldMap();

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = {
  ts: 0, courses: [], colleges: [], jobTitles: [], industries: [], companies: [],
  employmentTypes: [], furtherEducationTypes: [], trainingTypes: [], reasonsNotEmployed: [],
  customQuestions: [],
};

// Every `type: 'catalog-match'` registry entry needs a live DISTINCT list
// cached under its own `catalogKey` — generated from the registry instead
// of one hand-written Promise.all per field, so a new catalog-match entry
// added to fieldRegistry.js is automatically cached here with no change
// needed in this file.
const CATALOG_MATCH_ENTRIES = FIELD_REGISTRY.filter((e) => e.type === 'catalog-match');

async function refreshCache() {
  if (Date.now() - cache.ts < CACHE_TTL_MS) return;
  const [distinctResults, formConfigs] = await Promise.all([
    Promise.all(CATALOG_MATCH_ENTRIES.map((e) => TracerStudyResponse.distinct(e.dbField))),
    TracerFormConfig.find().lean(),
  ]);

  // Every college's own custom tracer questions, discovered from their live
  // TracerFormConfig — NOT a hardcoded list. A newly-added question on any
  // college's form becomes filterable here the moment this cache next
  // refreshes, with no code change. Fixed-schema questions (employment
  // status, job title, etc.) are excluded since those already have their
  // own dedicated, better-typed matching above — this only covers what
  // FIXED_KEYS does NOT.
  const customQuestions = [];
  for (const cfg of formConfigs) {
    for (const page of (cfg.config?.pages || [])) {
      for (const q of (page.questions || [])) {
        if (!q.id || !q.label || FIXED_KEYS.has(q.id)) continue;
        customQuestions.push({
          id: q.id,
          label: q.label,
          labelLower: q.label.toLowerCase(),
          options: Array.isArray(q.options) ? q.options.filter(Boolean) : [],
          college: cfg.college,
        });
      }
    }
  }

  // College/course matching uses the OFFICIAL catalog (utils/collegesCourses.js),
  // not a Mongo distinct() scan of User records — see that file's own
  // comment on why a distinct() scan is the wrong source here (it would
  // treat a historical typo sitting on some old account as if it were a
  // real, valid college/course). Every catalog-match field has no such
  // official catalog to check against, so those stay DB-observed.
  const newCache = {
    ts: Date.now(),
    courses: ALL_COURSES.filter(Boolean),
    colleges: COLLEGE_CODES.filter(Boolean),
    customQuestions,
  };
  CATALOG_MATCH_ENTRIES.forEach((entry, i) => {
    const values = distinctResults[i].filter(Boolean);
    newCache[entry.catalogKey] = entry.skipPlaceholderDrop ? values : dropPlaceholders(values);
  });
  cache = newCache;
}

// "a", "a and b", "a, b, and c" — natural-language joining for the matched
// filter parts, instead of a structured "key = value" list a human wouldn't
// actually say out loud.
function joinNatural(parts) {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

// A question can name MANY filters at once, in any combination — some real
// and resolvable, others naming a condition this schema structurally has no
// field for at all (salary, an exact year count, etc. — see
// queryPlanExtractor.js's RULE 4). The three compute* functions below used
// to hard-refuse the ENTIRE query the moment ANY unsupported condition was
// present, even when every OTHER named filter resolved perfectly fine —
// e.g. "how many female BSIT alumni earning over 30k are employed?" (a
// real, answerable gender+course+employmentStatus query, with only the
// salary part unsupported) got NO answer at all instead of the female BSIT
// employed count it could have given. That's a worse failure mode than
// disclosing the gap: dropping a condition SILENTLY would be wrong (the
// user wouldn't know their salary filter was ignored), but refusing
// EVERYTHING just because one piece of a multi-filter question can't be
// applied throws away real, correct, verified data the system already had
// on hand. This helper builds the disclosure clause appended to such an
// answer's description — never silent, but also never an all-or-nothing
// refusal when a partial, honestly-labeled answer is available instead.
function unsupportedConditionsNote(unsupportedConditions) {
  if (!unsupportedConditions || unsupportedConditions.length === 0) return '';
  const verb = unsupportedConditions.length > 1 ? 'are' : 'is';
  return ` | note: ${joinNatural(unsupportedConditions)} ${verb} not tracked in this system and could not be applied as a filter`;
}

// Strips a `parts` entry's own internal label wrapper ('program "BSBA" (any
// major)', 'college "College of Computer Studies" (CCS)') down to just the
// display name, for embedding naturally inside a plain sentence like "...
// for X alumni" — the raw part text reads fine in the "filters:" list
// format it was built for, but "...for program "BSBA" (any major)
// alumni" is clunky prose. Returns the input unchanged if it doesn't match
// the expected "program "X""/"college "X"" shape.
function scopePartName(part) {
  const m = part && part.match(/^(?:program|college) "(.+?)"(.*)$/);
  return m ? `${m[1]}${m[2]}` : part;
}

// Extracts + validates a structured query plan for `question` via the LLM
// (see services/queryPlanExtractor.js and utils/queryPlanValidator.js), or
// returns the already-computed `providedPlan` as-is when one is passed in —
// computeVerifiedStat extracts the plan ONCE per question and routes to the
// matching compute* function with it, avoiding a redundant second LLM call;
// each compute* function still extracts its own plan when called in
// isolation (e.g. directly, or in a test) so every exported function stays
// usable on its own.
async function getPlan(question, providedPlan, scopeCollege) {
  if (providedPlan) return providedPlan;
  await refreshCache();
  const rawPlan = await extractQueryPlan(question);
  if (!rawPlan) {
    return {
      intent: 'none', rankingField: null, rankingDirection: null, rankingScope: null, rankingMode: null, compareScope: null, summaryTopics: [],
      userFilters: {}, tracerFilters: {}, parts: [], statusMatch: null,
      unresolvedField: null, unresolvedScope: false, unsupportedConditions: [], ambiguousField: null, forbiddenScope: null,
    };
  }
  const validated = validateQueryPlan(rawPlan, cache, question, scopeCollege);
  return {
    intent: rawPlan.intent, rankingField: rawPlan.rankingField, rankingDirection: rawPlan.rankingDirection, rankingScope: rawPlan.rankingScope,
    rankingMode: rawPlan.rankingMode, compareScope: rawPlan.compareScope, summaryTopics: rawPlan.summaryTopics, ...validated,
  };
}

// Counts TracerStudyResponse records matching tracerFilters, additionally
// scoped to alumni whose course and/or college matches userFilters when
// present (via a $lookup join — TracerStudyResponse itself has no program
// or college field of its own).
async function countWithFilters(userFilters, tracerFilters) {
  const userKeys = Object.keys(userFilters);
  if (userKeys.length === 0) {
    return TracerStudyResponse.countDocuments(tracerFilters);
  }
  // Generic over EVERY userFilters key (course, college, track/specialization,
  // or any future User-collection filter) instead of hand-checking course/
  // college specifically — a field like "specialization" living on User
  // needs the exact same $lookup join as course/college, no special-casing.
  const userMatch = {};
  for (const key of userKeys) userMatch[`user.${key}`] = userFilters[key];
  const result = await TracerStudyResponse.aggregate([
    { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { ...tracerFilters, ...userMatch } },
    { $count: 'n' },
  ]);
  return result[0]?.n || 0;
}

function unresolvedFieldDescription(unresolvedField) {
  return `${unresolvedField.type} "${unresolvedField.value}" does not match any ${unresolvedField.type} on record`;
}

// A genuinely ambiguous named value (see queryPlanValidator.js's own
// comment — e.g. "Information Technology" is a real INDUSTRY, not a real
// job title, but the question's phrasing could plausibly mean either).
// Returned as its own 'clarify' type (not folded into unresolvedField's
// "0, doesn't exist" handling) — ragService.js streams this question
// directly, bypassing LLM narration entirely, for the same reliability
// reason the names/unsupported-condition hard gates do.
function ambiguousFieldClarify(ambiguousField) {
  const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
  return {
    type: 'clarify',
    description: `Did you mean "${ambiguousField.value}" as ${article(ambiguousField.askedAs)} ${ambiguousField.askedAs}, or as ${article(ambiguousField.alsoMatches)} ${ambiguousField.alsoMatches}? Both exist in the records, but asking about them means different things.`,
  };
}

// A coordinator named a REAL course/college that belongs to a DIFFERENT
// college than their own (see queryPlanValidator.js's own doc comment on
// why this is distinct from unresolvedScope — the value is real, it's just
// not allowed for this user). Returned as its own 'forbidden' type,
// streamed directly by ragService.js (bypassing LLM narration entirely) —
// a permissions message is exactly the kind of fact that must never risk
// LLM paraphrase drift, same reasoning as the 'summary'/'clarify' bypasses.
function forbiddenScopeClarify(forbiddenScope) {
  const allowedName = COLLEGE_NAMES[forbiddenScope.allowed] || forbiddenScope.allowed;
  return {
    type: 'forbidden',
    description: `You can only view data for your own college, ${allowedName} (${forbiddenScope.allowed}). "${forbiddenScope.requested}" belongs to a different college, which is outside your access.`,
  };
}

/**
 * Returns { count, description } for a "how many" question, or null when the
 * plan's intent isn't "count" or no filter could be confidently matched
 * (caller should fall back to the normal RAG/refusal path in that case —
 * never guess a count here either).
 */
// A "X vs Y" / "X versus Y" / "X compared to Y" question asks for a full
// breakdown across a field's values in one breath, but the query plan only
// ever resolves ONE side by default. Caught live: "how many work locally vs
// abroad" extracted workLocation: "Local" only — the verified data line
// therefore contained ONLY the Local count (163, correct) with nothing for
// "abroad" at all, and the narration LLM, trying to honor the "vs abroad"
// half of the question it had no real data for, didn't just omit that half
// — it INVENTED BOTH numbers from scratch ("99 locally, 5 abroad"),
// replacing even the one real, correctly-computed figure it had been given.
// A verified line covering only half of what a comparison question asks for
// is apparently enough to make the model fabricate the entire answer, not
// just the missing half — so a comparison must be fully resolved with EVERY
// side's real number before it ever reaches narration, never partially.
//
// GENERIC across every enum-like AND boolean field, not hand-written per
// field: once queryPlanValidator.js tags `plan.comparisonField` (the field
// whose own backstop wording actually matched the question — see its own
// comment), this reads that field's complete value set and queries a count
// for EVERY value in it, not just the two sides the question happened to
// name. A brand-new field gets comparison support automatically the moment
// it's added to the registry with a `values` map (enum-synonym/prefix-
// bucket) or is `type: 'boolean-yesno'`, plus a `backstop` so "X vs Y"
// phrasing reliably ties to it (see workLocation/employmentStatus/gender's
// own backstop comments on why that matters) — no new code here. Returns
// null when the question isn't a recognized comparison shape or no
// comparable field resolved, so callers fall through to normal intent-based
// handling.
//
// `entry.comparisonFold` (optional, declarative) handles a field whose own
// value regexes overlap — e.g. employmentStatus's "Employed"
// (/^yes$|^self-employed$/i) already counts self-employed respondents too,
// so listing "Self-Employed" as a third, seemingly-disjoint bucket
// alongside it reads as double-counting or as if self-employed were
// excluded from "Employed" (same for jobRelatedToDegree's "Related" being
// a superset of "Somewhat Related"). `{ into, subset, subsetMentionPattern }`
// — the `subset` label is hidden from the breakdown UNLESS the question
// itself names it (`subsetMentionPattern` test), and `into` gets a short
// "(includes X)" note instead. A field without this quirk just omits
// `comparisonFold` entirely — no fold applied.
function booleanComparisonValues(entry) {
  return { Yes: entry.trueMatch, No: { $not: entry.trueMatch, $nin: [null, ''] } };
}

// "What are the reasons for unemployment?" (and similar bare, not-naming-
// one-specific-reason phrasings) asks for a BREAKDOWN of reasonsNotEmployed
// — a multi-select array field (one alumnus can cite several reasons at
// once). Per CLAUDE.md's own documented lesson (section 4): an LLM asked to
// narrate raw multi-select chunks directly risks inventing causal
// relationships between co-occurring values ("these other reasons the SAME
// people also picked" misread as "reasons FOR the one reason asked about").
// This bypasses narration entirely with a real $unwind+$group aggregation,
// same "deterministic query function, never LLM-narrated raw chunks"
// principle as every other well-defined, enumerable shape in this file.
// Deliberately matched on the raw question text (not plan.intent) — a bare
// "what are the reasons" question has no single filter value to extract, so
// the LLM intent classifier has nothing to reliably key off of.
const UNEMPLOYMENT_REASONS_PATTERN = /\b(reasons?|why)\b(?:(?!\?).){0,40}\b(unemploy|not\s+(?:currently\s+)?employ|jobless|without\s+(?:a\s+)?job)/i;

async function computeUnemploymentReasons(plan, question) {
  if (!UNEMPLOYMENT_REASONS_PATTERN.test(question || '')) return null;
  // Deliberately NOT gated on plan.tracerFilters.reasonsNotEmployed (an
  // earlier version of this check was) — caught live: the extraction LLM
  // non-deterministically hallucinated a specific reason value
  // ("Lack of work experience") for this exact bare "what are the reasons
  // for unemployment?" question on some runs and not others, with nothing
  // in the question actually naming one — trusting that unreliable
  // extraction caused this whole deterministic breakdown to randomly not
  // fire. UNEMPLOYMENT_REASONS_PATTERN above already requires the bare
  // "reason(s)/why ... unemploy" shape; a question naming one specific
  // reason (e.g. "how many cited lack of work experience as their
  // reason?") doesn't match it in the first place and is handled by the
  // normal catalog-match count path instead — see fieldRegistry.js's
  // reasonNotEmployed entry.
  const { userFilters, tracerFilters, forbiddenScope } = plan;
  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);

  const matchStage = { ...tracerFilters, reasonsNotEmployed: { $exists: true, $ne: [] } };
  const userKeys = Object.keys(userFilters);
  const pipeline = [];
  if (userKeys.length) {
    pipeline.push({ $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: 'user' } });
    pipeline.push({ $unwind: '$user' });
    for (const key of userKeys) matchStage[`user.${key}`] = userFilters[key];
  }
  pipeline.push({ $match: matchStage });
  const [reasonRows, respondentCount] = await Promise.all([
    TracerStudyResponse.aggregate([
      ...pipeline,
      { $unwind: '$reasonsNotEmployed' },
      { $group: { _id: '$reasonsNotEmployed', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    TracerStudyResponse.aggregate([...pipeline, { $count: 'n' }]).then((r) => r[0]?.n || 0),
  ]);

  if (reasonRows.length === 0) {
    return { type: 'unsupported', description: 'There are no recorded reasons for unemployment in the tracer survey responses yet.' };
  }

  // Fold the catalog's own literal "Other" value plus any one-off reason
  // (count <= 1 — mostly free-text noise like a specific date-stamped
  // remark, e.g. "I left my last company recently. (September 27, 2024)")
  // into a single "Others" bucket, so the list reads as a clean set of real
  // categories instead of a long tail of one-person stray entries — caught
  // live: those stray entries made an already-long pipe-separated line even
  // harder to read without adding any real signal.
  const OTHERS_LABEL = 'Other';
  const realReasons = [];
  let othersCount = 0;
  for (const row of reasonRows) {
    if (row._id === OTHERS_LABEL || row.count <= 1) othersCount += row.count;
    else realReasons.push(row);
  }
  const displayRows = [...realReasons, ...(othersCount > 0 ? [{ _id: OTHERS_LABEL, count: othersCount }] : [])];

  // One reason per line instead of a single pipe-separated paragraph — a
  // 13-item "Label: N | Label: N | ..." line was reported as hard to read.
  const rowsText = displayRows.map((r) => `- ${r._id}: ${r.count}`).join('\n');
  const charts = [{ type: 'bars', title: 'Reasons for Unemployment', rows: displayRows.map((r) => ({ label: r._id, count: r.count })) }];
  return {
    type: 'unsupported',
    description: `Based on ${respondentCount} unemployed alumni who reported at least one reason (a respondent may cite more than one, so these don't sum to ${respondentCount}), the reasons cited were:\n${rowsText}`,
    charts,
  };
}

async function computeComparison(plan, question) {
  if (!plan.comparisonField) return null;
  const entry = FIELD_REGISTRY_BY_KEY[plan.comparisonField];
  if (!entry) return null;

  const { userFilters, tracerFilters, parts, forbiddenScope } = plan;
  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);

  // skillRating is the one bespoke exception: its real dbField is dynamic
  // (personalGrowthRatings.<whichever skill was named>), so it can't use a
  // static `entry.dbField`/`entry.values` like every other comparable field
  // — the normal resolveSkillRating resolver (which already ran earlier in
  // the validator loop) left the actual dbField as a live key in
  // `tracerFilters`, which is read back out here instead.
  let dbField = entry.dbField;
  // Several boolean-yesno entries (professionalCertifications,
  // pursuedTrainings, professionalDevelopmentActivities, ...) only define
  // `partLabel` (used in plain count filter text), not `label` — crashed
  // live ("How many alumni pursued professional certifications vs further
  // trainings?" → `fieldLabel[0].toUpperCase()` on undefined) the first
  // time one of them got selected as comparisonField, since every OTHER
  // comparable field in the registry happens to define `label` too.
  let fieldLabel = entry.label || entry.partLabel || entry.key;
  let values = entry.values || (entry.type === 'boolean-yesno' ? booleanComparisonValues(entry) : null);
  if (entry.key === 'skillRating') {
    const dynamicKey = Object.keys(tracerFilters).find((k) => k.startsWith('personalGrowthRatings.'));
    if (!dynamicKey) return null;
    dbField = dynamicKey;
    fieldLabel = `${dynamicKey.slice('personalGrowthRatings.'.length).replace(/([A-Z])/g, ' $1').trim().toLowerCase()} rating`;
    values = Object.fromEntries(SKILL_RATING_VALUES.map((v) => [v, v]));
  }
  // Catalog-match fields (jobTitle, industryField, companyName,
  // employmentType, trainingType, ...) have no fixed enum `values` map —
  // queryPlanValidator.js's findCatalogComparisonValues instead found which
  // of the field's own LIVE catalog values are literally named in the
  // question ("Regular/Permanent vs Contractual"), carried here as
  // plan.catalogComparisonValues. Unlike every other branch above, each
  // "value" here IS the real stored string already (an exact DB value, not
  // a regex pattern) — the DB field stores this exact literal text, so an
  // exact-match $eq (via the plain tracerFilters merge countWithFilters
  // already does) is correct, no regex needed.
  if (entry.type === 'catalog-match' && plan.catalogComparisonValues) {
    values = Object.fromEntries(plan.catalogComparisonValues.map((v) => [v, v]));
  }
  // specialization (TSM/WMA/NA) — another bespoke exception, same spirit as
  // skillRating above: its real field is User.track, not a plain tracer
  // field, so dbField has to be matched against userFilters (via
  // countWithFilters' own $lookup join) instead of tracerFilters like every
  // generic branch above does. queryPlanValidator.js's own specialization-
  // comparison block supplies the matched TSM/WMA/NA values the same way it
  // supplies plan.catalogComparisonValues for real catalog-match fields.
  // graduationYear (year-over-year, "2024 vs 2025") is the same onUser
  // shape (User.graduationYear, not a tracer field) but — unlike
  // specialization — doesn't imply any extra forced filter (TSM/WMA/NA only
  // ever exist within BSIT; any batch year can belong to any program), so
  // `extraUserFilters` stays per-entry rather than hardcoded.
  const onUser = entry.key === 'specialization' || entry.key === 'graduationYear';
  const extraUserFilters = entry.key === 'specialization' ? { course: 'BSIT' } : {};
  if (onUser && plan.catalogComparisonValues) {
    dbField = entry.key === 'specialization' ? 'track' : 'graduationYear';
    fieldLabel = entry.key === 'specialization' ? 'specialization' : 'batch year';
    values = Object.fromEntries(plan.catalogComparisonValues.map((v) => [String(v), v]));
  }
  // customQuestion (an admin-defined tracer-form question, any college) —
  // the LAST bespoke exception. There's no single dbField at all here
  // (unlike skillRating's dynamic-but-still-singular personalGrowthRatings.X
  // path) — a matching answer could live under extra_answers.<id> for
  // potentially MULTIPLE question ids at once (the same worded question
  // defined separately by more than one college), so it has to be queried
  // as an $or across every matched id, the exact same shape
  // resolveCustomQuestion itself already builds for a single-value filter —
  // just repeated once per compared option instead of once overall.
  const isCustomQuestionComparison = entry.key === 'customQuestion' && plan.catalogComparisonValues && plan.customQuestionComparisonIds;
  if (isCustomQuestionComparison) {
    fieldLabel = plan.customQuestionComparisonLabel || 'custom question';
    values = Object.fromEntries(plan.catalogComparisonValues.map((v) => [v, v]));
  }
  if (!values) return null;

  // `$or` is also stripped here (alongside dbField) — resolveCustomQuestion's
  // own normal (non-comparison) resolver, which still runs earlier in
  // queryPlanValidator.js's per-field loop regardless of comparisonField,
  // may have already left a SINGLE-value $or clause sitting in tracerFilters;
  // the customQuestion comparison branch below builds its own per-label $or
  // instead, so that stray one must not also survive into restFilters.
  const { [dbField]: _current, $or: _strayOr, ...restFilters } = tracerFilters;
  const { [dbField]: _currentUser, ...restUserFilters } = userFilters;
  const labels = Object.keys(values);
  const counts = await Promise.all(
    labels.map((label) => {
      if (isCustomQuestionComparison) {
        const orClause = plan.customQuestionComparisonIds.map((id) => ({ [`extra_answers.${id}`]: values[label] }));
        return countWithFilters(userFilters, { ...restFilters, $or: orClause });
      }
      return onUser
        ? countWithFilters({ ...restUserFilters, ...extraUserFilters, [dbField]: values[label] }, tracerFilters)
        : countWithFilters(userFilters, { ...restFilters, [dbField]: values[label] });
    }),
  );
  let breakdown = labels.map((label, i) => ({ label, count: counts[i] }));

  const noteSuffix = {};
  if (entry.comparisonFold) {
    const { into, subset, subsetMentionPattern } = entry.comparisonFold;
    if (!subsetMentionPattern.test(question)) {
      breakdown = breakdown.filter((b) => b.label !== subset);
    } else {
      noteSuffix[into] = ` (includes ${subset.toLowerCase()})`;
    }
  }

  // `.includes`, not `.startsWith` — most fields' own `part` text leads with
  // the label ("employment status \"Employed\""), but specialization's
  // (resolveSpecializationFilter, fieldRegistry.js) puts the value FIRST
  // ("TSM specialization"), which `.startsWith(fieldLabel)` would never
  // match, letting it leak into scopeText as a redundant, confusing
  // "scope: TSM specialization" alongside the comparison's own TSM/WMA rows.
  // graduationYear's own part text ("batch 2024", resolveGraduationYear)
  // doesn't contain fieldLabel ("batch year") as a substring either way, so
  // it needs its own exclusion check (startsWith "batch ") rather than
  // reusing fieldLabel directly.
  const scopeText = parts
    .filter((p) => !p.includes(fieldLabel))
    .filter((p) => !(entry.key === 'graduationYear' && p.startsWith('batch ')))
    .join(', ');
  const descText = breakdown.map((b) => `${b.label}${noteSuffix[b.label] || ''}: ${b.count}`).join(' | ');
  // Same {type, title, rows} shape every other verified chart uses (see
  // computeVerifiedRanking's own comment). Unlike a single-value count/
  // percentage/ranking answer, a comparison IS inherently a breakdown
  // across several values of one field — always attached, not gated behind
  // CHART_REQUEST_PATTERN, since the whole point of a "vs"/comparison
  // question is to see the values side by side. Built from the SAME
  // `breakdown` rows already computed above, never a second query or
  // LLM-composed numbers.
  const charts = [{ type: 'bars', title: `${fieldLabel[0].toUpperCase()}${fieldLabel.slice(1)} Comparison${scopeText ? ` — ${scopeText}` : ''}`, rows: breakdown.map((b) => ({ label: b.label, count: b.count })) }];
  return {
    type: 'count',
    count: breakdown[0]?.count ?? 0,
    description: `metric: ${fieldLabel} comparison${scopeText ? ` | scope: ${scopeText}` : ''} | ${descText}`,
    charts,
  };
}

// "How many pursued professional certifications vs further trainings?" —
// unlike computeComparison above (two VALUES of the SAME field), this
// compares two DIFFERENT boolean fields' own Yes-counts side by side. See
// queryPlanValidator.js's crossBooleanFields comment for the live bug this
// fixes (a crash, then a wrong "one field used as a filter on the other"
// answer). Each field's Yes-count is computed independently — a respondent
// can be Yes on both, so these are NOT mutually exclusive buckets of one
// population the way computeComparison's single-field breakdown is.
async function computeCrossBooleanComparison(plan) {
  if (!plan.crossBooleanFields) return null;
  const { userFilters, tracerFilters, forbiddenScope } = plan;
  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);

  const entries = plan.crossBooleanFields.map((key) => FIELD_REGISTRY_BY_KEY[key]);
  // Strips EVERY crossBooleanFields dbField out of the shared filter base,
  // not just the one currently being counted — otherwise each field's own
  // count was unintentionally ALSO filtered by the other field still being
  // true in tracerFilters (both were force-set together by
  // queryPlanValidator.js's certifications/trainings mutual-exclusivity
  // block), silently computing the INTERSECTION of both fields for each
  // side instead of each field's own independent total. Caught live: both
  // sides came back as the identical count (11) — the actual overlap, not
  // each field's real total (certifications: 30, trainings: 41).
  const restFilters = { ...tracerFilters };
  for (const entry of entries) delete restFilters[entry.dbField];
  const rows = await Promise.all(entries.map(async (entry) => {
    const count = await countWithFilters(userFilters, { ...restFilters, [entry.dbField]: entry.trueMatch });
    return { label: entry.partLabel || entry.label || entry.key, count };
  }));

  const descText = rows.map((r) => `${r.label}: ${r.count}`).join(' | ');
  const charts = [{ type: 'bars', title: 'Comparison', rows: rows.map((r) => ({ label: r.label, count: r.count })) }];
  return {
    type: 'count',
    count: rows[0]?.count ?? 0,
    description: `metric: comparison | ${descText}`,
    charts,
  };
}

// 2D cross-tab ("employment status by gender") — every value of fieldA
// crossed with every value of fieldB. Reuses the same per-field `values`
// resolution as computeComparison (including the skillRating dynamic-
// dbField exception) but is otherwise a separate function since it groups
// by TWO fields at once, a genuinely different query shape.
function comparableFieldValues(entry, tracerFilters) {
  if (entry.key === 'skillRating') {
    const dynamicKey = Object.keys(tracerFilters).find((k) => k.startsWith('personalGrowthRatings.'));
    if (!dynamicKey) return null;
    const label = `${dynamicKey.slice('personalGrowthRatings.'.length).replace(/([A-Z])/g, ' $1').trim().toLowerCase()} rating`;
    return { dbField: dynamicKey, label, values: Object.fromEntries(SKILL_RATING_VALUES.map((v) => [v, v])) };
  }
  const values = entry.values || (entry.type === 'boolean-yesno' ? booleanComparisonValues(entry) : null);
  return values ? { dbField: entry.dbField, label: entry.label, values } : null;
}

// Generalized to N dimensions (queryPlanValidator.js no longer caps
// crosstabFields at 2 — "employment status by gender by college" names
// three fields at once, the same "by"/"per" shape as a 2D cross-tab, just
// with one more axis). Computes the full Cartesian product across every
// matched field's own value set — for the common 2-field case this
// produces the EXACT same output shape as before (verified: the 2-field
// branch below is byte-for-byte what the old hardcoded version built), a
// 3rd+ field just adds another nested dimension to the same cells array.
async function computeVerifiedCrossTab(plan, question) {
  if (!plan.crosstabFields || plan.crosstabFields.length < 2) return null;
  const entries = plan.crosstabFields.map((key) => FIELD_REGISTRY_BY_KEY[key]);
  if (entries.some((e) => !e)) return null;

  const { userFilters, tracerFilters, parts, forbiddenScope } = plan;
  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);

  const fields = entries.map((entry) => comparableFieldValues(entry, tracerFilters));
  if (fields.some((f) => !f)) return null;

  const restFilters = { ...tracerFilters };
  for (const f of fields) delete restFilters[f.dbField];

  // Cartesian product of every field's own label set, e.g. for 3 fields
  // with {Male,Female}/{Employed,Unemployed}/{CCS,CBA} this builds all 8
  // combinations — same shape the old 2D version built via flatMap, just
  // generalized to fold over however many fields were matched.
  let combos = [[]];
  for (const f of fields) {
    const labels = Object.keys(f.values);
    combos = combos.flatMap((combo) => labels.map((l) => [...combo, l]));
  }

  const cells = await Promise.all(combos.map((combo) => {
    const matchPatch = {};
    fields.forEach((f, i) => { matchPatch[f.dbField] = f.values[combo[i]]; });
    return countWithFilters(userFilters, { ...restFilters, ...matchPatch }).then((count) => ({ combo, count }));
  }));

  const scopeText = parts.filter((p) => !fields.some((f) => p.startsWith(f.label))).join(', ');
  const titleFields = fields.map((f) => f.label).join(' by ');

  // 2-field rows stay grouped by the first field's own value ("Male (Employed:
  // N, Unemployed: N)"), the exact same readable shape as before — a 3+
  // field cross-tab has no single natural grouping axis to nest under, so
  // it flattens every combo into its own "A - B - C: N" line instead.
  const rowsText = fields.length === 2
    ? Object.keys(fields[0].values)
        .map((la) => `${la} (${cells.filter((c) => c.combo[0] === la).map((c) => `${c.combo[1]}: ${c.count}`).join(', ')})`)
        .join(' | ')
    : cells.map((c) => `${c.combo.join(' - ')}: ${c.count}`).join(' | ');

  // A cross-tab has no single-axis bar-chart shape to fall back on, so
  // each cell is flattened into its own labeled bar ("Male - Employed", or
  // "Male - Employed - CCS" for 3 fields). Always attached, not gated
  // behind CHART_REQUEST_PATTERN — same reasoning as computeComparison's
  // own chart above: a "breakdown"/cross-tab question is inherently asking
  // to see values compared side by side, so the visualization isn't
  // something that needs to be separately requested. Still built from the
  // SAME `cells` already computed above, never a second query.
  const charts = [{ type: 'bars', title: `${titleFields[0].toUpperCase()}${titleFields.slice(1)}${scopeText ? ` — ${scopeText}` : ''}`, rows: cells.map((c) => ({ label: c.combo.join(' - '), count: c.count })) }];

  return {
    type: 'count',
    count: cells[0]?.count ?? 0,
    description: `metric: ${titleFields} cross-tab${scopeText ? ` | scope: ${scopeText}` : ''} | ${rowsText}`,
    charts,
  };
}

// "Do alumni with Excellent technical skills get employed more?", "Does
// gender affect employment?" — answered as a genuine, practical insight
// (the employment RATE within each group of the named field — "Excellent:
// 85% employed, Beginner: 60% employed"), deliberately NOT a real
// statistical correlation coefficient (Pearson's r, chi-square, p-value).
// A real coefficient risks being read as more statistically rigorous than
// this schema's sample sizes/categorical shape can actually support, and
// would need genuine statistical framing (confidence intervals,
// significance testing) this chatbot has no safe, deterministic way to
// narrate — this project's own standing rule is to prefer a plain,
// honestly-labeled deterministic figure over an LLM-narrated statistical
// claim that could be misread as more certain than it is. A rate-per-group
// breakdown answers the practical question just as well without that risk.
async function computeVerifiedCorrelation(plan, question) {
  if (!plan.correlationField) return null;
  const entry = FIELD_REGISTRY_BY_KEY[plan.correlationField];
  if (!entry) return null;

  const { userFilters, tracerFilters, parts, forbiddenScope } = plan;
  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);

  const groupField = comparableFieldValues(entry, tracerFilters);
  if (!groupField) return null;

  // "Employed" is always the fixed outcome here — queried directly via the
  // registry's own regex rather than relying on tracerFilters.employmentStatus
  // having been resolved by the normal per-field loop (it usually hasn't:
  // employmentStatus's own `backstop` only fires for comparison questions,
  // not correlation ones, and a correlation question doesn't require the
  // word "employed" to literally appear in extractable-filter form).
  const employedRegex = FIELD_REGISTRY_BY_KEY.employmentStatus.values.Employed;
  const { [groupField.dbField]: _current, employmentStatus: _es, ...restFilters } = tracerFilters;
  const labels = Object.keys(groupField.values);

  const rows = await Promise.all(labels.map(async (label) => {
    const groupFilter = { ...restFilters, [groupField.dbField]: groupField.values[label] };
    const [total, employed] = await Promise.all([
      countWithFilters(userFilters, groupFilter),
      countWithFilters(userFilters, { ...groupFilter, employmentStatus: employedRegex }),
    ]);
    return { label, total, employed, rate: total > 0 ? Math.round((employed / total) * 1000) / 10 : null };
  }));

  // A group with zero respondents at all has no real rate to report —
  // dropped rather than shown as a misleading "0%" (0 of 0 is not the same
  // claim as 0 of 50).
  const validRows = rows.filter((r) => r.total > 0);
  if (validRows.length === 0) return null;

  // skillRating's own `part` text ("technical skills rated \"Excellent\"",
  // resolveSkillRating) doesn't start with groupField.label ("technical
  // skills rating" — the "rated"/"rating" word differs), so it needs its
  // own exclusion check (matching the skill name itself) rather than
  // reusing the generic startsWith(label) filter other fields use — same
  // class of mismatch already fixed for specialization/graduationYear above.
  const skillNameBase = entry.key === 'skillRating' ? groupField.label.replace(/ rating$/, '') : null;
  const scopeText = parts
    .filter((p) => !p.startsWith(groupField.label))
    .filter((p) => !(skillNameBase && p.includes(skillNameBase)))
    .join(', ');
  const descText = validRows.map((r) => `${r.label}: ${r.rate}% employed (${r.employed} of ${r.total})`).join(' | ');

  // GroupedBarChart (single series) — same standing-bar-graph shape already
  // used for a top-N ranking and a direct two-way comparison, with the same
  // `%` unit labeling as computeVerifiedRanking's own rate charts.
  const charts = [{
    type: 'grouped-bars',
    title: `Employment Rate by ${groupField.label[0].toUpperCase()}${groupField.label.slice(1)}${scopeText ? ` — ${scopeText}` : ''}`,
    unit: '%',
    series: [{ name: 'employment rate' }],
    rows: validRows.map((r) => ({ category: r.label, values: [r.rate] })),
  }];

  return {
    type: 'count',
    count: validRows[0]?.employed ?? 0,
    description: `metric: employment rate by ${groupField.label}${scopeText ? ` | scope: ${scopeText}` : ''} | ${descText}`,
    charts,
  };
}

// "technical skills vs problem solving" (or three-or-more-way, e.g.
// "technical skills vs problem solving vs communication") — every DISTINCT
// skill actually named, each broken down across all 5 rating levels, shown
// side by side. Generic over however many skills findAllSkillMatches found
// (queryPlanValidator.js no longer caps this at 2 — see its own comment on
// why silently dropping a 3rd+ named skill was itself a bug). See that
// file's own comment on why this needs to be distinct from
// computeComparison's `comparisonField === 'skillRating'` path (one skill's
// own levels vs several different skills).
async function computeSkillCompare(plan, question) {
  // At least 2 REAL skills, OR at least 1 real skill plus at least one
  // named-but-unmatched one (see queryPlanValidator.js's own comment on
  // `unmatchedSkillNames` — "technical skills vs leadership skills" should
  // still chart technical skills alone rather than silently answering
  // nothing at all). Zero real skills matched at all (every named item is
  // untracked) has nothing to chart, so that case still falls through to
  // the caller's normal "no verified data" handling.
  const unmatchedSkillNames = plan.unmatchedSkillNames || [];
  const hasEnoughSkills = plan.skillCompareFields
    && (plan.skillCompareFields.length >= 2 || (plan.skillCompareFields.length >= 1 && unmatchedSkillNames.length > 0));
  if (!hasEnoughSkills) return null;
  const { userFilters, tracerFilters, parts, forbiddenScope } = plan;
  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);

  const skills = plan.skillCompareFields;
  const dbFields = skills.map((s) => `personalGrowthRatings.${s}`);
  const restFilters = { ...tracerFilters };
  for (const f of dbFields) delete restFilters[f];

  // One count array per skill, each covering all 5 rating levels — same
  // shape as the old two-skill version, just looped over N skills instead
  // of hand-written twice.
  const countsBySkill = await Promise.all(
    dbFields.map((dbField) => Promise.all(SKILL_RATING_VALUES.map((l) => countWithFilters(userFilters, { ...restFilters, [dbField]: l })))),
  );

  const scopeText = parts.filter((p) => !p.startsWith('rated their')).join(', ');
  const perSkillText = skills.map((s, i) => `${SKILL_FIELD_LABELS[s]} (${SKILL_RATING_VALUES.map((l, j) => `${l}: ${countsBySkill[i][j]}`).join(', ')})`);
  const titleSkills = skills.map((s) => SKILL_FIELD_LABELS[s]).join(' vs ');
  // Told explicitly, not silently dropped — see this function's own top
  // comment and queryPlanValidator.js's `unmatchedSkillNames`. Quoted
  // exactly as the user named it so the answer is unambiguous about what
  // wasn't found.
  const unmatchedNote = unmatchedSkillNames.length > 0
    ? ` | not tracked: ${unmatchedSkillNames.map((n) => `"${n}"`).join(', ')} (no such skill category exists in the system — only ${Object.values(SKILL_FIELD_LABELS).join(', ')} are tracked)`
    : '';

  // Every skill rated across the SAME 5 levels — a genuine multi-series
  // comparison, not a single-series list. Flattening every skill into one
  // long "Skill - Level" bar list (the earlier shape) forced the reader to
  // mentally regroup rows back into skills themselves; a dedicated
  // "grouped-bars" chart type (frontend/src/components/common/Charts.jsx's
  // GroupedBarChart) renders one category column per rating level with
  // every skill's bar side by side instead, and already supports any
  // number of series, not just 2. Always attached, not gated behind
  // CHART_REQUEST_PATTERN — same reasoning as
  // computeComparison/computeVerifiedCrossTab above.
  const charts = [{
    type: 'grouped-bars',
    title: `Skill Rating Comparison — ${titleSkills}${scopeText ? ` — ${scopeText}` : ''}`,
    // No color here — frontend's GroupedBarChart assigns each series a
    // color from its own CHART_PALETTE by index, same as every other chart
    // type in this file (the backend never dictates UI color choices).
    series: skills.map((s) => ({ name: SKILL_FIELD_LABELS[s] })),
    rows: SKILL_RATING_VALUES.map((l, j) => ({ category: l, values: countsBySkill.map((counts) => counts[j]) })),
  }];

  return {
    type: 'count',
    count: countsBySkill[0][0],
    description: `metric: skill rating comparison${scopeText ? ` | scope: ${scopeText}` : ''} | ${perSkillText.join(' | ')}${unmatchedNote}`,
    charts,
  };
}

async function computeVerifiedCount(question, providedPlan, scopeCollege) {
  const plan = await getPlan(question, providedPlan, scopeCollege);
  if (plan.intent !== 'count') return null;

  const { userFilters, tracerFilters, parts, unresolvedField, unresolvedScope, unsupportedConditions, ambiguousField, forbiddenScope } = plan;

  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);
  if (ambiguousField) return ambiguousFieldClarify(ambiguousField);

  const comparison = await computeComparison(plan, question);
  if (comparison) return comparison;

  // Computed up front so both refusal branches below can ALSO disclose an
  // unsupported condition named in the SAME question — see
  // computeVerifiedNames's own comment on the live case this fixes ("List
  // the employed CCS alumni who are civil servants by marital status"
  // named both an unresolvable job title AND an untracked condition at
  // once; the refusal used to mention only the first one found).
  const earlyUnsupportedNote = unsupportedConditionsNote(unsupportedConditions);

  // Refuse rather than silently answer a narrower query than what was
  // actually asked — a named job title/industry/company that matched no
  // real DB value must not just be dropped from the filter set.
  if (unresolvedField) {
    return { type: 'count', count: 0, description: `metric: alumni count | ${unresolvedFieldDescription(unresolvedField)} | value: 0${earlyUnsupportedNote}` };
  }

  // Same reasoning: a named college/course scope that matched nothing real
  // must not be silently dropped — see chatbotGuardrails.js rule 32.
  if (unresolvedScope) {
    return { type: 'count', count: 0, description: `metric: alumni count | ${unresolvedScopeMessage(unresolvedScope)} | value: 0${earlyUnsupportedNote}` };
  }

  // A condition this schema cannot filter on at all (years in job, salary)
  // no longer refuses the WHOLE query — see unsupportedConditionsNote's own
  // comment. When there are also no OTHER resolvable filters at all
  // (parts.length === 0, just below), there is genuinely nothing left to
  // compute, so that case still falls through to the normal "no real scope"
  // handling. Otherwise the valid filters answer the query and the
  // unsupported condition is disclosed in the description instead of
  // silently dropped or refusing everything.
  const unsupportedNote = unsupportedConditionsNote(unsupportedConditions);

  if (parts.length === 0) {
    // Nothing else in the question resolved to a real filter, but there IS
    // something true to say — the exact reason this can't be answered as
    // asked — so state that plainly instead of silently falling through to
    // null (which risks the caller treating this as "no verified data at
    // all" and handing the question to unverified LLM/RAG narration
    // instead). Same "always disclose, never silently refuse" principle as
    // the unresolvedField/unresolvedScope branches just above.
    if (unsupportedConditions.length > 0) {
      return { type: 'unsupported', description: `This cannot be answered as asked.${unsupportedNote}` };
    }
    if (!TOTAL_POPULATION_PATTERN.test(question)) return null;
    const total = await User.countDocuments({ role: 'alumni' });
    return { type: 'count', count: total, description: `metric: total alumni accounts in system | value: ${total} | filters: none` };
  }

  const count = await countWithFilters(userFilters, tracerFilters);
  return { type: 'count', count, description: `metric: alumni count | value: ${count} | filters: ${joinNatural(parts)}${unsupportedNote}` };
}

/**
 * Returns { numerator, denominator, percentage, description } for a
 * "what percentage/percent/rate" question. Only handles the employment-rate
 * shape (percentage of some population — optionally scoped by course/
 * college — that has a specific employment status), since that's the one
 * percentage question this schema can answer without an ambiguous, assumed
 * numerator. Returns null if the plan carries no employment status to use
 * as the numerator condition — never assumes one (the extractor prompt
 * itself infers "Employed"/"Unemployed" from "employment rate"/
 * "unemployment rate" phrasing, so this never needs to guess).
 */
async function computeVerifiedPercentage(question, providedPlan, scopeCollege) {
  const plan = await getPlan(question, providedPlan, scopeCollege);
  if (plan.intent !== 'percentage') return null;

  const { userFilters, tracerFilters, parts, percentageMatch, unresolvedField, unresolvedScope, unsupportedConditions, ambiguousField, forbiddenScope } = plan;
  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);
  if (ambiguousField) return ambiguousFieldClarify(ambiguousField);
  if (!percentageMatch) return null;
  // Same "don't silently drop a named-but-unmatched job title/scope" guard
  // as computeVerifiedCount — a percentage scoped to a nonexistent job
  // title/industry/company or college/course would otherwise silently
  // become an unscoped percentage instead.
  if (unresolvedField) return null;
  if (unresolvedScope) return null;
  // Same "answer with the valid filters, disclose the rest" principle as
  // computeVerifiedCount — a percentage question naming BOTH a real filter
  // and an unsupported condition still computes using the real one(s), with
  // the gap disclosed rather than refusing to answer at all.
  const unsupportedNote = unsupportedConditionsNote(unsupportedConditions);

  const denominatorFilters = { ...tracerFilters };
  delete denominatorFilters[percentageMatch.dbField];

  const [numerator, denominator] = await Promise.all([
    countWithFilters(userFilters, tracerFilters),
    countWithFilters(userFilters, denominatorFilters),
  ]);
  if (denominator === 0) {
    // A real, resolved scope (e.g. "BSBA" aggregated across its majors —
    // see resolveCourseCollege's own comment) that simply has no tracer
    // respondents yet is a different, more honest answer than a bare
    // `null` falling through to the generic "I do not have enough verified
    // data" fallback — same "state it plainly" principle
    // computeVerifiedSummary's own empty-result branch already uses.
    const scopePart = parts.find((p) => p.startsWith('program "') || p.startsWith('college "'));
    if (scopePart) {
      return { type: 'unsupported', description: `There are no tracer survey responses recorded yet for ${scopePartName(scopePart)} alumni.` };
    }
    return null;
  }

  const percentage = Math.round((numerator / denominator) * 1000) / 10; // one decimal place
  // Built from `parts`' own already-formatted text, not userFilters.course
  // directly — course is no longer always a plain string (a bare program-
  // family name like "BSBA" resolves to `{ $in: [...] }` across its majors
  // — see resolveCourseCollege's own comment — and stringifying that object
  // directly would read as "[object Object] alumni respondents").
  const scopePart = parts.find((p) => p.startsWith('program "') || p.startsWith('college "'));
  const scope = scopePart ? `${scopePart} alumni respondents` : 'all tracer respondents';
  // Every OTHER matched condition (gender, skill rating, job title,
  // industry, etc.) besides employment status/course/college — those three
  // are already named via statusMatch/scope above, everything else in
  // `parts` was silently missing from this description entirely until now.
  // The underlying numerator/denominator query (countWithFilters above) DID
  // already apply every one of these filters correctly — only the
  // DESCRIPTION TEXT handed to the narration LLM failed to mention them,
  // which left the narrator unable to tell the computed percentage actually
  // covered the full question asked (e.g. "female... adaptability rated
  // competent") and it understandably refused rather than risk stating an
  // incomplete answer as if it were complete.
  const extraParts = parts.filter((p) => !p.startsWith('employment status') && !p.startsWith('program') && !p.startsWith('college'));
  const extraText = extraParts.length ? ` | also scoped to: ${joinNatural(extraParts)}` : '';
  return {
    type: 'percentage',
    numerator,
    denominator,
    percentage,
    description: `metric: percentage matching ${percentageMatch.label} | value: ${percentage}% | numerator: ${numerator} | denominator: ${denominator} | population: ${scope}${extraText}${unsupportedNote}`,
  };
}

/**
 * Returns { field, direction, top, results, description } for a
 * "highest/lowest/most/least/top" question naming a known groupable field
 * (program, industry, company, job title). Returns null if the plan's
 * intent isn't "ranking" or no recognized field is named, or no data exists
 * to rank.
 */
// Which college a resolved 'specialization' ranking target belongs to —
// BSIT itself for the User.track case, or the owning college of any course
// in the matched PROGRAM_MAJOR_GROUPS group otherwise (every course in one
// group belongs to the same college, so the first is representative). Used
// to refuse a coordinator naming another college's program the same way a
// named-but-forbidden course/college filter is refused elsewhere — see
// queryPlanValidator.js's own doc comment on why this is a refusal, not a
// silent narrow.
function specializationTargetCollege(rankingScope) {
  if (!rankingScope || rankingScope.toUpperCase() === 'BSIT') return COURSE_TO_COLLEGE.BSIT || null;
  const groupKey = Object.keys(PROGRAM_MAJOR_GROUPS).find((k) => k.toLowerCase() === rankingScope.toLowerCase());
  const sampleCourse = groupKey && PROGRAM_MAJOR_GROUPS[groupKey][0];
  if (sampleCourse) return COURSE_TO_COLLEGE[sampleCourse] || null;
  if (rankingScope.toUpperCase() === 'BSIS') return COURSE_TO_COLLEGE.BSIS || null;
  return null;
}

// "BSIT vs BSCS employment rate" / "compare CCS and CBA" — exactly TWO
// named programs or colleges, each getting their own rate (if a status
// filter is named) or raw count computed and shown side by side. A
// deliberately separate function from the top-5-of-everything ranking
// below — see queryPlanExtractor.js's own RULE 2d on why "compareScope"
// is distinct from "rankingField":"course"/"college".
async function computeVerifiedCompareScope(plan, scopeCollege, question) {
  const [rawA, rawB] = plan.compareScope;
  const courseA = exactMatch(rawA, cache.courses);
  const courseB = exactMatch(rawB, cache.courses);
  const collegeA = exactMatch(rawA, cache.colleges);
  const collegeB = exactMatch(rawB, cache.colleges);

  let type;
  let valueA;
  let valueB;
  if (courseA && courseB) { type = 'course'; valueA = courseA; valueB = courseB; }
  else if (collegeA && collegeB) { type = 'college'; valueA = collegeA; valueB = collegeB; }
  else if (!courseA && !collegeA && !courseB && !collegeB) {
    // NEITHER name matches anything at all — this is very likely a
    // misclassified compareScope rather than a genuine named-but-invalid
    // program/college. Caught live: "technical skills vs problem solving"
    // had the LLM set compareScope to the internal skill keys
    // ["technicalSkills","problemSolvingSkills"] alongside the (correct)
    // rankingField:"skill" — since compareScope is checked first (see
    // computeVerifiedStat's own comment on why), this silently hijacked a
    // working skill comparison into a false "not a recognized college or
    // course" refusal. Returning null here lets the question fall through
    // to computeSkillCompare/computeComparison/the normal intent switch
    // instead — only a PARTIAL match (one side resolves, the other
    // doesn't — see below) is trusted as a genuine, refusable program/
    // college comparison; two complete non-matches means compareScope
    // itself was probably about the wrong thing entirely.
    return null;
  } else {
    const unresolved = (!courseA && !collegeA) ? rawA : rawB;
    return { type: 'count', count: 0, description: `metric: alumni count | ${unresolvedScopeMessage(unresolved)} | value: 0` };
  }

  if (scopeCollege) {
    const collegesInvolved = type === 'course' ? [COURSE_TO_COLLEGE[valueA], COURSE_TO_COLLEGE[valueB]] : [valueA, valueB];
    const outside = collegesInvolved.find((c) => c !== scopeCollege);
    if (outside) return forbiddenScopeClarify({ requested: outside, allowed: scopeCollege });
  }

  const { tracerFilters, parts } = plan;
  const userField = type === 'course' ? 'course' : 'college';
  const { employmentStatus: statusCond, ...otherTracerFilters } = tracerFilters;

  // With a status filter named (the common "X vs Y employment rate" case),
  // compute each side's own RATE (matching / total within that side's own
  // population) — without one, just each side's raw respondent count. Each
  // side's total is scoped to its OWN population (userField), never the
  // other side's — a program with few respondents can have a misleadingly
  // high/low rate, but that is the real, honestly-computed rate for that
  // program, not something to silently correct.
  async function sideStats(value) {
    const baseUserFilters = { [userField]: value };
    const total = await countWithFilters(baseUserFilters, otherTracerFilters);
    if (!statusCond) return { total, matched: null, rate: null };
    const matched = await countWithFilters(baseUserFilters, { ...otherTracerFilters, employmentStatus: statusCond });
    const rate = total > 0 ? (matched / total) * 100 : 0;
    return { total, matched, rate };
  }

  const [statsA, statsB] = await Promise.all([sideStats(valueA), sideStats(valueB)]);
  const scopeText = parts.filter((p) => !p.startsWith('program') && !p.startsWith('college') && !p.startsWith('employment status')).join(', ');
  const label = type === 'course' ? 'program' : 'college';
  const fmt = (name, s) => (statusCond ? `${name}: ${s.rate.toFixed(1)}% (${s.matched} of ${s.total})` : `${name}: ${s.total}`);

  // Always attached, not gated behind CHART_REQUEST_PATTERN — a direct
  // two-way comparison ("compare BSIT and BSCS employment rates") is
  // inherently a breakdown across two values, same reasoning already
  // applied to computeComparison/computeVerifiedCrossTab/computeSkillCompare
  // above: the whole point of a comparison question is to see both sides
  // side by side, so the visualization isn't something that needs to be
  // separately requested. Caught live: this branch was the one comparison-
  // shaped result left still requiring the user to say "graph"/"chart"
  // explicitly, with no visual otherwise. Rendered as a standing bar graph
  // (GroupedBarChart, single series, same as computeVerifiedRanking's top-N
  // chart) rather than the horizontal MiniBarChart list — only ever 2 bars,
  // so a compact column chart reads cleaner than a horizontal list built for
  // many rows. `unit: '%'` only when this is a rate comparison (statusCond
  // set); a plain headcount comparison has no unit to label.
  const chartTitle = `${label[0].toUpperCase()}${label.slice(1)} Comparison — ${valueA} vs ${valueB}${scopeText ? ` — ${scopeText}` : ''}`;
  const charts = [{
    type: 'grouped-bars',
    title: chartTitle,
    unit: statusCond ? '%' : '',
    series: [{ name: statusCond ? `${label} employment rate` : `${label} respondent count` }],
    rows: statusCond
      ? [{ category: valueA, values: [Math.round(statsA.rate * 10) / 10] }, { category: valueB, values: [Math.round(statsB.rate * 10) / 10] }]
      : [{ category: valueA, values: [statsA.total] }, { category: valueB, values: [statsB.total] }],
  }];

  return {
    type: 'count',
    count: statsA.total,
    description: `metric: ${label} comparison${scopeText ? ` | scope: ${scopeText}` : ''} | ${fmt(valueA, statsA)} | ${fmt(valueB, statsB)}`,
    charts,
  };
}

// "Which skill do alumni rate themselves highest in?" — ranks the 8
// personal-growth skill CATEGORIES against each other (by how many
// respondents rated each at a given level, default "Excellent"), a
// completely different dimension from skillRating's own comparisonField
// path (which breaks down rating LEVELS within one already-named skill).
// Bespoke, not a $group on a literal field, for the same reason the
// specialization extractFromText branch is — each skill lives in its own
// nested personalGrowthRatings.<skill> path, nothing to group on directly.
async function computeVerifiedSkillRanking(plan, question) {
  const direction = plan.rankingDirection === 'lowest' ? 1 : -1;
  const ratingLevel = (plan.rankingScope && SKILL_RATING_VALUES.includes(plan.rankingScope)) ? plan.rankingScope : 'Excellent';
  const { userFilters, tracerFilters, parts } = plan;
  const skills = Object.keys(SKILL_FIELD_LABELS);
  const counts = await Promise.all(
    skills.map((s) => countWithFilters(userFilters, { ...tracerFilters, [`personalGrowthRatings.${s}`]: ratingLevel })),
  );
  const results = skills
    .map((s, i) => ({ _id: SKILL_FIELD_LABELS[s], count: counts[i] }))
    .sort((a, b) => (direction === -1 ? b.count - a.count : a.count - b.count))
    .slice(0, 5);
  if (results.length === 0) return null;

  const top = results[0];
  const dirLabel = direction === -1 ? 'highest' : 'lowest';
  const rankingList = results.map((r) => `${r._id} (${r.count})`).join(', ');
  const scopeText = parts.join(', ');
  const chartTitle = `Skill Rating Breakdown — rated "${ratingLevel}"`;
  const charts = CHART_REQUEST_PATTERN.test(question)
    ? [{ type: 'bars', title: chartTitle, rows: results.map((r) => ({ label: r._id, count: r.count })) }]
    : [];

  return {
    type: 'ranking',
    field: `skill rated "${ratingLevel}"`,
    direction: dirLabel,
    top: { value: top._id, count: top.count },
    results: results.map((r) => ({ value: r._id, count: r.count })),
    description: `metric: ${dirLabel} skill rated "${ratingLevel}" by respondent count${scopeText ? ` | filters: ${scopeText}` : ''} | top: ${top._id} (${top.count}) | full ranking: ${rankingList}`,
    charts,
  };
}

async function computeVerifiedRanking(question, providedPlan, scopeCollege) {
  const plan = await getPlan(question, providedPlan, scopeCollege);
  if (plan.intent !== 'ranking') return null;

  if (plan.compareScope) return computeVerifiedCompareScope(plan, scopeCollege, question);
  if (plan.rankingField === 'skill') return computeVerifiedSkillRanking(plan, question);

  // 'specialization' isn't a fixed entry in RANKING_FIELD_MAP — which real
  // field it resolves to depends on WHICH program was named
  // (plan.rankingScope). See fieldRegistry.js's resolveSpecializationRankingTarget
  // for the full BSIT-track-vs-course-suffix-majors reasoning. A named
  // scope that matches neither is a program with NO tracked specializations
  // at all — refuse rather than silently rank something that doesn't exist.
  if (scopeCollege && plan.rankingField === 'specialization') {
    const targetCollege = specializationTargetCollege(plan.rankingScope);
    if (targetCollege && targetCollege !== scopeCollege) {
      return forbiddenScopeClarify({ requested: plan.rankingScope || 'BSIT', allowed: scopeCollege });
    }
  }
  const match = plan.rankingField === 'specialization'
    ? resolveSpecializationRankingTarget(plan.rankingScope)
    : RANKING_FIELD_MAP[plan.rankingField];
  // A named program with NO tracked specializations at all (anything other
  // than BSIT, a BSBA-family major group, or BSIS — see
  // resolveSpecializationRankingTarget's own comment) must say so plainly,
  // not just silently fall through to the generic "I do not have enough
  // verified data" refusal — caught live: "which BSCS specialization has
  // the most employed graduates?" gave no indication WHY it couldn't
  // answer, reading as if the system were broken rather than as the honest
  // fact that BSCS genuinely has no specializations tracked. Built entirely
  // from plan.rankingScope (whatever program the question actually named,
  // copied verbatim) — never a hardcoded program name/list, so this reads
  // correctly no matter which program was asked about.
  //
  // type: 'unsupported' — streamed directly by ragService.js, bypassing LLM
  // narration entirely (same as 'clarify'/'forbidden'), since this is
  // already a complete, natural sentence, not a "metric:/value:" data line
  // for the model to narrate. Routing a "value: 0" line through the normal
  // narration path was caught live silently discarding the actual
  // explanation — see ragService.js's own comment on the 'unsupported' type
  // for the exact failure mode this avoids.
  if (plan.rankingField === 'specialization' && !match) {
    const scopeName = plan.rankingScope ? plan.rankingScope.toUpperCase() : 'That program';
    return {
      type: 'unsupported',
      description: `${scopeName} has no tracked specializations in the system, so there is nothing to rank.`,
    };
  }
  if (!match) return null;

  const direction = plan.rankingDirection === 'lowest' ? 1 : -1;

  // Any other filter the plan resolved (most commonly employmentStatus —
  // "which program has the most EMPLOYED graduates" names a real condition
  // that must scope the ranking, not just name the grouping field) is
  // applied as an additional $match — without this, "most employed
  // graduates" silently ranked by TOTAL respondent count regardless of
  // employment status, answering a different, unscoped question while
  // looking like it had honored the condition.
  const { tracerFilters, parts } = plan;

  // Rate mode ("top 3 programs by employment RATE") — each group is ranked
  // by what fraction of ITS OWN respondents match the named status, not by
  // raw headcount. A genuinely different query shape (needs each group's
  // total AND its matching count, not just one count) from the normal
  // count-ranking pipeline below, so it's handled as its own early return.
  // Requires a status filter (the rate's numerator); if the LLM set
  // rankingMode without one (shouldn't happen per RULE 2b, but not
  // trusted blindly), falls through to the normal count-based ranking
  // instead of crashing on an undefined condition.
  //
  // Also covers the graduationYear TREND shape ("how has the employment
  // RATE changed per batch year?") — queryPlanExtractor.js's own worked
  // example for this phrasing never sets rankingMode at all (only
  // rankingField/employmentStatus), so `plan.rankingMode === 'rate'` alone
  // doesn't catch it; this was caught live: the trend answer showed raw
  // employed HEADCOUNT per batch ("1 employed in 2000, ... 47 in 2022"),
  // which is misleading for something explicitly asked as a RATE — cohort
  // size varies wildly by year, so a tiny early batch's headcount of 1
  // looks negligible next to 2022's 47 even if that 1 person WAS 100% of
  // that batch and 47 is a much smaller fraction of a huge batch. Detected
  // here via the question's own "rate"/"percentage"/"%" wording (the same
  // signal RULE 7 in queryPlanExtractor.js already treats as meaning
  // employmentStatus should be set at all) rather than rankingMode, since
  // that field was never reliably set for this phrasing to begin with.
  const isTrendCandidate = match.sortByKey && !plan.rankingDirection;
  const wantsRate = plan.rankingMode === 'rate'
    || (isTrendCandidate && /\b(rate|percentage|percent|%)\b/i.test(question));
  if (wantsRate && !match.extractFromText && tracerFilters.employmentStatus) {
    const { employmentStatus: statusCond, ...otherTracerFilters } = tracerFilters;
    const dbFieldPath = match.onTracer ? match.dbField : `user.${match.userField}`;
    const valueCondition = match.onTracer
      ? { $nin: [null, ''], $not: PLACEHOLDER_VALUE_PATTERN }
      : { $nin: [null, '', ...(match.excludeValues || [])], ...(match.inValues ? { $in: match.inValues } : {}) };
    const ratePipeline = [
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $match: { [dbFieldPath]: valueCondition, ...(scopeCollege ? { 'user.college': scopeCollege } : {}), ...otherTracerFilters } },
      {
        $group: {
          _id: `$${dbFieldPath}`,
          total: { $sum: 1 },
          matched: { $sum: { $cond: [{ $regexMatch: { input: '$employmentStatus', regex: statusCond.source, options: 'i' } }, 1, 0] } },
        },
      },
      { $addFields: { rate: { $multiply: [{ $divide: ['$matched', '$total'] }, 100] } } },
      // A trend stays chronological (oldest to newest), same as the plain
      // count-based trend path below — never resorted by rate, which would
      // defeat the whole point of seeing it change OVER TIME. A genuine
      // top-N rate ranking (not a trend) sorts by rate and caps at 5, same
      // as before this trend case was added.
      isTrendCandidate ? { $sort: { _id: 1 } } : { $sort: { rate: direction } },
      { $limit: isTrendCandidate ? 50 : 5 },
    ];
    const rateResults = await TracerStudyResponse.aggregate(ratePipeline);
    if (rateResults.length === 0) return null;
    const topR = isTrendCandidate ? rateResults.reduce((a, b) => (b.rate > a.rate ? b : a), rateResults[0]) : rateResults[0];
    const dirLabelR = isTrendCandidate ? 'chronological' : (direction === -1 ? 'highest' : 'lowest');
    const rankingListR = rateResults.map((r) => `${r._id} (${r.rate.toFixed(1)}%, ${r.matched} of ${r.total})`).join(', ');
    const rateChartTitle = `${match.label[0].toUpperCase()}${match.label.slice(1)} Employment Rate`;
    // TrendLine ('line' type) was tried here for the chronological trend
    // case but looked bad in practice for this data shape — many years all
    // sitting at the same 100% ceiling with a few sparse low points reads as
    // a confusing flat smear with a wide horizontal scrollbar, not a clean
    // trend. Reverted to the same horizontal bar-list (MiniBarChart) every
    // other breakdown chart in this file uses — plain, consistent, and
    // doesn't need its own special case.
    //
    // A genuine top-N rate RANKING (not a trend — a small, fixed number of
    // named items like "top 3 programs by employment rate") reads as a
    // standing/vertical bar graph — donut was tried here first, but a rate
    // is a percentage OF each group's own population, not a share of one
    // combined whole, so the donut's own center total (summing percentages
    // across unrelated groups — "199.1") was actively misleading, not just
    // a style preference. GroupedBarChart (normally multi-series) renders a
    // clean standing bar per category when given exactly one series — reused
    // here instead of building a near-duplicate single-series vertical bar
    // component from scratch. The chronological trend case stays horizontal
    // bars (a column chart with 15+ closely-packed bars reads worse than
    // the scrollable horizontal list).
    const rateCharts = [isTrendCandidate
      ? { type: 'bars', title: rateChartTitle, rows: rateResults.map((r) => ({ label: r._id, count: Math.round(r.rate * 10) / 10 })) }
      : {
          type: 'grouped-bars',
          title: rateChartTitle,
          unit: '%',
          series: [{ name: `${match.label} employment rate` }],
          rows: rateResults.map((r) => ({ category: r._id, values: [Math.round(r.rate * 10) / 10] })),
        }];
    return {
      type: 'ranking',
      field: `${match.label} employment rate`,
      direction: dirLabelR,
      top: { value: topR._id, count: topR.matched },
      results: rateResults.map((r) => ({ value: r._id, count: r.matched, rate: Math.round(r.rate * 10) / 10, total: r.total })),
      description: `metric: ${dirLabelR} ${match.label} by employment rate | top: ${topR._id} (${topR.rate.toFixed(1)}%, ${topR.matched} of ${topR.total}) | full ranking: ${rankingListR}`,
      charts: rateCharts,
    };
  }

  // Coordinator college-scoping: for a program/specialization ranking
  // (already joined to User for match.userField), this adds one more
  // $match condition on the same join. For an industry/company/jobTitle
  // ranking (match.onTracer — no User join existed at all before), a join
  // now has to be added SPECIFICALLY for the scoped case, since those
  // fields live directly on TracerStudyResponse and were never previously
  // joined to User at all. Comparing a coordinator's own college's
  // industries/companies/job titles against each other is the same
  // "ranking still works, just narrowed" behavior confirmed for program
  // rankings — not a refusal (unlike a cross-college rankingScope, which
  // names something outside their access entirely).
  // 'specialization' ranking targets with no structured field at all (BSIS's
  // "Business Analytics" — see fieldRegistry.js's TEXT_SPECIALIZATION_PROGRAMS)
  // group on a value regex-extracted from the free-text programsCompleted
  // array at query time instead of a plain field path — a separate pipeline
  // shape because there's no literal dbField to $group on directly.
  let pipeline;
  let groupKeyExpr;
  if (match.extractFromText) {
    const joinedText = { $reduce: { input: '$programsCompleted', initialValue: '', in: { $concat: ['$$value', '; ', '$$this'] } } };
    groupKeyExpr = '$_specializationText';
    pipeline = [
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $match: { 'user.course': match.courseFilter, programsCompleted: { $elemMatch: { $regex: match.matchHint } }, ...(scopeCollege ? { 'user.college': scopeCollege } : {}), ...tracerFilters } },
      { $addFields: { _specializationMatch: { $regexFind: { input: joinedText, regex: match.textPattern.source, options: 'i' } } } },
      { $addFields: { _specializationText: { $trim: { input: { $arrayElemAt: ['$_specializationMatch.captures', 0] } } } } },
      { $match: { _specializationText: { $nin: [null, ''] } } },
      { $group: { _id: groupKeyExpr, count: { $sum: 1 } } },
    ];
  } else {
    const dbFieldPath = match.onTracer ? match.dbField : `user.${match.userField}`;
    const valueCondition = match.onTracer
      ? { $nin: [null, ''], $not: PLACEHOLDER_VALUE_PATTERN }
      : { $nin: [null, '', ...(match.excludeValues || [])], ...(match.inValues ? { $in: match.inValues } : {}) };
    const needsUserJoin = !match.onTracer || Boolean(scopeCollege);

    pipeline = needsUserJoin
      ? [
          { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: 'user' } },
          { $unwind: '$user' },
          { $match: { [dbFieldPath]: valueCondition, ...(scopeCollege ? { 'user.college': scopeCollege } : {}), ...tracerFilters } },
          { $group: { _id: `$${dbFieldPath}`, count: { $sum: 1 } } },
        ]
      : [
          { $match: { [dbFieldPath]: valueCondition, ...tracerFilters } },
          { $group: { _id: `$${dbFieldPath}`, count: { $sum: 1 } } },
        ];
  }
  // graduationYear supports TWO different questions: a bare "how has
  // employment changed per batch year" (a TREND — every year, chronological,
  // no rankingDirection named) vs "which batch year had the highest/lowest
  // employment?" (a genuine top-N ranking BY COUNT, rankingDirection IS
  // named — same as every other ranking field). `match.sortByKey` only
  // forces chronological order when no direction was actually asked for;
  // once the question names "highest"/"lowest", it behaves exactly like
  // course/industry/company ranking instead.
  const isTrend = match.sortByKey && !plan.rankingDirection;
  if (isTrend) {
    pipeline.push({ $sort: { _id: 1 } }, { $limit: 50 });
  } else {
    pipeline.push({ $sort: { count: direction } }, { $limit: 5 });
  }

  const results = await TracerStudyResponse.aggregate(pipeline);
  if (results.length === 0) return null;

  const top = isTrend ? results.reduce((a, b) => (b.count > a.count ? b : a), results[0]) : results[0];
  const dirLabel = isTrend ? 'chronological' : (direction === -1 ? 'highest' : 'lowest');
  const rankingList = results.map((r) => `${r._id} (${r.count})`).join(', ');

  // A real bar chart built from the SAME `results` rows already computed
  // above (never a second, separate query, and never numbers the LLM
  // composed) — attached ONLY when the question explicitly asked for a
  // chart/graph/visualization (CHART_REQUEST_PATTERN), matching the
  // product decision that a chart is given when asked for one, not
  // appended to every plain count/ranking answer. Same {type, title, rows}
  // shape AcChart (frontend) already renders for computeVerifiedSummary's
  // own charts — rows here are {value, count} instead of {label, count},
  // so they're remapped to match.
  // The title names what the ranking is actually scoped to (e.g. "Employed"),
  // not just the bare grouping dimension — a generic "Specialization
  // Breakdown" title on a chart whose bars are already EMPLOYED-only counts
  // (13/30/34, not the real totals of 24/47/49) looks like a complete,
  // unscoped breakdown when it silently isn't one. `parts` already holds
  // every OTHER filter the plan resolved (e.g. 'employment status
  // "Employed"') in the same natural-language form the text answer itself
  // uses — reused here rather than re-deriving a second description.
  const baseTitle = `${match.label[0].toUpperCase()}${match.label.slice(1)} Breakdown`;
  const chartTitle = parts.length ? `${baseTitle} — ${joinNatural(parts)}` : baseTitle;
  // 'line' was tried here for the chronological trend case but looked bad
  // in practice (a wide horizontal-scroll line chart reads as a confusing
  // smear rather than a clean trend for this data) — reverted to the same
  // horizontal bar-list (MiniBarChart) every other breakdown chart in this
  // file uses. A genuine top-N ranking (not a trend — "which program has
  // the most employed graduates", capped at 5 results) renders as a
  // standing/vertical bar graph (GroupedBarChart given a single series) —
  // a donut was tried first but reads worse than a simple column chart for
  // a small top-N list like this, same conclusion reached for the
  // rate-ranking branch above.
  const charts = CHART_REQUEST_PATTERN.test(question)
    ? [isTrend
        ? { type: 'bars', title: chartTitle, rows: results.map((r) => ({ label: r._id, count: r.count })) }
        : { type: 'grouped-bars', title: chartTitle, series: [{ name: match.label }], rows: results.map((r) => ({ category: r._id, values: [r.count] })) }]
    : [];

  return {
    type: 'ranking',
    field: match.label,
    direction: dirLabel,
    top: { value: top._id, count: top.count },
    results: results.map((r) => ({ value: r._id, count: r.count })),
    // `filters:` (same natural-language text the chart title and plain
    // count/percentage descriptions already use) is included here too —
    // without it, "which program has the most EMPLOYED graduates" narrated
    // from this line had no way to know the ranking was scoped to employed
    // respondents at all (the bars/numbers already reflect it, but neither
    // the description nor the chart title said so — caught live).
    description: `metric: ${dirLabel} ${match.label} by respondent count${parts.length ? ` | filters: ${joinNatural(parts)}` : ''} | top: ${top._id} (${top.count}) | full ranking: ${rankingList}`,
    charts,
  };
}

// Only name + program are surfaced here — never a field verifiedCount's own
// guardrail rules restrict (home address, civil status, religion, age), and
// this always runs alongside the chatbot's existing college-scope
// enforcement already applied to every User/TracerStudyResponse query
// elsewhere in the app (coordinators never see other colleges' names here
// either, same as any other query).
async function listNamesWithFilters(userFilters, tracerFilters, limit) {
  const userMatch = {};
  for (const key of Object.keys(userFilters)) userMatch[`user.${key}`] = userFilters[key];
  const pipeline = [
    { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { ...tracerFilters, ...userMatch } },
    { $project: { name: { $concat: ['$user.firstName', ' ', '$user.lastName'] }, course: '$user.course' } },
    { $limit: limit + 1 },
  ];
  return TracerStudyResponse.aggregate(pipeline);
}

/**
 * Returns { names, total, description } for a "who are they / list them /
 * who is X" question. A bare follow-up with no filter words of its own
 * (e.g. "who are they?") reuses the FILTERS FROM THE PREVIOUS USER TURN
 * (previousUserQuestion) instead of guessing a new scope — this is the only
 * place conversation history feeds into a verified query. Returns null if
 * neither the current nor the previous question yields any filter (never
 * list the entire alumni roster unscoped), or if nothing matches.
 */
// Exported separately so ragService.js can hard-refuse a names-shaped
// question that computeVerifiedNames couldn't resolve, instead of letting
// it fall through to RAG/LLM narration — a specific list of real people's
// names is exactly the kind of enumerable, checkable output an 8B model
// will fabricate a plausible-looking version of if simply asked nicely not
// to (see CLAUDE.md: "don't rely solely on prompt rules for a small model
// to reliably preserve a specific fact"). Listing names is deterministic or
// it doesn't happen at all.
function isNamesQuestion(question) {
  return NAMES_QUESTION_PATTERN.test(question) || SHOW_ALL_PATTERN.test(question) || SHOW_N_PATTERN.test(question) || /\bwho\b/i.test(question) || /\bsino\b/i.test(question);
}

// Exported narrowly for ragService.js's own isAlumniDomain check — see its
// comment for why it needs this SPECIFIC (not the broader isNamesQuestion)
// pattern to decide when a previous turn's domain relevance can be trusted.
function isAnaphoricNamesFollowUp(question) {
  return NAMES_QUESTION_PATTERN.test(question);
}

async function computeVerifiedNames(question, previousUserQuestion, providedPlan, scopeCollege) {
  // A bare "yes"/"oo"/"sige" only counts as a names-continuation when the
  // PREVIOUS user turn was itself a names question — grounding the
  // otherwise-ambiguous bare affirmative to specifically mean "yes, to your
  // names offer" rather than a stray "yes" answering some unrelated bot
  // question. Caught live: "yes" alone (replying to the bot's own "see all,
  // or a specific number?" offer) matched neither NAMES_QUESTION_PATTERN
  // nor SHOW_ALL_PATTERN (no "all"/"more"/digit in it at all) and fell
  // through to ragService.js's generic off-topic decline.
  const trimmedQuestion = question.trim();
  const bareAffirmativeContinuation = BARE_AFFIRMATIVE_PATTERN.test(trimmedQuestion)
    && Boolean(previousUserQuestion) && isNamesQuestion(previousUserQuestion);

  if (!isNamesQuestion(question) && !bareAffirmativeContinuation) return null;

  // How many names THIS turn is asking for — a reply to the bot's own
  // "see all, or a specific number?" offer (see chatbotGuardrails.js rule
  // 25) names either "all" (capped at MAX_NAMES_SHOW_ALL) or an explicit
  // number ("show 30"); a bare affirmative defaults to "all" (the first
  // option offered); anything else keeps the normal default cap.
  const showNMatch = question.match(SHOW_N_PATTERN);
  let limit = MAX_NAMES_LISTED;
  if (showNMatch) limit = Math.min(parseInt(showNMatch[1], 10), MAX_NAMES_SHOW_ALL);
  else if (SHOW_ALL_PATTERN.test(question) || bareAffirmativeContinuation) limit = MAX_NAMES_SHOW_ALL;

  // A pure "show all"/"show N" reply (SHOW_ALL_PATTERN/showNMatch) carries
  // NO filter content of its own to extract at all — it's structurally a
  // reply to the bot's own prior offer, not a new question. Skip asking the
  // LLM to find filters in it and go straight to the previous turn's scope:
  // caught live, sending "yes, I want to see them all" alone (no
  // conversation context reaches the extractor — see
  // services/queryPlanExtractor.js, it only ever receives the raw question
  // text) to the 8B extractor produced a confident but entirely FABRICATED
  // plan (`course: "BSIT"` plus an invented "years in job" unsupported
  // condition) with zero textual basis — exactly the hallucination risk a
  // near-empty, context-free input invites. A question that still carries
  // its own real content (e.g. "who are the BSCS alumni that are
  // unemployed") is NOT treated as continuation-only here, so it still gets
  // extracted normally.
  const isContinuationOnly = Boolean(showNMatch) || SHOW_ALL_PATTERN.test(question) || bareAffirmativeContinuation;
  let plan;
  let scopeSource;
  if (isContinuationOnly && previousUserQuestion) {
    plan = await getPlan(previousUserQuestion, undefined, scopeCollege);
    scopeSource = previousUserQuestion;
  } else {
    // providedPlan (see this function's own PERFORMANCE comment, mirrored
    // from computeVerifiedStat) is only usable here for THIS question's own
    // text — the continuation branch above and the previousUserQuestion
    // fallback below both need a plan for DIFFERENT text, so those still
    // call getPlan() fresh.
    plan = await getPlan(question, providedPlan, scopeCollege);
    scopeSource = question;
    // Only reuse the PREVIOUS turn's scope when this turn's own phrasing is
    // genuinely anaphoric (NAMES_QUESTION_PATTERN — "who are THEY", "sino
    // SILA", "list THEM", etc., deliberately narrowed to exclude generic
    // "sino ang ___?"/"who is ___?" — see that pattern's own comment). The
    // broader isNamesQuestion() gate that got this function called at all
    // also matches a bare "who"/"sino" ANYWHERE in a sentence, including a
    // brand-new, unrelated question that simply happens to contain that
    // word — reusing stale scope for THAT case answers a completely
    // different question than the one actually asked. Caught live: "sino
    // ang president ng Fliptop?" (fully off-topic, no relation to the
    // conversation at all) matched the broad gate, found zero filters of
    // its own (correctly — it has none), and would otherwise have silently
    // reused an earlier, unrelated "CCS alumni employed in IT" scope.
    if (plan.parts.length === 0 && previousUserQuestion && NAMES_QUESTION_PATTERN.test(question)) {
      plan = await getPlan(previousUserQuestion, undefined, scopeCollege);
      scopeSource = previousUserQuestion;
    }
    // This function's own entry gate (isNamesQuestion, at the top) is
    // DELIBERATELY broad — it includes a bare `/\bwho\b/i`/`/\bsino\b/i`
    // match so genuine names questions phrased without the narrower
    // NAMES_QUESTION_PATTERN wording still reach here. But that same
    // broadness means a question where "who" is just a relative pronoun
    // ("BSIT alumni WHO are exactly 24 years old", not an actual names
    // request) also reaches here — and this function has no OTHER check
    // stopping it from happily listing names anyway once real filters
    // happen to resolve. Caught live: "How many male BSIT alumni earning
    // over 25k who are exactly 24 years old are employed?" correctly
    // extracted intent "count" (gender+course+employmentStatus all
    // resolved), but still got answered as a 3-name list instead of the
    // real count, because this function never once checked what the
    // ACTUAL resolved intent was. Only applies to THIS branch (the
    // question's own fresh extraction, not a continuation/anaphoric reuse
    // of a previous turn's plan above) — a genuine "who are they?" follow-
    // up legitimately reuses a PREVIOUS plan whose own intent was never
    // "names" either (it was "count", from the original count question),
    // so gating on plan.intent there would incorrectly break that case. The
    // narrow NAMES_QUESTION_PATTERN ("who are THEY", "list them", "sino
    // SILA", ...) is excluded from this check since THAT'S the actual,
    // unambiguous names signal — only a bare, generic "who"/"sino" match
    // with a non-"names" resolved intent gets deferred here.
    if (plan.intent && plan.intent !== 'names' && !NAMES_QUESTION_PATTERN.test(question)) {
      return null;
    }
  }
  const { userFilters, tracerFilters, parts, unresolvedField, unresolvedScope, unsupportedConditions, ambiguousField, forbiddenScope } = plan;
  if (forbiddenScope) return forbiddenScopeClarify(forbiddenScope);
  if (ambiguousField) return ambiguousFieldClarify(ambiguousField);
  // A clean natural-language clause (distinct from unsupportedConditionsNote
  // below, which is built for the internal "metric: ... | note: ..." format,
  // not a standalone sentence) — computed once, up front, so the
  // unresolvedScope/unresolvedField refusal branches can ALSO disclose an
  // unsupported condition when BOTH are present at once. Caught live: "List
  // the employed CCS alumni who are civil servants by marital status" named
  // an unresolvable job title ("Civil Servant") AND an untracked condition
  // ("marital status") at the same time — the refusal only ever mentioned
  // the job title, silently dropping the fact that "marital status" was
  // ALSO never going to be answerable even if the job title had resolved.
  const alsoUnsupportedClause = unsupportedConditions.length > 0
    ? ` Also, this system does not track ${joinNatural(unsupportedConditions)}, so that part of the question could not be answered either.`
    : '';
  // Same "named-but-unmatched scope must never be silently dropped"
  // discipline computeVerifiedCount/Percentage already enforce — this
  // function was missing it entirely. Caught live: "employment rate for
  // BSBA alumni..." ("BSBA" bare, not a real course — real values are
  // "BSBA-FM"/"BSBA-MM"/"BSBA-BE") correctly refused via
  // computeVerifiedPercentage's own unresolvedScope check, but the
  // PARALLEL computeVerifiedNames call (ragService.js always runs both)
  // had no such check, silently dropped the invalid course filter, and
  // listed every locally-employed alumnus system-wide — not scoped to
  // BSBA at all. ragService.js's own `statResult || namesResult` fallback
  // then surfaced this wrong, unscoped list instead of the correct refusal
  // the moment the percentage path (correctly) returned null.
  // type: 'unsupported' (streamed directly by ragService.js, bypassing LLM
  // narration — same pattern/reasoning as computeVerifiedRanking's own
  // 'unsupported' case) rather than the normal type:'names' shape. Caught
  // live: a type:'names' description ending "| names: none (0 matches)"
  // was narrated by namesFormatInstruction's own "list each name in the
  // 'names:' segment as its own bullet" rule, which — having no example or
  // guidance for a GENUINELY EMPTY names segment — dutifully bulleted the
  // literal placeholder text "none (0 matches)" as if it were itself a
  // person's name: "The matching alumni are: - none (0 matches)". A fully
  // pre-written, natural sentence sidesteps the whole class of bug, the
  // same way it already does for computeVerifiedRanking's analogous case.
  if (unresolvedScope) {
    return { type: 'unsupported', description: `${unresolvedScopeMessage(unresolvedScope)}, so no alumni can be matched.${alsoUnsupportedClause}` };
  }
  if (parts.length === 0) return null;
  // Same "answer with the valid filters, disclose the rest" principle as
  // computeVerifiedCount/computeVerifiedPercentage — a names question
  // naming both a real filter and an unsupported condition still lists
  // whoever matches the real filter(s), with the gap disclosed rather than
  // refusing to list anyone at all.
  const unsupportedNote = unsupportedConditionsNote(unsupportedConditions);

  // A named-but-unmatched job title/industry/company means zero people can
  // possibly match — same reasoning as computeVerifiedCount's own guard.
  // Return that as a real, verified empty result rather than silently
  // listing names that ignore the criterion the question actually asked for.
  if (unresolvedField) {
    // Same 'unsupported' bypass as the unresolvedScope branch above, same
    // reason — a type:'names' description ending "names: none (0 matches)"
    // was narrated as a literal bulleted "name".
    return { type: 'unsupported', description: `No alumni can be matched: ${unresolvedFieldDescription(unresolvedField)}.${alsoUnsupportedClause}` };
  }

  const rows = await listNamesWithFilters(userFilters, tracerFilters, limit);
  if (rows.length === 0) return null;

  const truncated = rows.length > limit;
  const shown = truncated ? rows.slice(0, limit) : rows;
  const nameList = shown.map((r) => r.name).join(', ');

  return {
    type: 'names',
    total: rows.length === limit + 1 ? `${limit}+` : rows.length,
    // Exposed so ragService.js can deterministically decide whether to
    // append the "would you like to see all of them, or a specific
    // number?" follow-up — see that file's own comment on why this isn't
    // left to the narration LLM to decide.
    truncated,
    names: shown.map((r) => r.name),
    description: `metric: matching alumni names | filters: ${joinNatural(parts)} (scope reused from: "${scopeSource}") | count shown: ${shown.length}${truncated ? ` of more than ${limit}` : ''}${unsupportedNote} | names: ${nameList}`,
  };
}

/**
 * Returns a data-line description of the same KPIs the Admin Dashboard's
 * "Tracer Study Analytics" header tiles show, for a broad "give me a
 * summary/overview" request. Deliberately calls employmentController.js's
 * own computeTracerAnalytics() rather than re-deriving these numbers here —
 * see this file's top comment on the repeated cost of two surfaces computing
 * "the same" figure independently and silently disagreeing. Optionally
 * scoped to one program/college if the plan names one; otherwise covers
 * every college, matching the Dashboard's own all-colleges default view.
 * Never returns null due to "no data" — an all-zero summary is still a
 * valid, real summary; only returns null when the plan's intent isn't
 * "summary" at all.
 *
 * A bare "give me a summary" names no specific topic (plan.summaryTopics is
 * empty) and gets every section below (back-compat with the Dashboard's own
 * all-sections overview). When the question DOES name a specific topic
 * (e.g. "summary for BSIT Employment"), only that topic's section(s) are
 * included — answering every topic regardless of what was actually asked
 * is the same bug class as unresolvedScope: silently ignoring a stated
 * scope. Work location and top industries are grouped under "employment"
 * since both describe the job itself, not a separate topic.
 */
async function computeVerifiedSummary(question, providedPlan, scopeCollege) {
  const plan = await getPlan(question, providedPlan, scopeCollege);
  if (plan.intent !== 'summary') return null;

  if (plan.forbiddenScope) return forbiddenScopeClarify(plan.forbiddenScope);

  const course = plan.userFilters.course || null;
  const college = plan.userFilters.college || null;

  const wantsEmployment = plan.summaryTopics.includes('employment');
  const wantsFurtherEducation = plan.summaryTopics.includes('furtherEducation');
  const wantsOther = plan.summaryTopics.includes('other');
  const anyTopicNamed = plan.summaryTopics.length > 0;
  const includeEmployment = !anyTopicNamed || wantsEmployment;
  const includeFurtherEducation = !anyTopicNamed || wantsFurtherEducation;
  const includeOther = !anyTopicNamed || wantsOther;

  // The question clearly named a scope (course or college) but it didn't
  // resolve to any real college or course — refuse rather than silently
  // run unscoped.
  if (plan.unresolvedScope) {
    return {
      type: 'summary',
      kpis: null,
      description: `${unresolvedScopeMessage(plan.unresolvedScope)}.`,
      charts: [],
    };
  }

  // Required here (not at top-level) to avoid a circular require — this
  // util has no other dependency on the controllers layer, and
  // employmentController.js never requires anything from utils/.
  const { computeTracerAnalytics } = require('../controllers/employmentController');
  const analyticsQuery = {};
  if (course) analyticsQuery.course = course;
  if (college) analyticsQuery.college = college;
  const { kpis, employmentOverview, occupationIndustry } = await computeTracerAnalytics(analyticsQuery);

  // A real, verified zero — not a fallback/error — but rendering the full
  // section-by-section layout below for it produces a confusing wall of
  // "0 (0%)" lines that reads like something broke, rather than a clear
  // answer. State it as one direct sentence instead, with no charts (an
  // empty donut/bar chart has nothing to render here either).
  if (kpis.totalTracerRespondents === 0) {
    // Built from plan.parts' own display text, not the raw course/college
    // values directly — course is no longer always a plain string (see
    // resolveCourseCollege's own comment on bare program-family names like
    // "BSBA" resolving to a $in array across their majors).
    const scopeParts = plan.parts.filter((p) => p.startsWith('program "') || p.startsWith('college "'));
    const scope = scopeParts.length ? `${scopeParts.map(scopePartName).join(' / ')} alumni` : 'the system';
    return {
      type: 'summary',
      kpis,
      description: `There are no tracer survey responses recorded yet for ${scope}.`,
      charts: [],
    };
  }

  // Work location (local/abroad) isn't one of computeTracerAnalytics's own
  // facets, so it's queried separately here. placeOfWork is free text, not
  // a clean enum — alongside the real "Local (within your home country)" /
  // "Abroad (outside your home country)" choice-field answers, older
  // responses (or a since-edited form version) left literal city names
  // ("Tarlac City", "Makati City") in this field instead. Bucketing by
  // regex prefix on the two real choice-field answers (also tolerating the
  // one "Abroad (outside your home country" row missing its closing
  // parenthesis — a real data-entry glitch found live) correctly counts
  // only genuine Local/Abroad answers; anything else (blank or a literal
  // city name) is neither, and is reported as its own bucket rather than
  // silently folded into one of the other two.
  // placeOfWork (TracerFormConfig: "Where is your current place of work?")
  // is only ever ASKED of respondents who answered "Yes" to employment
  // status (showIf: employmentStatus === "Yes" — see the form config) — an
  // unemployed respondent has no answer here at all. Scoping this count to
  // employed respondents only makes the percentage base the people who
  // could possibly have answered, instead of silently diluting it against
  // the full respondent pool (which includes unemployed alumni who were
  // never shown this question).
  const workLocationPipeline = [
    { $match: { employmentStatus: { $regex: /^yes$|^self[- ]?employed$/i } } },
  ];
  if (course || college) {
    const userMatch = {};
    if (course) userMatch['user.course'] = course;
    if (college) userMatch['user.college'] = college;
    workLocationPipeline.push(
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $match: userMatch },
    );
  }
  workLocationPipeline.push({
    $group: {
      _id: null,
      local:  { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$placeOfWork', ''] }, regex: /^local/i } }, 1, 0] } },
      abroad: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$placeOfWork', ''] }, regex: /^abroad/i } }, 1, 0] } },
      total:  { $sum: 1 },
    },
  });
  const [workLocationResult] = await TracerStudyResponse.aggregate(workLocationPipeline);
  const local  = workLocationResult?.local  || 0;
  const abroad = workLocationResult?.abroad || 0;
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  // Denominator is employed respondents specifically (who this question was
  // actually shown to), not workLocationResult.total — that would still
  // include employed respondents who left this optional-in-practice
  // question blank or answered with a legacy free-text value (a city name)
  // instead of the current Local/Abroad choice field.
  const respondentTotal = kpis.employedRespondents || 0;

  const topIndustries = (occupationIndustry?.byIndustry || []).slice(0, 3);
  // Same parts-derived display text as the empty-result branch above.
  const scopeParts = plan.parts.filter((p) => p.startsWith('program "') || p.startsWith('college "'));
  const scope = scopeParts.length ? `${scopeParts.map(scopePartName).join(' / ')} alumni` : 'all colleges';

  // Same two charts the Admin Dashboard itself renders for this data
  // (employment status breakdown, top industries) — attached so the
  // chatbot's summary answer shows a real chart alongside the text, not
  // just numbers in a sentence. AcChart (frontend) renders a donut by
  // default when no `type` is given, and a true bar chart for `type:
  // 'bars'` — see frontend/src/pages/admin/AiAssistantView.jsx. Order here
  // MUST match the {{chart:N}} anchor indices used in `description` below.
  // Gated on includeEmployment — a question scoped to "further education"
  // or "professional development/awards" only has no business showing the
  // employment donut/bar charts at all.
  const charts = [];
  if (includeEmployment && employmentOverview?.byStatus?.length) {
    charts.push({ title: 'Employment Status', rows: employmentOverview.byStatus });
  }
  if (includeEmployment && occupationIndustry?.byIndustry?.length) {
    charts.push({ type: 'bars', title: 'Top Industries', rows: occupationIndustry.byIndustry.slice(0, 5) });
  }

  // Composed as already-formatted markdown (headings/bullets/a numbered
  // list), not a plain paragraph — live-tested directly against the LLM
  // with the plain-paragraph version of this content and it STILL answered
  // "I do not have enough verified data" even at temperature 0, despite the
  // real data being right there (see the conversation that led to this
  // comment for the raw output). A multi-metric summary is too much for an
  // 8B model to reliably narrate at all, so ragService.js checks
  // `verifiedStat.type === 'summary'` and streams this text DIRECTLY,
  // bypassing the LLM entirely for this one type. `{{chart:N}}` is this
  // frontend's own existing anchor syntax (see parseAssistantBlocks /
  // stripChartAnchors in AiAssistantView.jsx) for placing a chart from the
  // `charts` array inline at an exact point in the text, rather than always
  // trailing after it.
  const statusLines = (employmentOverview?.byStatus || [])
    .map((s) => `- ${s.label}: ${s.count} (${pct(s.count, kpis.totalTracerRespondents)}%)`)
    .join('\n');
  const industryLines = topIndustries
    .map((i, idx) => `${idx + 1}. ${i.label}: ${i.count}`)
    .join('\n');
  let chartCursor = 0;
  const chartIdx = {
    status: includeEmployment && employmentOverview?.byStatus?.length ? chartCursor++ : -1,
    industries: includeEmployment && topIndustries.length ? chartCursor++ : -1,
  };

  // Each section below is gated on its own includeX flag — a question
  // scoped to one topic (e.g. "...Employment") now shows only that topic's
  // section(s) instead of the full dump every summary used to return
  // regardless of what was actually asked. A bare "give me a summary" has
  // every includeX flag true (anyTopicNamed is false), so it keeps getting
  // the full overview exactly as before.
  const description = [
    `## Tracer Study Overview with ${kpis.totalTracerRespondents} Respondents (${scope})`,
    '',
    includeEmployment ? `#### Employment Status` : '',
    includeEmployment ? statusLines : '',
    '',
    includeEmployment ? `Overall employment rate: ${kpis.employmentRate}% (including self-employed)` : '',
    '',
    chartIdx.status >= 0 ? `{{chart:${chartIdx.status}}}` : '',
    '',
    includeEmployment && industryLines ? `#### Top Industries` : '',
    includeEmployment ? industryLines : '',
    '',
    chartIdx.industries >= 0 ? `{{chart:${chartIdx.industries}}}` : '',
    '',
    includeEmployment ? `#### Work Location` : '',
    includeEmployment ? `- Local (within home country): ${local} (${pct(local, respondentTotal)}%)` : '',
    includeEmployment ? `- Abroad (outside home country): ${abroad} (${pct(abroad, respondentTotal)}%)` : '',
    '',
    includeFurtherEducation ? `#### Further Education` : '',
    includeFurtherEducation ? `${kpis.furtherEducationCount} pursued further studies (${pct(kpis.furtherEducationCount, kpis.totalTracerRespondents)}%)` : '',
    '',
    includeOther ? `#### Other` : '',
    includeOther ? `${kpis.professionalDevelopmentCount} pursued professional development activities, and ${kpis.awardsCount} reported an award or recognition.` : '',
  ].filter((line) => line !== '').join('\n');

  return { type: 'summary', kpis, description, charts };
}

/**
 * Extracts ONE structured query plan for `question` (a single LLM call,
 * unless `providedPlan` is already given — see PERFORMANCE note below),
 * then routes to whichever compute* function matches the plan's intent,
 * passing the already-extracted plan along so that function doesn't
 * extract a second one. Returns null if the plan's intent is "none" or
 * doesn't resolve to a usable result — caller falls back to normal
 * RAG/refusal path. Names-listing is NOT included here (see
 * computeVerifiedNames) since it needs the previous turn's question as a
 * second argument — called separately by ragService.js.
 *
 * PERFORMANCE: ragService.js calls this AND computeVerifiedNames in
 * parallel for every question (it doesn't know in advance which one will
 * actually resolve). Before `providedPlan` existed, each one independently
 * called getPlan(question) — for any question matching isNamesQuestion
 * (i.e. containing "who"/"sino" anywhere), that meant TWO separate LLM
 * extraction calls fired for the exact same question text every time, one
 * of which was ALWAYS wasted (computeVerifiedStat's switch has no 'names'
 * case, so that extraction's result was discarded no matter what). Passing
 * one shared `providedPlan` from ragService.js (which extracts it once up
 * front) cuts this specific case down to a single extraction call.
 */
// "What is Juan Dela Cruz's employment status?" — a lookup of ONE specific
// real alumnus by name, a fundamentally different query shape from every
// other function in this file (those all filter/aggregate a POPULATION;
// this finds one real account). Not a generic field resolver — reads
// plan.personName directly (see fieldRegistry.js's own comment on why).
//
// 2+ name matches are NEVER narrowed to "just pick one" — returned as a
// 'clarify' type (same reliability reasoning as ambiguousFieldClarify
// elsewhere: streamed directly by ragService.js, bypassing LLM narration,
// so there is no risk of the model confidently picking/inventing the wrong
// person's data). Coordinator scoping reuses the exact same mechanism
// every other lookup in this file already relies on — restricting the
// CANDIDATE POOL itself to the coordinator's own college, not a separate
// forbidden-scope check — so a coordinator asking about a real person from
// a DIFFERENT college gets an honest "no alumni record found" (same
// behavior already verified live for a cross-college custom-question
// lookup), never another college's real data.
async function computeVerifiedPersonLookup(plan, scopeCollege) {
  if (!plan.personName) return null;

  const words = plan.personName.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const nameRegexes = words.map((w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  const userMatch = { role: 'alumni' };
  if (scopeCollege) userMatch.college = scopeCollege;
  const candidates = await User.find(userMatch).select('firstName lastName middleInitial course college graduationYear').lean();
  const matches = candidates.filter((u) => {
    const fullName = `${u.firstName || ''} ${u.middleInitial || ''} ${u.lastName || ''}`.replace(/\s+/g, ' ').trim();
    return nameRegexes.every((re) => re.test(fullName));
  });

  if (matches.length === 0) {
    return { type: 'count', count: 0, description: `metric: alumni profile lookup | no alumni record found matching the name "${plan.personName}" | value: 0` };
  }

  if (matches.length > 1) {
    const list = matches
      .map((u) => `${u.firstName} ${u.lastName} (${u.course || u.college || 'unknown program'}, batch ${u.graduationYear || 'unknown'})`)
      .join('; ');
    return {
      type: 'clarify',
      description: `Multiple alumni match "${plan.personName}": ${list}. Could you specify which one (program and/or batch year)?`,
    };
  }

  const person = matches[0];
  const tracerResp = await TracerStudyResponse.findOne({ alumni_id: person._id }).lean();
  if (!tracerResp) {
    return { type: 'count', count: 0, description: `metric: alumni profile lookup | ${person.firstName} ${person.lastName} has no tracer survey response on file | value: 0` };
  }

  // A compact profile line, not the full raw document — same "only the
  // fields that matter to a tracer-study question" discipline every other
  // description in this file already follows, never the entire DB record.
  const profileParts = [
    `name: ${person.firstName} ${person.lastName}`,
    `program: ${person.course || 'unknown'}`,
    `batch: ${person.graduationYear || 'unknown'}`,
    `employment status: ${tracerResp.employmentStatus || 'unknown'}`,
    tracerResp.occupationTitle ? `job title: ${tracerResp.occupationTitle}` : null,
    tracerResp.companyName ? `company: ${tracerResp.companyName}` : null,
    tracerResp.industryField ? `industry: ${tracerResp.industryField}` : null,
    tracerResp.placeOfWork ? `work location: ${tracerResp.placeOfWork}` : null,
    tracerResp.presentEmploymentType ? `employment type: ${tracerResp.presentEmploymentType}` : null,
  ].filter(Boolean).join(' | ');

  return { type: 'count', count: 1, description: `metric: alumni profile lookup | ${profileParts}` };
}

async function computeVerifiedStat(question, providedPlan, scopeCollege) {
  const plan = await getPlan(question, providedPlan, scopeCollege);
  // Checked ahead of EVERYTHING else, including compareScope — a question
  // naming one specific real person is unambiguous about what it wants
  // regardless of whatever intent/comparison/crosstab shape the rest of the
  // text might also superficially resemble.
  if (plan.personName) {
    const personResult = await computeVerifiedPersonLookup(plan, scopeCollege);
    if (personResult) return personResult;
  }
  // Checked ahead of the intent switch — see computeComparison's own
  // comment on why a "vs"/"compared to" question can't rely on the LLM's
  // intent classification (count vs percentage) landing consistently.
  // compareScope is checked FIRST, ahead of even skillCompare/comparison —
  // caught live: "What percentage of BSIT vs BSCS alumni are employed?"
  // extracted intent:"percentage" (not "ranking") WITH compareScope
  // correctly set to ["BSIT","BSCS"], but since compareScope used to only
  // be read inside computeVerifiedRanking (reachable only via the intent
  // switch below), it was silently never checked — the question instead
  // fell through to the generic employmentStatus comparisonField engine
  // (which also matched, since "vs" plus "employed" both appear in the
  // text) and answered with a completely unscoped system-wide employed-
  // vs-unemployed breakdown, with zero connection to BSIT or BSCS at all.
  // A plausible-looking but entirely wrong answer to a different question
  // — exactly the failure mode this project's own guardrails exist to
  // prevent. compareScope names two SPECIFIC entities the question is
  // unambiguously about, so it must win over every more-generic comparison
  // path regardless of which intent the LLM happened to classify this as.
  if (plan.compareScope) {
    const compareResult = await computeVerifiedCompareScope(plan, scopeCollege, question);
    if (compareResult) return compareResult;
  }
  const skillCompare = await computeSkillCompare(plan, question);
  if (skillCompare) return skillCompare;
  const crossBoolean = await computeCrossBooleanComparison(plan);
  if (crossBoolean) return crossBoolean;
  const comparison = await computeComparison(plan, question);
  if (comparison) return comparison;
  const crosstab = await computeVerifiedCrossTab(plan, question);
  if (crosstab) return crosstab;
  const correlation = await computeVerifiedCorrelation(plan, question);
  if (correlation) return correlation;
  const unemploymentReasons = await computeUnemploymentReasons(plan, question);
  if (unemploymentReasons) return unemploymentReasons;
  switch (plan.intent) {
    case 'count': return computeVerifiedCount(question, plan);
    case 'percentage': return computeVerifiedPercentage(question, plan);
    case 'ranking': return computeVerifiedRanking(question, plan, scopeCollege);
    case 'summary': return computeVerifiedSummary(question, plan);
    default: return null;
  }
}

module.exports = { computeVerifiedCount, computeVerifiedPercentage, computeVerifiedRanking, computeVerifiedNames, computeVerifiedSummary, computeVerifiedStat, getPlan, isNamesQuestion, isAnaphoricNamesFollowUp, isNamesContinuationOnly, detectUnsupportedConditions };
