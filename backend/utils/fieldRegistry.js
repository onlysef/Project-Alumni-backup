// Single declarative source of truth for every filterable/rankable field
// the chatbot's query-plan extraction (services/queryPlanExtractor.js)
// and validation (utils/queryPlanValidator.js) know about. Before this
// file existed, each field required a hand-written block in THREE places
// (the extractor's JSON schema + rule text, the validator's resolution
// logic, and — for rankable fields — a RANKING_FIELD_MAP entry in
// verifiedCount.js) copy-pasted with small variations each time a new
// field came up. Adding a field now means adding ONE entry here; the
// extractor's JSON schema/rule text, the validator's resolution loop, and
// ranking all read from this registry instead of their own hand-maintained
// copies.
//
// IMPORTANT — this does NOT mean "let the LLM decide how to query the
// database." That directly contradicts this project's central, repeatedly
// relearned rule (verifiedCount.js's own top comment, CLAUDE.md): an LLM
// cannot be trusted to invent field mappings or produce the final number.
// Every entry below still goes through a VALIDATION step (an
// enum-synonym/catalog-match/etc. resolver) that checks the LLM's proposed
// value against something real (a fixed value set, a live DISTINCT list, an
// official catalog) before it is ever used in a query — this registry
// generalizes the MECHANICAL plumbing (schema shape, resolution loop,
// ranking dispatch), not the trust model.
//
// Two fields have genuinely irreducible, bespoke logic that cannot be
// collapsed into one of the generic `type`s without losing correctness —
// `yearsInJob` (bucket-union approximation math) and `course`/`college`
// (scope precedence + a deterministic regex backstop for LLM extraction
// misses) — these use `type: 'custom'` with their own resolver function,
// still *registered* generically (the rest of the system doesn't need to
// special-case them) but internally bespoke because the underlying data
// genuinely is irregular, not as a design shortcut.

const { COLLEGE_CODES, COLLEGE_NAMES, ALL_COURSES, COURSE_TO_COLLEGE } = require('./collegesCourses');

// ---------------------------------------------------------------------
// Shared helpers (used by multiple resolvers)
// ---------------------------------------------------------------------

function exactMatch(value, catalog) {
  if (!value || typeof value !== 'string') return null;
  const valueLower = value.trim().toLowerCase();
  if (!valueLower) return null;
  return catalog.find((c) => c.toLowerCase() === valueLower) || null;
}

// Catalog-match fields (jobTitle, industryField, companyName, employmentType,
// trainingType, ...) have no fixed `values` enum, unlike enum-synonym/
// boolean-yesno fields — so they never qualified for the "vs" comparison
// backstop loop in queryPlanValidator.js, which only recognizes a field as
// comparable when it has a static `values` map to iterate over. Caught
// live: "How many are Regular/Permanent vs Contractual employees?" only
// ever answered for ONE side (whichever the LLM happened to extract into
// the plain employmentType filter) — "Contractual" was silently dropped
// entirely, with no indication a comparison was even attempted. A direct
// "X vs Y" naming two REAL catalog values doesn't need a static enum
// though — it just needs to find which of the field's own LIVE catalog
// values (cache[entry.catalogKey], the same DISTINCT list resolveCatalogMatch
// already checks against) are literally named in the question text. Two or
// more matches means this question is genuinely comparing those named
// catalog values against each other; fewer than two means it's just a
// normal single-value catalog-match question, not a comparison.
function findCatalogComparisonValues(entry, question, cache) {
  if (!entry || entry.type !== 'catalog-match' || !question) return null;
  const catalog = (cache && cache[entry.catalogKey]) || [];
  const found = catalog.filter((value) => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(question);
  });
  return found.length >= 2 ? found : null;
}

// Respondents sometimes type a placeholder instead of leaving a free-text
// field blank ("N/A" confirmed live in occupationTitle/companyName/etc.) —
// a literal "N/A" is not null/empty-string so a plain $nin:[null,''] lets
// it through as if it were a real value. Excluded from every catalog-match
// field's live DISTINCT cache so "N/A"/"None"/etc. is never treated as a
// real, nameable value anywhere in the system.
const PLACEHOLDER_VALUE_PATTERN = /^(n\/?a|none|na|n\.a\.?|-|\.|tbd|not applicable)$/i;

// A "X vs Y"/"X compared to Y" question asks for a full breakdown across a
// field's values in one breath, not a single filtered count — shared by
// queryPlanValidator.js (to tag which registry field the comparison is
// about) and verifiedCount.js (to compute it). Single source of truth so
// both files agree on what counts as a comparison phrasing — see
// verifiedCount.js's computeComparison for why this can't rely on the LLM's
// own intent classification (count vs percentage observed to flip between
// runs of the identical question).
// "compare(d)?" alone (not just followed by "to"/"with") also counts —
// caught live: "Compare 2022, 2023, and 2024 batch sizes" never matched
// this pattern at all, since it names a LIST right after "compare" instead
// of "compare X to/with Y". Safe to broaden: every comparison-field
// detector downstream still requires finding 2+ REAL matching values
// before actually treating the question as a comparison (findCatalogComparisonValues,
// findYearComparisonValues, etc.) — a bare "compare" that turns out to
// name nothing comparable just falls through to normal handling, same as
// today, so this can't introduce a false-positive comparison answer, only
// enable ones that were previously silently ignored.
const COMPARISON_PATTERN = /\b(vs\.?|versus|compare[sd]?)\b/i;

// A bare, impersonal "what's the current employment status (of alumni)?" —
// one of the chatbot's own default quick-prompt chips — names no "vs"/
// "compare" wording so it never matched COMPARISON_PATTERN above, and has no
// other field vocabulary to extract either, so it fell all the way through
// with intent "none" and zero filters straight to unverified LLM/RAG
// narration, which fabricated specific headcounts out of thin air (caught
// live: "8 alumni, 4 employed, 4 unemployed" narrated for a college whose
// real total was 262). This is the SAME full employmentStatus breakdown
// "employed vs unemployed" already produces deterministically — just
// phrased as a direct question instead of a comparison. Deliberately narrow
// (requires "current", requires "what('s| is) the") so it can never fire
// for a specific-person question ("What is Juan's employment status?" has
// no "the current" in it) — see queryPlanValidator.js's own gating
// (parts.length === 0, no other field resolved) for the second layer of
// protection against overriding a real, filtered question.
const BARE_STATUS_BREAKDOWN_PATTERN = /\bwhat(?:'s|\s+is)\s+the\s+current\s+employment\s+status\b/i;

// A "X breakdown by Y"/"X per Y" question asks for a 2D cross-tab (every
// value of X crossed with every value of Y), not a single field's
// breakdown — e.g. "employment status by gender". Deliberately narrow
// (requires "by"/"per" AND two distinct comparable fields' own backstop
// vocabulary both present — see queryPlanValidator.js's own comment) so an
// unrelated question that happens to contain the common word "by"/"per"
// doesn't get misread as a cross-tab request.
const CROSSTAB_PATTERN = /\b(by|per)\b/i;

// Correlation-style question ("do alumni with Excellent technical skills
// get employed more?", "does gender affect employment?", "is there a
// correlation between further education and employment?") — answered as a
// genuine insight (employment RATE within each group of the other named
// field), not a raw correlation coefficient/p-value — see
// computeVerifiedCorrelation's own top comment in verifiedCount.js for why
// that scope was deliberately chosen over real statistical correlation.
const CORRELATION_PATTERN = /\b(correlat\w*|more likely|less likely|affects?|impact\w*|influenc\w*|associated with|get employed more|employed more often)\b/i;

// Conditions this schema genuinely cannot filter on at all, no matter how
// the LLM extraction resolves everything else — a deterministic backstop,
// not a replacement for the LLM's own `unsupportedConditions` self-report
// (queryPlanExtractor.js rule 11). Caught live: "...who graduated exactly
// in the top 10 of their batch" sometimes got correctly self-reported by
// the LLM as unsupported, but on other identical runs the LLM silently
// dropped the condition from extraction entirely (as if never asked),
// producing a plan with NO unsupportedConditions at all — the names list
// then went out with no disclosure, and the narration's own echo of the
// question's wording ("...who graduated in the top 10...") read as if the
// condition HAD been honored, when it never was. Matched against the raw
// question text independent of the LLM, same reasoning as every other
// backstop in this file (SCOPE_BACKSTOP_PATTERN, BARE_YEARS_BACKSTOP_PATTERN,
// each field's own `backstop`) — used by both queryPlanValidator.js (merged
// into the real unsupportedConditions array so computeVerifiedCount/Names's
// own disclosure note always fires) and ragService.js (as a cheap top-level
// refusal gate that doesn't depend on an LLM call at all).
const UNSUPPORTED_CONDITION_PATTERNS = [
  { pattern: /\bsalary|income|\bwage\b|\bpay\b(?!ing)/i, label: 'salary or income' },
  { pattern: /\b(class\s*rank|batch\s*rank|top\s+\d+\s+(?:of|in)\s+(?:their|his|her|the)\s*batch|honor\s*roll|latin\s*honors?|valedictorian|salutatorian|cum\s*laude|magna\s*cum\s*laude|summa\s*cum\s*laude|\bGPA\b|grade\s*point\s*average)\b/i, label: 'class rank, honors, or GPA' },
  // The real tracked employmentType vocabulary is "Regular/Permanent",
  // "Contractual", "Probationary", "Self-Employed", "Job Order",
  // "Project-based", "Casual" (confirmed live via distinct() on the real
  // collection) — "full-time"/"part-time" simply isn't a value this schema
  // stores anywhere. Caught live: without this backstop, the LLM
  // non-deterministically either disclosed the mismatch itself or silently
  // answered using employmentStatus (Employed/Unemployed) instead, which
  // looks like a real answer to "full-time vs part-time" but isn't.
  { pattern: /\b(full[\s-]?time|part[\s-]?time)\b/i, label: 'full-time/part-time employment type (not tracked — only Regular/Permanent, Contractual, Probationary, Self-Employed, Job Order, Project-based, Casual are)' },
];

function detectUnsupportedConditions(question) {
  return UNSUPPORTED_CONDITION_PATTERNS.filter((c) => c.pattern.test(question)).map((c) => c.label);
}

function dropPlaceholders(values) {
  return values.filter((v) => v && !PLACEHOLDER_VALUE_PATTERN.test(v.trim()));
}

// Custom tracer-form question labels can't realistically be matched by
// exact string equality — the extractor describes WHAT TOPIC a question is
// about (paraphrasing), not the real form's exact wording verbatim.
// Substring-either-direction first, then significant-word overlap for a
// looser paraphrase.
function fuzzyLabelMatch(queryLabel, customQuestions) {
  const queryLower = queryLabel.trim().toLowerCase();
  if (!queryLower) return [];
  const substringMatches = customQuestions.filter(
    (q) => q.labelLower.includes(queryLower) || queryLower.includes(q.labelLower)
  );
  if (substringMatches.length) return substringMatches;
  const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'do', 'does', 'did', 'you', 'your', 'their', 'in', 'of', 'to', 'for', 'any', 'on', 'at']);
  const queryWords = queryLower.split(/\W+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (queryWords.length === 0) return [];
  return customQuestions.filter((q) => {
    const overlap = queryWords.filter((w) => q.labelLower.includes(w)).length;
    return overlap / queryWords.length >= 0.6;
  });
}

// ---------------------------------------------------------------------
// Generic type-handlers — one function per `type`, each given
// (entry, filters, cache, question) and returning a result "patch" or null
// if the field wasn't named / didn't resolve to anything to apply. Every
// resolver (generic-type AND custom) shares this same signature and return
// shape, so the validator's main loop never needs to know which kind it's
// calling.
//
// Patch shape: { tracerFiltersPatch?, userFiltersPatch?, part?,
//                unresolvedField?, ambiguousField?, unresolvedScope?,
//                extraUnsupported? }
// ---------------------------------------------------------------------

// enum-synonym: the question's natural vocabulary (e.g. "Employed") maps to
// a DB value that never literally contains that word (e.g. "Yes"). `values`
// is { ExternalLabel: dbMatchRegex }.
function resolveEnumSynonym(entry, filters) {
  const raw = filters[entry.key];
  if (!raw || !entry.values[raw]) return null;
  return {
    tracerFiltersPatch: { [entry.dbField]: entry.values[raw] },
    part: entry.partLabel ? entry.partLabel(raw) : `${entry.label} "${raw}"`,
  };
}

// catalog-match: the question names a free-text value (job title, industry,
// company, ...) that must be checked against a live DISTINCT list or a
// fixed official catalog before trusting it — a name that doesn't resolve
// is reported as unresolvedField (never silently dropped, never silently
// accepted). `entry.ambiguousWith` (optional) names ANOTHER catalog-match
// entry's key to cross-check when this one fails — e.g. "Information
// Technology" is a real INDUSTRY but not a real job title, so a question
// that named it as one is genuinely ambiguous, not simply wrong.
function resolveCatalogMatch(entry, filters, cache) {
  const raw = filters[entry.key];
  if (!raw) return null;
  const catalog = cache[entry.catalogKey] || [];
  let match = exactMatch(raw, catalog);
  // `entry.synonymSubstrings` (optional): a named abbreviation that will
  // NEVER exact-match the catalog because the real DB values are full
  // descriptive sentences, not short codes — confirmed live: "LET" asked
  // about a professional exam whose only real DB values are "Licensure
  // Exam for Professional Teachers"/"Professional Licensure Examination for
  // Teachers" (never the bare abbreviation itself). Checked only as a
  // fallback AFTER exactMatch fails, never instead of it — an exact catalog
  // value always wins when one exists.
  if (!match && entry.synonymSubstrings) {
    const substring = entry.synonymSubstrings[raw.trim().toUpperCase()];
    if (substring) match = catalog.find((c) => c.toLowerCase().includes(substring.toLowerCase())) || null;
  }
  if (match) {
    return {
      [entry.collection === 'user' ? 'userFiltersPatch' : 'tracerFiltersPatch']: { [entry.dbField]: match },
      part: entry.partLabel ? entry.partLabel(match) : `${entry.label} "${match}"`,
    };
  }
  if (entry.ambiguousWith) {
    const other = FIELD_REGISTRY_BY_KEY[entry.ambiguousWith];
    const altMatch = other && exactMatch(raw, cache[other.catalogKey] || []);
    if (altMatch) {
      return { ambiguousField: { value: raw, askedAs: entry.label, alsoMatches: other.label } };
    }
  }
  return { unresolvedField: { type: entry.label, value: raw } };
}

// boolean-yesno: a plain yes/no tracer-form question. `trueMatch` is the
// exact regex this field's real DB value satisfies when "yes" (these are
// NOT all identical — some real values have trailing text, e.g.
// "Yes, ..." — carried over verbatim per field, never assumed uniform).
function resolveBooleanYesNo(entry, filters) {
  if (filters[entry.key] !== true) return null;
  return { tracerFiltersPatch: { [entry.dbField]: entry.trueMatch }, part: entry.partLabel };
}

// prefix-bucket: a free-text field bucketed by a regex prefix match rather
// than exact equality (e.g. placeOfWork's real values are full sentences
// like "Local (within your home country)", not the bare word "Local").
// `values` is { ExternalLabel: dbPrefixRegex }.
function resolvePrefixBucket(entry, filters) {
  const raw = filters[entry.key];
  if (!raw || !entry.values[raw]) return null;
  return {
    tracerFiltersPatch: { [entry.dbField]: entry.values[raw] },
    part: entry.partLabel ? entry.partLabel(raw) : `${entry.label} "${raw}"`,
  };
}

const TYPE_RESOLVERS = {
  'enum-synonym': resolveEnumSynonym,
  'catalog-match': resolveCatalogMatch,
  'boolean-yesno': resolveBooleanYesNo,
  'prefix-bucket': resolvePrefixBucket,
};

// ---------------------------------------------------------------------
// Custom resolvers — see this file's own top comment on why these two
// can't be generic `type`s.
// ---------------------------------------------------------------------

// course/college — a named course is strictly more specific than its
// parent college (the extractor is told never to set both); college is
// only considered when no course was named. SCOPE_BACKSTOP_PATTERN is a
// deterministic BACKSTOP ONLY — the extraction LLM is instructed to always
// copy a named course/college into filters, even an unfamiliar/made-up
// one, and let this resolver reject it; in practice an 8B model still
// occasionally drops such a name entirely instead of passing it along
// (caught live: "summary of Call of Duty" sometimes extracted college:
// null instead of college: "Call of Duty"), which would silently fall
// through to an UNSCOPED answer. This regex only ever RAISES a refusal the
// LLM should have raised itself; it never resolves a real course/college
// on its own.
const SCOPE_BACKSTOP_PATTERN = /\b(?:for|sa|ng|of|about)\s+([A-Z]{2,10}|[A-Z][a-zA-Z]*(?:\s+(?:of|the|and|in|for)\s+[A-Z][a-zA-Z]*|\s+[A-Z][a-zA-Z]*)*)\b/;
const TOTAL_POPULATION_PATTERN = /\b(alumni|alumnus|alumna|graduates?|records?|respondents?)\b/i;
// The backstop above matches ANY "for/sa/ng/of/about X" shape, with no
// awareness of whether the question is even ABOUT alumni data at all —
// caught live: "Sino ang president ng Pilipinas?" (fully off-topic, no
// alumni content whatsoever) matched "ng Pilipinas" and set
// unresolvedScope:"Pilipinas", which used to be silently swallowed
// downstream (computeVerifiedNames didn't check unresolvedScope at all)
// but started surfacing as a wrong, confusing "'Pilipinas' is not a
// recognized college or course" refusal the moment that gap was fixed —
// a real answer to a question that was never about alumni data in the
// first place. Requires at least one real alumni-domain word ALSO be
// present in the question before trusting the backstop match at all —
// same guard concept as ragService.js's own ALUMNI_DOMAIN_PATTERN, kept
// as a separate, lightweight copy here since fieldRegistry.js is a lower
// layer that services/ragService.js itself depends on (importing the
// other way would be circular).
const SCOPE_BACKSTOP_DOMAIN_PATTERN = /\b(alumni|alumnus|alumna|graduate|tracer|employ\w*|program|course|college|respondent|survey|batch|job|work|industr\w*|company|position|occupation|skill|training|seminar|exam|licensure|promotion|summary|overview|activity|report)\b/i;

function resolveCourseCollege(entry, filters, cache, question) {
  const f = filters;
  let course = null;
  let college = null;
  const patch = {};
  if (f.course) {
    course = exactMatch(f.course, cache.courses);
    if (course) { patch.userFiltersPatch = { course }; patch.part = `program "${course}"`; }
  } else if (f.college) {
    college = exactMatch(f.college, cache.colleges);
    if (college) { patch.userFiltersPatch = { college }; patch.part = `college "${COLLEGE_NAMES[college] || college}" (${college})`; }
  }

  // A bare program-family name ("BSBA") that doesn't exactMatch a single
  // ALL_COURSES entry isn't necessarily unanswerable — it's a real,
  // multi-major program (PROGRAM_MAJOR_GROUPS, derived below) whose majors
  // just all require a "-XX" suffix (BSBA-BE/FM/MM). Caught live: "What is
  // the employment rate for BSBA alumni..." was refused outright ("BSBA is
  // not a recognized course") even though real data exists across its
  // majors — the honest answer is to aggregate across all of them (course
  // $in [...]), the same way resolveSpecializationRankingTarget already
  // treats a bare program name as valid for RANKING its majors against each
  // other. `courseGroupCollege` is threaded back to queryPlanValidator.js's
  // own coordinator college-scope check — it can't derive the owning
  // college from `userFilters.course` once that becomes an `$in` array
  // instead of a single string, so the group's own (single, shared) college
  // is surfaced here instead.
  if (f.course && !course) {
    const groupKey = Object.keys(PROGRAM_MAJOR_GROUPS).find((k) => k.toLowerCase() === f.course.toLowerCase());
    if (groupKey) {
      const groupCourses = PROGRAM_MAJOR_GROUPS[groupKey];
      patch.userFiltersPatch = { course: { $in: groupCourses } };
      patch.part = `program "${groupKey}" (any major)`;
      patch.courseGroupCollege = COURSE_TO_COLLEGE[groupCourses[0]] || null;
      course = groupKey;
    }
  }

  if (f.course && !course) patch.unresolvedScope = f.course;
  else if (f.college && !college) patch.unresolvedScope = f.college;
  else if (!f.course && !f.college && question && SCOPE_BACKSTOP_DOMAIN_PATTERN.test(question)) {
    const backstopMatch = question.match(SCOPE_BACKSTOP_PATTERN);
    if (backstopMatch && !TOTAL_POPULATION_PATTERN.test(backstopMatch[1])) {
      patch.unresolvedScope = backstopMatch[1];
    }
  }
  return Object.keys(patch).length ? patch : null;
}

// yearsInJob/yearsInJobMoreThan — see this file's own top comment. The
// ONLY 6 real distinct values TracerStudyResponse.yearsInCurrentJob
// actually contains (confirmed live via distinct() — a fixed-choice tracer
// form field, not genuinely free text). BARE_YEARS_BACKSTOP_PATTERN is a
// deterministic override for a bare "for N years" phrasing the LLM proved
// unstable on (same question resolving to a different adjacent bucket on
// different calls — see its own inline comment at use).
const YEARS_IN_JOB_BUCKETS = ['Less than 6 months', '6 months to 1 year', '1 to 2 years', '2 to 3 years', '3 to 5 years', 'More than 5 years'];
const YEARS_IN_JOB_UPPER_BOUNDS = {
  'Less than 6 months': 0.5,
  '6 months to 1 year': 1,
  '1 to 2 years': 2,
  '2 to 3 years': 3,
  '3 to 5 years': 5,
  'More than 5 years': Infinity,
};
const BARE_YEARS_BACKSTOP_PATTERN = /\bfor\s+(\d+)\s+years?\b(?!\s*(?:to|-)\s*\d)/i;

function resolveYearsInJob(entry, filters, cache, question) {
  const f = filters;
  let effectiveYearsInJob = f.yearsInJob;
  let effectiveYearsInJobMoreThan = f.yearsInJobMoreThan;
  if (question) {
    const bareYearsMatch = question.match(BARE_YEARS_BACKSTOP_PATTERN);
    if (bareYearsMatch) {
      effectiveYearsInJob = null;
      effectiveYearsInJobMoreThan = Number(bareYearsMatch[1]);
    }
  }

  if (effectiveYearsInJob) {
    const match = exactMatch(effectiveYearsInJob, YEARS_IN_JOB_BUCKETS);
    if (match) {
      return { tracerFiltersPatch: { yearsInCurrentJob: match }, part: `${match.toLowerCase()} in their current job` };
    }
    return null;
  }

  if (typeof effectiveYearsInJobMoreThan === 'number' && Number.isFinite(effectiveYearsInJobMoreThan)) {
    const n = effectiveYearsInJobMoreThan;
    const qualifyingBuckets = YEARS_IN_JOB_BUCKETS.filter((b) => YEARS_IN_JOB_UPPER_BOUNDS[b] > n);
    if (qualifyingBuckets.length === 0) {
      return { extraUnsupported: `an exact cutoff of more than ${n} years in the job (no tracked range covers this)` };
    }
    const isExactBoundary = qualifyingBuckets.length === 1 && qualifyingBuckets[0] === 'More than 5 years' && n === 5;
    if (isExactBoundary) {
      return { tracerFiltersPatch: { yearsInCurrentJob: { $in: qualifyingBuckets } }, part: 'more than 5 years in their current job' };
    }
    // The population that may be WRONGLY included is only ever those
    // sitting in the LOWEST qualifying bucket, between its own lower edge
    // and N — not "near N" in general (for a wide gap like N=7 landing
    // inside the open-ended "More than 5 years" bucket, the over-inclusion
    // band is 5-7 years, not "around 7").
    const lowestBucket = qualifyingBuckets[0];
    const lowestBucketFloor = lowestBucket === 'Less than 6 months' ? 0 : YEARS_IN_JOB_UPPER_BOUNDS[YEARS_IN_JOB_BUCKETS[YEARS_IN_JOB_BUCKETS.indexOf(lowestBucket) - 1]] ?? 0;
    const caveatBand = lowestBucketFloor === n
      ? `respondents with exactly ${n} years who do not strictly qualify`
      : `respondents with between ${lowestBucketFloor} and ${n} years who do not strictly qualify`;
    // The detailed caveat goes through `extraUnsupported` (the SAME
    // unsupportedConditions -> "note:" segment pipeline every other
    // "couldn't be precisely applied" disclosure uses — see
    // unsupportedConditionsNote/ragService.js's detectMissingNote), not
    // bundled into `part` (the plain "filters:" list) like it used to be.
    // Caught live: "who are the employed BSIT alumni with more than 20
    // years of experience?" had this whole caveat sitting inside `parts`,
    // which `detectMissingNote`'s safety net never covers (it only checks
    // the dedicated "note:" segment) — the narration dropped the caveat
    // entirely AND opened with "...with more than 20 years of experience
    // are:" as if the filter were exact, misrepresenting 5 real people (who
    // may have anywhere from 5 to 20+ years) as precisely verified 20-year
    // veterans. Routing this through extraUnsupported gives it the exact
    // same "must survive narration or get appended back" guarantee a
    // genuinely unsupported condition already has.
    return {
      tracerFiltersPatch: { yearsInCurrentJob: { $in: qualifyingBuckets } },
      part: `more than approximately ${n} years in their current job`,
      extraUnsupported: `an exact cutoff of more than ${n} years (the tracer data only tracks fixed ranges — ${qualifyingBuckets.join(', ')} — so this may include ${caveatBand})`,
    };
  }
  return null;
}

// skillRating — a self-rated competency (one of 8 personalGrowthRatings
// sub-fields, each storing exactly one of 5 literal rating strings,
// confirmed live via distinct() on every one of the 8 sub-fields).
const SKILL_RATING_VALUES = ['Excellent', 'Competent', 'Satisfactory', 'Beginner', 'Non-Acceptable'];
const SKILL_FIELD_LABELS = {
  technicalSkills: 'technical skills',
  problemSolvingSkills: 'problem solving skills',
  communicationSkills: 'communication skills',
  projectManagement: 'project management',
  teamworkCollaboration: 'teamwork and collaboration',
  adaptability: 'adaptability',
  workLifeBalance: 'work-life balance',
  criticalThinkingSkills: 'critical thinking skills',
};

function resolveSkillRating(entry, filters) {
  const sr = filters.skillRating;
  if (!sr || !sr.skill || !SKILL_FIELD_LABELS[sr.skill]) return null;
  const skillLabel = SKILL_FIELD_LABELS[sr.skill];
  const dbField = `personalGrowthRatings.${sr.skill}`;
  if (sr.rating && SKILL_RATING_VALUES.includes(sr.rating)) {
    return { tracerFiltersPatch: { [dbField]: sr.rating }, part: `${skillLabel} rated "${sr.rating}"` };
  }
  return { tracerFiltersPatch: { [dbField]: { $in: SKILL_RATING_VALUES } }, part: `rated their ${skillLabel}` };
}

// Backstop for a "vs" comparison naming a specific skill but no specific
// rating level ("Excellent vs Satisfactory in technical skills" already
// resolves via the normal {skill, rating} shape above when a level IS
// named — this only covers the bare-skill case). Resolves to {skill} with
// no `rating`, same as a plain "how do alumni rate their technical skills"
// question — computeComparison (verifiedCount.js) special-cases
// `comparisonField === 'skillRating'` to break that down across all 5
// rating levels, since skillRating's dbField is dynamic (depends on WHICH
// skill) and so can't use the static `values` map every other comparable
// field has.
// "skills" after "technical"/"communication" is OPTIONAL, same leniency
// every other alternative here already has ("problem solving", "teamwork",
// "adaptability", ... never require a trailing "skills" to match) — caught
// live: "technical skills vs problem solving vs communication vs teamwork"
// silently dropped "communication" entirely (matched 3 of the 4 named
// skills with no indication a 4th was ever named) because the question said
// bare "communication", not the literal 2-word phrase "communication
// skills" this pattern required.
const SKILL_NAME_BACKSTOP_PATTERN = /\b(technical(?:\s+skills)?|problem[- ]solving|communication(?:\s+skills)?|project management|teamwork|collaboration|adaptability|work-life balance|critical thinking)\b/i;
function resolveSkillNameFromText(matchText) {
  const t = matchText.toLowerCase();
  if (t.includes('technical')) return 'technicalSkills';
  if (t.includes('problem')) return 'problemSolvingSkills';
  if (t.includes('communication')) return 'communicationSkills';
  if (t.includes('project')) return 'projectManagement';
  if (t.includes('teamwork') || t.includes('collaboration')) return 'teamworkCollaboration';
  if (t.includes('adaptability')) return 'adaptability';
  if (t.includes('work-life')) return 'workLifeBalance';
  return 'criticalThinkingSkills';
}

// Finds EVERY distinct skill named in a question (not just the first) —
// needed to tell apart two genuinely different "vs" shapes for skillRating:
// "Excellent vs Satisfactory in technical skills" (ONE skill, two RATING
// LEVELS — handled by the normal comparisonField path, breaking that one
// skill down across all 5 levels) vs "technical skills vs problem solving"
// (TWO different SKILLS compared against each other). Caught live: treating
// the second shape as the first silently compared only the FIRST-named
// skill's 5 levels and left the second skill's numbers completely
// unverified — the narration LLM then filled that gap by inventing
// plausible-looking numbers for it, undetected by the hallucination
// checks (which only verify every number in verifiedDescription survived
// narration, not that the reverse holds — see queryPlanValidator.js's own
// use of this for the two-skill comparison branch).
function findAllSkillMatches(question) {
  if (!question) return [];
  const found = [];
  const re = new RegExp(SKILL_NAME_BACKSTOP_PATTERN.source, 'gi');
  let m;
  while ((m = re.exec(question)) !== null) {
    const skill = resolveSkillNameFromText(m[1]);
    if (!found.includes(skill)) found.push(skill);
  }
  return found;
}

// A skill-comparison question naming something that ISN'T one of the 8 real
// tracked categories ("technical skills vs problem solving vs leadership" —
// "leadership" is never tracked anywhere in the tracer form) must not be
// silently dropped with no explanation, nor fabricated into the nearest
// real match — see resolveSkillNameFromText's own fallback, which is safe
// ONLY because findAllSkillMatches never calls it on non-matching text in
// the first place (the regex itself gates what reaches it). This instead
// splits the question on comparison connectors (vs/versus/compared to/,/
// and) to find each individually-named item, and reports back any segment
// that didn't match SKILL_NAME_BACKSTOP_PATTERN — so the caller can keep
// the chart for whichever skills DID resolve, and tell the user plainly
// that the rest aren't tracked, instead of just quietly answering a
// narrower question than what was actually asked.
//
// Gated on at least ONE real skill already being found elsewhere in the
// question (`findAllSkillMatches(question).length > 0`, checked by the
// caller/here) — without that anchor, splitting an ARBITRARY sentence on
// "and"/"," and flagging every non-matching fragment would misfire constantly
// (e.g. "for BSIT and CCS" is a scope clause, not an attempted skill name).
// Once the question is already confirmed to be a real skill comparison,
// every OTHER item in the same vs/,/and list is fair game to flag — no
// longer requiring the fragment to itself contain the word "skill"/
// "competency" (an earlier version did; caught live: "technical skills vs
// problem solving vs leadership" named "leadership" bare, with no "skill"
// word anywhere near it, and that filter silently dropped it exactly the
// way this function exists to prevent). A scope-preposition opener ("for
// BSIT", "in CCS", "among females") is still excluded — those are a
// trailing scope clause tacked onto the comparison, not another compared
// item, even once the "must contain 'skill'" gate is gone.
const SKILL_SEGMENT_SPLIT_PATTERN = /\s*(?:\bvs\.?\b|\bversus\b|\bcompared?\s+to\b|,|\band\b)\s*/i;
const SKILL_SCOPE_CLAUSE_PATTERN = /^(?:for|in|at|of|among|within|from)\b/i;
function findUnmatchedSkillMentions(question) {
  if (!question) return [];
  if (findAllSkillMatches(question).length === 0) return [];
  const segments = question.split(SKILL_SEGMENT_SPLIT_PATTERN).map((s) => s.trim()).filter(Boolean);
  const unmatched = [];
  for (const seg of segments) {
    if (SKILL_NAME_BACKSTOP_PATTERN.test(seg)) continue; // a real, tracked skill
    if (SKILL_SCOPE_CLAUSE_PATTERN.test(seg)) continue; // a trailing scope clause, not another compared item
    // Strip leading filler so the reported name is just the skill phrase
    // itself, not the whole surrounding clause ("how do alumni rate their
    // leadership skills" -> "leadership skills").
    const cleaned = seg.replace(/^(?:how (?:do|does|much)\s+(?:alumni\s+)?rate\s+(?:their\s+)?|compare\s+|rate\s+(?:their\s+)?|what\s+(?:is|are)\s+)/i, '').trim();
    if (cleaned && cleaned.length < 60 && !unmatched.includes(cleaned)) unmatched.push(cleaned);
  }
  return unmatched;
}

// customQuestion — any college's own tracer-form question not covered by a
// fixed field above, matched by fuzzy label text (see fuzzyLabelMatch's own
// comment on why exact-match doesn't work for this one).
function resolveCustomQuestion(entry, filters, cache) {
  const cq = filters.customQuestion;
  if (!cq || !cq.label) return null;
  const entries = fuzzyLabelMatch(cq.label, cache.customQuestions);
  if (!entries.length) return null;
  const optionValue = cq.value
    ? entries.flatMap((q) => q.options).find((o) => o.toLowerCase() === cq.value.trim().toLowerCase())
    : null;
  return {
    tracerFiltersPatch: {
      $or: entries.map((q) => ({ [`extra_answers.${q.id}`]: optionValue || { $exists: true, $nin: [null, ''] } })),
    },
    part: optionValue ? `"${entries[0].label}" = "${optionValue}"` : `answered "${entries[0].label}"`,
  };
}

// customQuestion comparison ("how many chose X vs Y for [some admin-added
// question]?") — the last remaining field with no "vs" support at all.
// Genuinely different shape from every other comparison above: there's no
// global catalog of real values to check (a catalog-match field's
// cache[catalogKey] is one shared DISTINCT list across the whole schema) —
// each custom question has its OWN small set of options, scoped to
// whichever college(s) actually defined it, discovered the same way
// resolveCustomQuestion's own fuzzyLabelMatch already works. Requires the
// LLM to have still named WHICH question is being asked about (cqFilter.label
// — e.g. "for the preferred work arrangement question") even on a
// comparison; only the two (or more) OPTION values being compared need to
// be found literally in the question text, not re-guessed from scratch.
function findCustomQuestionComparisonValues(cqFilter, question, cache) {
  if (!cqFilter || !cqFilter.label || !question) return null;
  const entries = fuzzyLabelMatch(cqFilter.label, cache.customQuestions);
  if (!entries.length) return null;
  const allOptions = [...new Set(entries.flatMap((e) => e.options))];
  const found = allOptions.filter((opt) => {
    const escaped = opt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(question);
  });
  if (found.length < 2) return null;
  return { entries, values: found };
}

// specialization ranking — see RANKING entries below for how this plugs
// into computeVerifiedRanking. Only BSIT has a separate User.track field
// for its specializations (TSM/WMA/NA) — every OTHER multi-major program
// (collegesCourses.js: "Majors use a '-XX' suffix, except BSIT") encodes
// its major directly in the course code itself, e.g. "BSBA-FM" is its own
// real ALL_COURSES entry. PROGRAM_MAJOR_GROUPS is derived (not hand-
// maintained) by grouping ALL_COURSES by the text before their "-".
//
// IMPORTANT: "NA" here is a REAL specialization code — "Network
// Administration" — NOT a "not applicable"/placeholder value. It looks
// identical to the common "N/A" placeholder shorthand used elsewhere in
// this schema (companyName, occupationTitle), which is exactly what led to
// it being wrongly excluded from this ranking at first (same treatment as
// the real "N/A" placeholders dropped via PLACEHOLDER_VALUE_PATTERN
// elsewhere) — confirmed live by the person who owns this data that "NA"
// is a genuine third BSIT track, not an empty answer. Only a true blank
// string ('') means no specialization was recorded; "NA" must count as a
// real value.
const PROGRAM_MAJOR_GROUPS = ALL_COURSES.reduce((groups, course) => {
  const dashIdx = course.indexOf('-');
  if (dashIdx === -1) return groups;
  const prefix = course.slice(0, dashIdx);
  (groups[prefix] = groups[prefix] || []).push(course);
  return groups;
}, {});

// A named course that fails to exact-match the catalog (e.g. bare "BSBA")
// is usually a genuinely nonexistent program — but sometimes it's a REAL
// program family whose majors all require the "-XX" suffix this one just
// left off (PROGRAM_MAJOR_GROUPS's own comment: BSBA's real catalog entries
// are "BSBA-FM"/"BSBA-MM"/"BSBA-BE", never bare "BSBA"). A flat "not a
// recognized college or course" reads as if BSBA doesn't exist at TSU at
// all, when it does — it just needs a major named. Builds the more helpful,
// specific message in that case; falls back to the plain message for a
// genuinely unrecognized name.
function unresolvedScopeMessage(name) {
  const groupKey = Object.keys(PROGRAM_MAJOR_GROUPS).find((k) => k.toLowerCase() === String(name).toLowerCase());
  if (groupKey) {
    return `"${name}" is a program with multiple majors, not a single course on its own — its real majors are ${PROGRAM_MAJOR_GROUPS[groupKey].join(', ')}`;
  }
  return `"${name}" is not a recognized college or course in the system`;
}

// BSIS has no structured specialization field (no User.track entry like
// BSIT, no "-XX" course-code suffix like BSBA) — its one real specialization
// ("Business Analytics") only exists as free text embedded in
// TracerStudyResponse.programsCompleted, e.g. "Bachelor of Science in
// Information Systems - Specialized in Business Analytics;" (confirmed live
// against the DB: 60/68 BSIS tracer rows carry this exact phrasing, 8 carry
// none). Ranking/filtering on it requires regex-extracting the capture group
// at query time (see verifiedCount.js's handling of `extractFromText`)
// instead of grouping on a plain field path like every other specialization
// target. Only BSIS is known to use this phrasing today — if another
// program starts recording its own specialization the same free-text way,
// add it here rather than inventing a new mechanism.
const TEXT_SPECIALIZATION_PROGRAMS = {
  BSIS: { courseFilter: 'BSIS', textPattern: /specialized in\s*([^;]+)/i, matchHint: /information systems/i },
};

function resolveSpecializationRankingTarget(rankingScope) {
  if (!rankingScope || rankingScope.toUpperCase() === 'BSIT') {
    return { dbField: 'track', label: 'specialization', onTracer: false, userField: 'track' };
  }
  const groupKey = Object.keys(PROGRAM_MAJOR_GROUPS).find((k) => k.toLowerCase() === rankingScope.toLowerCase());
  if (groupKey) {
    return { dbField: 'course', label: `${groupKey} specialization`, onTracer: false, userField: 'course', inValues: PROGRAM_MAJOR_GROUPS[groupKey] };
  }
  const textProgram = TEXT_SPECIALIZATION_PROGRAMS[rankingScope.toUpperCase()];
  if (textProgram) {
    return { extractFromText: true, label: `${rankingScope.toUpperCase()} specialization`, onTracer: true, courseFilter: textProgram.courseFilter, textPattern: textProgram.textPattern, matchHint: textProgram.matchHint };
  }
  return null;
}

// "specialization" as a plain FILTER (count/percentage/names/summary) —
// distinct from the ranking-only resolveSpecializationRankingTarget above.
// Only BSIT has tracked specializations at all (TSM/WMA/NA — "NA" is a
// real third track, "Network Administration", not a blank answer; see
// PROGRAM_MAJOR_GROUPS's own comment), so naming one implicitly means
// "BSIT students" too — sets userFilters.course = "BSIT" alongside the
// track value itself, so the coordinator college-scope check in
// queryPlanValidator.js (which looks at userFilters.course/college) can
// correctly recognize "TSM" as a CCS-only request without needing its own
// separate cross-check. A value that isn't exactly "TSM"/"WMA"/"NA" is
// simply dropped, not refused — same discipline as gender/workLocation
// elsewhere (the question named no fact the schema can't represent, the
// LLM just didn't produce a clean value).
const SPECIALIZATION_VALUES = ['TSM', 'WMA', 'NA'];
// BSIS's one real specialization ("Business Analytics") has no structured
// field — see TEXT_SPECIALIZATION_PROGRAMS above. As a plain filter (not a
// ranking), it's applied as a tracerFiltersPatch regex against the same
// free-text programsCompleted phrasing, alongside userFiltersPatch.course so
// the coordinator college-scope check still recognizes it as a CCS-only
// request exactly like TSM/WMA/NA does for BSIT.
const TEXT_SPECIALIZATION_FILTER_VALUES = {
  'BUSINESS ANALYTICS': { course: 'BSIS', textPattern: /specialized in\s*business analytics/i },
};
function resolveSpecializationFilter(entry, filters) {
  const raw = filters.specialization;
  if (!raw || typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase();
  if (SPECIALIZATION_VALUES.includes(normalized)) {
    return {
      userFiltersPatch: { track: normalized, course: 'BSIT' },
      part: `${normalized} specialization`,
    };
  }
  const textMatch = TEXT_SPECIALIZATION_FILTER_VALUES[normalized];
  if (textMatch) {
    return {
      userFiltersPatch: { course: textMatch.course },
      tracerFiltersPatch: { programsCompleted: { $elemMatch: { $regex: textMatch.textPattern } } },
      part: `${raw.trim()} specialization`,
    };
  }
  return null;
}

// graduationYear — a real User.graduationYear field with no fixed value
// set (an open range of 4-digit years, unlike every enum/boolean field
// above), so it's a `custom` resolver rather than enum-synonym: there's no
// `values` map to validate against, just a plausible-year sanity range.
function resolveGraduationYear(entry, filters) {
  const year = filters.graduationYear;
  if (typeof year !== 'number' || !Number.isInteger(year)) return null;
  if (year < 1950 || year > new Date().getFullYear() + 1) return null;
  return { userFiltersPatch: { graduationYear: year }, part: `batch ${year}` };
}

// Year-over-year comparison ("2024 vs 2025 employment rate") — distinct
// from computeVerifiedRanking's existing graduationYear TREND shape (a full
// chronological sweep across every batch year that has data), this is a
// direct two-or-more SPECIFIC named years compared against each other, the
// same "vs" shape every other comparable field already supports. Scans for
// every plausible 4-digit year literally in the question (same sanity range
// resolveGraduationYear itself already enforces — 1950 through next year),
// deduplicated — "2024" mentioned twice only counts once.
const YEAR_PATTERN = /\b(19[5-9]\d|20\d{2})\b/g;
function findYearComparisonValues(question) {
  if (!question) return null;
  const maxYear = new Date().getFullYear() + 1;
  const found = [...new Set(
    [...question.matchAll(YEAR_PATTERN)]
      .map((m) => Number(m[1]))
      .filter((y) => y >= 1950 && y <= maxYear),
  )];
  return found.length >= 2 ? found : null;
}

// Deterministic backstop for resolveGraduationYear (not a `backstop`-style
// registry entry since graduationYear is a `type: 'custom'` resolver) —
// caught live: "Why are 2024 graduates unemployed?" non-deterministically
// extracted graduationYear as null on some runs despite the year being
// named explicitly, silently answering the UNSCOPED system-wide total
// instead of just batch 2024's. Only returns a value when EXACTLY ONE
// plausible year is mentioned — 2+ years is the comparison shape
// (findYearComparisonValues above), not a single-year scope, so this
// deliberately stays out of that case's way.
function findSingleYearMention(question) {
  if (!question) return null;
  const maxYear = new Date().getFullYear() + 1;
  const found = [...new Set(
    [...question.matchAll(YEAR_PATTERN)]
      .map((m) => Number(m[1]))
      .filter((y) => y >= 1950 && y <= maxYear),
  )];
  return found.length === 1 ? found[0] : null;
}

// Builds the same shape RANKING_FIELD_MAP used to be hand-maintained as in
// verifiedCount.js — "course" is always present (it's not a catalog-match
// registry entry; the registry's "course" key is the bespoke filter/scope
// resolver, a different purpose than grouping-for-ranking) and every other
// rankable catalog-match entry (jobTitle/industryField/companyName) is
// derived automatically. "specialization" is NOT included here — it's
// resolved dynamically per-question via resolveSpecializationRankingTarget
// above (its real target field depends on which program's majors were
// asked about), the same as before this file existed.
//
// "college" was missing entirely until caught live: "Which college has the
// highest employment rate?" (an admin-only question — a coordinator is
// already scoped to one college, so ranking colleges against each other
// only makes sense for an admin) had no rankingField to resolve to at all,
// in EITHER this map or queryPlanExtractor.js's own allowed-values list —
// it silently fell all the way through to "I do not have enough verified
// data" with no ranking ever attempted. Added the same way "course" already
// is (college has no dedicated registry entry of its own either — see
// fieldRegistry's own "course"/"college" bespoke-resolver comment).
function buildRankingFieldMap() {
  const map = {
    course: { dbField: 'course', label: 'program', onTracer: false, userField: 'course' },
    college: { dbField: 'college', label: 'college', onTracer: false, userField: 'college' },
    // `sortByKey: true` — a batch-year trend is read chronologically
    // (oldest to newest), never sorted by respondent count like every
    // other ranking target; see computeVerifiedRanking's own handling.
    graduationYear: { dbField: 'graduationYear', label: 'batch year', onTracer: false, userField: 'graduationYear', sortByKey: true },
  };
  for (const entry of FIELD_REGISTRY) {
    if (!entry.rankable) continue;
    map[entry.rankLabel || entry.key] = { dbField: entry.dbField, label: entry.label, onTracer: entry.collection !== 'user' };
  }
  return map;
}

// ---------------------------------------------------------------------
// THE REGISTRY — order matters: it's the precedence/short-circuit order
// the validator loop processes fields in, matching the original
// hand-written validator's own ordering exactly.
// ---------------------------------------------------------------------
const FIELD_REGISTRY = [
  {
    key: 'course', type: 'custom', resolve: resolveCourseCollege, jsonHint: 'string or null',
    description: '"course" must be copied VERBATIM as written in the question if it names one (e.g. "BSIT", "BSCS") — do not expand, correct, or guess a course the question didn\'t actually name. Only set it if a course/program is named; otherwise null. IMPORTANT: "TSM", "WMA", and "NA" are BSIT specialization/track codes, NOT course codes — even though they are short, uppercase, and superficially look like one. A question naming one of these goes in "specialization" instead (see that field\'s own rule below), never here.',
  },
  {
    key: 'college', type: 'custom', resolve: () => null /* handled together with course above */, jsonHint: 'string or null',
    description: '"college" must be copied VERBATIM as written (e.g. "CCS", "CBA") — only set if a college is named AND no specific course was already named (a named course is more specific than its college, never set both).',
  },
  {
    key: 'employmentStatus', type: 'enum-synonym', dbField: 'employmentStatus', label: 'employment status',
    jsonHint: '"Employed" | "Unemployed" | "Self-Employed" or null',
    description: '"employmentStatus" must be exactly one of "Employed", "Unemployed", "Self-Employed", or null — infer "Employed" from "employment rate"/"employed"/"working", "Unemployed" from "unemployment rate"/"unemployed"/"not employed"/"jobless", "Self-Employed" only when self-employment specifically is named. Never set both an employment status AND treat the question as a plain population count unless the question actually asks about employment.',
    // Mirrors computeTracerAnalytics's own YES/NOT_EMPLOYED buckets exactly
    // (controllers/employmentController.js) — employmentStatus is stored as
    // "Yes"/"No"/"Never Employed", not literally "Employed"/"Unemployed".
    values: {
      'Self-Employed': /^self[- ]?employed$/i,
      Unemployed: /^no$|never/i,
      Employed: /^yes$|^self[- ]?employed$/i,
    },
    // Caught live: "How many are employed vs unemployed?" extracted
    // employmentStatus: null (confirmed via isolated re-run of the exact
    // same question) despite naming both states explicitly — an "X vs Y"
    // comparison question seems to confuse the LLM into not picking either
    // single value. Same fallback mechanism/reasoning as workLocation's own
    // backstop below (see queryPlanValidator.js's generic application of
    // `entry.backstop`) — the comparison branch in verifiedCount.js only
    // needs ANY truthy employmentStatus value to trigger (it then computes
    // all three states regardless of which one was initially set), so which
    // side the backstop picks doesn't matter for a comparison question.
    // "unemployment" (the NOUN form — "unemployment rate") was missing
    // entirely until caught live: "Compare TSM and WMA graduates'
    // unemployment rate" matched none of these alternatives ("unemployed"
    // only covers the ADJECTIVE form, "employment rate" doesn't match
    // "unemployment rate" since "un" breaks the literal "employment rate"
    // substring), so employmentStatus never got set at all — the
    // comparison silently fell back to raw TOTAL headcounts per
    // specialization instead of unemployment-filtered ones, with nothing
    // indicating the "unemployment" part of the question was ever dropped.
    backstop: {
      pattern: /\b(unemployed|unemployment(?:\s+rate)?|not employed|jobless|self[- ]?employed|employed|employment rate)\b/i,
      resolve: (m) => {
        const t = m[1].toLowerCase();
        if (/^self/.test(t)) return 'Self-Employed';
        if (/^un|^not|jobless/.test(t)) return 'Unemployed';
        return 'Employed';
      },
    },
    // "Employed"'s own regex is a superset of "Self-Employed" — see
    // computeComparison's own comment on `comparisonFold`.
    comparisonFold: { into: 'Employed', subset: 'Self-Employed', subsetMentionPattern: /self[- ]?employed/i },
  },
  {
    key: 'jobTitle', type: 'catalog-match', collection: 'tracer', dbField: 'occupationTitle', label: 'job title',
    catalogKey: 'jobTitles', chain: 'catalog', ambiguousWith: 'industryField', rankable: true, rankLabel: 'jobTitle', jsonHint: 'string or null',
    description: '"jobTitle", "industryField", "companyName" — copy the exact phrase the question names for each, verbatim, only if explicitly named (e.g. "Software Engineer", "Information Technology", "Accenture"). Do not guess one that wasn\'t stated.',
  },
  {
    key: 'industryField', type: 'catalog-match', collection: 'tracer', dbField: 'industryField', label: 'industry',
    catalogKey: 'industries', chain: 'catalog', ambiguousWith: 'jobTitle', rankable: true, rankLabel: 'industry', jsonHint: 'string or null',
    description: null, // covered by jobTitle's shared rule line above
  },
  {
    key: 'companyName', type: 'catalog-match', collection: 'tracer', dbField: 'companyName', label: 'company',
    catalogKey: 'companies', chain: 'catalog', rankable: true, rankLabel: 'company', jsonHint: 'string or null',
    description: null,
  },
  {
    key: 'employmentType', type: 'catalog-match', collection: 'tracer', dbField: 'presentEmploymentType', label: 'employment type',
    catalogKey: 'employmentTypes', chain: 'catalog', jsonHint: 'string or null',
    description: '"employmentType" copies verbatim a named employment arrangement (e.g. "Regular/Permanent", "Contractual", "Probationary", "Self-Employed", "Job Order", "Project-based") — only if the question actually names one.',
  },
  {
    key: 'furtherEducationType', type: 'catalog-match', collection: 'tracer', dbField: 'furtherEducationType', label: 'further education type',
    catalogKey: 'furtherEducationTypes', chain: 'catalog', jsonHint: 'string or null',
    description: '"furtherEducationType" copies verbatim a specific named course/program of further study (e.g. "Master of Information Technology") — only if actually named, not just "pursued further studies" in general (that\'s the "furtherEducation" boolean instead).',
  },
  {
    key: 'trainingType', type: 'catalog-match', collection: 'tracer', dbField: 'trainingType', label: 'training type',
    catalogKey: 'trainingTypes', chain: 'catalog', jsonHint: 'string or null',
    description: '"trainingType" copies verbatim a specific named training/program (e.g. "CCNA", "Cybersecurity") — only if actually named (distinct from "pursuedTrainings", which is just a yes/no about whether alumni underwent trainings generally).',
  },
  {
    key: 'reasonNotEmployed', type: 'catalog-match', collection: 'tracer', dbField: 'reasonsNotEmployed', label: 'reason for not being employed',
    // Unlike every other catalog-match field, this one's live DISTINCT
    // list is NOT run through placeholder-dropping (refreshCache below) —
    // preserved exactly as the original hand-written cache build did
    // (reasonsNotEmployed real values are full descriptive sentences,
    // never observed to contain an "N/A"-style placeholder in practice).
    catalogKey: 'reasonsNotEmployed', chain: 'catalog', skipPlaceholderDrop: true, jsonHint: 'string or null',
    description: '"reasonNotEmployed" copies verbatim a specific named reason an alumnus might cite for being unemployed (e.g. "lack of work experience", "pursuing further studies") — only if the question names a specific reason, not just asking about unemployment in general.',
  },
  {
    key: 'workLocation', type: 'prefix-bucket', dbField: 'placeOfWork', label: 'work location', jsonHint: '"Local" | "Abroad" or null',
    description: '"workLocation" is "Local" only for phrasing like "locally"/"within the Philippines"/"local area", "Abroad" only for "abroad"/"overseas"/"outside the Philippines" — null otherwise. IMPORTANT: for a "locally vs abroad"/"local vs abroad" COMPARISON question, still set this to either "Local" or "Abroad" (whichever side is mentioned first) — never null — the comparison logic downstream always computes BOTH numbers once either side is set; leaving it null answers a completely different, wrong question instead. CRITICAL — never infer "Local" or "Abroad" from a SPECIFIC named city, province, or region (e.g. "Quezon City", "Cebu", "Pampanga") — this system only tracks the coarse Local-vs-Abroad distinction, never a specific place, so a named specific place is NOT the same thing as "locally"/"abroad" and must NOT set this field at all; put the named place in "unsupportedConditions" instead (verbatim, e.g. "Quezon City") and leave "workLocation" null. Caught live: "BSBA alumni who live in Quezon City" wrongly set workLocation to "Local" (since Quezon City happens to be within the Philippines) — that silently answers a different, broader question ("Local" includes every city in the country) than the one actually asked.',
    values: { Local: /^local/i, Abroad: /^abroad/i },
    backstop: {
      pattern: /\b(locally|local area|within the philippines|abroad|overseas|outside the philippines)\b/i,
      resolve: (m) => (/abroad|overseas|outside/i.test(m[1]) ? 'Abroad' : 'Local'),
    },
  },
  {
    key: 'gender', type: 'enum-synonym', dbField: 'gender', label: 'gender', jsonHint: '"Male" | "Female" | "LGBTQIA+" or null',
    description: '"gender" is exactly one of "Male", "Female", "LGBTQIA+" — set it only when the question explicitly names a sex/gender group (e.g. "male alumni", "by sex", "female respondents", "LGBTQIA+ graduates"). Never infer it from a name or any other indirect signal.',
    // Real distinct() values include a data-entry typo ("MAle" alongside
    // "Male") — matched case-insensitively so it isn't silently treated as
    // a separate group from "Male".
    values: { Male: /^male$/i, Female: /^female$/i, 'LGBTQIA+': /^lgbtqia\+$/i },
    // Same "X vs Y" extraction instability as workLocation/employmentStatus
    // (see those entries' own backstop comments) — "male vs female" risks
    // the LLM setting gender to null since neither single side is "the"
    // answer to a comparison question.
    backstop: {
      pattern: /\b(male|female|lgbtqia\+?)\b/i,
      resolve: (m) => {
        const t = m[1].toLowerCase();
        if (t === 'male') return 'Male';
        if (t === 'female') return 'Female';
        return 'LGBTQIA+';
      },
    },
  },
  {
    key: 'furtherEducation', type: 'boolean-yesno', dbField: 'furtherEducation', trueMatch: /^yes/i,
    partLabel: 'pursued further education', jsonHint: 'true | false or null',
    description: '"furtherEducation" is true only if the question asks about pursuing further studies/graduate school; "professionalDevelopmentActivities" is true only if it asks about professional development activities, trainings, or certifications; "awardsOrRecognition" is true only if it asks about awards, recognitions, or significant accomplishments. Leave each null otherwise.',
    // Boolean fields only need a backstop that recognizes the field's OWN
    // topic was named by a comparison question ("further studies vs not") —
    // the generic comparison engine (verifiedCount.js's computeComparison)
    // always computes both Yes/No regardless of which single value the LLM
    // or backstop resolved, so `resolve` just needs to return `true`.
    backstop: { pattern: /\bfurther (?:studies|education)\b/i, resolve: () => true },
  },
  {
    key: 'professionalDevelopmentActivities', type: 'boolean-yesno', dbField: 'professionalDevelopmentActivities', trueMatch: /^yes/i,
    partLabel: 'pursued professional development activities', jsonHint: 'true | false or null', description: null,
    backstop: { pattern: /\bprofessional development\b/i, resolve: () => true },
  },
  {
    key: 'awardsOrRecognition', type: 'boolean-yesno', dbField: 'significantAccomplishments', trueMatch: /^yes/i,
    partLabel: 'reported an award or recognition', jsonHint: 'true | false or null', description: null,
    backstop: { pattern: /\b(?:awards?|recognitions?)\b/i, resolve: () => true },
  },
  {
    key: 'jobRelatedToDegree', type: 'enum-synonym', dbField: 'jobRelatedToDegree', label: 'job relation to degree',
    jsonHint: '"Related" | "Somewhat Related" | "Not Related" or null',
    description: '"jobRelatedToDegree" is "Related" when the question asks whether alumni\'s job is (directly) related to their course/degree, "Somewhat Related" only when "somewhat"/"partially" is explicit, "Not Related" when asking about an UNrelated job.',
    // TracerStudyResponse.jobRelatedToDegree stores the full sentence the
    // form's radio option reads, not a short enum. "Related" (no
    // "directly"/"somewhat" qualifier) matches BOTH "directly related" and
    // "somewhat related" DB answers — a bare "is their job related to
    // their degree?" colloquially means "related at all", and "somewhat
    // related" is still related, not unrelated. Caught live: an unqualified
    // question only counted the exact "directly related" bucket, silently
    // excluding "somewhat related" respondents.
    values: {
      Related: /^yes, it is (directly|somewhat) related$/i,
      'Somewhat Related': /^yes, it is somewhat related$/i,
      'Not Related': /^no, it is not related$/i,
    },
    partLabel: (raw) => `job ${raw === 'Related' ? 'related (directly or somewhat)' : raw === 'Somewhat Related' ? 'somewhat related' : 'not related'} to their degree`,
    backstop: {
      pattern: /\b(not related|unrelated|somewhat related|related)\b/i,
      resolve: (m) => {
        const t = m[1].toLowerCase();
        if (/not|unrelated/.test(t)) return 'Not Related';
        if (/somewhat/.test(t)) return 'Somewhat Related';
        return 'Related';
      },
    },
    // "Related"'s own regex is a superset of "Somewhat Related" (see this
    // entry's own comment above) — same quirk as employmentStatus's
    // Employed/Self-Employed, same declarative fix: see computeComparison's
    // own comment on `comparisonFold`.
    comparisonFold: { into: 'Related', subset: 'Somewhat Related', subsetMentionPattern: /somewhat/i },
  },
  {
    key: 'professionalExamResult', type: 'enum-synonym', dbField: 'professionalExam', label: 'professional exam result',
    jsonHint: '"Passed" | "Failed" | "NotTaken" or null',
    description: '"professionalExamResult" is "Passed" for passing a licensure/professional/board exam, "Failed" for failing one, "NotTaken" for not having taken one yet — only when the question is specifically about this exam outcome.',
    values: { Passed: /^yes, i passed/i, Failed: /^yes, i failed/i, NotTaken: /^no, i have not/i },
    partLabel: (raw) => (raw === 'Passed' ? 'passed the professional exam' : raw === 'Failed' ? 'failed the professional exam' : 'has not taken the professional exam'),
    backstop: {
      pattern: /\b(passed|failed|(?:not|hasn't|haven't) taken)\b/i,
      resolve: (m) => {
        const t = m[1].toLowerCase();
        if (t.startsWith('pass')) return 'Passed';
        if (t.startsWith('fail')) return 'Failed';
        return 'NotTaken';
      },
    },
  },
  {
    key: 'professionalExamName', type: 'catalog-match', collection: 'tracer', dbField: 'professionalExamName', label: 'professional exam name',
    catalogKey: 'professionalExamNames', chain: 'catalog', jsonHint: 'string or null',
    description: '"professionalExamName" copies verbatim a SPECIFIC named licensure/board exam (e.g. "LET", "CPA Board Exam", "Civil Engineering Board Exam") — distinct from "professionalExamResult", which is only the pass/fail/not-taken outcome without naming which exam. Only set when a specific exam is actually named (e.g. "how many passed the LET?"), not for a generic "professional exam" mention with no specific one named.',
    // Real respondents type the full exam name as a sentence, never the
    // bare abbreviation — see resolveCatalogMatch's own comment on
    // `synonymSubstrings`. Extend this map as more real abbreviation
    // mismatches are caught live (same discipline as "NA" for BSIT's
    // Network Administration track).
    synonymSubstrings: {
      LET: 'teachers',
      CSC: 'civil service',
    },
  },
  {
    key: 'graduationYear', type: 'custom', resolve: resolveGraduationYear,
    jsonHint: 'number (4-digit graduation year, e.g. 2023) or null',
    description: '"graduationYear" is the 4-digit batch/graduation year explicitly named in the question (e.g. "2023 graduates", "batch of 2021", "class of 2020") — only set when a specific year is actually named, never guessed, never defaulted to the current year, and never inferred from "recent"/"latest" wording (those have no single real year to set).',
  },
  {
    key: 'promotedInJob', type: 'boolean-yesno', dbField: 'promotedInJob', trueMatch: /^yes$/i,
    partLabel: 'was promoted in their job', jsonHint: 'true | false or null',
    description: '"promotedInJob" is true only if asking about alumni who got promoted; "professionalCertifications" is true only if asking about alumni who hold professional certifications (distinct from "professionalDevelopmentActivities", which is about participating in development activities generally, not holding a certification); "pursuedTrainings" is true only if asking whether alumni underwent trainings (distinct from "trainingType", which is for naming a SPECIFIC kind of training).',
    backstop: { pattern: /\bpromot(?:ed|ion)\b/i, resolve: () => true },
  },
  {
    key: 'professionalCertifications', type: 'boolean-yesno', dbField: 'professionalCertifications', trueMatch: /^yes$/i,
    partLabel: 'has professional certifications', jsonHint: 'true | false or null', description: null,
    backstop: { pattern: /\bcertifications?\b/i, resolve: () => true },
  },
  {
    key: 'pursuedTrainings', type: 'boolean-yesno', dbField: 'pursuedTrainings', trueMatch: /^yes$/i,
    partLabel: 'pursued trainings', jsonHint: 'true | false or null', description: null,
    backstop: { pattern: /\btrainings?\b/i, resolve: () => true },
  },
  {
    key: 'skillRating', type: 'custom', resolve: resolveSkillRating,
    jsonHint: '{"skill": "technicalSkills" | "problemSolvingSkills" | "communicationSkills" | "projectManagement" | "teamworkCollaboration" | "adaptability" | "workLifeBalance" | "criticalThinkingSkills", "rating": "Excellent" | "Competent" | "Satisfactory" | "Beginner" | "Non-Acceptable" or null} or null',
    description: '"skillRating" is for a question about alumni\'s SELF-RATED competency on one of the tracer form\'s 8 personal-growth skills (NOT "professionalCertifications"/"pursuedTrainings"/"professionalDevelopmentActivities", which are separate yes/no questions about activities, not self-ratings). Map the question\'s own wording for the skill to exactly one of: "technicalSkills" (technical skills), "problemSolvingSkills" (problem solving/critical reasoning), "communicationSkills" (communication), "projectManagement" (project management), "teamworkCollaboration" (teamwork/collaboration), "adaptability" (adaptability/flexibility), "workLifeBalance" (work-life balance), "criticalThinkingSkills" (critical thinking). If the question also names a rating level, map it to exactly one of the 5 real values: "excellent"/"outstanding" → "Excellent"; "competent"/"good"/"proficient" → "Competent"; "satisfactory"/"fair"/"average" → "Satisfactory"; "beginner"/"weak"/"needs improvement" → "Beginner"; "non-acceptable"/"poor"/"unacceptable" → "Non-Acceptable". Set "rating" to null if the question asks about the skill generally without naming a level. Only set "skillRating" at all when a specific skill is actually named — never guess one from a generic "skills"/"competencies" mention with no specific skill named.',
    // Comparison support ("Excellent vs Satisfactory in technical skills",
    // or just "ratings for technical skills vs problem solving" naming no
    // level at all) — see resolveSkillNameFromText's own comment above.
    backstop: {
      pattern: SKILL_NAME_BACKSTOP_PATTERN,
      resolve: (m) => ({ skill: resolveSkillNameFromText(m[1]) }),
    },
  },
  {
    key: 'yearsInJob', type: 'custom', resolve: resolveYearsInJob,
    jsonHint: '"Less than 6 months" | "6 months to 1 year" | "1 to 2 years" | "2 to 3 years" | "3 to 5 years" | "More than 5 years" or null',
    description: '"yearsInJob" is set ONLY when the question\'s phrasing matches ONE of these closed ranges WORD-FOR-WORD in meaning: "3 to 5 years"/"3-5 years" → "3 to 5 years"; "2 to 3 years" → "2 to 3 years"; "1 to 2 years" → "1 to 2 years"; "6 months to 1 year"/"6 months to a year" → "6 months to 1 year"; "less than 6 months"/"under 6 months"/"new to the job" → "Less than 6 months". For EVERY OTHER years-in-job phrasing — "more than N years"/"over N years"/"at least N years"/"N+ years", AND ALSO a bare "N years"/"for N years"/"employed for N years" with no range words and no "more than" either — set "yearsInJobMoreThan" to the plain number N instead; do NOT set "yearsInJob" for these. A bare "N years" is deliberately treated the same as "more than N years" here, NOT guessed into whichever of the two closed buckets adjacent to N happens to sound right — two different closed buckets could each partially apply to a bare "N years" (e.g. "employed for 2 years" sits exactly on the boundary between "1 to 2 years" and "2 to 3 years"), and guessing one over the other produces a different, unstable answer each time asked. The downstream system resolves "yearsInJobMoreThan" into a disclosed, honest approximation — never attempt this resolution yourself, just extract the raw number N.',
  },
  {
    key: 'yearsInJobMoreThan', type: 'custom', resolve: () => null /* handled together with yearsInJob above */,
    jsonHint: 'number or null', description: null,
  },
  {
    key: 'specialization', type: 'custom', resolve: resolveSpecializationFilter,
    jsonHint: '"TSM" | "WMA" | "NA" | "Business Analytics" or null',
    description: '"specialization" is set to exactly "TSM", "WMA", or "NA" whenever the question names one of BSIT\'s three specializations/tracks — these ALWAYS go here, NEVER in "course" (see that field\'s own warning). Map each of these spoken-out forms to its code: "TSM" stays "TSM"; "WMA" stays "WMA"; "Network Administration" (the full spoken-out name alumni/staff actually use) maps to "NA" — "NA" is this REAL track\'s code, NOT "not applicable"/"none", never skip it or treat it as a non-answer. BSIS has exactly one tracked specialization, "Business Analytics" — set "specialization" to the literal string "Business Analytics" when the question names it (course stays null, same as BSIT). No other program has a tracked specialization; do not set this for any other program or guess one from a generic "specialization"/"track" mention with no specific one named (that is a "ranking" question instead, not a filter). Examples: "how many TSM students are employed" -> specialization "TSM"; "how many Network Administration students are there" -> specialization "NA"; "how many BSIS Business Analytics students are employed" -> specialization "Business Analytics" (course stays null either way — the downstream system already knows which program a specialization belongs to).',
  },
  {
    key: 'customQuestion', type: 'custom', resolve: resolveCustomQuestion,
    jsonHint: '{"label": string, "value": string or null} or null',
    description: '"customQuestion" is for a tracer-form question that doesn\'t match any of the fields above — set "label" to the exact topic phrase asked about, "value" to a specific answer value if one was named, else null. Only use this when nothing above already covers it.',
  },
  // personName has no `resolve` of its own — a specific-person lookup is a
  // fundamentally different query shape (find ONE real alumni account by
  // name, not filter a population), handled entirely by
  // computeVerifiedPersonLookup in verifiedCount.js, which reads
  // plan.personName directly rather than going through the generic
  // per-field resolver loop like every other field here does. Still
  // registered (not just a bespoke extractor-prompt addition) so the schema
  // block/field-rules block below stay single-source-of-truth generated,
  // same as every other field.
  {
    key: 'personName', type: 'custom', resolve: () => null,
    jsonHint: 'string or null',
    description: '"personName" is set ONLY when the question asks about ONE SPECIFIC NAMED alumnus by their actual name (e.g. "What is Juan Dela Cruz\'s employment status?", "Tell me about Maria Santos", "Where does Pedro Reyes work?") — copy the name VERBATIM as written, do not correct spelling or guess a full name from a partial one. This is NEVER set for a question asking about a GROUP of alumni (e.g. "who are the employed BSIT alumni" — that is the "names" intent, not this field) — personName is exclusively for a single, specifically-named individual. When set, every other filter field should stay null; the person\'s own record answers the question, not a filtered count.',
  },
];

const FIELD_REGISTRY_BY_KEY = Object.fromEntries(FIELD_REGISTRY.map((e) => [e.key, e]));

module.exports = {
  FIELD_REGISTRY,
  FIELD_REGISTRY_BY_KEY,
  TYPE_RESOLVERS,
  exactMatch,
  findCatalogComparisonValues,
  findCustomQuestionComparisonValues,
  findYearComparisonValues,
  findSingleYearMention,
  dropPlaceholders,
  fuzzyLabelMatch,
  PLACEHOLDER_VALUE_PATTERN,
  COMPARISON_PATTERN,
  BARE_STATUS_BREAKDOWN_PATTERN,
  CROSSTAB_PATTERN,
  CORRELATION_PATTERN,
  SKILL_NAME_BACKSTOP_PATTERN,
  resolveSkillNameFromText,
  UNSUPPORTED_CONDITION_PATTERNS,
  detectUnsupportedConditions,
  PROGRAM_MAJOR_GROUPS,
  unresolvedScopeMessage,
  resolveSpecializationRankingTarget,
  buildRankingFieldMap,
  SKILL_RATING_VALUES,
  SKILL_FIELD_LABELS,
  findAllSkillMatches,
  findUnmatchedSkillMentions,
  SPECIALIZATION_VALUES,
};
