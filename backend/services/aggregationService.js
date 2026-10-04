const Graduate = require('../models/Graduate');

const User = require('../models/User');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const AlumniEmployment = require('../models/AlumniEmployment');
const Event = require('../models/Event');
const AttendanceLog = require('../models/AttendanceLog');
const EventFeedback = require('../models/EventFeedback');
const { runWithCollegeScope, getCollegeScope } = require('../utils/collegeScope');

// filters.gender gets interpolated into a `^...$` $regex at every gender
// call site below — harmless for "Male"/"Female", but the real stored value
// "LGBTQIA+" contains a literal "+", a regex quantifier. Unescaped, `^LGBTQIA+$`
// means "one or more A" instead of a literal trailing "+", so it silently
// never matched the actual data. Every one of those call sites needs this.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Default preview size for a names-list answer, and the raised cap used once
// filters.showAll is set (an explicit "show all"/"see the full list"
// follow-up) or filters.showLimit exceeds it — the dataset is currently a
// few hundred records at most, so this still isn't truly unbounded, just
// generous enough to cover it. Declared here (not just above queryNames())
// so extractFilters() can also reference NAMES_FULL_LIMIT as the cap for an
// explicit "show 50" request.
const NAMES_PREVIEW_LIMIT = 15;
const NAMES_FULL_LIMIT = 500;

// Builds the $regex pattern for matching (or, via the exclude call sites,
// negating) an employmentStatus filter value. Bare "Yes" folds in
// "Self-Employed" — every OTHER employment-count surface in this app
// (queryEmployment()'s summary, the Admin Dashboard's "Employed Alumni" tile,
// employmentController.getEmploymentStats()) already treats Self-Employed as
// a form of "employed," but this file's own count/names/industry queries only
// matched the literal "Yes" status, silently excluding the self-employed
// group. Caught live: the chatbot answered 172 for "how many alumni are
// employed" while the Admin Dashboard's tile (built from the same underlying
// data) showed 177 — a 5-record gap partly caused by this alone. Every OTHER
// status (No/Never Employed/Self-Employed itself when explicitly asked) is
// unaffected — only the bare "Yes" case folds in the extra alternative.
function employedStatusPattern(status) {
  return status === 'Yes' ? '^(yes|self[- ]?employed)' : `^${status}`;
}

// workLocation is a free-text field, not a real two-value enum — the tracer
// form's own radio options are "Local (within your home country)"/"Abroad
// (outside your home country)", but bulk-migrated records often carry a
// literal city name instead ("Clark", "Taguig", "Clark, Pampanga"). Every
// one of those IS local (a Philippine city can't be "abroad"), so the only
// reliable signal is whether the value mentions abroad/overseas at all —
// anything that doesn't is Local, regardless of exact wording.
const ABROAD_REGEX = /abroad|overseas/i;

// Canonical label used to bucket a raw workLocation value into exactly the
// two categories the tracer form's own options describe — used both by the
// aggregation $group stages (so charts don't fragment into one bucket per
// stray city name) and anywhere a human-readable label is shown.
function normalizeWorkLocationLabel(raw) {
  if (!raw) return null;
  return ABROAD_REGEX.test(raw) ? 'Abroad (outside your home country)' : 'Local (within your home country)';
}

// Builds the $match condition for filters.workLocation ('local'/'abroad')
// + filters.negateWorkLocation. Resolves to a single "does this value count
// as abroad?" test (via ABROAD_REGEX) so "local" correctly matches free-text
// city names too, and negation is derived by flipping that same test rather
// than re-matching the literal word "local"/"abroad" (which silently missed
// city names — negating "local" that way would have wrongly caught them as
// "not local").
function workLocationCondition(location, negate) {
  const wantsAbroad = (location === 'abroad') !== !!negate;
  return wantsAbroad
    ? { $regex: ABROAD_REGEX }
    : { $nin: [null, ''], $not: ABROAD_REGEX };
}

// ─── Intent Detection ─────────────────────────────────────────────────────────

// Any TWO (or more) of the real employmentType categories mentioned
// together — "Regular/Permanent vs Casual/Contractual", "part-time or
// project-based", "regular vs contractual vs part-time" — reads as a request
// to COMPARE across types, not to filter down to a single one. Confirmed
// against the actual tracer form's "present employment type" dropdown:
// Regular/Permanent, Casual/Contractual, Part-time, Project-based,
// Self-employed (Graduate.employmentType stores these strings verbatim —
// see backend/models/Graduate.js). "full-time" is kept as a recognized
// keyword even though it isn't one of the 5 real stored values (users
// naturally phrase the comparison that way) — queryWorkType()'s real
// breakdown, not a fabricated "full-time" count, is what actually answers it.
// A REGEX alone can't reliably tell "regular or permanent" (one filter, two
// words for the SAME value) apart from "regular or part-time" (a genuine
// two-value comparison) — this counts DISTINCT normalized keywords instead
// of just testing for a connector word, treating "regular"/"permanent" as
// the same underlying value (they're stored as one combined string,
// "Regular/Permanent") so that exact phrase still correctly resolves to the
// single-value COUNT path a live test case already depends on, not this
// multi-type comparison path.
//
// Shared by TOPIC_PATTERNS.work_type's early detectTopic() special-case
// below (routes to queryWorkType()'s full, always-charted employmentType
// breakdown) and extractFilters() further down (which must NOT narrow
// filters.employmentType to just one side of a real comparison — see that
// call site's own comment for the live bug this avoids: "part-time" alone in
// the WORK_TYPE_MAP loop would otherwise filter the whole breakdown down to
// Part-time only, defeating the comparison).
const WORK_TYPE_KEYWORD_PATTERN = /\b(regular|permanent|part-?time|full-?time|casual|contractual|project-?based|self-?employed|temporary|probationary|trainee|job\s*order|on\s+training|gip)\b/gi;
function isWorkTypeComparisonQuestion(question) {
  const matches = question.match(WORK_TYPE_KEYWORD_PATTERN) || [];
  const normalize = (w) => /^(?:regular|permanent)$/i.test(w) ? 'regular/permanent' : w.toLowerCase().replace(/[\s-]/g, '');
  return new Set(matches.map(normalize)).size >= 2;
}

// Shared by extractFilters() (single-value filters.employmentType, and the
// comparison-mode filters.employmentTypesRequested list) and queryWorkType()
// (which filters its real DB-grouped rows down to just the requested labels
// for a comparison, instead of always dumping the full ~12-category
// breakdown). Patterns are tested directly against the REAL stored
// employmentType strings too (not just the question text) — "contractual"
// substring-matches both the legacy standalone "Contractual" row and the
// current form's combined "Casual/Contractual" row, which is deliberate:
// asking about "contractual" alumni should surface either real spelling
// without the caller needing to know which one is actually in the database.
const WORK_TYPE_MAP = [
  [/\b(?:regular|permanent)\b/i, 'Regular/Permanent'],
  [/\bjob\s*order\b/i,           'Job Order'],
  [/\bpart-?time\b/i,            'Part-time'],
  [/\bcontractual\b/i,           'Contractual'],
  [/\btemporary\b/i,             'Temporary'],
  [/\bprobationary\b/i,          'Probationary'],
  [/\bcasual\b/i,                'Casual'],
  [/\bproject-?based\b/i,        'Project-based'],
  [/\bself-?employed\b/i,        'Self-employed'],
  [/\btrainee\b/i,               'Trainee'],
  [/\bon\s+training\b/i,         'On Training'],
  [/\b(?:gip|government\s+internship)\b/i, 'GIP'],
];

// "full-time vs part-time" — "full-time" has no WORK_TYPE_MAP entry (no
// distinct stored value corresponds to it), so a comparison naming it needs
// to say so explicitly rather than silently act as if only "part-time" was
// ever asked about.
const FULL_TIME_PATTERN = /\bfull-?time\b/i;

// Every WORK_TYPE_MAP label the question mentions, deduped — used for
// comparison-mode questions ("Regular/Permanent vs Casual/Contractual") to
// know exactly which rows to keep, as opposed to isWorkTypeComparisonQuestion()
// above, which only needs to know THAT two or more are mentioned, not which.
function matchedWorkTypeLabels(question) {
  return [...new Set(WORK_TYPE_MAP.filter(([pat]) => pat.test(question)).map(([, label]) => label))];
}

// None of these have a dedicated tracer-study question OR a reasonable
// closest-available proxy (confirmed against tracerFormConfigController.js's
// full question list) — unlike "curriculum relevance" (which has a genuine
// proxy in jobRelatedToDegree/job_relevance), there's nothing meaningfully
// close to substitute here, so these decline plainly instead of asking
// "would you like to see X instead?" for an X that doesn't really answer the
// question either. Without this, all three fell through to bare
// EMPLOYMENT_SIGNAL (\bjob\b/\bwork\b) and silently answered with the
// generic Employed/Unemployed/Self-Employed breakdown — a confidently wrong
// answer to a completely different question, with no disclaimer at all
// (worse than the curriculum-relevance case, which at least explained
// itself before this fix).
// NOTE: "work-life balance" briefly sat in this list too — WRONG, it's a
// real tracked rating category (Graduate.competencies.workLifeBalance, part
// of the tracer form's "Personal Growth" ratings — see TOPIC_PATTERNS.
// competencies' own "personal/professional growth" trigger below). Removed
// once that was confirmed against the actual live form, not just this file.
// "salary" (and its synonyms/Tagalog forms) doesn't satisfy EMPLOYMENT_SIGNAL
// at all (no "job"/"work"/"employ"/"status" substring), so a bare "What is
// the average salary of alumni?" matched NO topic here whatsoever and fell
// all the way through to the generic RAG/vector-search fallback — which
// correctly declines (no embedded salary content exists to hallucinate
// from), but with the same vague "I could not find relevant information...
// rephrase your question" text every OTHER unrelated failure gets, instead
// of clearly saying salary specifically isn't tracked. detectTopic() below
// has its own early special-case routing this straight to 'employment' (see
// that function's own comment) so it reaches this same untracked-concept
// decline instead of the RAG path at all.
// "suweldo" (alt spelling of "sweldo") and "buwanang kita"/"kita sa trabaho"
// added — bare "kita" alone is deliberately excluded (it's also the common
// Tagalog word for "see"/"visible" — "makikita", "kita kita" — too ambiguous
// on its own; only the income-specific compound phrases are safe).
const SALARY_PATTERN = /\bsalar(?:y|ies)\b|\bincome\b|\bcompensation\b|\bwages?\b|\bearn(?:ings?|s)?\b|\bsahod\b|\bs(?:uw|w)eldo\b|\b(?:buwanang|buwan-buwan(?:g)?)\s+kita\b|\bkita\s+sa\s+trabaho\b/i;

// Shared by TOPIC_PATTERNS.competencies below, queryInner()'s trend-detection
// bypass (isPersonalOrProfessionalGrowth), and detectTopic()'s own early
// special-case — kept as one constant so a Tagalog phrasing added here
// doesn't need to be duplicated three times and risk drifting out of sync.
// "paglago"/"pag-unlad" are the natural Tagalog nouns for "growth"; "bilang
// tao/indibidwal/propesyonal" ("as a person/individual/professional") covers
// the verb-phrase form ("paano lumago...") without the noun "paglago" itself.
const PERSONAL_GROWTH_PATTERN = /\b(?:personal|professional)\s+growth\b|\b(?:personal|propesyonal)\s+na\s+(?:paglago|pag-?unlad)\b|\bpaglago\s+(?:bilang\s+)?(?:tao|indibidwal|propesyonal)\b/i;

// queryInner()'s trend-detection bypass (below) used to match the verb-root
// alternatives (improv/declin/increas/decreas/grow/worsen/drop) completely
// BARE — each one is an ordinary English word with no inherent connection to
// a trend question on its own ("improving their skills," "a drop in
// temperature"), the exact same false-positive shape "grow" already had
// against "personal/professional GROWTH" (see isPersonalOrProfessionalGrowth
// at this bypass's own call site) before that one got its own targeted
// exclusion. Caught live, far more sharply: a question opening with "DROP
// TABLE tracer_responses; --" (a SQL-injection-style string pasted ahead of
// a real question) matched the bare "drop" alternative and silently
// replaced the real embedded question ("What is the employment rate?") with
// an unrelated by-year breakdown. Not an actual SQL injection risk — this
// backend is MongoDB/Mongoose throughout, no raw query string is ever built
// from user text, "DROP TABLE" is inert here — but a real false-positive in
// this heuristic's own word list, generalized here to every verb-root at
// once (not just "grow") rather than patching each collision one at a time
// as it's found. Each verb-root now only counts as a trend signal when it
// actually sits near a rate/employment-shaped subject word, in either word
// order ("employment IS DROPPING" / "DROPPING employment rate") — "trend"/
// "year-over-year"/"over time" are unambiguous on their own and stay bare.
const TREND_SUBJECT_WORD = '(?:rate|employment|job|jobs|percentage|percent|numbers?|alumni|graduates?)';
const TREND_VERB_ROOT = '(?:improv|declin|increas|decreas|grow(?:ing|th)?|worsen|drop(?:ping|ped)?)\\w*';
const TREND_PATTERN = new RegExp(
  '\\btrend\\b|\\byear[\\s-]over[\\s-]year\\b|\\bover\\s+time\\b'
  + `|\\b${TREND_VERB_ROOT}\\b.{0,30}\\b${TREND_SUBJECT_WORD}\\b`
  + `|\\b${TREND_SUBJECT_WORD}\\b.{0,30}\\b${TREND_VERB_ROOT}\\b`,
  'i'
);

// "Which batch year had the most graduates?" / "Which batch has the highest
// unemployment rate?" — the trigger for queryInner()'s own "which batch/year
// has the highest/lowest X" ranking bypass (further below). Named and
// extracted here (not left inline at that one call site) because a SECOND
// place needs the exact same test: the "bare chart-only continuation" guard
// a few hundred lines earlier checks `topic === null` to decide whether a
// chart-type request carries no real content of its own and should bail out
// for ragService.js to retry with the real prior question — but this
// ranking bypass runs INDEPENDENTLY of detectTopic()/topic (it matches
// directly against the raw question text), so `topic` stays null even for a
// fully self-contained, answerable ranking question like "which batch had
// the most graduates." Caught live: "which batch had the most graduates
// (make it a line graph)" has real content of its own (the ranking
// question) but got wrongly bailed out as if it were a bare, content-free
// "make it a line graph" follow-up, because topic was null and a chart was
// requested — never even reaching the ranking bypass that would have
// answered it correctly. See that guard's own comment for the full fix.
const BATCH_YEAR_SUPERLATIVE_PATTERN = /\bwhich\s+(?:graduation\s+)?(batch|year)\b/i;
const SUPERLATIVE_DIRECTION_WORD_PATTERN = /\b(most|highest|fewest|least|lowest)\b/i;

// "What trainings did alumni attend?" / "which seminars/workshops have
// alumni attended?" ask about SELF-REPORTED tracer-study professional
// development (Graduate.furtherTraining) — but 'events' sits much earlier
// in TOPIC_PATTERNS below and its own bare "attend(ed/ees/ance)" alternative
// (deliberately broad, see its own comment) wins outright before
// further_training's pattern ever gets a turn, same object-order collision
// class as isWorkTypeComparisonQuestion/SALARY_PATTERN above. Caught live:
// "What trainings did alumni attend?" routed to the college-picker clarify
// question, then answered with a specific CALENDAR EVENT's attendance count
// ("3 alumni attended CCS Tech Summit 2026...") instead of the tracer
// study's own trainings-pursued data — a confidently wrong answer to a
// different question. Scoped to "trainings/seminars/workshops" as the
// question's own grammatical subject (not a specific named event) so a
// genuine "who attended the IT Training Summit?" (naming one real calendar
// event) still correctly falls through to events below. Second alternative
// covers the reverse word order ("how many alumni PURSUED trainings" — verb
// before the noun) — caught live separately: 'count' sits even earlier than
// 'events' in TOPIC_PATTERNS and its own bare "how many...alumni"
// alternative won the same way, answering the plain unfiltered headcount
// (703) instead of the pursued/not-pursued breakdown.
// "dumalo"/"pumunta" (Tagalog "attended"/"went to") added alongside
// attend\w* — caught live: "Ilan ang mga alumning dumalo sa seminar o
// workshop?" shares no substring with the English "attend*" root at all
// (a completely different word, not a spelling variant), so it matched
// NEITHER alternative here and fell through to 'events' instead (same
// collision class this pattern already exists to prevent for the English
// phrasing) — answered "No event matching 'seminar o workshop' found"
// instead of the real tracer-study trainings-pursued breakdown.
const TRACER_TRAINING_QUESTION_PATTERN = /\b(?:what|which|how\s+many)\b.{0,25}\b(?:trainings?|seminars?|workshops?)\b.{0,25}\b(?:attend\w*|pursu\w*|took|take|have|has|did|dumalo|pumunta)\b|\b(?:how\s+many|ilan(?:g)?)\b.{0,25}\b(?:attend\w*|pursu\w*|took|take|nag-?training|dumalo|pumunta)\b.{0,15}\b(?:trainings?|seminars?|workshops?)\b/i;

// Shared by TOPIC_PATTERNS.competencies below and extractFilters()'s COMP_MAP
// (the filters.competency='workLifeBalance' extraction) — same reasoning as
// PERSONAL_GROWTH_PATTERN just above.
const WORK_LIFE_BALANCE_PATTERN = /\bwork.?life\s+balance\b|\bbalans[e]?\s+(?:ng|sa)\s+(?:buhay\s+at\s+trabaho|trabaho\s+at\s+buhay|buhay(?:\s+at)?\s*trabaho)\b|\bbalanse\s+ng\s+buhay\b/i;

const UNTRACKED_EMPLOYMENT_CONCEPTS = [
  {
    pattern: /\bjob\s+satisfaction\b|\bsatisf(?:ied|action)\b.{0,25}\b(?:jobs?|work)\b|\b(?:jobs?|work)\b.{0,25}\bsatisf(?:ied|action)\b|\bkasiyahan\b.{0,40}\btrabaho\b/i,
    label: 'job satisfaction',
  },
  {
    // "...found a job WITHIN 6 months of graduation" / "...within a year
    // after graduating" added — a different grammatical shape of the exact
    // same untracked concept (time elapsed before finding a job), caught
    // live: this phrasing matched NEITHER the "how long"/"time to"
    // alternatives already here, so the question fell all the way through
    // to the generic employment-status topic and answered with the bare
    // OVERALL employment rate (68.6%) as if it had actually addressed the
    // "within 6 months" timing — a real, correctly-computed number
    // answering a completely different question than the one asked.
    pattern: /\bhow\s+long\b.{0,25}\b(?:find|land|get|secure|got)\b.{0,20}\b(?:first\s+)?(?:jobs?|employ\w*)\b|\btime\s+to\b.{0,15}\b(?:first\s+)?(?:jobs?|employ\w*)\b|\b(?:found|landed|got|secured)\b.{0,15}\b(?:a\s+)?jobs?\b.{0,15}\bwithin\b.{0,25}\b(?:months?|years?)\b|\bwithin\b.{0,25}\b(?:months?|years?)\b.{0,25}\bof\s+graduat\w*\b|\bgaano\s+katagal\b.{0,25}\b(?:makahanap|nakahanap|makakuha|nakakuha)\b.{0,15}\btrabaho\b/i,
    label: 'how long it takes alumni to find their first job',
    // The overall employment rate is a genuinely useful "closest available"
    // substitute here (someone employed AT ALL is at least informative when
    // "employed within a specific timeframe" isn't tracked) — unlike job
    // satisfaction/salary just above and below, which have no comparably
    // close substitute at all. Read by the dedicated handler just below
    // untrackedEmploymentConceptMessage() that offers it as a suggestion,
    // mirroring queryWorkType()'s own "full-time" -> "Regular/Permanent"
    // redirect (see that function's own comment).
    hasRateAlternative: true,
  },
  {
    pattern: SALARY_PATTERN, label: 'salary/income/compensation',
    // Overrides the generic "not tracked" wording below — salary genuinely
    // isn't a tracer study SURVEY question, but it's not entirely unavailable
    // either: a handful of alumni have separately added a salary range to
    // their own Employment Details profile (AlumniEmployment.salary_range —
    // see buildPersonLookupResult()'s own comment). Too sparse a sample
    // (checked live: 4 of 293 profiles) to report as a dataset-wide average
    // or breakdown without it being misleading, but a question naming ONE
    // specific alumnus can check their own profile directly, so the decline
    // should point there instead of flatly claiming no salary data exists
    // anywhere at all.
    customMessage: `Salary/income is not one of the official tracer study survey questions, so there's no dataset-wide average or breakdown to report. A small number of alumni have optionally added a salary range to their own Employment Details profile instead — ask about one specific alumnus by name (e.g. "What is Juan Dela Cruz's salary?") and I can check their profile directly.`,
  },
];
// Exposes the matched entry itself (not just its rendered message) so the
// 'employment' dispatch below can check `hasRateAlternative` and enrich the
// plain decline with a real suggested follow-up for the one concept
// (time-to-employment) that actually has a sensible closest-available
// substitute — see that entry's own comment.
function matchUntrackedEmploymentConcept(question) {
  return UNTRACKED_EMPLOYMENT_CONCEPTS.find(({ pattern }) => pattern.test(question)) || null;
}
// Bulleted (not a run-on comma sentence), shared by both places that render
// this exact "what IS available instead" list (this function, and the
// hasRateAlternative branch in queryInner() further below) so a future edit
// only has to happen once. Bullet formatting also makes ragService.js's
// bulletLineCount>=2 check skip LLM narration entirely for either caller's
// answer, the same protection every other verified deterministic message
// already gets — guarantees these exact lines reach the user unparaphrased.
const AVAILABLE_EMPLOYMENT_MEASURES_LIST = '\n\n- Employment status\n- Employment type\n- Industry\n- Work location\n- Job relevance to course of study\n- Further studies/training\n\n';
function untrackedEmploymentConceptMessage(question) {
  const match = matchUntrackedEmploymentConcept(question);
  if (!match) return null;
  if (match.customMessage) return match.customMessage;
  return `The tracer study does not track ${match.label} as its own question. What is available:${AVAILABLE_EMPLOYMENT_MEASURES_LIST}Please ask about one of those instead.`;
}

// "What is the most common reason alumni gave for being unemployed?" /
// "Why are alumni waiting for the right job opportunity?" / "What reasons
// did alumni give about skills not matching job market demands?" — this
// USED to be declined outright as untracked (see git history on this
// comment) on the belief that the tracer form has no structured "reason for
// unemployment" field at all. That belief was WRONG: TracerStudyResponse.
// reasonsNotEmployed (a real, populated, multi-select field — confirmed
// live: 85 respondents, 13 distinct values, e.g. "Waiting for the right job
// opportunity" cited by 46) has carried this data the whole time; it just
// was never synced onto Graduate (the chatbot's own data source) until now
// — see Graduate.js's own comment on the field. The declining message was
// then not just unhelpful but actively FALSE ("does not track..." for data
// that does exist), and separately, a phrasing that slipped past the old
// decline pattern entirely (no literal "unemployed"/"jobless" substring)
// reached RAG instead, which hallucinated a confident-sounding but WRONG
// answer: it listed several alumni's OTHER, independently-selected reasons
// (Market Saturation, Exploring different career paths, etc.) as if they
// were explanations FOR the skills-mismatch reason specifically, when
// reasonsNotEmployed is multi-select and those are just separate reasons
// the SAME people also happened to pick — a real but miscategorized
// relationship between data points, not an invented one.
//
// Maps a phrase in the QUESTION to the exact canonical reasonsNotEmployed
// string it means — mirrors WORK_TYPE_MAP's "map informal phrasing to the
// real stored value" shape elsewhere in this file. Order doesn't matter;
// patterns are specific enough not to collide with each other.
const UNEMPLOYMENT_REASON_MAP = [
  [/\bskills?\b.{0,20}\b(?:(?:do(?:es)?n'?t|do\s+not|does\s+not)\s+match|not\s+matching)\b|\bskills?\s+mismatch\b|\bskill\s+gap\b/i, 'Skills do not match current job market demands'],
  [/\bwaiting\s+for\s+(?:the\s+)?(?:right\s+)?(?:job\s+)?opportunity\b/i, 'Waiting for the right job opportunity'],
  [/\block\s+of\s+(?:work\s+)?experience\b|\bno\s+(?:work\s+)?experience\b/i, 'Lack of work experience'],
  [/\bpersonal\s+reasons?\b|\bhealth\s+issues?\b|\bfamily\s+obligations?\b|\bgap\s+year\b/i, 'Personal reasons (e.g., health issues, family obligations, gap year)'],
  [/\bexploring\s+(?:different\s+)?career\s+paths?\b|\bcareer\s+paths?\b/i, 'Exploring different career paths'],
  [/\bineffective\s+job\s+search\b|\block\s+of\s+networking\b|\bnetworking\b/i, 'Ineffective job search strategies or lack of networking'],
  [/\bmarket\s+saturation\b|\bincreased\s+competition\b/i, 'Market Saturation (increased competition)'],
  [/\bpursuing\s+further\s+studies\b/i, 'Pursuing further studies'],
  [/\bgeographical\s+constraints?\b|\blocation\s+constraints?\b/i, 'Geographical constraints'],
  // Checked LAST on purpose — "other"/"iba" are common, generic words, only
  // meaningful as a reason-category name once every more specific pattern
  // above has already failed to match. Added so a follow-up naming the
  // breakdown's own "Other" bucket by name (e.g. "ano yung Other na yan?")
  // can resolve to it at all — previously UNEMPLOYMENT_REASON_MAP had no
  // entry for "Other" whatsoever, even though it's a real, displayed row in
  // queryUnemploymentReasons()'s own breakdown output below.
  [/\bother\b|\biba\b/i, 'Other'],
];
function matchedUnemploymentReason(question) {
  const found = UNEMPLOYMENT_REASON_MAP.find(([pat]) => pat.test(question));
  return found ? found[1] : null;
}

// Two distinct shapes this question can take: (a) a GENERIC ask for why
// alumni are unemployed, with no specific reason named ("why are alumni
// unemployed", "what reasons did alumni give for not having a job") — gets
// the full breakdown; (b) a question already naming ONE specific reason
// (resolved via matchedUnemploymentReason() above) alongside a "reasons"
// word anywhere nearby — gets that one reason's count + names, not the
// whole breakdown. "gave"/"give" both covered — "did alumni give" is the
// grammatically correct present-tense form after "did", not a typo of "gave".
const UNEMPLOYMENT_REASON_QUESTION_PATTERN = /\breasons?\b.{0,40}\b(?:unemploy\w*|jobless|without\s+(?:a\s+)?job|no\s+job|not\s+(?:yet\s+)?employed|gave|give|cited|reported)\b|\b(?:unemploy\w*|jobless)\b.{0,30}\breasons?\b|\bwhy\b.{0,30}\b(?:unemploy\w*|jobless|not\s+(?:yet\s+)?employed|waiting\s+for|still\s+(?:looking|searching)|haven'?t\s+(?:found|gotten))\b/i;

function isUnemploymentReasonQuestion(question) {
  const specific = matchedUnemploymentReason(question);
  return UNEMPLOYMENT_REASON_QUESTION_PATTERN.test(question) || (!!specific && /\breasons?\b/i.test(question));
}

// Answers either shape of isUnemploymentReasonQuestion() above with REAL
// Graduate.reasonsNotEmployed data — never RAG narration, so there's no
// chance of the multi-select-conflation hallucination this replaced (see
// this section's own top comment). Scoped by the same stablePipeline()
// filters (program/year/gender) every other breakdown here respects.
async function queryUnemploymentReasons(filters, specificReason) {
  const base = stablePipeline(filters);
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);

  const totalRows = await Graduate.aggregate([
    ...base,
    { $match: { reasonsNotEmployed: { $exists: true, $not: { $size: 0 } } } },
    { $count: 'total' },
  ]);
  const total = totalRows[0]?.total ?? 0;
  if (total === 0) return null;

  if (specificReason) {
    const rows = await Graduate.aggregate([
      ...base,
      { $match: { reasonsNotEmployed: { $elemMatch: { $regex: `^${escapeRegex(specificReason)}$`, $options: 'i' } } } },
      { $project: { name: 1 } },
      { $sort: { name: 1 } },
    ]);
    if (!rows.length) return null;
    const names = rows.map((r) => toTitleCase(cleanText(r.name))).filter(Boolean);
    let out = `**${rows.length}** ${gPrefix}alumni${lbl} cited **"${specificReason}"** as one of their reasons for not being employed (${pct(rows.length, total)} of ${total} who gave a reason — a person may have cited more than one).\n\n`;
    out += `**Alumni who cited this reason:**\n`;
    names.forEach((n) => { out += `- ${n}\n`; });
    return out;
  }

  // No specific reason named — full breakdown, same underlying field as the
  // Admin Dashboard's own unemploymentReasons facet (employmentController.js),
  // just scoped through Graduate/stablePipeline instead of TracerStudyResponse.
  const rows = await Graduate.aggregate([
    ...base,
    { $match: { reasonsNotEmployed: { $exists: true, $not: { $size: 0 } } } },
    { $unwind: '$reasonsNotEmployed' },
    ...caseMergeGroup('$reasonsNotEmployed'),
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  let out = `**Reasons alumni gave for not being employed${lbl}** (${total} respondent${total === 1 ? '' : 's'} who gave at least one reason — a person may have cited more than one):\n\n`;
  rows.forEach((r) => { out += `- **${r.label}**: ${r.count} (${pct(r.count, total)})\n`; });
  return withChart(out, { type: 'bars', title: 'Reasons for Not Being Employed', rows: rows.map((r) => ({ _id: r.label, count: r.count })) });
}

const TOPIC_PATTERNS = {
  // Checked before `events` below — "what's the feedback for the Job Fair"
  // contains no literal "event"/"attend*" word, but DOES contain "for the Job
  // Fair" which the shared extractEventName() trigger already parses, and
  // "feedback on the recent event" contains BOTH "feedback" and "event" — if
  // `events` were checked first it would win and route to the plain event
  // listing/attendance count instead of the feedback summary.
  //
  // NOT a bare "\bfeedback\b" trigger (an earlier version was — corrected):
  // "feedback" IS a real qualitative concept elsewhere in this system (see
  // ragService.js SYSTEM_PROMPT rule 5's own "challenges, reasons, opinions,
  // feedback" list) even though Graduate has no dedicated feedback field, so
  // a bare trigger here hijacked genuine tracer-study feedback questions
  // ("What feedback did alumni give about their experience?") into this
  // event-only path, which then failed with a misleading "No event matching
  // '...' found" instead of ever reaching RAG for the real qualitative
  // content. Event-feedback questions are near-universally phrased "feedback
  // for/on/about X" (the exact shape extractEventName()'s own trigger word
  // list expects) — requiring that adjacency excludes the tracer-study case
  // above (where "feedback" and "about" aren't adjacent: "feedback did
  // alumni give about...") while still matching every realistic event-feedback
  // phrasing.
  // Tagalog "puna"/"komento" require the same "for/about X" adjacency as
  // English "feedback for/on/about" — same reasoning as above: a bare
  // "puna"/"komento" trigger would hijack genuine qualitative tracer-study
  // questions phrased with those words too.
  // Negative lookahead added — "feedback on/about CURRICULUM (relevance)"/
  // "teaching quality"/"training received"/"the tracer study" are real
  // tracer-study qualitative subjects that happen to use the exact same
  // "feedback for/on/about X" adjacency this trigger otherwise correctly
  // relies on. Caught live: "show feedback on curriculum relevance" matched
  // this topic, resolveEvent() found no event named "curriculum relevance",
  // fell to queryEventOverview(), and an unscoped admin got the college-
  // picker CLARIFY_COLLEGE_QUESTION for a question that has nothing to do
  // with events at all. Optional "the/our/this" filler before each excluded
  // noun handles "feedback about THE curriculum" the same as bare
  // "feedback about curriculum".
  // "How many feedback did X receive?" — a COUNT question, distinct from the
  // "feedback for/on/about X" shape above. Requires a trailing
  // receive[d]/submitted/get/got word (not just bare "how many...feedback")
  // — without it, "How many alumni gave feedback about their tracer study
  // experience?" also matched and misrouted to an event lookup that found no
  // event, instead of falling through to RAG for the genuine qualitative
  // tracer-study answer it needed. "received/submitted/got" is specifically
  // how this app's own real phrasings (and EVENT_FEEDBACK_COUNT_PATTERN's
  // own second alternative further below, for the same count shape once
  // already inside this topic) ask "how much feedback did an EVENT get",
  // never how tracer-study feedback is described. Caught live: "How many
  // feedback did Annual Career Fair 2026 receive?" matched no topic here at
  // all (the event's own title ending in a year made extractFilters()
  // misread it as a graduation-batch reference too — see that function's own
  // comment), so aggregationService never even tried
  // queryEventFeedbackCount(), the one function that actually has this
  // answer.
  // \brating\s+(?:ng|para\s+sa)\b used to be a BARE trigger with no "event"
  // proximity requirement at all (every other alternative in this pattern
  // DOES require "event"/"kaganapan" nearby) — caught live: "Anong skill ang
  // may pinakamataas na RATING NG mga alumni sa kanilang sarili?" (a
  // competency-ranking question) contains the literal substring "rating ng"
  // with nothing to do with any event, misrouted into this topic, and
  // confusingly tried (and failed) to resolve it as an event lookup instead
  // of ever reaching the real competency-ranking logic. Narrowed to require
  // "event"/"kaganapan" within the same proximity window its sibling
  // alternatives already use.
  event_feedback:  /\bfeedback\s+(?:for|on|about|regarding)\b(?!\s+(?:the\s+|our\s+|this\s+)?(?:curriculum|kurikulum|course\s+(?:content|quality)|program\s+quality|teaching|training(?:\s+received)?|their\s+(?:experience|learning)|the\s+tracer\s+study))|\b(?:rated|rating)\b.{0,25}\bevent\b|\bevent\b.{0,25}\b(?:rated|rating)\b|\bpuna\s+(?:para\s+sa|tungkol\s+sa|sa)\b|\bkomento\s+(?:para\s+sa|tungkol\s+sa|sa)\b|\brating\s+(?:ng|para\s+sa)\b.{0,25}\b(?:event|kaganapan)\b|\b(?:event|kaganapan)\b.{0,25}\brating\s+(?:ng|para\s+sa)\b|\b(?:how\s+many|number\s+of|count\s+of|total|ilan(?:g)?)\b.{0,25}\bfeedback\b.{0,30}\b(?:receive[ds]?|submitted|get|got|natanggap|nabigay|naisumite)\b/i,
  // Must be checked before `count`/`names` below — "how many alumni attended
  // the job fair" would otherwise match count's "how many...alumni" bare
  // alternative first (object key order = detectTopic()'s iteration/match
  // order), and a bare "job fair" would fall to the generic EMPLOYMENT_SIGNAL
  // \bjob\b fallback at the bottom of detectTopic() before ever reaching
  // here. Object insertion order is load-bearing for this one, not cosmetic.
  // Kept broad (bare "event(s)"/"attend*" anywhere) rather than requiring
  // both words together in one phrase — an earlier version required "event"
  // and a trigger word in the same clause and silently failed to match
  // "how many alumni attended the job fair" (no literal word "event" in it
  // at all) and "how many events do we have" (word order the compound
  // pattern didn't anticipate). Neither word appears anywhere in genuine
  // tracer-study phrasing, so the broad match carries no real collision risk.
  // "dumalo"/"pagdalo" (Tagalog "attended"/"attendance") — this is a PH
  // university portal and coordinators code-switch freely ("Ilan ang dumalo
  // sa Career Fair?"); English-only matching silently fell through to a
  // college-scoped "no tracer study data matching that" refusal for a
  // question this topic can actually answer.
  // "upcoming activities"/"activity calendar" added — narrowly scoped (not
  // a bare "activities", which would collide with the tracer form's own
  // "professional development activities" question — a different topic
  // entirely, further_training's territory) but still catches a natural
  // way to ask about events without the word "event" or "attend" at all.
  // "kaganapan" (Tagalog "event") added — the Tagalog attend*/dumalo/pagdalo
  // triggers already here covered ATTENDING an event, but nothing covered
  // the noun "event" itself in Tagalog, so a purely-Tagalog question with no
  // English "event(s)"/"attend*" word at all ("ilang feedback ang natanggap
  // ng lahat ng KAGANAPAN?") never reached this topic in the first place.
  // "participants?" added — this app's own coordinator UI calls event
  // attendees "Participants"/"Event Participation" (see EventParticipation.jsx),
  // but nothing here recognized that word at all. Caught live: "list the
  // participants for CCS Tech Summit 2026: AI & Web Innovation" matched NO
  // topic here, fell to the generic null-topic rescue further down (which
  // reads extractFilters()'s "answerShape" instead), and extractFilters()
  // separately parsed the bare "2026" IN THE EVENT'S OWN TITLE as a batch/
  // graduation year filter — answering with "Alumni Batch 2026" (a single,
  // unrelated graduate) instead of the event's real attendees.
  events:          /\bevents?\b|\bkaganapan\b|\bparticipants?\b|\battend(?:ed|ees|ance)?\b|\bdumalo\b|\bpagdalo\b|\bupcoming\s+activit(?:y|ies)\b|\bactivit(?:y|ies)\s+(?:calendar|schedule)\b/i,
  // "names? of" used to match bare, with zero requirement that the question
  // have anything to do with alumni — "What is the NAME OF the earthlike
  // planet..." matched it directly and returned an unrelated 50-alumni
  // roster. Now requires "alumni/graduates/respondents" within a few words
  // after "name(s) of." The `.*alumni`/`alumni.*name`-style alternatives
  // are bounded to `.{0,30}` for the same reason (unbounded `.*` risks
  // matching "name" and "alumni" anywhere in a long, unrelated sentence).
  // "who is/are ... alumni|graduates?|respondents?" — "who is the alumni
  // that has a gender of LGBTQIA+" used to fall through to whichever OTHER
  // topic the rest of the sentence happened to trigger (here, `gender`,
  // which answers with a bare count: "There is 1 LGBTQIA+ graduate..."),
  // never actually naming the person the question asked for by name. A
  // genuine single-person question ("who is Liam Miranda") never reaches
  // this far — it's already resolved by extractPersonName()/
  // queryPersonLookup() earlier in queryInner, before topic detection runs
  // at all. An EARLIER version of this fix matched bare "who is"/"who are"
  // with no alumni-noun requirement at all — that silently swallowed
  // completely off-topic questions too ("who is the most famous rapper"
  // matched `names`, returned no data, and answered with the confusing
  // college-scoped "no tracer study data matching that" message instead of
  // the correct plain "that's outside what I can answer"). Requiring an
  // alumni-referring noun within a few words — same convention the
  // "name(s) of" alternative below already uses for the same reason — is
  // what actually distinguishes the two.
  // "sino[-\s]sino ang" — reduplicated "sino" is Tagalog's own way of asking
  // for a LIST of who's ("sino-sino ang mga nagtatrabaho bilang X" = "who
  // are the ones working as X"), same shape as "who are the ..." above but
  // with no equivalent alumni-referring-noun requirement — real phrasings of
  // this construction very often have no such noun at all (as above: no
  // literal "alumni"/"graduates" anywhere), so that same guard would just
  // make this alternative unreachable for the exact case it's meant to catch.
  // Kept safe from off-topic false positives by requiring "ang" right after
  // (the natural, near-universal way this construction is phrased) rather
  // than a bare "sino sino" anywhere in the message.
  // "sino ang mga X" (plain, non-reduplicated "sino") is the far more common
  // everyday phrasing of the same "who are the ones ..." question
  // "sino-sino ang" above catches — but a bare "sino ang X" with no plural
  // marker has the exact off-topic risk described above for bare English
  // "who is"/"who are" ("sino ang pinakamagaling na manlalaro" = "who is
  // the best player", unrelated to alumni). Requiring "ang mga" specifically
  // (the Tagalog plural marker right after "ang") is the equivalent signal
  // reduplication provides for "sino-sino ang" — a question about a GROUP,
  // not a single generic entity — without needing the alumni-noun guard
  // English "who is/are" needs, for the same reason "sino-sino ang" doesn't.
  // The three "saan/ano ang position/kailan" alternatives below answer a
  // per-person DETAIL about an already-established GROUP follow-up ("sila"/
  // "nila"/"they"/"them" — no name of their own, unlike a single-person
  // lookup which extractPersonName()/queryPersonLookup() already resolve
  // earlier in queryInner, before topic detection ever runs) — routed to
  // 'names' too (queryNames() below inspects the question again to decide
  // whether to show work location / graduation year alongside job title).
  // Checked here, not left to fall through to EMPLOYMENT_SIGNAL's generic
  // 'employment' breakdown at the very end of detectTopic() — caught live:
  // "Saan sila nagtatrabaho?" (bare "nagtatrabaho") and "Ano ang position
  // nila?" (bare "position") both satisfy EMPLOYMENT_SIGNAL and used to
  // silently answer with an unrelated employed/unemployed count instead of
  // the location/position actually asked about.
  // "sino ang nagtatrabaho sa X" ("who works at/for X") — a STANDALONE
  // (not-a-follow-up) reverse-lookup-by-company question, added to the
  // pattern below. The English equivalent already matches via the "who
  // works?" alternative already in the pattern; this covers the Tagalog
  // phrasing, which that alternative doesn't reach. Without this, "sino ang
  // nagtatrabaho sa Accenture?" fell all the way to EMPLOYMENT_SIGNAL's bare
  // "nagtatrabaho" fallback ('employment' topic) before this file's own
  // filters.company extraction (which DID correctly resolve "Accenture")
  // ever got a chance to be used — answering an unrelated "0 employed
  // alumni at Accenture" COUNT sentence instead of the names list a "sino"
  // (who) question asks for.
  // "who is/are (currently/still) working/employed/unemployed" — present-
  // continuous/adjectival employment-status phrasing the verb-list
  // alternative just above can't reach (that one requires "who" directly
  // followed by the verb, e.g. "who works", not "who IS working"). Missing
  // this meant "Who is working?" matched no TOPIC_PATTERNS entry at all
  // (see WHO_IS_EXCLUDE_WORDS's own comment for the OTHER half of this same
  // live bug — it also got wrongly captured as a person-name lookup), so
  // detectTopic() fell all the way to the generic EMPLOYMENT_SIGNAL fallback
  // instead of correctly resolving to a names list.
  names:           /\b(who\s+(?:are|is)\s+(?:the\s+|those\s+|these\s+)?(?:\w+\s+){0,4}(?:alumni|alumnus|alumna|graduates?|respondents?)|who (did|do|does|didn'?t|don'?t|doesn'?t|have|has|haven'?t|hasn'?t|were|was|weren'?t|wasn'?t|passed|failed|took|pursued|works?|worked)|who\s+(?:is|are)\s+(?:currently\s+|now\s+|still\s+)?(?:working|employed|unemployed|self-employed)\b|names?\s+of\s+(?:the\s+)?(?:\w+\s+){0,3}(?:alumni|graduates?|respondents?)|list.{0,20}(names?|alumni|graduates?)|show.{0,20}(names?|alumni|graduates?)|which alumni|which graduates?|name.{0,30}alumni|alumni.{0,30}name|graduates?.{0,30}name|name.{0,30}graduates?)\b|\bsino[\s-]*sino\s+ang\b|\bsino\s+ang\s+mga\b|\bsaan\s+(?:sila|sina|nila|silang)\b.{0,20}\b(?:nagtatrabaho|nagwowork|naninirahan|nakatira)\b|\bwhere\s+(?:do|does)\s+they\s+work\b|\bano\s+ang\s+(?:trabaho|posisyon|position)\s+(?:nila|niya)\b|\bwhat\s+(?:is|are)\s+their\s+(?:job\s+title|position|occupation)s?\b|\bkailan\s+(?:sila|silang)\b.{0,15}\b(?:nagtapos|natapos|nag-?graduate|nagsi-?graduate)\b|\bwhen\s+did\s+they\s+graduate\b|\bsino\b.{0,15}\b(?:nagtatrabaho|nagwowork|empleyado)\s+sa\b|\bpangalan\s+ng\s+(?:mga\s+)?(?:\w+\s+){0,3}(?:alumni|guraduwado|nagtapos|respondents?)\b/i,
  // "ilan"/"ilang" (Tagalog "how many") — requires an alumni-referring noun
  // nearby, same as the English alternatives above, and NOT bare — bare
  // "ilan" is common enough in casual Tagalog phrasing of every other topic
  // ("ilan ang nasa gobyerno", "ilan ang babae") that an unqualified match
  // here would win topic detection before work_type/gender/etc. ever got a
  // turn (count is checked early), silently answering with a generic total
  // count instead of the actually-asked-about breakdown. "ilang" (not just
  // "ilan") is required too — Tagalog's "-ng" linker attaches directly to a
  // following vowel-initial word ("ilan" + alumni → "ilang alumni"), so
  // requiring the bare "ilan\b" form alone missed this the first time.
  // Must be checked before `count` below — "how many alumni have updated
  // their tracer information" / "...have NOT updated..." / "...recently
  // updated..." and "how many alumni records were added this month" all
  // satisfy count's own bare "how many alumni/records" alternative, which
  // has no concept of submission activity at all and just returned the
  // total tracer-study count for every one of these — the same "262" no
  // matter what the actual question was asking. Caught live: 4 different
  // phrasings (updated/not updated/recently updated/added this month) all
  // produced the identical, wrong answer.
  tracer_activity: /\b(?:updat|submitt|resubmitt|edit|modif|chang)\w*\b.{0,20}\btracer\b|\btracer\b.{0,20}\b(?:updat|submitt|resubmitt|edit|modif|chang)\w*\b|\brecords?\b.{0,15}\b(?:were|have been|got|being)?\s*added\b|\badded\s+(?:this|last)\s+(?:month|week|year)\b/i,
  // "count of (?:\w+\s+){0,4}(alumni|...)" added — "count of employed
  // alumni"/"give me a count of BSIT graduates" is as natural a phrasing as
  // "how many"/"total"/"number of" right above it, but matched none of
  // them (all three require their own specific lead-in word, none of which
  // is "count").
  // "bilang ng" ("number of") added — Tagalog count phrasing that isn't
  // "ilan"/"ilang", which was the only Tagalog trigger covered before.
  count:           /\b(how many (?:\w+\s+){0,4}(alumni|records?|graduates?|respondents?|people)|how many (passed|failed|took|pursued|work\w*|did)|total (alumni|records?|graduates?|respondents?)|number of (alumni|records?|graduates?|respondents?)|count\s+of\s+(?:\w+\s+){0,4}(alumni|records?|graduates?|respondents?)|how many are there|how many alumni are|ilang?\b.{0,20}\b(alumni|guraduwado|nagtapos|respondents?))\b|\bbilang\s+ng\s+(?:mga\s+)?(?:\w+\s+){0,3}(?:alumni|guraduwado|nagtapos|respondents?|sumagot)\b/i,
  // "percentage of (?:\w+\s+){0,3}(graduates?|alumni)" — was bare-adjacent
  // only ("percentage of graduates"), so an informal, prefix-less phrasing
  // like "percentage of BSIT graduates" (a program name sitting between "of"
  // and "graduates") matched NOTHING here, fell through detectTopic() with
  // no topic at all, and got swallowed whole by the bare-industry-noun-
  // phrase heuristic near the end of query() — which then searched the
  // industry field for the literal string "percentage of BSIT graduates",
  // found nothing, and surfaced the generic "I don't have enough data"
  // refusal for a question this app can answer perfectly well.
  //
  // (un)?employment\s+rate, not employment\s+rate — "employment rate" IS a
  // literal substring of "unemployment rate", but the leading \b on the
  // whole alternation can't match mid-word (there's no word boundary
  // between "un" and "employment"), so "unemployment rate" silently missed
  // this pattern entirely and fell all the way through to the generic "I
  // don't have enough data" refusal instead of answering.
  // "rates" (plural) added — "comparing employment RATES across all
  // specializations" has no singular "rate" anywhere (the trailing \b on
  // this whole alternation requires a boundary right after "rate", which
  // "rates" never has — 's' is a word character), so this matched NONE of
  // the alternatives here and fell through past 'rate' entirely, reaching
  // 'by_program' (or, before that pattern itself recognized
  // "specializations"/"across all", the EMPLOYMENT_SIGNAL fallback) instead
  // — losing the "rate" framing and answering with a plain headcount/
  // breakdown instead of the employment RATE comparison actually asked for.
  rate:            /\b(what\s+(percentage|percent|rate)|how\s+many\s+percent|(un)?employment\s+rates?|percentage\s+of\s+(?:\w+\s+){0,3}(graduates?|alumni)|found\s+a\s+job|got\s+a\s+job|porsyento|porsiyento)\b/i,
  // "give me tracer study information" (and similar "tracer ... info/
  // information/details" phrasings, either order) used to match NONE of the
  // alternatives below — "general (data|info|...)" only fires with the
  // literal word "general" right before it, and "tracer.*result" doesn't
  // cover "information"/"details" at all. With no TOPIC_PATTERNS match,
  // this fell all the way through to the college-scope "no data" fallback
  // in ragService.js, which is actively WRONG (not merely unhelpful) — it
  // told a CCS coordinator there was no tracer data for their own college,
  // when the college has plenty; the question was just too generic to hit
  // any specific stat, not actually unanswerable.
  overview:        /\b(tracer survey activity|tracer study activity|overview|summary|overall|general (data|info|information|result|stat)|show.*tracer|tracer.*result|tracer.{0,20}\b(info|information|details)\b|\b(info|information|details)\b.{0,20}tracer|employment\s+breakdown|employment\s+data|employment\s+statistic|buod)\b/i,
  // "What are the most/least common job positions among alumni?" — checked
  // before `industry` (job titles vs industries are different fields
  // entirely) and before falling to the generic EMPLOYMENT_SIGNAL fallback
  // ('employment' topic) at the bottom of detectTopic(), which is what used
  // to catch this: a bare "job"/"position" word satisfies EMPLOYMENT_SIGNAL
  // with no dedicated topic of its own, so both "most common" and "least
  // common" job-position questions silently answered with the generic
  // Yes/No/Self-Employed/Never-Employed status breakdown instead of an
  // actual ranked list of job titles — identical wrong answer either way,
  // completely ignoring what was actually asked.
  // Last alternative added — same "X that has/with the highest/most" gap
  // fixed for BY_PROGRAM_QUESTION_PATTERN above: "the role with the most
  // graduates" or "the job position that has the most alumni" matched none
  // of the "common"/"top" alternatives, which all require that specific
  // wording adjacent to the noun.
  job_positions:   /\b(?:most|least)\s+common\s+(?:job\s+)?(?:positions?|titles?|occupations?|roles?)\b|\bcommon(?:est)?\s+job\s+(?:positions?|titles?)\b|\btop\s+job\s+(?:positions?|titles?)\b|\bjob\s+(?:positions?|titles?)\b.{0,15}\b(?:most|least|common)\b|\b(?:job\s+)?(?:positions?|titles?|occupations?|roles?)\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:most|least|highest|top)\b/i,
  // "What companies employ the most alumni?" — same gap as job_positions
  // just above: a bare "compan(y/ies)"+"employ" satisfies EMPLOYMENT_SIGNAL
  // with no dedicated topic of its own, so this fell all the way through to
  // the generic Yes/No/Self-Employed/Never-Employed status breakdown
  // instead of an actual ranked list of employers — the same wrong answer
  // as any other employment question, ignoring "companies" entirely. Company
  // is elsewhere ONLY ever a narrowing filter (filters.company, "how many
  // work AT Sutherland") — there was no "rank companies by headcount"
  // question shape at all before this.
  // Last alternative added — "the company that has the most alumni"/"the
  // company with the highest number of hires" matched nothing above (all
  // require "employ/hire" verbs or "top/most/least" directly before
  // "company"), the same "that has/with" gap as job_positions and
  // BY_PROGRAM_QUESTION_PATTERN.
  // "top/biggest employers" added — "employers" is as natural a synonym for
  // "companies" as it gets, but every existing alternative required the
  // literal word "compan(y/ies)".
  top_companies:   /\b(?:what|which)\s+compan(?:y|ies)\b.{0,25}\b(?:employ|hire|hiring)\w*\b|\b(?:top|most|least)\s+compan(?:y|ies)\b|\bcompan(?:y|ies)\b.{0,20}\b(?:hire|hiring|employ)\w*\b.{0,15}\balumni\b|\bcompan(?:y|ies)\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:most|least|highest|top)\b|\b(?:top|biggest|most\s+common)\s+employers?\b/i,
  // "field of work" added — a common synonym for "industry".
  industry:        /\bindustr|industriya|field\s+of\s+work\b/i,
  // "freelance(r/rs)" added — a real employment-type category (self-employed
  // gig work) that had no matching alternative at all.
  // "full-time vs part-time" ALSO resolves to this topic (queryWorkType()'s
  // full employmentType breakdown chart — Regular/Permanent, Casual/
  // Contractual, Part-time, Project-based, Self-employed, confirmed against
  // the actual tracer form's "present employment type" dropdown) but is
  // matched as its own early special-case in detectTopic() below, NOT as
  // part of this pattern — 'count' (checked before this topic in object
  // order, same reason 'names'/tracer_activity's own comments explain) would
  // otherwise always win "how many alumni are employed full-time vs
  // part-time?" via its bare "how many...alumni" alternative first, so the
  // comparison needs to be decided before the main topic loop even runs,
  // not by trying to out-order it within this same object.
  work_type:       /\b(government|private|sector|work type|type of (employment|work)|employment type|freelance\w*|gobyerno|pribado)\b/i,
  // "kaugnayan sa" (noun form "relevance to", vs. the adjective "kaugnay"
  // already covered) and "in line with" (a natural English synonym for
  // "related to" that isn't the word "related"/"relevant"/"align" at all)
  // both added — same underlying question, phrasings that fell through.
  job_relevance:   /\b(related|relevance|relevant\s+to\s+(?:the(?:ir)?\s+)?(?:course|study|program|degree|field)|align(?:s|ed|ment)?\s+(?:with|to)\b.{0,20}\b(?:course|study|studied|program|degree|field)|in\s+line\s+with\b.{0,25}\b(?:course|study|program|degree|field))\b|\bkaugnay\s+(?:ng|sa)\s+(?:kurso|propesyon|larangan|programa)\b|\bkaugnayan\s+sa\s+(?:kurso|propesyon|larangan|programa)\b|\bmay\s+kinalaman\s+sa\s+(?:kurso|propesyon|larangan|programa)\b/i,
  // "grad school"/"masteral"/"doctorate" added — casual English and Tagalog
  // synonyms for the same further-education concept "graduate studies"/
  // "masters" already covered. "nag-aral ng masteral" (Tagalog "studied for
  // a master's") had no equivalent phrasing at all before.
  further_studies: /\b(further studies?|graduate studies?|grad\s+school|masters?|masteral|doctorate|phd|post.?grad|further education|nagpatuloy.{0,15}pag-?aaral|magpapatuloy.{0,15}pag-?aaral|nag-?aral.{0,10}(?:ng\s+)?(?:masteral|doktor|masters?))\b/i,
  // "board passers" added — a very natural way to ask this ("board
  // exam" alone wasn't enough; "passers" with no "exam" word matched
  // nothing) that doesn't fit the existing "(tak|pass|fail)...exam"
  // proximity alternative either, since there's no literal "exam" nearby.
  licensure:       /\blicens\w*\b|\b(board\s+(?:exam|passers?)|professional\s+exam|prc|lisensya)\b|\b(tak\w*|pass\w*|fail\w*).{0,20}\bexam\b/i,
  // New topic — Graduate.hasPromotion had a real, normalized, populated
  // field (see queryPromotion()'s own comment) but no TOPIC_PATTERNS entry
  // to ever route a question to it at all.
  // \bna-?promote\b required "na" fused directly onto "promote" (with an
  // optional hyphen) — "na promote" (a real SPACE between them, an equally
  // common casual-Filipino spacing of the same borrowed verb) didn't match
  // at all. \bna(?:ka)?\s?-?\s?promote\b covers "napromote", "na-promote",
  // "na promote", AND the "naka-"/"naka " state-aspect variant
  // ("naka-promote" — caught live: "Sino ang mga alumni na naka-promote?"
  // matched none of these, fell through to the generic 'names' topic with
  // zero filter, and dumped the entire unfiltered 702-alumni roster instead
  // of the real promoted-alumni list).
  // NOTE: an earlier attempt at this used `naka?` (literal "nak" + optional
  // "a") instead of `na(?:ka)?` (literal "na" + optional "ka") — the wrong
  // grouping actually matched "nak"/"naka" and NEVER matched the far more
  // common bare "na-promote"/"na promote" form at all, caught live via
  // systematic Tagalog testing: "Ilan ang mga alumning na-promote sa
  // trabaho?" fell all the way through to the generic bare-count topic
  // (just "264 graduates," no promotion data at all) because of this typo
  // in the fix itself.
  promotion:       /\bpromot(?:ed|ion|ions)?\b|\bna(?:ka)?\s?-?\s?promote\b|\bpinromote\b/i,
  // New topic — same gap as promotion above, for Graduate.furtherTraining.
  // Distinct from further_studies (graduate school) — trainings/seminars/
  // workshops are a completely different tracer-form question with no
  // overlap in wording, so this can't collide with that pattern.
  further_training: /\btrainings?\b|\bseminars?\b|\bworkshops?\b|\bsumali\s+sa\s+training\b|\bnag-?training\b/i,
  // New topic, same gap/fix shape as promotion/further_training above — for
  // Graduate.significantAccomplishments (the tracer form's free-text
  // "describe a significant accomplishment" question). "tagumpay"
  // (success/achievement) and "nakamit" (attained/achieved) are the natural
  // Tagalog nouns for this same concept.
  accomplishments: /\baccomplishments?\b|\bachievements?\b|\btagumpay\b|\bnakamit\b/i,
  // Bare "rating(s)" ADDED — the only thing "rating" ever refers to in this
  // dataset is the competency self-assessment scores (Excellent/Competent/
  // .../Non-Acceptable per category); there's no other "rating" concept for
  // it to collide with. Without this, "What is the average rating of
  // alumni?" matched no TOPIC_PATTERNS entry and no EMPLOYMENT_SIGNAL word
  // either, so it fell through the whole aggregation layer to RAG — which
  // had nothing relevant either — and refused with the generic "I don't
  // have enough data" sentence for a question the competency data could
  // answer perfectly well.
  // "self.?assess" ADDED \w* — the original never actually matched "self
  // ASSESSMENT" (only bare "self assess"/"self-assess"): the alternation's
  // own closing \b required a word boundary immediately after "assess",
  // which "assessment" doesn't have (the word keeps going into "-ment").
  // "skilled" added too — "how skilled are the alumni?" is a completely
  // natural way to ask about the same competency self-ratings, distinct
  // from bare "skill(s)" (skills_list, a different topic entirely — named,
  // concrete skills like Python/Java, not a 1-5 self-rating).
  // "rate themselves"/"rate their own" added — the verb form of the exact
  // same self-rating concept the noun forms ("ratings", "self-assessment")
  // already covered.
  // "personal growth"/"professional growth" added — the tracer form's own
  // section names for this exact rating data (see TracerStudyResponse.js's
  // "Personal Growth (C)"/"Professional Growth (D)" comments) had no trigger
  // here at all, so a question phrased with the form's own terminology
  // ("show personal growth of alumni") never reached this topic — see the
  // isPersonalOrProfessionalGrowth guard in queryInner()'s trend-detection
  // bypass above for the other (worse) half of this same live bug.
  // "work-life balance" added — one of the 8 real rating categories
  // (Graduate.competencies.workLifeBalance) but, unlike "teamwork"/
  // "adaptability"/etc. just above, had no trigger word of its own at all —
  // it doesn't contain "competenc"/"skill"/"rating"/any of the other
  // alternatives here, so a bare "what is the work-life balance of alumni?"
  // matched nothing in this topic even with the personal/professional
  // growth fix above.
  competencies:    new RegExp(
    '\\b(competenc\\w*|skill\\s+ratings?|ratings?|self.?assess\\w*|performance|technical\\s+skills?|communication\\s+skills?|problem.?solving|critical\\s+thinking|teamwork|adaptability|project\\s+management|skilled|rate\\s+(?:themselves|their\\s+own)|kasanayan|kakayahan)\\b|' +
    PERSONAL_GROWTH_PATTERN.source + '|' + WORK_LIFE_BALANCE_PATTERN.source,
    'i'
  ),
  // Bare "skill(s)" — checked AFTER competencies above, so a specific
  // category phrase ("technical skills", "skill ratings") still wins there
  // first; this only catches a bare, unqualified mention ("most common
  // skills", "what skills do alumni have"). Points to Graduate.skills
  // (AlumniEmployment.skills's own free-text list — "Python, Java, SQL",
  // set via the alumni's separate Job Connect/Employment Details profile
  // editor, NOT a tracer-form question) — genuinely different data from
  // competencies' 8 fixed self-rating categories. Was briefly folded into
  // `competencies` itself (routing "most common skills" to the self-rating
  // breakdown instead) until the user pointed out "skills" means concrete
  // named skills like Python/Java, not an abstract rating — this restores
  // that as its own topic pointing at the real underlying field.
  skills_list:     /\bskills?\b/i,
  // "domestic(ally)"/"international(ly)"/"OFW(s)" added — real synonyms for
  // local/abroad that never matched before ("OFW" — Overseas Filipino
  // Worker — is the single most common everyday PH term for "works
  // abroad," arguably more common in casual speech than the literal word
  // "abroad" itself). \bofws?\b explicit (not folded into the shared \b...\b
  // group) since "OFW" needs its own plural "s" handled the same way
  // "graduates?" etc. do elsewhere in this file.
  work_location:   /\b(local(?:ly)?|abroad|work location|place of work|overseas|domestic(?:ally)?|international(?:ly)?|lokal|ibang\s+bansa)\b|\bofws?\b/i,
  // Last alternative on each — "the program that has the most graduates"/
  // "which program has the most graduates"/"the batch with the most
  // alumni" all previously required literal "by/per/each program|batch"
  // wording to route to the per-program/per-year breakdown at all; a plain
  // superlative headcount question with none of that wording matched
  // nothing here (or anything else) and fell through unanswered — same
  // "that has/with" gap as job_positions/top_companies/
  // BY_PROGRAM_QUESTION_PATTERN above.
  // "specialization(s)"/"track(s)" added as synonyms alongside program/
  // course — "specialization" is this app's own vocabulary for a
  // program's track (see PROGRAM_SPECIALIZATIONS above), every bit as real
  // a way to ask for a per-program breakdown as the word "program" itself.
  // "across (all|every) specializations" added as a connector synonym for
  // "by/per/each" — caught live: "compare employment rates across all
  // specializations" matched NONE of the original alternatives (no "by/
  // per/each", no "program"/"course"/"degree" noun at all) and silently
  // fell through to the generic single-number overall rate, completely
  // ignoring the explicit "across all specializations" comparison request.
  by_program:      /\b(by\s+(?:program|course|specialization|track)s?|per\s+(?:program|course|specialization|track)s?|each\s+(?:program|course|specialization|track)|across\s+(?:all|every)\b(?:\s+\w+){0,2}\s+(?:programs?|courses?|specializations?|tracks?)|(?:program|specialization)\s+breakdown|bawat\s+(kurso|programa)|per\s+(kurso|programa))\b|\b(?:program|course|degree|specialization|track)\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:most|least|highest|top|more|fewer)\b/i,
  by_year:         /\b(by (batch|year|graduation)|per (batch|year)|each (batch|year)|year breakdown|batch breakdown|bawat\s+taon|kada\s+taon|per\s+taon)\b|\b(?:batch|year)\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:most|least|highest|top|more|fewer)\b/i,
  // lgbt\w* also covers "lgbtq"/"lgbtqia"/"lgbtqia+" (the actual stored
  // value) — the survey's gender field only has one umbrella option for
  // this ("LGBTQIA+"), not separate gay/lesbian/trans/etc. categories, so
  // any of these terms in a question all resolve to that same value.
  // Kept OUTSIDE the \b(...)\b wrapper the other alternatives share — real
  // messages run it into an adjacent word with no space ("manyLGBT"), and a
  // leading \b there requires a word boundary immediately before "lgbt"
  // that a glued-together typing like that never has. "lgbt" as a raw
  // substring is distinctive enough there's no realistic false-positive risk.
  // lalaki(?:ng)?/babae(?:ng)? — not \blalaki\b/\bbabae\b alone: Tagalog's
  // "-ng" linker attaches directly with no boundary in modifier constructions
  // ("lalaking walang trabaho", "babaeng may trabaho"), the same agglutination
  // issue as "ilan"/"ilang" elsewhere in this file.
  // "boys?"/"girls?" added — as casual/common a way to ask about gender
  // split as "men"/"women" right next to it, but missing entirely before.
  gender:          /\b(gender|\bmale\b|\bfemale\b|\bmen\b|\bwomen\b|\bboys?\b|\bgirls?\b|\bqueer\b|\bgay\b|\blesbian\b|transgender|non.?binary|lalaki(?:ng)?|babae(?:ng)?)\b|lgbt\w*/i,
};

function normalizeQuestion(q) {
  return q
    .replace(/never\s*employed/gi,    'never employed')
    .replace(/self\s*employed/gi,     'self-employed')
    .replace(/further\s*education/gi, 'further education')
    .replace(/further\s*studi/gi,     'further studi')
    .replace(/work\s*location/gi,     'work location')
    .replace(/board\s*exam/gi,        'board exam')
    .replace(/job\s*relat/gi,         'job relat')
    .replace(/by\s*program/gi,        'by program')
    .replace(/by\s*year/gi,           'by year')
    .replace(/by\s*batch/gi,          'by batch');
}

// Words that justify falling back to the general employment breakdown when no
// specific topic pattern matched. Without this gate, ANY unmatched statistical
// question (e.g. "what skills do graduates use?", "average salary?") would
// silently return the employment Yes/No breakdown — a confident answer to the
// wrong question, which is worse than admitting no data is available.
// Tagalog agglutinates prefixes directly onto the root ("nagtrabaho" =
// nag+trabaho, "nagsasariling" = nagsasa+sariling) with no boundary between
// them — bare substring match, same as "employ" above (which already
// deliberately matches inside "unemployed"/"employment"/etc.), not a
// \b-wrapped whole-word match that "nagtrabaho" etc. would silently miss.
// \bstatus\b alone deliberately excludes "civil status"/"marital status" —
// caught live: "What is your civil status breakdown?" has no employ/job/
// work/occupation/position word at all, just "status," which used to be
// enough on its own to confidently answer with the EMPLOYMENT status
// breakdown instead. Civil status isn't one of the fixed tracer fields at
// all (nor, at the time this was caught, any college's actual custom
// question) — the honest answer is "not tracked," not a different field's
// real numbers. Excluding these two specific non-employment "status"
// phrases lets the question correctly fall through to topic === null
// instead, where the custom-question embedding check gets a real chance to
// find an actual matching question (if some college has genuinely added
// one) before declining, instead of EMPLOYMENT_SIGNAL claiming it by
// accident and never giving either path a chance to run.
//
// \bposition\b removed entirely (was here before) for the same reason —
// caught live: "tell me about alumni positions held" has no ranking
// language ("most/least common"), so TOPIC_PATTERNS.job_positions' own
// pattern (which specifically requires that framing) correctly doesn't
// match it, and the bare word "position" alone used to be enough for
// EMPLOYMENT_SIGNAL to claim it anyway and answer with the unrelated
// Employment Status breakdown. Now it falls through to topic === null
// instead, where the custom-question match and the keyword-overlap
// "did you mean" suggestion (both added later this session) get a real
// chance to answer or clarify instead of EMPLOYMENT_SIGNAL grabbing it by
// accident on a single generic word.
const EMPLOYMENT_SIGNAL = /employ|\bjob|\bwork|(?<!civil\s)(?<!marital\s)\bstatus\b|\boccupation\b|trabaho|empleyado|negosyo/i;

// "How did alumni FIND their job" asks about the job-search method/channel
// (referral, walk-in, online posting, agency...) — a question this schema has
// no field for. It still contains "job", so EMPLOYMENT_SIGNAL below would
// otherwise wave it through to the generic employment Yes/No breakdown, the
// exact "confident answer to the wrong question" failure mode the comment
// above warns about — that fallback exists for status/count questions, not
// process questions that happen to mention a status-adjacent word.
const JOB_SEARCH_METHOD_PATTERN = /\bhow\s+(did|do|does|would|can)\s+(?:\w+\s+){0,4}(find|get|land|search\s+for|secure|obtain)\b/i;

// "Show me the visualization/chart/graph of X" — an explicit ask for a
// chart alongside whatever answer text the question would otherwise get.
// Currently wired into queryRate() only (the reported case: the overall
// employment/unemployment rate is a single derived percentage with no
// natural chart of its own, unlike a by-program/by-year breakdown, which
// already always charts regardless of whether a visualization was asked
// for) — not yet applied to every other plain-text-only answer path in this
// file. Extend the same wantsChart wiring to other handlers if those need
// on-request charts too.
const VISUALIZATION_REQUEST_PATTERN = /\b(visuals?|visuali[sz]e|visuali[sz]ation|chart|graph|plot|pie\s*(chart|graph)?)\b/i;

function detectTopic(question) {
  question = normalizeQuestion(question);
  // Decided before the main loop below, not as part of TOPIC_PATTERNS.
  // work_type itself — 'count' sits earlier in that object and its own bare
  // "how many (?:\w+\s+){0,4}alumni" alternative wins "how many alumni are
  // employed full-time vs part-time?" outright before work_type's pattern
  // ever gets a turn (same object-order collision 'names'/tracer_activity's
  // own comments already document for their "ilan ang alumni"/"updated
  // tracer" phrasings — checked live: without this, the question answered
  // with an unrelated "181 employed alumni" total instead of the real
  // Regular/Permanent vs Casual/Contractual vs Part-time vs Project-based vs
  // Self-employed breakdown queryWorkType() actually has).
  if (isWorkTypeComparisonQuestion(question)) return 'work_type';
  // "salary"/"income"/"compensation" doesn't satisfy EMPLOYMENT_SIGNAL below
  // at all (no job/work/employ/status substring) — a bare "What is the
  // average salary of alumni?" matched no topic here whatsoever and fell all
  // the way to the generic RAG fallback's vague "I could not find relevant
  // information... rephrase your question" text, instead of clearly saying
  // salary specifically isn't tracked (see UNTRACKED_EMPLOYMENT_CONCEPTS's
  // own comment). Routed to 'employment' — untrackedEmploymentConceptMessage()
  // there is checked before that topic's normal Employed/Unemployed
  // breakdown and catches this via the same SALARY_PATTERN.
  if (SALARY_PATTERN.test(question)) return 'employment';
  // 'names' sits earlier than 'competencies' in TOPIC_PATTERNS below, and its
  // own broad "show...alumni"/"show...graduates" alternative (any occurrence
  // of "alumni"/"graduates" within 20 chars of "show", regardless of what's
  // actually between them) wins "show personal growth of alumni after
  // graduation" outright before competencies' own new "personal/professional
  // growth" trigger ever gets a turn — same object-order collision class as
  // isWorkTypeComparisonQuestion/SALARY_PATTERN above. Caught live: that
  // exact question returned a plain alphabetical alumni roster instead of
  // the real personal-growth competency ratings.
  if (PERSONAL_GROWTH_PATTERN.test(question)) return 'competencies';
  if (TRACER_TRAINING_QUESTION_PATTERN.test(question)) return 'further_training';
  // 'count' sits earlier than 'promotion' in TOPIC_PATTERNS below, and its
  // own bare "how many (?:\w+\s+){0,4}alumni" alternative wins "How many
  // alumni got promoted in their jobs?" outright ("alumni" sits right after
  // "how many", satisfying count's pattern directly) before promotion's own
  // "\bpromot(?:ed|ion|ions)?\b" trigger ever gets a turn — same object-order
  // collision class as isWorkTypeComparisonQuestion/SALARY_PATTERN above.
  // Caught live: that exact question fell through to queryCount() with no
  // promotion-related filter at all (extractFilters() has no promotion
  // filter to set), silently answering the plain unfiltered headcount (703)
  // instead of the real promoted/not-promoted breakdown.
  if (TOPIC_PATTERNS.promotion.test(question)) return 'promotion';
  // 'names' sits earlier than 'rate' in TOPIC_PATTERNS below, and its own
  // broad "who (is|are) ... (working|employed|unemployed|self-employed)"
  // alternative (built for a genuine roster request like "who is currently
  // employed?") wins outright before 'rate' ever gets a turn whenever a
  // RATE question's own phrasing happens to use the same "who are ...
  // employed" construction as part of a larger sentence — same object-order
  // collision class as every other override above. Caught live: "Show me
  // the percentage of Computer Science graduates who are currently employed
  // full-time and work locally" explicitly asks for a PERCENTAGE (TOPIC_
  // PATTERNS.rate's own "percentage of ... graduates" alternative matches
  // it directly), but also contains "...graduates WHO ARE currently
  // employed," which satisfied 'names' first and returned a full
  // alphabetical roster instead of the real rate. TOPIC_PATTERNS.rate's own
  // triggers (percentage/percent/rate/porsyento) are unambiguous, explicit
  // statistical vocabulary — never a generic phrase a genuine names request
  // would also use — so it's safe to let it win outright whenever present.
  if (TOPIC_PATTERNS.rate.test(question)) return 'rate';
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
    if (pattern.test(question)) return topic;
  }
  if (JOB_SEARCH_METHOD_PATTERN.test(question)) return null;
  return EMPLOYMENT_SIGNAL.test(question) ? 'employment' : null;
}

// Whether a superlative ranking question ("which program has the
// most/highest/lowest X") wants the HIGH end — NOT a bare /\b(most|highest)\b/
// test, which wrongly read "what program would MOST LIKELY have the LOWEST
// unemployment rate" as asking for the HIGHEST rate. "most" in the common
// hedge phrase "most likely" has nothing to do with the actual lowest/
// highest direction stated later in the same sentence, but a bare substring
// match can't tell the two uses of "most" apart. An explicit "lowest/least/
// fewest" anywhere in the question is checked FIRST and wins outright
// regardless of any unrelated "most" elsewhere; only when none of those are
// present does an actual "most/highest" get treated as asking for the top end.
// "fewer"/"less" and "more"/"greater" added alongside the existing
// superlative words — a COMPARATIVE phrasing ("which program will have MORE
// employed next year") is just as clear a direction signal as the
// superlative ("most"), but neither word list recognized it at all, so
// `wantsHighestDirection` fell through to its own false default and
// confidently named the LOWEST-performing program as the answer to a
// question explicitly asking for the one with MORE. Caught live, right
// after the OUT_OF_SCOPE_TOPICS predict/next-year exclusion above started
// letting this exact question shape ("predict which program will have more
// employed next year") reach this function for the first time.
function wantsHighestDirection(question) {
  if (/\b(lowest|least|fewest|fewer|less)\b/i.test(question)) return false;
  return /\b(most|highest|more|greater)\b/i.test(question);
}

// A negation word appearing shortly before a phrase — "not self-employed",
// "who doesn't work in IT", "not employed locally" — means the question
// wants that phrase EXCLUDED, not matched positively. Proximity-limited (same
// clause, ~25 chars) and checks every negation occurrence in the question
// (not just the first) so a negation attached to one filter in a compound
// question ("aren't self-employed but working in IT") doesn't leak onto an
// unrelated filter mentioned later in the same sentence.
function isNegatedBeforeIndex(question, targetIndex, maxGap = 25) {
  if (targetIndex === null || targetIndex === undefined) return false;
  // "hindi"/"wala"/"walang" — Tagalog negation. Same proximity-limited "this
  // negates whatever phrase comes shortly after" logic as the English list;
  // "walang" doubles as its own direct status word for unemployment
  // elsewhere (extractFilters' hasUnemployed) — that's a separate, more
  // specific check that runs independently and isn't affected by also
  // treating "walang" as a generic negator here for OTHER phrases (e.g.
  // "walang trabahong lokal" — no local job).
  const negRe = /\b(not|n't|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|didn'?t|hindi|wala|walang)\b/gi;
  let m;
  while ((m = negRe.exec(question))) {
    if (m.index < targetIndex && (targetIndex - m.index) <= maxGap) return true;
  }
  return false;
}

function isNegatedBefore(question, phraseSource, maxGap = 25) {
  const phraseMatch = new RegExp(phraseSource, 'i').exec(question);
  if (!phraseMatch) return false;
  return isNegatedBeforeIndex(question, phraseMatch.index, maxGap);
}

function extractFilters(question) {
  question = normalizeQuestion(question);
  const filters = {};

  // "How many total alumni RECORDS and tracer survey RESPONSES are
  // currently in the system?" — a bare, unfiltered count question that
  // explicitly names BOTH "records" and "responses" as if asking for two
  // separate figures. Graduate's own row count answers both (every row IS
  // both an alumni record and, thanks to LIVE_SUBMISSION_ONLY, a real
  // tracer survey response), so the NUMBER queryCount() already gives is
  // correct — but its default wording only ever says "graduates," never
  // acknowledging the question's own "records"/"responses" framing at all.
  // Read by queryCount()'s bare-total branch to phrase the SAME correct
  // number so it explicitly answers both halves of what was actually asked,
  // instead of reading as though only one half got addressed. Bidirectional
  // ("records...responses" OR "responses...records") since either word
  // order is natural phrasing.
  if (/\brecords?\b.{0,40}\b(?:responses?|submissions?)\b|\b(?:responses?|submissions?)\b.{0,40}\brecords?\b/i.test(question)) {
    filters.mentionsRecordsAndResponses = true;
  }

  // Combined program+specialization shorthand: "BSIT-TSM", "BSIS Business
  // Analytics", "BSIT major in Network Administration". filters.program is
  // used as a MongoDB regex, so "X.*Y" requires both substrings present in
  // order, matching the real stored format ("...Information Technology -
  // Specialized in Technical Service Management").
  //
  // Every REAL program+specialization combination currently on file (see
  // Graduate.program) — not just IT. Originally hardcoded to IT's three
  // tracks alone; generalized here so a NEW specialization under ANY
  // program/college (not just IT) only ever needs ONE new entry added to
  // this list, not a parallel copy of the whole matching mechanism. `code`
  // is the short form some users naturally type ("BSIT TSM") — omit it
  // (null) for a specialization with no safe short code of its own (e.g.
  // "BA" for Business Analytics collides too easily with "Bachelor of
  // Arts"/"Business Administration" to ever safely stand alone); the fully
  // spelled-out form below still works for those regardless.
  // `name` is the single CANONICAL form used for filters.program/programLabel
  // (must match how Graduate.program actually stores it); `aliases` are
  // OTHER ways someone naturally types the same specialization that should
  // still resolve to that same canonical name — "&" instead of "and",
  // "App(s)" instead of "Application", "Networking" as the everyday word for
  // "Network Administration". Aliases are only ever matched INSIDE an
  // explicit program-prefixed or connector-worded context below (never as a
  // context-free bare trigger the way the canonical `name`/`code` are
  // further down in SPEC_ABBR) — "Networking" alone, with no "BSIT"/
  // "specialized in"/"major in" anywhere nearby, is an ordinary English word
  // (professional networking, a networking event) far too likely to appear
  // in an unrelated question to ever safely stand alone, the same collision
  // risk this file's own comment above already calls out for why bare "BA"
  // was deliberately never added for Business Analytics.
  const PROGRAM_SPECIALIZATIONS = [
    { abbr: 'IT', base: 'Information Technology', code: 'TSM', name: 'Technical Service Management', aliases: [] },
    { abbr: 'IT', base: 'Information Technology', code: 'WMA', name: 'Web and Mobile Application', aliases: ['Web and Mobile Applications', 'Web & Mobile Application', 'Web & Mobile Applications', 'Web and Mobile App', 'Web and Mobile Apps', 'Web & Mobile App', 'Web & Mobile Apps'] },
    // "Network Administrator" (the ROLE/PERSON noun) added alongside
    // "Networking" — a different, equally natural way someone refers to
    // this same specialization ("Network Administration" is the course
    // name; "Network Administrator" is what someone who takes it becomes),
    // not previously recognized at all. Caught live: "BSIT - Specialized in
    // Network Administrator vs Web and Mobile Application" only resolved
    // the RIGHT side; the left silently fell back to the whole "Information
    // Technology" base program (157, every IT specialization combined)
    // instead of just the Network Administration track, since "Administrator"
    // never matches the literal word "Administration" this list otherwise
    // requires.
    { abbr: 'IT', base: 'Information Technology', code: 'NA',  name: 'Network Administration', aliases: ['Networking', 'Network Administrator', 'Network Administrators'] },
    { abbr: 'IS', base: 'Information Systems',    code: null, name: 'Business Analytics', aliases: [] },
  ];
  // Short-code OR full-name form glued directly onto the program
  // abbreviation — "BSIT TSM", "BSIT Technical Service Management", "BSIS
  // Business Analytics" (no "major in" connector needed for any of these).
  // [-\/\s]+ (not just [-\/]) between the abbreviation and what follows, and
  // requires it to directly follow THIS SAME program's own abbreviation
  // (never a different program's), so e.g. "TSM" only ever resolves under
  // "BSIT", never accidentally under "BSIS". Caught live twice: "BSIT TSM"
  // (a plain SPACE, no hyphen/slash — only the hyphenated "BSIT-TSM" form
  // worked before this) and "BSIS Business Analytics" (no short code exists
  // for this one, and no "major in" connector was used either) both
  // answered with the WHOLE program's number as if no specialization had
  // been named at all.
  //
  // The PREFIX before that separator also needs every natural way someone
  // actually spells out the base program, not just its short abbreviation —
  // "BS Information Systems - Business Analytics" has no "BSIS"/"BS IS"
  // anywhere in it at all, just the fully spelled-out base name glued the
  // same way, and fell through this whole block untouched (then also missed
  // the plain full-name PROGRAM_KEYWORDS match further below, since THAT
  // regex has no "- Business Analytics" suffix awareness either) — the
  // question matched literally nothing in the database and fell all the way
  // through to the generic "I could not find relevant information" refusal.
  // Caught live. `BS\s+(?:in\s+)?` and the full "Bachelor of Science in"
  // form are both optional — a bare base name immediately followed by the
  // separator+specialization ("Information Systems - Business Analytics",
  // no "BS" at all) is just as natural and equally unambiguous here (the
  // specialization name/code right after it is what makes this narrow
  // pattern safe, not the presence of "BS").
  // Connector between the program prefix and the specialization — was just
  // "[-\/\s]+" (a bare hyphen/slash/space), which only covers the GLUED
  // phrasing ("BSIT-TSM"). The database's OWN stored format spells this out
  // as "...- Specialized in Technical Service Management" (see this
  // function's own comment on filters.program further up), yet a question
  // using that exact connector word ("BSIT students specialized in Network
  // Administration") had no match of its own at all — neither this glued
  // form (no bare separator directly before the name) nor the "major in"
  // form just below (wrong connector word entirely). "sa" (Tagalog "in")
  // covers the equally natural Taglish "nag-major SA Technical Service
  // Management" / "nag-specialize SA Network Administration" idiom, same
  // bilingual-gap reasoning this file applies elsewhere (see e.g. the
  // "ihambing/ikumpara" compare-trigger comment).
  // "*" (zero-or-more), not "+" — a typo that drops the space entirely
  // ("bsittechnical service management graduates," no separator whatsoever
  // between the abbreviation and the specialization name) is a real, live
  // case, and the ORIGINAL "+" (one-or-more) required at least one
  // separator character to exist at all, so a fully-glued typo like this
  // matched nothing here. Safe to allow zero: the trailing specAlt
  // alternation right after it is one of only 4 highly specific, fully
  // spelled-out specialization names/codes (never a generic word), so a
  // false positive would need an unrelated sentence to coincidentally glue
  // one of those exact phrases directly onto "BSIT"/"Information
  // Technology"/etc. with nothing between them at all — effectively
  // impossible by accident.
  const SPEC_CONNECTOR = '(?:[-\\/\\s]*|\\s*(?:nag[- ]?)?(?:specializ(?:ed|ation)|major(?:ing)?|track(?:ing)?)\\s+(?:in|on|sa)\\s+|\\s+under(?:\\s+the)?\\s+)';
  const specGluedMatch = PROGRAM_SPECIALIZATIONS
    .map((s) => {
      const specAlt = [s.code, s.name, ...s.aliases].filter(Boolean).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const baseEsc = escapeRegex(s.base);
      const prefixAlt = [`BS[- ]?${s.abbr}`, `BS\\s+(?:in\\s+)?${baseEsc}`, `Bachelor\\s+of\\s+Science\\s+in\\s+${baseEsc}`, baseEsc].join('|');
      // No "\b" between the prefix group and the connector (unlike the
      // leading/trailing "\b" around the whole match, which stay) — a "\b"
      // there would itself block the zero-separator typo case above, since
      // two adjacent word characters ("...IT" immediately followed by
      // "Technical...") never satisfy a word boundary regardless of what
      // SPEC_CONNECTOR allows.
      return { s, re: new RegExp(`\\b(?:${prefixAlt})${SPEC_CONNECTOR}(?:${specAlt})\\b`, 'i') };
    })
    .find(({ re }) => re.test(question));
  // Fully spelled-out form with NO program prefix at all: "majoring in
  // Business Analytics," "specialized in Network Administration," "nag-major
  // sa Technical Service Management" — just as natural a phrasing as the
  // short code, and equally silently dropped before this existed (same live
  // case: "BSIT MAJOR IN TECHNICAL SERVICE MANAGEMENT" answered the
  // whole-program number too). The specialization's full name/alias is
  // unique enough on its own that this doesn't also need the program
  // abbreviation to disambiguate — matched case-insensitively so an all-caps
  // question (as typed live) still resolves to the properly-cased canonical
  // name. Shares SPEC_CONNECTOR's connector-word alternatives (minus the bare
  // separator, which needs an actual program prefix right before it to mean
  // anything — a bare "- Business Analytics" with nothing in front of the
  // hyphen isn't a real phrase).
  const specNameMatch = !specGluedMatch && PROGRAM_SPECIALIZATIONS
    .map((s) => {
      const specAlt = [s.code, s.name, ...s.aliases].filter(Boolean).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      return { s, re: new RegExp(`\\b(?:nag[- ]?)?(?:specializ(?:ed|ation)|major(?:ing)?|track(?:ing)?)\\s+(?:in|on|sa)\\s+(?:${specAlt})\\b`, 'i') };
    })
    .find(({ re }) => re.test(question));
  const resolvedSpec = specGluedMatch?.s || specNameMatch?.s;
  if (resolvedSpec) {
    filters.program = `${resolvedSpec.base}.*${resolvedSpec.name}`;
    // filterLabel() prefers this for display so the answer reads naturally
    // instead of showing the raw ".*" regex used for matching.
    filters.programLabel = `${resolvedSpec.base} - ${resolvedSpec.name}`;
  }

  // Program name: "BSCS graduates", "BSIT students", etc.
  // "Bachelor(?:\s+of\s+[A-Za-z]+)+" alone only ever captures "Bachelor of
  // Science" — the group only repeats on ANOTHER "of <word>" clause, so it
  // stops dead the instant it hits "in" (the real connector every actual
  // stored program name uses: "Bachelor of Science IN Information
  // Management/Computer Science/..."). Caught live: "How many alumni from
  // the Bachelor of Science in Information Management program were
  // promoted?" resolved filters.program to the bare truncated "Bachelor of
  // Science" — which, used as-is as a MongoDB regex, is a substring of
  // EVERY program this school offers (they all start with "Bachelor of
  // Science in...") — silently widening the scope from ~10 Information
  // Management respondents to the entire ~250+ person student body, while
  // still labeling the answer as if it were specific to one program. Added
  // an optional trailing "in <multi-word name>" clause so the full spelled-
  // out name is captured completely instead of being cut off mid-phrase.
  // The "in <name>" clause is capped at 2 words (every real program name
  // here is exactly 2 words after "in" — "Information Management,"
  // "Computer Science," "Information Technology," "Information Systems";
  // track-specific names like "...Specialized in Technical Service
  // Management" are matched by the dedicated PROGRAM_SPECIALIZATIONS
  // matching above, not this generic branch) — an earlier, uncapped
  // `[A-Za-z]+(?:\s+[A-Za-z]+)*` greedily consumed every following word in
  // the WHOLE SENTENCE, not just the program name itself (caught live:
  // "...Bachelor of Science in Information Management PROGRAM WERE
  // PROMOTED" all got swallowed into filters.program as one string, which
  // then matched literally nothing in the database at all). The negative
  // lookahead additionally excludes common trailing words ("program,"
  // "students," "alumni," "graduates," "course," "degree") that naturally
  // follow a program NAME in real English phrasing but are never part of
  // the name itself — a safety net on top of the word cap, since a 1-word
  // real program name followed immediately by "program" could otherwise
  // still fit inside the 2-word cap.
  const courseMatch = !filters.program && question.match(/\b(BS[A-Z]{1,8}|B\.?S\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?|Bachelor(?:\s+of\s+[A-Za-z]+)+(?:\s+in\s+(?!(?:program|students?|alumni|alumnus|graduates?|course|degree)\b)[A-Za-z]+(?:\s+(?!(?:program|students?|alumni|alumnus|graduates?|course|degree)\b)[A-Za-z]+){0,1})?)\b/i);
  if (courseMatch) {
    filters.program = courseMatch[1].trim();
    // Expand BS-prefixed abbreviations to keywords matching full DB program names
    const ABBR = {
      BSCS:  'Computer Science',
      BSIT:  'Information Technology',
      BSIS:  'Information Systems',
      BSIM:  'Information Management',
      BSBA:  'Business Administration',
      BSECE: 'Electronics',
      BSCE:  'Civil Engineering',
      BSEE:  'Electrical Engineering',
      BSME:  'Mechanical Engineering',
      BSED:  'Education',
      BSN:   'Nursing',
      BSACCT:'Accountancy',
    };
    const expanded = ABBR[filters.program.toUpperCase()];
    if (expanded) {
      filters.program = expanded;
    } else {
      // The SPACED form ("BS Information Technology", "B.S. Information
      // Technology") — not the glued "BSIT" the ABBR map above expects.
      // The regex alternative that allows a space after "BS" deliberately
      // captures the whole "BS Information Technology" span (so the degree
      // name right after it isn't cut off), but that means the ABBR lookup
      // above (keyed on glued forms only) never finds it, and filters.program
      // was left as the raw, un-normalized "BS Information Technology" —
      // which then matched ZERO real Graduate.program values (the stored
      // form spells out "Bachelor of Science in Information Technology,"
      // never literally "BS Information Technology" as a substring).
      // Caught live: "how many BS Information Technology graduates..."
      // silently returned 0 real matches and fell through to RAG's generic
      // "could not find relevant information" refusal instead of the real
      // count. Stripping the "BS"/"B.S." prefix recovers the already-valid,
      // already-matchable program name sitting right behind it —
      // "Information Technology" alone IS a real substring of the full
      // stored name, same as if the question had just said that directly.
      filters.program = filters.program.replace(/^B\.?S\.?\s+/i, '');
    }
  }

  // "nasa IT/CS/IS/IM" ("in/at IT/CS/IS/IM") — Filipino "nasa" signals a
  // WORKPLACE/FIELD context ("nasa IT siya nagtatrabaho", "nasa BPO
  // industry"), not the degree program someone took. Checked BEFORE the
  // SPEC_ABBR program loop below (whose own patterns exclude a "nasa "
  // prefix via negative lookbehind for this exact reason) and sets
  // filters.industry instead — without this, "Ilan sa kanila ang nasa IT?"
  // ("how many of them are in IT?", a follow-up after establishing a group
  // of employed alumni) wrongly matched the bare "IT" as filters.program,
  // answering 0 (a real alumnus in this exact live case has industry
  // "Information Technology" but program "Computer Science" — a program
  // filter excluded him entirely) instead of the real industry-filtered
  // count. Graduate.industry stores the same full spelled-out names as
  // Graduate.program ("Information Technology", not bare "IT"), so the
  // same expansions apply.
  if (!filters.industry) {
    const NASA_INDUSTRY_ABBR = [
      [/\bnasa\s+IT\b/, 'Information Technology'],
      [/\bnasa\s+CS\b/, 'Computer Science'],
      [/\bnasa\s+IS\b/, 'Information Systems'],
      [/\bnasa\s+IM\b/, 'Information Management'],
    ];
    for (const [pat, expansion] of NASA_INDUSTRY_ABBR) {
      if (pat.test(question)) { filters.industry = expansion; break; }
    }
  }

  // "IT-related jobs" / "CS-related work" — "related" here describes a
  // NAMED FIELD ("IT"), a totally different meaning from "jobs related to
  // THEIR OWN course" (the jobRelated filter further below, which the
  // hasJobWord/hasRelatedWord check would otherwise ALSO set from this same
  // sentence — "jobs" + "related" both present). Checked before SPEC_ABBR
  // below (so the bare "IT" in "IT-related" doesn't ALSO get claimed as
  // filters.program, same reasoning as NASA_INDUSTRY_ABBR above) — resolves
  // to filters.industry instead. Caught live: "How many alumni are working
  // in IT-related jobs?" answered "There are 0 employed alumni ... with
  // jobs related to their course (Information Technology)" followed by a
  // "Directly related: 40 / Somewhat related: 48" breakdown that flatly
  // contradicted the "0" headline — filters.program AND filters.jobRelated
  // were BOTH wrongly set from a phrase that meant neither.
  // "non IT-related jobs" / "not CS-related work" — "non"/"not" sits as its
  // OWN word before the field-hyphenated compound (unlike "non-related",
  // which IS the compound and means something different — see isFieldRelated
  // further below). This means EXCLUDE that industry, not include it — the
  // positive FIELD_RELATED_ABBR block below has no negation awareness at
  // all, so without checking this FIRST, "non IT-related jobs" resolved to
  // the exact same filters.industry='Information Technology' as a plain
  // "IT-related jobs" question, silently dropping the "non" and answering
  // the OPPOSITE question with an identical "49" to the un-negated one.
  // "IT jobs" (no hyphen to "related" at all — just the bare abbreviation
  // directly modifying "job(s)") is the SAME workplace/field meaning as
  // "IT-related jobs", not "IT-program alumni who happen to have jobs".
  // Missing this meant "How many alumni have IT jobs directly related to
  // their course?" fell through to the SPEC_ABBR program block below and
  // silently became "BSIT-program alumni whose job matches their OWN
  // course" (verified against the DB: the "40" that produced actually came
  // from program=Information Technology, not industry) — a completely
  // different cohort than "people whose JOB is in IT," which is what a
  // reader naturally understands "IT jobs" to mean. Same reasoning as
  // NASA_INDUSTRY_ABBR/FIELD_RELATED_ABBR above, just one more shape of the
  // same underlying phrase.
  if (!filters.industry && !filters.excludeIndustry) {
    // [\s-]+ (not \s+) between "non"/"not" and the abbreviation — "non-IT
    // jobs" (hyphenated) is at least as natural a phrasing as "non IT jobs"
    // (spaced), but \s+ alone never matches a literal hyphen, so the
    // hyphenated form fell through this whole negated block untouched and
    // was then caught by the POSITIVE (non-negated) FIELD_RELATED_ABBR/
    // SPEC_ABBR patterns below instead — silently answering the exact
    // OPPOSITE of what was asked ("non-IT-related jobs" resolved
    // filters.industry='Information Technology', INCLUDING IT, not
    // excluding it). Caught live.
    const NEGATED_FIELD_JOB_ABBR = [
      [/\b(?:non|not)[\s-]+IT\s+jobs?\b/, 'Information Technology'],
      [/\b(?:non|not)[\s-]+CS\s+jobs?\b/, 'Computer Science'],
      [/\b(?:non|not)[\s-]+IS\s+jobs?\b/, 'Information Systems'],
      [/\b(?:non|not)[\s-]+IM\s+jobs?\b/, 'Information Management'],
    ];
    for (const [pat, expansion] of NEGATED_FIELD_JOB_ABBR) {
      if (pat.test(question)) { filters.excludeIndustry = expansion; break; }
    }
  }

  if (!filters.industry && !filters.excludeIndustry) {
    // [\s-]+ (not \s+) — same hyphenated-"non" gap as NEGATED_FIELD_JOB_ABBR
    // just above: "non-IT-related jobs" (the fully-hyphenated phrasing) has
    // a hyphen, not whitespace, between "non" and "IT" specifically.
    const NEGATED_FIELD_RELATED_ABBR = [
      [/\b(?:non|not)[\s-]+IT[- ]related\b/, 'Information Technology'],
      [/\b(?:non|not)[\s-]+CS[- ]related\b/, 'Computer Science'],
      [/\b(?:non|not)[\s-]+IS[- ]related\b/, 'Information Systems'],
      [/\b(?:non|not)[\s-]+IM[- ]related\b/, 'Information Management'],
    ];
    for (const [pat, expansion] of NEGATED_FIELD_RELATED_ABBR) {
      if (pat.test(question)) { filters.excludeIndustry = expansion; break; }
    }
  }

  if (!filters.industry && !filters.excludeIndustry) {
    const FIELD_RELATED_ABBR = [
      [/\bIT[- ]related\b/, 'Information Technology'],
      [/\bCS[- ]related\b/, 'Computer Science'],
      [/\bIS[- ]related\b/, 'Information Systems'],
      [/\bIM[- ]related\b/, 'Information Management'],
      [/\bIT\s+jobs?\b/,    'Information Technology'],
      [/\bCS\s+jobs?\b/,    'Computer Science'],
      [/\bIS\s+jobs?\b/,    'Information Systems'],
      [/\bIM\s+jobs?\b/,    'Information Management'],
    ];
    for (const [pat, expansion] of FIELD_RELATED_ABBR) {
      if (pat.test(question)) { filters.industry = expansion; break; }
    }
  }

  // Specialization abbreviations (not BS-prefixed) — checked only if program not yet set
  if (!filters.program) {
    const SPEC_ABBR = [
      [/\bTSM\b/i,                              'Technical Service Management'],
      [/\bWMA\b/i,                              'Web and Mobile Application'],
      // "&" and shortened "App(s)" are just as natural as the fully spelled-
      // out "Web and Mobile Application" — these are specific enough
      // multi-word phrases (unlike a bare generic word) to stay safe as a
      // context-free bare trigger, same reasoning PROGRAM_SPECIALIZATIONS'
      // own aliases comment gives for why "Networking" alone does NOT get
      // the same treatment here.
      [/\bWeb\s+(?:and|&)\s+Mobile\s+(?:Application|Applications|App|Apps)\b/i, 'Web and Mobile Application'],
      [/\bNet(?:work)?\s*Admin\w*\b/i,          'Network Administration'],
      [/\bNA\b/,                                'Network Administration'],   // case-sensitive: avoids Filipino "na"
      [/\bBusiness\s*Analytics?\b/i,            'Business Analytics'],
      // (?<!nasa\s)...(?![- ]related|\s+jobs?\b|\s+industr|\s+sector\b) — see
      // the NASA_INDUSTRY_ABBR/FIELD_RELATED_ABBR blocks above: "nasa IT",
      // "IT-related", and bare "IT jobs" all mean workplace/field, already
      // claimed as an industry filter there, not a program to also
      // (redundantly, and wrongly) claim here. Caught live: "IT jobs
      // directly related to their course" resolved filters.program=
      // 'Information Technology' (BSIT alumni) instead of filters.industry —
      // a completely different cohort (BSIT graduates whose job matches
      // THEIR course, vs. anyone working an IT job that matches THEIR OWN
      // course, whatever it was). The "\s+industr"/"\s+sector" exclusions
      // were missing from this specific list (the later, full-spelled-out
      // PROGRAM_KEYWORDS check further below already excludes "industry" —
      // this bare-abbreviation list just never got the same treatment) —
      // caught live: "How many alumni work in the IT industry?" silently
      // set BOTH filters.program AND filters.industry to 'Information
      // Technology', narrowing to BSIT graduates who ALSO work in IT instead
      // of every alumnus (any program) working in the IT industry — same
      // "no \b after industr" note as the industry-keyword regex above.
      [/\b(?<!nasa\s)IS(?![- ]related|\s+jobs?\b|\s+industr|\s+sector\b)\b/,                     'Information Systems'],      // case-sensitive: avoids "is"
      [/\b(?<!nasa\s)IT(?![- ]related|\s+jobs?\b|\s+industr|\s+sector\b)\b/,                     'Information Technology'],   // case-sensitive: avoids "it"
      [/\b(?<!nasa\s)CS(?![- ]related|\s+jobs?\b|\s+industr|\s+sector\b)\b/,                     'Computer Science'],         // case-sensitive: avoids "cs"
      [/\b(?<!nasa\s)IM(?![- ]related|\s+jobs?\b|\s+industr|\s+sector\b)\b/,                     'Information Management'],   // case-sensitive: avoids "im"
    ];
    for (const [pat, expansion] of SPEC_ABBR) {
      if (pat.test(question)) { filters.program = expansion; break; }
    }
  }

  // Full spelled-out program name ("Information Technology alumni", not an
  // abbreviation) — everything above only recognizes "BSIT"/"IT"-style
  // shorthand, so a question already using the expanded name (as this
  // file's OWN suggestion chips do — see FOLLOWUP_QUESTION/programLabel
  // near queryPersonLookup) silently failed to resolve any program filter
  // at all and answered with the unfiltered whole-dataset total instead.
  // PROGRAM_KEYWORDS is the same list queryPersonLookup() uses to recognize
  // a Graduate.program value — reused here for the reverse direction
  // (recognizing that name inside a QUESTION). Several of these names ARE
  // ALSO real industry names ("Information Technology" the program vs.
  // "Information Technology" the industry alumni work in) — the negative
  // lookahead skips a match immediately followed by "industry" so "who else
  // works in the Information Technology industry" stays an industry-only
  // filter instead of silently also restricting to that program and
  // excluding every other-program alumnus actually working in that industry.
  if (!filters.program) {
    const keyword = PROGRAM_KEYWORDS.find(k => {
      // (?!\s+(?:industry|sector|field)\b) — "industry" alone was covered,
      // but "sector" and "field" are equally common synonyms for the same
      // thing in this exact spot ("the Information Technology SECTOR"/
      // "...FIELD") — this app's own IT-ambiguity clarify message already
      // treats "industry"/"sector"/"field" as interchangeable triggers (see
      // the qualifiers regex a few hundred lines up in ragService.js), so
      // this lookahead was just missing two of the three. Caught live: "How
      // many alumni in the Information Technology SECTOR are employed?"
      // matched this as a PROGRAM keyword too (alongside the correct
      // industry filter), silently narrowing the answer to BSIT graduates
      // only (35) instead of every program's alumni working in IT (51) —
      // the question never named a program at all.
      if (!new RegExp(`\\b${k}\\b(?!\\s+(?:industry|sector|field)\\b)`, 'i').test(question)) return false;
      // "further education"/"continuing education"/"pursue(d) education" is
      // a common ENGLISH IDIOM for "continued studying" — condenseQuestion()
      // translates Tagalog "nagpatuloy (ng) pag-aaral"/"nagpatuloy mag-aral"
      // to exactly this phrasing — and is NOT a reference to the "Bachelor
      // of Education" program. Without this guard, "who did not pursue
      // further education?" wrongly set filters.program = 'Education' and
      // answered "No alumni found FROM EDUCATION, who did not pursue
      // further education" — a nonsensical combination of two unrelated
      // meanings of the same word. filters.furtherEducation (set separately,
      // further below) already correctly captures this question's real
      // intent, so bare "Education" here is skipped whenever that phrasing
      // is present.
      if (k === 'Education' && /\b(further|continuing|pursue[ds]?)\s+education\b/i.test(question)) return false;
      return true;
    });
    if (keyword) filters.program = keyword;
  }

  // "How many Computer Science and TSM graduates are currently working in
  // roles somewhat related to their degree?" — every single-value step above
  // (courseMatch/SPEC_ABBR/PROGRAM_KEYWORDS) is deliberately gated behind
  // `if (!filters.program)`, correct for ONE program but meaning whichever
  // step matches FIRST (SPEC_ABBR's bare "TSM" runs before the full-name
  // PROGRAM_KEYWORDS loop) silently blocks a second, equally real program
  // named later in the SAME question from ever being attempted at all.
  // Caught live: that exact question answered for TSM alone, with "Computer
  // Science" discarded with no indication anything had been dropped — the
  // user's own words, "dapat pwede rin yung dalawa ang maraming courses"
  // ("it should be possible for there to be two or many courses").
  // Independent of (and must never fire alongside) the compare/vs/versus
  // path — queryInner() routes that to queryCompare() separately, which
  // wants the two cohorts kept APART for a side-by-side comparison; "and"
  // here instead means "combine into one answer," the opposite intent.
  if (!/\b(compare|\bvs\.?\b|\bversus\b|difference\s+between|ihambing|ikumpara|paghambingin|pagkakaiba\s+ng)\b/i.test(question)) {
    const mentions = findAllProgramMentions(question);
    const distinct = [];
    for (const m of mentions) {
      // Same program named twice in different forms ("IT" ... "Information
      // Technology") must count once, not be treated as two cohorts to combine.
      if (!distinct.some((d) => d.label === m.label)) distinct.push(m);
    }
    if (distinct.length >= 2) {
      // Only combine mentions separated by nothing but a plain connector
      // ("and"/","/"&") — two program names that happen to appear far apart
      // in an otherwise unrelated multi-part question should NOT be silently
      // merged into one filter neither name's own half of the question
      // actually intended to share.
      const adjacent = distinct.every((m, i) => i === 0 || /^\s*(?:,|&|and)\s*$/i.test(question.slice(distinct[i - 1].end, m.index)));
      if (adjacent) {
        filters.program = distinct.map((d) => `(?:${d.pattern})`).join('|');
        const labels = distinct.map((d) => d.label);
        filters.programLabel = labels.length === 2 ? labels.join(' and ') : labels.join(', ').replace(/, ([^,]*)$/, ' and $1');
      }
    }
  }

  // Graduation year RANGE: "batch 2020 to 2022", "2020-2022", "2020 hanggang
  // 2022", "between 2020 and 2022" — a closed, INCLUSIVE range (2020, 2021,
  // AND 2022), distinct from the yearFrom-only "past N years" case below
  // (which the 'trend' bypass in queryInner() deliberately treats as an
  // open-ended multi-year window rather than a single count/list). Checked
  // BEFORE the single-year match just below — that regex has no `g` flag and
  // returns only the FIRST year found in the whole question, so without this,
  // "batch 2020 to 2022" silently dropped the "to 2022" half and matched only
  // 2020. "between X and Y" needs its OWN alternative (not just adding "and"
  // to the connector list below) — a bare "X and Y" with no "between" is a
  // DISCRETE two-value list (see the multi-year branch further down: "how
  // many graduated in 2022 and 2008" means those two specific years, NOT
  // every year from 2008 through 2022 inclusive), so "and" can only mean a
  // RANGE connector when "between" is the word that introduced it.
  //
  // Skipped entirely for an event/feedback-shaped question — a calendar
  // event's own title routinely ends in a year ("Annual Career Fair 2026",
  // "CCS Tech Summit 2026"), which this otherwise-bare "any 4-digit number
  // 1990-2039" scan can't tell apart from a real graduation-batch reference.
  // Events aren't tied to any alumni's graduation batch at all, so a
  // yearGraduated filter is meaningless here regardless — caught live: "How
  // many feedback did Annual Career Fair 2026 receive?" resolved
  // yearGraduated: 2026 from the event's own title and answered with an
  // unrelated "7 graduates in Batch 2026" stats line ahead of the real
  // (separately-resolved) event-feedback answer. Bare "\bfeedback\b" added on
  // top of the TOPIC_PATTERNS check — that exact phrasing has no "event"/
  // "attend" word anywhere in it and matches neither TOPIC_PATTERNS.events
  // nor .event_feedback (which requires "feedback for/on/about/regarding"
  // adjacency), yet is unmistakably an event-feedback question by itself.
  const isEventOrFeedbackQuestion = TOPIC_PATTERNS.events.test(question) || TOPIC_PATTERNS.event_feedback.test(question) || /\bfeedback\b/i.test(question);
  if (!isEventOrFeedbackQuestion) {
    const yearRangeMatch = question.match(/\bbetween\s+(199\d|20[0-3]\d)\s+and\s+(199\d|20[0-3]\d)\b/i)
      || question.match(/\b(199\d|20[0-3]\d)\s*(?:to|through|-|–|—|until|hanggang)\s*(199\d|20[0-3]\d)\b/i);
    if (yearRangeMatch) {
      const y1 = parseInt(yearRangeMatch[1], 10);
      const y2 = parseInt(yearRangeMatch[2], 10);
      filters.yearFrom = Math.min(y1, y2);
      filters.yearTo   = Math.max(y1, y2);
    } else {
      // Graduation year(s): "batch 2001", "2023 graduates", "2022 and 2008",
      // "2020, 2021 and 2022", etc. — covers 1990–2039. Scanned globally (not
      // just the first match) so a DISCRETE list of years (joined by "and"/","/
      // "&", not a "to"/"through"/hanggang" RANGE connector — already handled
      // above) is recognized as such instead of silently keeping only the
      // first year found and dropping every other one. Caught live: "How many
      // alumni graduated in 2022 and 2008?" answered with the exact same
      // Batch-2022-only count as a bare "2022" question, as if "2008" had never
      // been typed at all.
      const allYears = [...question.matchAll(/\b(199\d|20[0-3]\d)\b/g)].map(m => parseInt(m[1], 10));
      const distinctYears = [...new Set(allYears)];
      if (distinctYears.length > 1) filters.yearsGraduated = distinctYears;
      else if (distinctYears.length === 1) filters.yearGraduated = distinctYears[0];
    }
  }

  // "the past/last N years" — a MINIMUM year (inclusive range), not a single
  // exact year. Without this, "over the past three years" was silently
  // dropped entirely (no year-related word this regex recognizes), so a
  // trend question ended up answered with the ALL-TIME aggregate across
  // every batch ever recorded instead of the recent window actually asked
  // about — a materially different, misleading number.
  if (!filters.yearGraduated && !filters.yearFrom) {
    const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const pastYearsMatch = question.match(/\b(?:past|last)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/i);
    if (pastYearsMatch) {
      const n = NUMBER_WORDS[pastYearsMatch[1].toLowerCase()] || parseInt(pastYearsMatch[1], 10);
      if (n > 0) filters.yearFrom = new Date().getFullYear() - n + 1;
    }
  }

  // "the most recent/latest/newest batch" — a RELATIVE reference to
  // whichever graduation year actually has the newest data on file, not a
  // literal year typed anywhere in the question. Without this, "how many
  // graduates from the most recent batch are still seeking employment"
  // resolved NO year filter at all (no 4-digit number anywhere to match)
  // and silently answered with the ALL-TIME unemployed count across every
  // batch ever recorded — caught live. extractFilters() itself has no DB
  // access to know which year is actually "most recent," so this only sets
  // a bare sentinel; queryInner() (the one place in this flow with a live
  // DB round-trip) resolves it into a concrete filters.yearGraduated before
  // dispatch, after which every downstream function scopes to it exactly
  // like a literal "batch 2024" question already does via
  // yearMatchCondition(). Skipped whenever an explicit year/range already
  // won above — a question naming BOTH ("most recent batch, 2022") is
  // self-contradictory and the literal year should win regardless.
  if (!filters.yearGraduated && !filters.yearsGraduated && !filters.yearFrom) {
    if (/\b(?:most\s+)?(?:recent|latest|newest)\s+(batch|year|graduat\w*|class)\b/i.test(question)) {
      filters.mostRecentBatch = true;
    }
  }

  // "across all/every programs/specializations/courses/tracks" — an
  // explicit instruction that THIS comparison must span every one of them,
  // not just whichever single program/batch a PRIOR turn happened to narrow
  // to. Without this, a bare follow-up like "can you show me a bar chart
  // comparing employment rates across all specializations" inherits
  // whatever filters.program/yearGraduated an earlier, unrelated turn left
  // behind (e.g. "the most recent batch" two turns ago) via seedFilters —
  // this turn's own text sets neither itself, so the merge in queryInner()
  // silently kept the old narrow scope, collapsing "across all
  // specializations" down to just the ONE specialization/batch combination
  // that happened to still have data, the exact opposite of what was asked.
  // Caught live. Resolved in queryInner() (the one place seedFilters and
  // ownFilters are merged) — same "set a bare sentinel here, act on it where
  // the merge happens" split as filters.mostRecentBatch just above.
  // (?:\s+\w+){0,2} tolerates a word or two sitting between "all/every" and
  // the noun ("across all CCS specializations") — caught live: the plain
  // adjacency-only version above matched "across all specializations" fine
  // but silently missed "across all CCS SPECIALIZATIONS" entirely (the
  // college code breaks direct adjacency), falling all the way back to the
  // single overall rate again despite "across all" being right there.
  if (/\bacross\s+(?:all|every)\b(?:\s+\w+){0,2}\s+(?:programs?|courses?|specializations?|tracks?)\b/i.test(question)) {
    filters.showAllPrograms = true;
  }

  // "specialization(s)"/"track(s)" specifically (not the broader "program(s)
  // "/"course(s)") — narrows a by-program breakdown down to only the genuine
  // TRACK-level rows (program values containing "- Specialized in ", e.g.
  // TSM/NA/WMA/Business Analytics — see PROGRAM_SPECIALIZATIONS above),
  // excluding the bare base-degree rows ("Bachelor of Science in Computer
  // Science", "...Information Management", etc.) that aren't a
  // specialization/track of anything. Without this, "comparing employment
  // rates across all CCS specializations" answered with EVERY program
  // (including non-specialized base degrees the question never asked about)
  // mixed in alongside the actual TSM/NA/WMA/Business-Analytics tracks —
  // caught live: the user explicitly wanted "specialization lang like TSM,
  // NA, and WMA," not the full program list. Resolved in the by-program
  // query functions themselves (queryEmploymentRateByProgram() etc.), not
  // here — extractFilters() just flags the intent.
  if (/\bspecializations?\b|\btracks?\b/i.test(question) && !/\bprograms?\b|\bcourses?\b/i.test(question)) {
    filters.specializationsOnly = true;
  }

  // Industry — path 1: explicit "industry/sector/field" keyword
  // Note: no \b after "industr" — "industry"/"industries" don't have boundary after "industr"
  let industryMatchIndex = null;
  if (/\bindustr|\bsector\b|\bfield\b/i.test(question)) {
    const indMatch = question.match(/\b(?:works?\s+in|working\s+in|employed\s+in|in)\s+(?:the\s+)?([a-zA-Z](?:[a-zA-Z ]){1,49}?)(?=\s+(?:industr|sector|field))/i);
    // "...currently working IN roles directly related to their FIELD of
    // study" — the trailing literal word "field" is exactly this path's own
    // lookahead anchor (zero-width, never part of indMatch[0] itself), so
    // the job-relevance idiom path 2 below already guards against ("related
    // to their field," meaning field OF STUDY, not an industry name)
    // slipped past THIS path entirely, which had no equivalent exclusion.
    // Checks a real WINDOW of the original text starting at the match (the
    // captured candidate plus whatever genuinely follows it) rather than
    // guessing which of industr/sector/field the lookahead actually matched.
    // Caught live: captured "roles directly related to their" (everything up
    // to the lookahead's own "field") as a bogus industry name, searched
    // Graduate.industry for that literal string, found nothing, and declined
    // the whole question outright despite the real jobRelated='directly'
    // filter it should have combined with instead.
    const isJobRelevancePhraseP1 = indMatch
      && /\brelated\s+to\s+(?:their|his|her|its)?\s*(course|degree|program|study|studies|field)\b/i.test(
        question.slice(indMatch.index, indMatch.index + indMatch[0].length + 20)
      );
    if (indMatch && !isJobRelevancePhraseP1) { filters.industry = indMatch[1].trim(); industryMatchIndex = indMatch.index; }
  }
  // Industry — path 2: verb-based "work(s) in / working in / employed in X" without keyword.
  // The (?<!self[- ])(?<!never\s) guards stop "self-employed in BSIT" / "never
  // employed in BSIT" from matching "employed in X" and misreading a program
  // abbreviation as an industry name — "employed" is a substring of both
  // compound status phrases, so without this guard the regex fired on them too.
  if (!filters.industry) {
    const verbMatch = question.match(/\b(?:works?\s+in|working\s+in|(?<!self[- ])(?<!never\s)employed\s+in)\s+(?:the\s+)?([a-zA-Z][a-zA-Z ]{1,49}?)(?=[?,!.]|$)/i);
    if (verbMatch) {
      const candidate = verbMatch[1].trim();
      // "working in A FIELD RELATED TO their degree" — no punctuation
      // appears until the end of the sentence, so the lazy capture above
      // expands all the way past "field" into the entire rest of the
      // clause, mistaking a job-relevance idiom ("field" = field of study,
      // not industry) for an industry name. Reject any candidate matching
      // this idiom outright — it belongs to the jobRelated filter below,
      // not here.
      const isJobRelevancePhrase = /\brelated\s+to\s+(?:their|his|her|its)?\s*(course|degree|program|study|studies|field)\b/i.test(candidate);
      // "managerial or supervisor ROLES/POSITIONS" describes a JOB ROLE, not
      // an industry/sector, despite matching this SAME "working in X" verb
      // shape — redirect it to jobTitleRegex instead of letting it become a
      // bogus industry name with zero real matches. Caught live: "...are
      // currently working in managerial or supervisor roles" captured the
      // whole phrase as filters.industry (no alumnus has an industry
      // literally called "managerial or supervisor roles"), instead of a
      // real per-person jobTitle match against stored titles like "Operations
      // Manager"/"IT Support Supervisor".
      const isRolePhrase = /\b(?:role|roles|position|positions|capacity)\s*$/i.test(candidate);
      if (isRolePhrase) {
        const ROLE_WORD_MAP = [
          [/\bmanageri?al\b/i,   'manager'],
          [/\bsupervisory?\b/i,  'supervisor'],
          [/\bdirectors?\b/i,    'director'],
          [/\bexecutives?\b/i,   'executive'],
          [/\bteam\s*leads?\b/i, 'lead'],
          [/\bheads?\b/i,        'head'],
        ];
        const matchedWords = ROLE_WORD_MAP.filter(([pat]) => pat.test(candidate)).map(([, w]) => w);
        if (matchedWords.length) {
          filters.jobTitle = matchedWords.join(' or ');
          filters.jobTitleRegex = matchedWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        }
      } else if (!isJobRelevancePhrase && !/^(the|a|an|this|that|those|our|their|its|any|all|database|system|table|records?|fields?)$/i.test(candidate)) {
        filters.industry = candidate;
        industryMatchIndex = verbMatch.index;
      }
    }
  }
  // Path 3: bare "X industry" with NO preceding verb at all ("the Healthcare
  // industry", "Healthcare industry alumni") — needed because a shared verb
  // phrase elides itself on the SECOND half of a two-way split: "alumni IN
  // the IT industry vs the Healthcare industry" only ever states "in" once,
  // before the first industry, the same way "across all CCS specializations"
  // elsewhere in this file only states "all" once for a whole list.
  // splitCompareQuestion() (used by queryCompare()) has no way to restore
  // that shared "in" onto the second half's own text, so without this, the
  // right side's own extractFilters() call came back with filters.industry
  // completely unset. Caught live: "compare the number of alumni in the IT
  // industry vs the Healthcare industry" resolved the IT side correctly but
  // silently dropped Healthcare entirely, falling through with no comparison
  // at all. The trailing literal word "industry" is itself a strong, narrow
  // enough anchor that no preceding verb is needed to trust the capture.
  if (!filters.industry) {
    const bareMatch = question.match(/\b(?:the\s+)?([A-Za-z][A-Za-z &/-]{1,49}?)\s+industry\b/i);
    if (bareMatch) {
      const candidate = bareMatch[1].trim();
      if (!/^(the|a|an|this|that|those|our|their|its|any|all|same|whole|entire)$/i.test(candidate)) {
        filters.industry = candidate;
        industryMatchIndex = bareMatch.index;
      }
    }
  }
  // Tagalog "nagtatrabaho sa gobyerno/pribado" (working in government/
  // private) — the verb-phrase capture above is English-only ("works?
  // in"/"working in"), so this fell through with no industry filter at all,
  // and separately, even a raw Tagalog capture would never match anyway:
  // the stored industry values are English ("Government and Public
  // Administration"), so "gobyerno" has to be mapped to "government"
  // explicitly, not captured verbatim. Without this, "ilan ang nagtatrabaho
  // sa gobyerno" fell through to TOPIC_PATTERNS.work_type's own bare
  // "gobyerno" trigger instead — a completely different dimension
  // (employment TYPE — Regular/Permanent vs Job Order — not industry).
  if (!filters.industry) {
    if (/\bnagta+trabaho\s+sa\s+gobyerno\b|\bnagtrabaho\s+sa\s+gobyerno\b/i.test(question)) {
      filters.industry = 'government';
    } else if (/\bnagta+trabaho\s+sa\s+pribado\b|\bnagtrabaho\s+sa\s+pribado\b/i.test(question)) {
      filters.industry = 'private';
    // English equivalent of the Tagalog check just above — "government
    // positions/jobs/sector" / "private sector/company" was never
    // recognized at all in English, only Tagalog "gobyerno"/"pribado".
    // Caught live: "...currently in Regular/Permanent GOVERNMENT positions
    // versus PRIVATE SECTOR roles?" resolved neither side, silently
    // dropping the entire government-vs-private comparison.
    } else if (/\bgovernment\s+(?:position|job|role|sector|agenc|office)/i.test(question)) {
      filters.industry = 'government';
    } else if (/\bprivate\s+(?:sector|compan|firm|position|job|role)/i.test(question)) {
      filters.industry = 'private';
    }
  }
  // Bare abbreviation captured verbatim by path 1/2 above ("in the IT
  // industry", "working in CS") — Graduate.industry stores the same
  // full spelled-out names as Graduate.program ("Information Technology"),
  // which does NOT contain "IT" as a substring, so leaving the raw
  // abbreviation in filters.industry made the later $regex match nothing
  // even when real matching records existed (verified live: "female BSIT
  // 2022-2024 alumni working in the IT industry" has 2 real matches but
  // this bug reported 0). NASA_INDUSTRY_ABBR/FIELD_RELATED_ABBR above
  // already expand this same abbreviation for other phrasings ("nasa IT",
  // "IT jobs/related") — apply the same expansion here for whatever path
  // 1/2 captured verbatim.
  if (filters.industry) {
    const BARE_INDUSTRY_ABBR = {
      IT: 'Information Technology',
      CS: 'Computer Science',
      IS: 'Information Systems',
      IM: 'Information Management',
    };
    const expansion = BARE_INDUSTRY_ABBR[filters.industry.toUpperCase()];
    if (expansion) filters.industry = expansion;
  }

  // "who does NOT work in IT" / "not working in the government sector" — the
  // industry was matched correctly above, but as a POSITIVE filter; if a
  // negation word sits right before the verb phrase that introduced it, the
  // question actually wants everyone EXCLUDING that industry.
  if (filters.industry && isNegatedBeforeIndex(question, industryMatchIndex)) {
    filters.excludeIndustry = filters.industry;
    delete filters.industry;
  }

  // Job title: "working as a software engineer", "employed as a nurse",
  // "alumni that are software engineers" — was completely unsupported
  // before, so any question naming a specific job title silently answered
  // with the ALL-alumni total instead, ignoring the title entirely. Trailing
  // plural "s" is made optional in the match regex (not stripped from the
  // display text) so "software engineers" still matches a stored singular
  // "Software Engineer" record.
  //
  // A bare "who are the X?" / "who works as an X?" fallback was added below
  // — the shorter, more natural way to ask this ("Who are the software
  // engineers?", "Who works as a software engineer?") used to fall through
  // with NO job title extracted at all, silently returning the entire
  // unfiltered 50-alumni roster: a confident wrong answer, not just an
  // incomplete one. It's tried LAST (after the more specific "that are/is X"
  // form) so a compound sentence like "who are the alumni that are X" still
  // captures the correct (shorter) span from the "that are" branch instead
  // of the bare "who are" branch grabbing the whole rest of the sentence.
  // (?:locally|abroad|remotely|overseas|domestically|internationally|
  // currently|now|part-?time|full-?time)\s+)? tolerates ONE work-location/
  // status adverb wedged between "working" and "as" — a filters.workLocation
  // word (see the separate "local"/"abroad" extraction below, which already
  // resolved this half correctly on its own) sitting in the SAME clause as
  // the job title broke the original tight "working as X" adjacency
  // entirely, with no match at all. Caught live: "...are working LOCALLY as
  // Front-end Developer" extracted workLocation='local' correctly but
  // jobTitle not at all — the combined question then searched for the
  // program+year+location alone, found zero real matches for the
  // unnormalized program text (see the courseMatch fix just above), and the
  // honest "0 results" never even got a chance to run with the job title
  // also applied.
  const jobTitleMatch = question.match(/\b(?:working|works?|employed)\s+(?:(?:locally|abroad|remotely|overseas|domestically|internationally|currently|now|part-?time|full-?time)\s+)?as\s+(?:an?\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i)
    // Tagalog "nagtatrabaho/nagwowork bilang X" ("working as X") — English-
    // only above, so "sino sino ang mga nagtatrabaho bilang software
    // developer" extracted no job title at all and fell through to a bare
    // gender/employed count instead of the actually-requested names list.
    // The extra lookahead for "na lalaki/babae" (a trailing gender qualifier
    // — "bilang X na lalaki" = "as X who is male") stops the capture there
    // instead of swallowing it into the literal title regex, same reason the
    // English alternatives stop at punctuation/end-of-string.
    || question.match(/\b(?:nagta+trabaho|nagwowork)\s+bilang\s+(?:isang\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=\s+na\s+(?:lalaki|babae)\b|[?,!.]|$)/i)
    // "who has position of SA" / "position is SA" / "role/designation of X"
    // — a real, natural way to ask for a job title that none of the other
    // patterns here recognize (no "working as"/"that are" wording at all).
    // Without this, "who are the alumni who has position of SA" extracted
    // NO job title whatsoever and silently returned the entire unfiltered
    // 256-alumni roster instead of filtering to that one title.
    || question.match(/\b(?:position|role|designation)\s+(?:of|is|as)\s+(?:an?\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i)
    || question.match(/\bthat\s+(?:are|is)\s+(?:an?\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i)
    // Missing an?\s+ (unlike the two patterns above) let "who is A NURSE?"
    // capture "a Nurse" (article included) as the literal job title regex —
    // real stored titles are just "Nurse", so that never matched anything.
    || question.match(/\bwho\s+(?:are|is)\s+(?:the\s+|an?\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i)
    // "how many are Software Engineers?" — a natural, common follow-up to
    // "who are Software Engineers?" (asking for just the count of the same
    // group) that names no alumni/employee noun for TOPIC_PATTERNS.count to
    // key off, and doesn't start with "who" for the fallback above either —
    // fell all the way through with no job title extracted at all.
    || question.match(/\bhow\s+many\s+(?:are|is)\s+(?:the\s+|an?\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i);
  if (jobTitleMatch) {
    const candidate = jobTitleMatch[1].trim();
    // Excludes words already handled by their own dedicated filters — "that
    // are employed"/"that are self-employed"/"that are male" are status/
    // gender questions, not job-title lookups, and would otherwise get
    // double (and wrongly) interpreted as a literal job title of "employed."
    // Pronouns (they/them/it/we/you/she/he/him/her) added after a live
    // failure: "sino sila?" ("who are they?") as a follow-up to "how many
    // work as software developer?" — condenseQuestion()'s pronoun-resolution
    // step (ragService.js) is SUPPOSED to substitute "sila"/"they" with the
    // actual group being discussed ("software developers") before this
    // point, but when that resolution doesn't happen (translation/LLM
    // limitation, not something this regex layer can fix), "who are they?"
    // survived untranslated and this fallback pattern treated the literal
    // word "they" as if it were a job title being asked about — producing
    // the nonsensical "No alumni found working as they." instead of either
    // resolving correctly or admitting the referent couldn't be determined.
    const isGenericWord = /^(the|a|an|this|that|those|our|their|its|any|all|employed|unemployed|self[- ]?employed|never\s+employed|male|female|men|women|working|local|abroad|related|graduates?|alumni|respondents?|they|them|it|we|you|she|he|him|her|these)$/i.test(candidate);
    // The bare "who are/is X" fallback captures the WHOLE rest of the
    // sentence (no "that are"/"working as" anchor to stop it early), so a
    // question like "who are the male alumni from BSIT" would otherwise
    // capture "male alumni from bsit" wholesale as a literal (unmatchable)
    // job title, silently overriding the gender/program filters that
    // extractFilters() correctly sets elsewhere for the same words. Reject
    // any candidate that CONTAINS one of those already-claimed qualifier
    // words, not just an exact match — this guard only applies to the
    // multi-word-prone bare fallback; the two narrower, explicitly-anchored
    // forms above keep their original exact-match check untouched.
    const containsClaimedWord = /\b(employed|unemployed|self[- ]?employed|male|female|men|women|working|local(?:ly)?|abroad|overseas|related|relevant|graduates?|alumni|respondents?|program|course|batch|year)\b/i.test(candidate);
    // "how many are FROM BSIT?" — a leading "from" always names an origin
    // (program/batch/location), never a job title ("working as FROM X" isn't
    // English) — without this, "from BSIT" itself got captured as a literal
    // job title candidate, stacking a nonsensical jobTitle filter on top of
    // the program filter courseMatch already correctly set from the same
    // span, and "No alumni found working as from BSIT" instead of the real,
    // program-filtered count.
    const startsWithFrom = /^from\s+/i.test(candidate);
    if (!isGenericWord && !containsClaimedWord && !startsWithFrom) {
      filters.jobTitle = candidate;
      // \b...\b (word-boundary anchored, not a bare substring) — without
      // it, a short title/abbreviation like "SA" matched as a substring
      // ANYWHERE, including inside unrelated words that just happen to
      // contain those letters in sequence ("PSA Enumerator", "SAP Master
      // Data", "Sales and Marketing Associate") — none of which are
      // actually "SA" as a job title. \b still allows a longer phrase like
      // "Software Engineer" to match inside "Associate Software Engineer"
      // or "Software Engineer/staff Consultant" (a real boundary exists on
      // both sides of the phrase there), so this doesn't lose the
      // legitimate partial-title matches that already worked.
      filters.jobTitleRegex = '\\b' + candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/i, 's?') + '\\b';
    }
  }

  // "self-employed or freelancers IN [FIELD]" — freelance/self-employed
  // work described by FIELD/ACTIVITY ("freelancers in web development",
  // "self-employed in graphic design") rather than a "working in X" verb
  // phrase or the literal word "industry"/"sector"/"field" — fails every
  // industry-extraction path above AND the main jobTitleMatch block just
  // above (which needs a "working as"-style frame), so the field was
  // silently dropped entirely. Caught live: "...graduates from 2022 to 2024
  // who are self-employed or freelancers in Web Development" correctly
  // resolved yearFrom/yearTo + employmentStatus='Self-Employed' but
  // silently ignored "Web Development," returning EVERY self-employed
  // alumnus regardless of field. Reuses the SAME filters.jobTitle/
  // jobTitleRegex every job-title lookup already uses (not a new filter key
  // needing its own wiring into every consumer) — a plain substring match
  // (not the word-boundary EXACT-phrase form jobTitleMatch above builds),
  // since a named field is rarely how an alumnus's own jobTitle is
  // literally worded, and almost never matches Graduate.industry's own
  // stored categories either (those are broad — "Information Technology" —
  // not narrow activities; see that field's real distinct values). If
  // genuinely nothing on file contains it, that's an honest, reportable
  // zero — not something to paper over by guessing a "web/full-stack/
  // front-end" synonym expansion this file has no real basis for asserting
  // are equivalent.
  if (!filters.jobTitle && /\b(?:self-?employed|freelanc\w*)\b/i.test(question)) {
    const fieldMatch = question.match(/\b(?:self-?employed|freelanc\w*)\b(?:\s+\w+){0,4}?\s+in\s+(?:the\s+)?([A-Za-z][A-Za-z &/-]{1,49}?)(?=[?,!.]|$)/i);
    if (fieldMatch) {
      const candidate = fieldMatch[1].trim();
      // Rejects a bare year ("self-employed ... in 2023") and the same
      // generic-filler list the other job-title/industry paths above
      // already use — this capture has no "working as"/"industry" anchor
      // of its own to lean on, so it's the most permissive of the three and
      // needs the widest guard against an obviously-wrong candidate.
      if (!/^\d{4}$/.test(candidate) && !/^(?:the|a|an|this|that|those|our|their|its|any|all)$/i.test(candidate)) {
        filters.jobTitle = candidate;
        filters.jobTitleRegex = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
  }

  // Company/employer name ("who works at Sutherland?", "ilan ang
  // nagtatrabaho sa kompanyang Accenture?") — reuses COMPANY_LOOKUP_PATTERN
  // (defined further below, used by extractCompanyName()) so this stays a
  // normal filter, combinable with course/gender/employment-status filters
  // and reusable by multi-turn follow-up accumulation, instead of the
  // isolated queryByCompany() bypass this used to be exclusively handled by
  // (which ignored every other filter and had no way to be reused by a
  // follow-up). Guarded against the pattern's own false-positive risk: "how
  // many alumni work IN IT industry" / "work IN Manila" also match "work...
  // in X" and would otherwise be captured as if "IT industry"/"Manila" were
  // company names — rejected here whenever the candidate names an
  // industry/sector or duplicates a program/industry filter already resolved
  // above (that already-set filter is the correct interpretation of "X").
  const company = extractCompanyName(question);
  if (company) {
    const lc = company.toLowerCase();
    // A bare 2-letter abbreviation ("IT"/"CS"/"IS"/"IM") is never a real
    // company name in this dataset — it's the NASA_INDUSTRY_ABBR match
    // above claiming the same text as an industry ("ilan nasa IT?"), which
    // the new "ilan/sino ... nasa X" company-lookup branch would otherwise
    // ALSO match (neither `filters.industry`/`filters.program` substring
    // check above catches this: "it" isn't a substring of "information
    // technology", it's the other way around).
    // "related" (e.g. "working in IT-related jobs") — COMPANY_LOOKUP_PATTERN's
    // "work...in X" alternative greedily captures to end-of-string, so a
    // generic "X-related jobs" phrase gets swallowed whole as if it named a
    // company. Caught live: "IT-related jobs" became filters.company,
    // stacking a company filter matching zero real companies on top of the
    // (correct) FIELD_RELATED_ABBR industry filter above — the count came
    // back 0 not because no IT-industry alumni are employed, but because
    // NO company is literally named "IT-related jobs".
    const looksLikeIndustryOrLocation = /\b(industry|industries|sector|field|locally|abroad|overseas|philippines|related)\b/i.test(company)
      || (filters.industry && lc.includes(filters.industry.toLowerCase()))
      || (filters.program  && lc.includes(filters.program.toLowerCase()))
      || /^(?:it|cs|is|im)$/i.test(company.trim());
    if (!looksLikeIndustryOrLocation) {
      filters.company = company;
      filters.companyRegex = '\\b' + company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b';
    }
  }

  // Employment status — only set for a single-status question ("how many are
  // unemployed?"). A compound question mentioning multiple statuses ("statistics
  // of employed and unemployed") must leave this unset so queryEmployment()
  // returns the full breakdown instead of silently narrowing to whichever
  // status this if/else-if chain happened to check first, dropping the rest
  // of the question. \bemployed\b does NOT match inside "unemployed" (no word
  // boundary between "un" and "employed"), but DOES match inside "self-employed"
  // and "never employed" (hyphen/space creates a boundary) — counted (not just
  // boolean-excluded) so a question like "employed including self employed",
  // which has BOTH a standalone "employed" AND a separate "self employed",
  // still detects the standalone one instead of discarding it entirely.
  // \s* alone only matched "never employed" with adjacent words — the equally
  // natural "have never BEEN employed" phrasing left neverEmployedCount at 0,
  // so the standalone "employed" inside it fell through to hasPlainEmployed
  // instead (see below), silently answering "how many were EMPLOYED" for a
  // question asking the opposite.
  const neverEmployedCount = (question.match(/\bnever\s+(?:been\s+)?employed\b/gi) || []).length;
  const selfEmployedCount  = (question.match(/\bself[- ]?employed\b/gi) || []).length;
  const allEmployedCount   = (question.match(/\bemployed\b/gi) || []).length;
  // Tagalog status words are distinct vocabulary, not shared substrings of
  // one another the way "self-employed"/"never employed" both contain
  // "employed" — so they're detected independently here rather than folded
  // into the English counting trick above, then OR'd into the same booleans
  // that trick already feeds. Deliberately NOT including bare "nagtatrabaho"
  // ("is working") as a plain-employed trigger — it's the generic verb any
  // work-related Tagalog question uses (including work_location questions
  // like "nagtatrabaho nang lokal"), and would have set employmentStatus:
  // 'Yes' (which excludes self-employed, per STATUS_PHRASE below) on
  // questions that were never asking about employment status at all.
  const hasNeverEmployed = neverEmployedCount > 0
    || /\bhindi\s+pa\s+(kailanman\s+)?nag(ka)?trabaho\b|\bhindi\s+pa\s+nakapagtrabaho\b/i.test(question);
  // "sariling" (not \bsariling\b) — "nagsasariling negosyo" fuses the
  // "nagsasa-" prefix directly onto "sariling" with no boundary between them,
  // same agglutination issue EMPLOYMENT_SIGNAL's own comment above explains.
  const hasSelfEmployed  = selfEmployedCount > 0
    || /sariling\s+negosyo\b|\bnegosyante\b|\bnagnenegosyo\b/i.test(question);
  // Natural paraphrases of "unemployed" that never use the literal word at
  // all ("still looking for work") were silently invisible to status
  // detection — the question fell through with no employmentStatus filter
  // set, so "graduates from batch 2022 still looking for work" answered
  // with the TOTAL batch headcount instead of the unemployed count, while
  // the literal "unemployed" phrasing of the exact same question answered
  // correctly — two answers for one question, disagreeing by 9x.
  const hasUnemployed    = /\bunemployed\b|\b(looking for (a )?(job|work)|job.?hunt(ing)?|seeking (a )?(job|employment|work)|searching for (a )?(job|work)|out of (a )?work|jobless|without (a )?job|haven'?t found (a )?job|(never|didn'?t|hasn'?t|hadn'?t)\s+(got|get|found|landed|secured)\s+(a\s+)?job|no job yet)\b/i.test(question)
    || /\bwalang\s+trabaho\b|\bnaghahanap\s+ng\s+trabaho\b|\bwalang\s+hanapbuhay\b/i.test(question);
  // Natural paraphrases of "employed" ("found/got/landed a job") were the
  // mirror-image gap of the unemployed-paraphrase fix above: these were only
  // ever used to pick the 'rate' TOPIC_PATTERNS bucket, never to actually set
  // an employmentStatus filter — so "How many alumni got a job in IT?" fell
  // straight through to queryCount() with NO status filter at all, silently
  // answering with the raw IT-program headcount (149) as if it had answered
  // the employment question. The negative lookahead-style check right after
  // excludes "haven't/hasn't/never/didn't found/got a job" (already correctly
  // handled as UNemployed above) so the two signals can't both fire and
  // produce a nonsensical two-status compound for a single-status question.
  const employedPhrase = /\b(?:found|got|get|landed|secured)\s+(?:a\s+)?job\b/i.test(question)
    && !/\b(?:haven'?t|hasn'?t|hadn'?t|never|didn'?t|doesn'?t|not)\s+(?:\w+\s+){0,2}(?:found|got|get|landed|secured)\b/i.test(question);
  const hasPlainEmployed = (allEmployedCount - selfEmployedCount - neverEmployedCount) > 0 || employedPhrase
    // nagtatrabaho/nagtrabaho ("is/was working" — verb form) is a distinct
    // grammatical shape from "may trabaho" ("has a job" — noun phrase)
    // already covered below; missing it meant "ilan ang nagtatrabaho?" fell
    // through with no status filter at all and answered with the total
    // headcount (256) instead of the employed count (169) — the literal
    // English "how many are employed" answered correctly, so the same
    // question asked in Tagalog silently gave a different number.
    || /\bmay\s+trabaho\b|\bempleyado\b|\bnakakuha\s+ng\s+trabaho\b|\bnagta+trabaho\b|\bnagtrabaho\b|\bgumagawa\b/i.test(question)
    // "working" (English "-ing" verb form) — the exact English counterpart
    // of nagtatrabaho/nagtrabaho just above, missing on the English side of
    // the very same gap: "Who is working?" set no employmentStatus filter at
    // all (only the literal noun "employed" was recognized), so it answered
    // with the full unfiltered 50-alumni roster instead of just the employed
    // ones. "self-employed" is excluded (that's its own distinct status,
    // matched separately by hasSelfEmployed above) via the negative
    // lookbehind, same guard the "employed" counting logic above already
    // uses for the same reason.
    || /(?<!self[- ])\bworking\b/i.test(question);

  // "employed locally/abroad" is a location descriptor ("works locally"), not
  // an independent status claim on top of the location. Treating "employed"
  // here as its own separate status filter is harmless for a positive
  // question (both filters point the same way), but for a negated one ("NOT
  // employed locally") it wrongly produces the AND of two negations —
  // "status != Yes AND location != local" — a far stricter, near-empty
  // intersection than the intended "doesn't work locally."
  let plainEmployedIsLocationPhrase = false;
  if (hasPlainEmployed) {
    const plainMatch = /(?<!self[- ])(?<!never\s)\bemployed\b/i.exec(question);
    if (plainMatch && /\blocal(?:ly)?\b|\babroad\b|\boverseas\b/i.test(question.slice(plainMatch.index, plainMatch.index + 30))) {
      plainEmployedIsLocationPhrase = true;
    }
  }

  const matchedStatuses = [];
  if (hasNeverEmployed) matchedStatuses.push('Never Employed');
  if (hasSelfEmployed)  matchedStatuses.push('Self-Employed');
  if (hasUnemployed)    matchedStatuses.push('No');
  if (hasPlainEmployed && !plainEmployedIsLocationPhrase) matchedStatuses.push('Yes');

  // Status-specific negation: "how many are NOT self-employed?" asks for the
  // complement of that one status (everyone else), not the status itself.
  // Only meaningful for a single matched status — a compound mention already
  // has its own explicit list via employmentStatuses below, and negating one
  // of several named statuses at once is an edge case not worth the ambiguity.
  const STATUS_PHRASE = {
    'Never Employed': 'never\\s*employed',
    'Self-Employed':  'self[- ]?employed',
    'No':             'unemployed',
    'Yes':            '(?<!self[- ])(?<!never\\s)employed',
  };

  if (matchedStatuses.length === 1) {
    const status = matchedStatuses[0];
    if (isNegatedBefore(question, STATUS_PHRASE[status])) {
      filters.excludeEmploymentStatus = status;
    } else {
      filters.employmentStatus = status;
    }
  } else if (matchedStatuses.length > 1) {
    // Compound question ("employed and unemployed") — record exactly which
    // statuses were asked about so queryEmployment() can show only those
    // rows, not every status that exists in the data. Also doubles as the
    // marker that stops the bare-noun-phrase industry guesser below from
    // mistaking the whole question for a literal industry name just because
    // employmentStatus ended up unset here.
    filters.employmentStatuses = matchedStatuses;
  }

  // Gender filter — \bmale\b never matches inside "female" (no word boundary
  // before "male" there), so check order doesn't matter, but female is checked
  // first for clarity anyway.
  if (/\bfemale\b|\bwomen\b|\bbabae(?:ng)?\b/i.test(question))      filters.gender = 'Female';
  else if (/\bmale\b|\bmen\b|\blalaki(?:ng)?\b/i.test(question))     filters.gender = 'Male';
  // Matches TOPIC_PATTERNS.gender's lgbt\w*/queer/gay/lesbian/transgender/
  // non-binary set — all map to the survey's single umbrella option.
  else if (/lgbt\w*|\bqueer\b|\bgay\b|\blesbian\b|transgender|non.?binary/i.test(question)) filters.gender = 'LGBTQIA+';

  // Exclude self-employed modifier
  if (/\b(don'?t|do\s+not|exclude|not\s+includ|without).{0,25}self[- ]?employ/i.test(question)) {
    filters.excludeSelfEmployed = true;
  }

  // Work location filter — only set for a single-sided question ("who works
  // abroad?"). A compound comparison ("locally vs. abroad") must leave this
  // unset so queryWorkLocation() returns the full local+abroad breakdown
  // instead of silently answering only the "local" half (this used to always
  // match "local" first via if/else-if, dropping "abroad" from the answer).
  // "local(?:ly)?" — NOT "locally?", which requires a double-L ("locall"/"locally")
  // and silently never matches bare "local" since `?` only applies to the "y".
  // "outside the Philippines" / "within the Philippines" — this app is
  // Philippines-specific (TSU), so a literal country name is at least as
  // common a phrasing as the generic "country" noun, which the original
  // pattern required verbatim and silently missed entirely.
  const hasLocalSignal  = /\blocal(?:ly)?\b|\bwithin.{0,20}(country|philippines)\b|\bhome\s+country\b|\blokal\b/i.test(question);
  const hasAbroadSignal = /\babroad\b|\boverseas\b|\boutside.{0,20}(country|philippines)\b|\bibang\s+bansa\b/i.test(question);
  if (hasLocalSignal && !hasAbroadSignal) {
    filters.workLocation = 'local';
  } else if (hasAbroadSignal && !hasLocalSignal) {
    filters.workLocation = 'abroad';
  }
  // "who is NOT employed locally?" / "not working abroad" — the workLocation
  // field only has two real values (Local/Abroad), so negating one is
  // equivalent to matching "not this value" rather than flipping to the
  // other, which stays correct even if a third value gets added later.
  if (filters.workLocation) {
    // isNegatedBefore() anchors on the LITERAL phrase actually present in
    // the question to find the negation's proximity — the original English-
    // only phrase list ('abroad|overseas') never matches when hasAbroadSignal
    // above actually fired because of the Tagalog phrase "ibang bansa" (a
    // completely different literal string, not a translation sharing any
    // substring with "abroad"). Caught live: "Ilan ang mga alumning hindi
    // nagtrabaho sa ibang bansa?" ("how many alumni do NOT work abroad?")
    // correctly set workLocation='abroad' via hasAbroadSignal, but
    // isNegatedBefore(question, 'abroad|overseas') found no match position
    // to check proximity against at all, so negateWorkLocation silently
    // stayed false — the question then answered with an unrelated bare
    // employed-alumni count instead of the real "NOT working abroad" group.
    const phrase = filters.workLocation === 'local'
      ? 'local(?:ly)?|lokal'
      : 'abroad|overseas|ibang\\s+bansa';
    if (isNegatedBefore(question, phrase)) filters.negateWorkLocation = true;
  }

  // Show all industries flag
  if (/\ball\s+industr/i.test(question) || (/\bshow\s+all\b/i.test(question) && /industr/i.test(question))) {
    filters.showAllIndustries = true;
  }

  // "show all"/"see the full list"/"show more" — a names-list answer now
  // previews only NAMES_PREVIEW_LIMIT results by default (see queryNames())
  // instead of dumping up to 50 immediately; this is the explicit request to
  // lift that cap for the SAME already-established filters. Deliberately
  // broad (matches on its own, no "alumni"/"names" noun required) since this
  // is meant to be typed as a short follow-up right after a truncated list
  // ("show the full list", "see more", "show everyone") — see
  // CONTINUATION_PATTERN in ragService.js for the matching change that lets
  // this bare phrasing inherit the prior turn's filters as a continuation.
  if (/\b(?:show|see)\s+(?:all|everyone|more|the\s+rest)\b|\bfull\s+list\b|\bcomplete\s+list\b|\ball\s+of\s+them\b/i.test(question)) {
    filters.showAll = true;
  }

  // "show 50"/"show the first 20"/"see 30"/"top 10" — an explicit request
  // for a SPECIFIC-sized preview, not just the binary showAll flag above.
  // \d{1,3} (not \d{1,4}) deliberately excludes 4-digit numbers so "batch
  // 2020"-style phrasing is never misread as a limit of 2020 — a real
  // requested preview size is realistically always under 1000. Capped at
  // NAMES_FULL_LIMIT so a wildly large typed number can't force an
  // effectively unbounded query.
  const showLimitMatch = question.match(/\b(?:show|see|list|display)\s+(?:the\s+)?(?:first\s+|top\s+)?(\d{1,3})\b|\btop\s+(\d{1,3})\b/i);
  if (showLimitMatch) {
    const n = parseInt(showLimitMatch[1] || showLimitMatch[2], 10);
    if (n > 0) filters.showLimit = Math.min(n, NAMES_FULL_LIMIT);
  }

  // "make it a line graph"/"turn that into a bar chart"/"pie chart please" —
  // a follow-up asking to RE-RENDER the previous answer's data as a
  // different chart type, not a new data question. Same "bare follow-up,
  // no topic of its own" shape as the showAll/showLimit phrases just above
  // — ragService.js's isChartTypeOnlyContinuation() treats a message that
  // resolves ONLY this filter as a continuation and appends it onto the
  // prior turn's own question text (mirroring its existing
  // isShowMoreOnlyContinuation handling), so this only needs to recognize
  // the bare phrase sitting anywhere in that combined string. Requires the
  // type word directly adjacent to chart/graph/plot (not just anywhere in
  // the question) so an unrelated real question mentioning "bar" in passing
  // can't misfire. 'pie'/'trend'/'column' map to this app's real chart
  // types — no separate pie renderer (MiniDonut already covers that shape).
  //
  // Takes the LAST match in the question, not the first — critical for
  // exactly the merged-string shape described above. "can you show me a BAR
  // chart comparing employment rates across all CCS specializations (make
  // it a PIE chart)" contains TWO chart-type phrases: the original
  // question's own "bar chart," and the just-appended "pie chart" the user
  // actually just asked for. A plain (non-global) .match() always returns
  // the FIRST one in the string, which is the STALE type from the ORIGINAL
  // question — not the one just requested — so a chart-type continuation
  // asked right after another chart-type continuation silently kept
  // re-rendering the OLD type and never recognized the new request at all.
  // Caught live, reported by name ("bakit di narerecognize ito") after "make
  // it a pie chart" right after "make it bar graph" right after the original
  // bar-chart question kept showing the bar chart.
  const chartTypeMatches = [...question.matchAll(/\b(line|trend|bar|bars|column|pie|donut)\s*(?:chart|graph|plot)\b/gi)];
  const chartTypeMatch = chartTypeMatches[chartTypeMatches.length - 1];
  if (chartTypeMatch) {
    const CHART_TYPE_WORD_MAP = { line: 'line', trend: 'line', bar: 'bars', bars: 'bars', column: 'bars', pie: 'donut', donut: 'donut' };
    filters.requestedChartType = CHART_TYPE_WORD_MAP[chartTypeMatch[1].toLowerCase()];
  } else if (VISUALIZATION_REQUEST_PATTERN.test(question)) {
    // "can you present it in a graph, chart or visual presentation?" — the
    // SAME "bare follow-up, no topic of its own" shape as the typed version
    // just above (chartTypeMatch), just without naming a specific type.
    // Coordinators/admins asking for "a graph" (no type) is at least as
    // common as naming one, but chartTypeMatch's own regex requires a type
    // word immediately before chart/graph/plot and simply doesn't match
    // this — this question then resolved NO filters at all, so
    // ragService.js's isChartTypeOnlyContinuation() (which only recognizes
    // requestedChartType) never treated it as a continuation either, and it
    // fell through as a fresh, topic-less message straight to the generic
    // "I could not find relevant information" refusal. filters.wantsChart
    // mirrors requestedChartType's own "carries no topic content of its
    // own" exemption everywhere that filter is special-cased (see
    // isGenericChartRequestContinuation() in ragService.js and this file's
    // own null-topic fallback below) — the underlying query function's
    // EXISTING default chart (already wired via VISUALIZATION_REQUEST_
    // PATTERN/wantsRateChart elsewhere in this file) is what actually
    // renders once the real prior question is correctly re-resolved; this
    // flag only has to get the continuation recognized and merged.
    filters.wantsChart = true;
  }

  // Superlative ranking direction ("least common"/"most common", "lowest"/
  // "top") for the ranked-list topics below (industry, job_positions,
  // top_companies, skills_list, competencies) — extracted as its own filter,
  // not just re-scanned from `question` at each dispatch call site, so a bare
  // follow-up that doesn't repeat the direction word itself ("show all the 15
  // industries", right after an already-established "least common
  // industries" breakdown) still INHERITS the right direction via seedFilters
  // the same way any other filter carries across turns. Without this, the
  // dispatch sites' own inline "does THIS turn's text say least/lowest/
  // fewest" checks only ever saw the current turn in isolation — caught live:
  // that follow-up silently flipped back to the "most common" default (and,
  // combined with filters.showAllIndustries still being set, printed ALL 27
  // industries top-down) the moment the reply stopped repeating "least"
  // verbatim. "least" checked first — a (currently unrealistic) phrase
  // combining both words is treated as "least" on the same "lowest wins
  // outright" convention wantsHighestDirection() above already uses.
  if (/\b(least|lowest|fewest)\b/i.test(question)) filters.rankDirection = 'least';
  else if (/\b(most|highest|top)\b/i.test(question)) filters.rankDirection = 'most';

  // Same carry-across-turns problem as rankDirection just above, for the
  // null-topic count-vs-names fallback further down (queryInner()): "how
  // many"/"ilan" signals the user wants a single NUMBER back, "who"/"list"/
  // "name(s)" signals a NAMES list — captured here as its own filter so a
  // bare narrowing continuation that repeats NEITHER wording ("how about
  // last month", right after an established "How many alumni are working in
  // IT-related jobs?" count question) still inherits which SHAPE of answer
  // was actually established via seedFilters, instead of that fallback
  // re-guessing from the continuation's OWN text alone. Caught live: that
  // exact "how about last month" follow-up silently flipped a 49-graduate
  // COUNT into an unrelated full NAMES dump of all 49, because "how about
  // last month" contains neither "how many" nor "who" for the fallback's own
  // inline check to key off.
  if (/\b(how\s+many|ilan(?:g)?|number\s+of|total|count)\b/i.test(question)) filters.answerShape = 'count';
  else if (/\b(who|sino|list|name(?:s)?)\b/i.test(question)) filters.answerShape = 'names';

  // Further education filter — check negation FIRST, use \w* to match full verb ("pursue/pursued").
  // "nagpatuloy/magpapatuloy...pag-aaral" — TOPIC_PATTERNS.further_studies
  // already recognizes this Tagalog phrase for TOPIC detection, but the
  // FILTER itself (used by queryCount() etc. for a single-status "how many"
  // answer) was never taught the same phrase, so a Tagalog "did NOT pursue"
  // negation, or a Tagalog phrasing reaching this file through some other
  // route (e.g. combined with a program/gender filter), silently got no
  // furtherEducation filter at all.
  if (/\b(did\s+not\s+pursu\w*|not\s+pursu\w*|never\s+pursu\w*|no\s+further)\b/i.test(question)
    || /\b(hindi|di|wala|walang)\b.{0,20}\bnagpatuloy\b|\bhindi\b.{0,20}\bnag-?aral\b/i.test(question)) {
    filters.furtherEducation = 'No';
  // "pursu* further" alone (with no check on what follows "further") used to
  // match "pursued further TRAINING" just as readily as "pursued further
  // EDUCATION" — caught live: "What percentage of alumni pursued further
  // training?" set filters.furtherEducation='Yes' (the STUDIES field), and
  // fn.rate's dispatch then answered with the further-EDUCATION rate (4.6%,
  // 32/702) for a question that was actually asking about the completely
  // separate further-TRAINING field (the real answer: 9.8%, 69/702) — a
  // wrong-topic substitution, not just an off-by-a-bit number. The negative
  // lookahead excludes training/seminar/workshop specifically right after
  // "further" so every other "pursued further ..." phrasing (education,
  // studies, masters, a specific degree name) still matches as before.
  } else if (/\b(pursu\w*\s+further(?!\s+(?:trainings?|seminars?|workshops?))|further\s+(education|studi)|graduate\s+studi|masters?|phd|post.?grad)\b/i.test(question)
    || /\bnagpatuloy.{0,15}pag-?aaral\b|\bmagpapatuloy.{0,15}pag-?aaral\b/i.test(question)) {
    filters.furtherEducation = 'Yes';
  }

  // Promotion filter (Graduate.hasPromotion) — needed so "who were promoted"
  // can scope queryNames() to just the promoted alumni, the same way
  // filters.tookExam/furtherEducation already let "who passed the board
  // exam"/"who pursued further education" return a real name list instead of
  // the generic Yes/No breakdown. Caught live: "Who are the alumni who were
  // promoted?" had no filter to set here at all, so fn.promotion's dispatch
  // (which only ever calls queryPromotion(), with no "who" branch) answered
  // with the promoted/not-promoted percentage breakdown instead of names —
  // not wrong data, but not what was actually asked for either.
  if (/\b(?:not|never|hasn'?t|haven'?t|wasn'?t)\b.{0,15}\b(?:been\s+)?promot(?:ed)?\b/i.test(question)) {
    filters.hasPromotion = 'No';
  } else if (/\bpromot(?:ed|ion)\b|\bna(?:ka)?\s?-?\s?promote\b|\bpinromote\b/i.test(question)) {
    filters.hasPromotion = 'Yes';
  }

  // Specific employment TYPE (not status) — "regular/permanent jobs",
  // "contractual", "job order", "casual", "temporary", "probationary",
  // "project-based", "trainee", "on training", "GIP" — a real Graduate field
  // (employmentType) with no filter extraction of its own until now. Gated
  // on a "job(s)/employ*/position/work" word nearby so a bare
  // "regular"/"permanent"/"casual" elsewhere in an unrelated sentence is
  // never mistaken for this filter. Without this, "How many alumni have
  // regular or permanent jobs?" matched no filter at all and silently
  // answered with the unfiltered whole-database total (262) instead of the
  // ~98 alumni actually in a Regular/Permanent position. "employ\w*" (not
  // just "employment"/"employees?") added after two separate live misses:
  // "employee(s)" isn't a substring of "employment", and "employed" (as in
  // "employed full-time") isn't a substring of either — both fell through
  // the old guard word list entirely.
  // "Part-time"/"Self-employed" added — confirmed against the actual tracer
  // form's "present employment type" dropdown (Regular/Permanent, Casual/
  // Contractual, Part-time, Project-based, Self-employed), real distinct
  // values this list never had at all (WORK_TYPE_MAP is now shared/declared
  // near isWorkTypeComparisonQuestion() above, not redeclared here).
  //
  // A genuine comparison ("full-time vs part-time", "regular vs contractual
  // vs part-time") sets filters.employmentTypesRequested to the SPECIFIC
  // labels named instead — queryWorkType() filters its full breakdown down
  // to just those, rather than either (a) the single-value path below
  // silently keeping only ONE side of the user's own comparison (the "part-
  // time" narrowing bug this comment used to describe), or (b) dumping every
  // one of the ~12 real+legacy categories on screen when only 2 were asked
  // about. FULL_TIME_PATTERN is tracked separately since it has no real
  // WORK_TYPE_MAP entry at all — queryWorkType() uses this flag to say so
  // explicitly instead of silently dropping that half of the question.
  if (isWorkTypeComparisonQuestion(question)) {
    filters.employmentTypesRequested = matchedWorkTypeLabels(question);
    if (FULL_TIME_PATTERN.test(question)) filters.mentionsUntrackedFullTime = true;
  } else if (/\b(?:jobs?|employ\w*|position|work)\b/i.test(question)) {
    for (const [pat, value] of WORK_TYPE_MAP) {
      // "Self-employed" is a real stored value in BOTH employmentType (job
      // arrangement: Regular/Permanent, Contractual, Casual, Self-employed,
      // ...) and employmentStatus (Yes/No/Self-Employed/Never Employed) — a
      // bare "how many are self employed" is an employment-STATUS question,
      // but it satisfies this loop's own "employ*" guard word (baked into
      // "self-EMPLOYed" itself) and this entry's own pattern too, silently
      // adding an unwanted employmentType filter on top of the status one
      // queryCount() already set. The two then get ANDed together there,
      // undercounting to the intersection of two different fields (3)
      // instead of the real status-only count (10). Skip this entry
      // whenever the employmentStatus half above already captured the same
      // phrase — a genuine work-type comparison naming Self-employed
      // alongside another type still works via employmentTypesRequested
      // above, untouched by this.
      // excludeEmploymentStatus === 'Self-Employed' ALSO skipped — a
      // NEGATED mention ("how many alumni are NOT self-employed?") sets
      // THAT filter (not the positive filters.employmentStatus this check
      // originally only looked at), but this loop has no concept of
      // negation at all and set filters.employmentType = 'Self-employed'
      // (the POSITIVE, non-negated value) regardless. Caught live: "How many
      // alumni are not self-employed?" ended up with excludeEmploymentStatus
      // = 'Self-Employed' (correct) AND employmentType = 'Self-employed'
      // (wrong, contradicts the negation) ANDed together in queryCount() —
      // "NOT self-employed status" AND "IS self-employed type" is nearly a
      // self-contradiction, collapsing ~700 real non-self-employed alumni
      // down to a nonsense "1" result instead of the correct ~700.
      if (value === 'Self-employed' && (filters.employmentStatus === 'Self-Employed' || filters.excludeEmploymentStatus === 'Self-Employed')) continue;
      if (pat.test(question)) { filters.employmentType = value; break; }
    }
    // "full-time" named as a SECONDARY modifier on a different primary
    // question ("...employed full-time locally versus full-time abroad" —
    // the primary ask is the LOCAL/ABROAD split, not the employment type
    // itself) — unlike the comparison-mode branch above (queryWorkType()'s
    // own "ask first, don't silently substitute" flow for when full-time
    // IS the primary subject), silently answering with NO employment-type
    // scope at all here would just drop the qualifier with zero indication,
    // the same "correct-looking but silently wrong" class of bug this file
    // has fixed repeatedly. No real WORK_TYPE_MAP entry exists for
    // "full-time" (see FULL_TIME_PATTERN's own comment — no stored value
    // corresponds to it exactly), so this applies the SAME closest-real-
    // category substitution (Regular/Permanent) queryWorkType() already
    // uses, but directly (this is a modifier on an already-answerable
    // question, not the question's own main subject) — filters.
    // fullTimeSubstituted lets the answer text disclose the substitution
    // instead of silently presenting it as an exact match. Caught live:
    // "How many BS Computer Science graduates are employed full-time
    // locally versus employed full-time abroad?" silently dropped
    // "full-time" entirely and answered the unscoped Local/Abroad split.
    if (!filters.employmentType && FULL_TIME_PATTERN.test(question)) {
      filters.employmentType = 'Regular/Permanent';
      filters.fullTimeSubstituted = true;
    }
  }

  // Job relevance filter — requires "job/jobs" or "field" (a common synonym
  // in "field related to their degree/course") to avoid extracting from
  // generic overview questions ("Is the work relevant to their degree?"
  // should NOT set this; "jobs/field related to course" should). Tagalog
  // "trabaho"/"hanapbuhay" (job) + "kaugnay"/"may kinalaman sa" (related) —
  // same gap as furtherEducation above: TOPIC_PATTERNS.job_relevance already
  // recognized these words, the FILTER extraction (what actually decides
  // directly/somewhat/no) didn't.
  // trabaho(?:ng)? — not \btrabaho\b alone: Tagalog's "-ng" linker attaches
  // directly with no word boundary ("trabahong kaugnay" = "job that is
  // related"), the same agglutination issue lalaki(?:ng)?/babae(?:ng)? in
  // TOPIC_PATTERNS.gender above already accounts for. Missing this meant
  // "may trabahong kaugnay ng kurso" matched "kaugnay" but not "trabaho",
  // silently failing the hasJobWord&&hasRelatedWord check below.
  const hasJobWord     = /\bjobs?\b|\bfield\b|\btrabaho(?:ng)?\b|\bhanapbuhay(?:na)?\b/i.test(question);
  const hasRelatedWord = /\brelated\b|\brelevant\b|\bkaugnay\b|\bkinalaman\b/i.test(question);
  // "X-related" (hyphen/space-attached to a preceding word, e.g. "IT-related
  // jobs") is "related" describing a NAMED FIELD, never "related to THEIR
  // OWN course" — the only thing this filter is meant to capture. Without
  // this exclusion, "IT-related jobs" satisfied hasJobWord ("jobs") &&
  // hasRelatedWord ("related") and set filters.jobRelated='yes' on top of
  // the FIELD_RELATED_ABBR industry filter above — two filters from one
  // phrase that only ever meant one thing, producing self-contradicting
  // answers (see that block's own comment for the live example). Hyphen-only
  // (not space) — a genuine "jobs related to their course" question always
  // has "related" as a separate, SPACE-separated word from what precedes
  // it, never hyphenated into a single compound adjective; matching on
  // space too would (and, caught before shipping, briefly did) wrongly
  // exclude that legitimate phrasing as well. Excludes "non-/un-/not-related"
  // specifically — those ARE negations of "related to their course" (handled
  // by the negation branch below), not a named field like "IT-related".
  const isFieldRelated = /\b(?!non-|un-|not-)\w+-related\b/i.test(question);
  if (!isFieldRelated && (
      /\b(jobs?|field).{0,40}(related|relevant)\b/i.test(question) ||
      /\b(related|relevant).{0,20}(jobs?|field)\b/i.test(question) ||
      /\b(directly|somewhat)\s+(related|relevant)\b/i.test(question) ||
      (hasJobWord && hasRelatedWord))) {
    if (/\bdirectly\b/i.test(question))                                      filters.jobRelated = 'directly';
    else if (/\bsomewhat\b/i.test(question))                                 filters.jobRelated = 'somewhat';
    // "non" added — "non-related" is a common way to phrase "NOT related"
    // but contains none of the other negation words, so it used to fall to
    // the `else` branch below and wrongly resolve to 'yes' (the OPPOSITE of
    // what "non-related" means). Caught live alongside the IT-related bug
    // above: "non-related IT jobs" answered as if it meant "related to
    // their course," the exact inverse of the question asked.
    else if (/\b(not|no|non|un|aren'?t|don'?t|doesn'?t|hindi|walang|wala)\b/i.test(question)) filters.jobRelated = 'no';
    else                                                                      filters.jobRelated = 'yes';
  }

  // Specific competency filter
  const COMP_MAP = [
    [/\btechnical\s+skills?\b/i,        'technicalSkills'],
    [/\bproblem.?solving\b/i,           'problemSolving'],
    [/\bproject\s+management\b/i,       'projectManagement'],
    [/\bcritical\s+thinking\b/i,        'criticalThinking'],
    [WORK_LIFE_BALANCE_PATTERN,         'workLifeBalance'],
    [/\bteamwork\b/i,                   'teamwork'],
    [/\badaptability\b/i,               'adaptability'],
    [/\bcommunication\s+skills?\b|\bcommunication\b/i, 'communication'],
  ];
  for (const [pat, key] of COMP_MAP) {
    if (pat.test(question)) { filters.competency = key; break; }
  }

  // Specific competency RATING LEVEL — only meaningful alongside
  // filters.competency just above (which skill), narrows to one specific
  // self-rating tier ("rated their Critical Thinking as 'High Competent'").
  // The REAL stored values (Graduate.competencies.<skill>, confirmed live
  // against the actual database) are exactly five: Beginner, Competent,
  // Excellent, Non-Acceptable, Satisfactory. A common intensifier ("high,"
  // "very," "highly") is stripped from the question first, so "High
  // Competent" matches the literal stored word "Competent" directly rather
  // than guessing it means something else — this is a literal match
  // against the real vocabulary, not an invented synonym. The few
  // additional synonyms mapped below (excellent/outstanding/exceptional ->
  // Excellent, poor/weak/unacceptable -> Non-Acceptable, novice/basic ->
  // Beginner) are unambiguous, common casual phrasings for the same tier —
  // deliberately NOT a broad fuzzy/semantic map, since a wrong guess here
  // would silently search for the WRONG rating tier with no indication
  // anything was misread.
  if (filters.competency) {
    const ratingText = question.replace(/\b(?:high|highly|very|extremely|so|quite|really)\b/gi, ' ');
    const RATING_LEVEL_MAP = [
      [/\b(?:excellent|outstanding|exceptional|expert)\b/i, 'Excellent'],
      [/\bcompetent\b/i,                                     'Competent'],
      [/\bsatisfactory\b/i,                                  'Satisfactory'],
      [/\b(?:non-?acceptable|unacceptable|poor|weak)\b/i,    'Non-Acceptable'],
      [/\b(?:beginner|novice|basic)\b/i,                     'Beginner'],
    ];
    for (const [pat, value] of RATING_LEVEL_MAP) {
      if (pat.test(ratingText)) { filters.competencyRating = value; break; }
    }
  }

  // Board / licensure exam filter — negation must bind to the RIGHT verb.
  // "did not pass" means failed (or at least not-passed), NOT "never took
  // the exam" — a single generic "did not/didn't/never" check used to
  // collapse both into tookExam='no', silently mislabeling "did not pass the
  // board exam" as "never took it." Check take/pass/fail negation separately.
  // "board passers"/"licensure passers" (noun form, no literal "exam" word
  // at all) doesn't satisfy "pass\w*.{0,20}\bexam\b" — caught live: "What
  // percentage of alumni are board passers?" matched neither that nor any
  // other alternative here, so filters.tookExam was never set, and the
  // question's OWN topic ('rate', via TOPIC_PATTERNS — checked earlier in
  // object order than 'licensure' and already won outright) fell through to
  // the generic overall EMPLOYMENT rate (31.6%) instead of the real board
  // exam pass rate — a completely different metric silently substituted for
  // the one actually asked about.
  if (/\blicens\w*\b|\b(board\s+exam|professional\s+exam|prc|tak\w*.{0,20}\bexam\b|pass\w*.{0,20}\bexam\b|fail\w*.{0,20}\bexam\b|board\s+passers?|licensure\s+passers?|pumasa|pumapasa|nakapasa|bumagsak|nabagsak|pumalya)\b/i.test(question)) {
    // "pumasa" (Tagalog "passed") shares no substring with English "pass",
    // so it fell all the way through to the generic `else` below and
    // resolved to the wrong status entirely — "ilan ang pumasa sa board
    // exam" (how many PASSED) answered with the took-the-exam count (22)
    // instead of the passed count (13), a real numeric mismatch, not just a
    // phrasing difference.
    const notTook = /\b(?:did\s*not|didn'?t|never|not)\s+(?:\w+\s+){0,1}(?:tak|attend|sit)/i.test(question);
    const notPass = /\b(?:did\s*not|didn'?t|not)\s+(?:\w+\s+){0,1}pass\b|\b(?:hindi|di)\s+(?:\w+\s+){0,1}(?:pumasa|pumapasa|nakapasa)\b/i.test(question);
    const notFail = /\b(?:did\s*not|didn'?t|not)\s+(?:\w+\s+){0,1}fail\b|\b(?:hindi|di)\s+(?:\w+\s+){0,1}(?:bumagsak|nabagsak|pumalya)\b/i.test(question);
    if (notTook)                            filters.tookExam = 'no';
    else if (notPass)                       filters.tookExam = 'failed';
    else if (notFail)                       filters.tookExam = 'passed';
    else if (/\bpass\w*\b|\bpumasa\b|\bpumapasa\b|\bnakapasa\b/i.test(question)) filters.tookExam = 'passed';
    else if (/\bfail\w*\b|\bbumagsak\b|\bnabagsak\b|\bpumalya\b/i.test(question)) filters.tookExam = 'failed';
    else                                    filters.tookExam = 'yes';
  }

  // Lets a bare follow-up like "how about in the last 5 days?" (no
  // "tracer"/"updated"/"added" word of its own — see TOPIC_PATTERNS.
  // tracer_activity) still be recognized as continuing a tracer-activity
  // question: buildSeedFilters() re-runs extractFilters() on the PRIOR
  // question's raw text, so this key survives into seedFilters even though
  // the follow-up's own text wouldn't set it. queryInner uses this to know
  // which action (updated/not updated/added) to keep asking about when only
  // the time window changes turn to turn.
  if (TOPIC_PATTERNS.tracer_activity.test(question)) {
    const isAdded = /\badded\b/i.test(question) && !/\b(?:updat|submitt|resubmitt|edit|modif|chang)\w*\b/i.test(question);
    const isNegated = /\b(?:not|haven'?t|hasn'?t|never)\b/i.test(question);
    filters.tracerActivityAction = isAdded ? 'added' : isNegated ? 'not_updated' : 'updated';
  }

  // A bare ALL-CAPS token immediately followed by "graduates/alumni/students"
  // ("What percentage of MIT graduates are employed?") that nothing above
  // resolved to any real program/industry/company/gender reads as an
  // ATTEMPTED program reference, even though "MIT" isn't one of the courses
  // this school actually offers. Left unset, the question silently fell
  // through with NO program filter at all, and queryRate() (etc.) just
  // answered for the ENTIRE unfiltered cohort instead — the answer never
  // mentioned "MIT" was unrecognized, reading as if it had correctly
  // answered the actual question asked. Setting filters.program to the raw
  // token instead lets it flow through the exact same regex $match every
  // other program filter already uses, which naturally matches ZERO real
  // records for a program that doesn't exist — producing the same honest
  // "no data" decline every other genuinely-empty scope already gets,
  // instead of a confident but completely unrelated whole-cohort number.
  // Gated behind every filter above being unset so this never overrides an
  // already-correctly-resolved filter of any kind (in particular, a REAL
  // recognized program/abbreviation like "BSIT"/"IT" already set
  // filters.program earlier and is never reached here).
  if (!filters.program && !filters.industry && !filters.excludeIndustry && !filters.company && !filters.gender) {
    // \s* (not \s+) — a fumbled/garbled attempt at a code often lands with
    // NO space at all before the suffix word ("CCSTalumni"), not just a
    // spaced-out one ("CCCCS alumni"). [A-Z]{2,8} is greedy but can only
    // ever consume uppercase letters, so it naturally stops right where the
    // lowercase suffix word begins even with zero separating whitespace —
    // requiring \s+ here meant a glued-together attempt matched nothing at
    // all and silently fell through to the unfiltered whole-cohort answer
    // instead of this function's own honest "no such program" decline.
    const unknownProgramMatch = question.match(/\b([A-Z]{2,8})\s*(?:graduates?|alumni|alumnus|alumna|students?)\b/);
    // A COLLEGE code ("CCS alumni", "CIT graduates") also matches this
    // bare-ALL-CAPS shape, but it's a real, recognized value — just not a
    // PROGRAM. It's resolved separately a few lines below (filters.college,
    // via extractRequestedCollege()/COLLEGE_CODES), and Graduate.program
    // never literally contains a college code, so setting filters.program to
    // it here always matched zero real records — producing a false "no
    // matching tracer study data was found for college 'CCS'" for a
    // perfectly answerable question. Caught live: "List top industries where
    // CCS alumni work" and "how many CCS alumni..." both fell into this
    // trap. COLLEGE_CODES is declared further down this file as a
    // module-level const — safe to reference here since extractFilters()
    // only ever runs per-request, after the whole module has loaded.
    if (unknownProgramMatch && !COLLEGE_CODES.includes(unknownProgramMatch[1].toUpperCase())) {
      filters.program = unknownProgramMatch[1];
      filters.programLabel = unknownProgramMatch[1];
    }
  }

  // A college named in this question ("what are the events in CCS") — folded
  // into the same seedFilters mechanism as company/job/industry/program/etc.
  // so a follow-up that doesn't repeat it ("can you list the participants
  // who attended each of the events?") still inherits it via buildSeedFilters
  // instead of forcing the college-picker clarify question all over again on
  // every single turn. extractRequestedCollege is declared further down this
  // file as a function declaration, so it's hoisted and safe to call here.
  const requestedCollege = extractRequestedCollege(question);
  if (requestedCollege) filters.college = requestedCollege;

  return filters;
}

function filterLabel(filters) {
  const parts = [];
  if (filters.programLabel)  parts.push(filters.programLabel);
  else if (filters.program)  parts.push(filters.program);
  // filters.college was silently never surfaced here at all — every answer
  // using this helper (queryCount, queryEmployment, etc.) stayed completely
  // silent about a college scope even when one was actually applied. Caught
  // live: "How many alumni are employed, male, and from CCS?" correctly
  // resolved filters.college='CCS' and the returned NUMBER was correctly
  // scoped to it, but the answer text read "There are 120 male employed
  // alumni in the tracer study database" with zero mention of CCS — reading
  // exactly like a TSU-wide figure instead of the CCS-only one it actually
  // was, the same "silently drops a real filter from the visible answer"
  // failure class as the jobRelated/industry filter-combo bugs fixed
  // earlier this session.
  if (filters.college) parts.push(filters.college);
  // Was missing: queryPromotion/queryLicensure/queryFurtherStudies/
  // queryFurtherTraining all build their label text through this helper —
  // without this, even after stablePipeline() above was fixed to actually
  // APPLY the industry filter, the answer text itself stayed silent about
  // it, reading identically to an unfiltered answer (same "correct number,
  // misleading sentence" failure class as the college fix below).
  if (filters.industry) parts.push(`${filters.industry} industry`);
  else if (filters.excludeIndustry) parts.push(`excluding ${filters.excludeIndustry} industry`);
  // Was missing, same "correct number, silent/misleading sentence" failure
  // class as college/industry above — a job-title-scoped queryCount()
  // answer read identically to the unfiltered total, with zero indication
  // the number was actually narrowed to that one title. Caught live: "how
  // many BS Information Technology graduates from Batch 2024 are working
  // locally as Front-end Developer" correctly counted 26 matching that
  // exact title, but the answer sentence said only "(Information
  // Technology, Batch 2024)" — no mention of "Front-end Developer" at all.
  if (filters.jobTitle) parts.push(`working as ${filters.jobTitle}`);
  // Was missing — same "correct number, silent/misleading sentence" failure
  // class as every entry above: queryCount()/queryNames() now actually
  // APPLY filters.competency+competencyRating as a real match condition
  // (see queryCount()'s own comment), but without this, the answer text
  // stayed completely silent about it, reading identically to a plain
  // unfiltered count. Only shown when BOTH are set — a bare filters.competency
  // with no rating level never reaches queryCount() at all (still redirects
  // to queryCompetencies()'s full distribution instead).
  if (filters.competency && filters.competencyRating) {
    const skillLabel = COMP_LABEL[filters.competency] || filters.competency;
    parts.push(`rated ${skillLabel} as ${filters.competencyRating}`);
  }
  // Was missing, same "correct number, silent/misleading sentence" failure
  // class as every entry above — stablePipeline() now actually APPLIES
  // filters.employmentType (see its own comment), but the answer text
  // stayed silent about it. filters.fullTimeSubstituted (set in
  // extractFilters() when "full-time" has no exact WORK_TYPE_MAP entry and
  // got mapped to the closest real category instead) gets an explicit
  // "(treated as ...)" note rather than reading as if "full-time" were
  // itself a real stored value — see FULL_TIME_PATTERN's own comment.
  if (filters.employmentType) {
    parts.push(filters.fullTimeSubstituted
      ? `full-time, treated as ${filters.employmentType}`
      : filters.employmentType);
  }
  if (filters.yearsGraduated) parts.push(`Batches ${filters.yearsGraduated.slice().sort((a, b) => a - b).join(', ')}`);
  else if (filters.yearGraduated) parts.push(`Batch ${filters.yearGraduated}`);
  else if (filters.yearFrom && filters.yearTo) parts.push(`Batch ${filters.yearFrom} to ${filters.yearTo}`);
  else if (filters.yearFrom) parts.push(`${filters.yearFrom} onward`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

// Prefix like "female " / "male " for a sentence's grammatical subject —
// mirrors queryCount()'s established convention. Applied individually (not
// folded into filterLabel()) so it doesn't risk double-mentioning gender in
// queryCount()/queryNames(), which already handle it themselves. Lowercasing
// reads fine for ordinary words ("male", "female") but flattens the acronym
// "LGBTQIA+" into "lgbtqia+" — kept uppercase like any other acronym instead.
function genderPrefix(filters) {
  if (!filters.gender) return '';
  return filters.gender.toUpperCase() === 'LGBTQIA+' ? 'LGBTQIA+ ' : `${filters.gender.toLowerCase()} `;
}

function pct(n, total) {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—';
}

// Builds the { text, chart } shape queryInner()'s wrapper expects. `rows` is
// whatever category/count rows the calling function already computed for its
// text breakdown — reused as-is for the chart rather than re-querying.
// `labelField` lets callers whose rows key the label as `_id` (most raw
// $group outputs) or `label`/`display` (already-merged case-insensitive
// groups like queryGender/queryEmployment) all feed the same helper.
// unit/max: only meaningful for type: 'line' — TrendLine (frontend) defaults
// to a hardcoded 0-100% axis, built for this file's one percentage-trend
// chart ("Employment Rate by Batch Year"). A caller building a genuine
// percentage-over-time line chart passes unit: '%', max: 100 explicitly (see
// queryEmploymentRateByProgram's own call); omitted for every other type —
// queryInner()'s own requestedChartType override (a "make it a line graph"
// follow-up converting a raw-count donut/bars chart) computes unit/max from
// the actual row values instead, since those never live on a 0-100 scale.
function withChart(text, { type = 'donut', title, rows, labelField = '_id', limit, unit, max } = {}) {
  if (!text || !rows?.length) return text;
  const chartRows = (limit ? rows.slice(0, limit) : rows)
    .map(r => ({ label: String(r[labelField] ?? r._id ?? r.label ?? ''), count: r.count }))
    .filter(r => r.label);
  if (!chartRows.length) return text;
  const chart = { type, title, rows: chartRows };
  if (unit != null) chart.unit = unit;
  if (max != null) chart.max = max;
  return { text, chart };
}

// "make it a pie/bar/line chart" — mutates `chart` in place to the
// requested type, same recompute queryInner()'s own generic dispatch
// wrapper (further below) already does for a whole chart. That generic
// wrapper only ever runs on the fn()-dispatch path — every `direct: true`
// EARLY-RETURN bypass in this file (queryCompare(), the TREND_PATTERN
// by-year shortcut, the "which batch/year has the highest/lowest X"
// ranking shortcut, and any new one added later) skips it entirely and has
// to apply the override itself, or a chart-type follow-up right after that
// bypass's own answer silently keeps whatever type it hardcoded no matter
// what was actually requested. Found and fixed three separate times as
// three "separate" bugs before becoming one shared helper — call this from
// every CURRENT and FUTURE `direct: true` return site that includes a
// chart, rather than re-deriving the same few lines a fourth time.
function applyRequestedChartType(chart, requestedChartType) {
  if (!requestedChartType || !chart) return;
  chart.type = requestedChartType;
  if (requestedChartType === 'line' && chart.unit !== '%') {
    chart.unit = '';
    chart.max = Math.ceil(Math.max(...chart.rows.map(r => r.count || 0), 1) * 1.1);
  }
}

// Recognizes a "by program" question shape — used at every rate/relevance/
// work-location dispatch site that decides between a single overall number
// and a per-program breakdown. Was just "(which|what) (program|course|
// degree)" (requires the trigger word DIRECTLY adjacent to the noun), which
// missed "What is the RANKING OF programs by employment rate?" — several
// words sit between "what" and "programs" there, so the plain-adjacency
// version never matched and this fell all the way through to the generic
// single-number queryRate() instead of the by-program ranking actually
// asked for. The 2nd/3rd alternatives catch that shape (and "rank the
// programs"/"programs ranked") without requiring exact adjacency.
//
// The last alternative catches a DIFFERENT common phrasing that still
// slipped through all of the above: "the course THAT HAS the highest
// employment rate" / "the program WITH the lowest rate" — no "which"/"what"
// at all, so this answered with the plain overall rate instead of ranking
// by program. Caught live: "how about the course that has the highest
// employment rate?" answered with the same generic 69.0% overall figure a
// completely unfiltered "what is the employment rate" question would get.
// "by program"/"per program"/"by course" SUFFIX phrasing added — caught live
// via systematic testing: "What is the licensure exam pass rate BY PROGRAM?"
// / "What percentage of alumni have jobs related to their course BY
// PROGRAM?" don't start with "which/what program" (the only shape the
// original alternatives covered — "what" here is followed by "is," not
// "program"), so none of this pattern's alternatives matched at all, and
// these fell through to the plain overall figure (e.g. the bare 19-passed
// licensure count) with the "by program" half of the question silently
// dropped — reading as if it had answered the per-program breakdown when it
// had actually just ignored that part of the question. Same "by
// program/course" vocabulary TOPIC_PATTERNS.by_program already recognizes
// for topic detection, now also recognized here for ROUTING within a topic
// that already matched (rate/employment/licensure/etc.).
// \b(?:show|see|list|display)\s+(?:all|every)\s+(?:the\s+)?(?:programs?|courses?)\b —
// a follow-up right after a by-program breakdown asking to re-expand it
// ("show all the programs", "see every course") never repeats "by
// program"/"per program" itself (that phrasing already did its job one turn
// ago), so none of the other alternatives above recognized it. Caught live:
// "show all the programs so I can download the graph" right after "What is
// the licensure exam pass rate by program?" — detectTopic() found no topic
// in the bare continuation text, and the generic null-topic fallback further
// below saw filters.tookExam (inherited from the prior turn) as "real
// content," defaulting to a NAMES list of exam passers instead of
// re-rendering the by-program chart with the small-sample programs no
// longer omitted. This alternative lets the dispatch override just below
// (which checks this same pattern against filters.tookExam/
// furtherEducation/hasPromotion) correctly re-route it regardless of
// whatever topic the null-topic fallback guessed.
// "aling programa"/"anong programa" (Tagalog "which program") added — caught
// live via systematic Tagalog testing: "Aling programa ang may pinakamataas
// na employment rate?" matched NONE of the English-only alternatives above,
// so it fell through to the generic bare overall employment rate — and the
// LLM narration, apparently trying to sound responsive to a question that
// explicitly asked "which program," HALLUCINATED a specific, entirely
// NON-EXISTENT program name ("the College of Engineering" — no Engineering
// program exists anywhere in this system, every real program here is an
// IT/CS/IS variant) directly attached to the real but unrelated bare rate
// figure. A far more serious failure than simply answering the wrong
// question: it fabricated a plausible-sounding but completely fictitious
// entity name to paper over the dropped "which program" framing.
// "specialization(s)"/"track(s)" added as synonyms alongside program/course/
// degree, and "across (all|every) ..." added as a connector synonym for
// "by/per/each" — same gap, same fix shape as TOPIC_PATTERNS.by_program's
// own comment above: "compare employment rates across all specializations"
// matched none of the original alternatives (no "by/per/each", no "which/
// what program", no "program"+"that has"), so it silently fell through to
// the generic single-number overall rate with the per-specialization
// comparison completely dropped.
// across\s+(?:all|every)\b(?:\s+\w+){0,2}\s+(?:programs?|...) — the
// (?:\s+\w+){0,2} tolerates a word or two between "all/every" and the noun
// ("across all CCS specializations"); same gap, same fix shape as
// TOPIC_PATTERNS.by_program's own identical alternative — a plain-adjacency
// version matched "across all specializations" but missed the college-code-
// in-the-middle phrasing entirely. Caught live.
const BY_PROGRAM_QUESTION_PATTERN = /\b(?:which|what)\s+(?:program|course|degree|specialization|track)\b|\b(?:aling|anong)\s+(?:programa|kurso)\b|\branking\s+of\s+(?:programs?|courses?|specializations?|tracks?)\b|\b(?:programs?|courses?|specializations?|tracks?)\s+(?:ranking|ranked)\b|\brank(?:ed)?\s+(?:the\s+)?(?:programs?|courses?|specializations?|tracks?)\b|\b(?:program|course|degree|specialization|track)\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:highest|lowest|best|worst)\b|\bby\s+(?:program|course|specialization|track)\b|\bper\s+(?:program|course|specialization|track)\b|\beach\s+(?:program|course|specialization|track)\b|\bacross\s+(?:all|every)\b(?:\s+\w+){0,2}\s+(?:programs?|courses?|specializations?|tracks?)\b|\bkada\s+(?:programa|kurso)\b|\bbawat\s+(?:programa|kurso)\b|\b(?:show|see|list|display)\s+(?:all|every)\s+(?:the\s+)?(?:programs?|courses?|specializations?|tracks?)\b/i;

// Same shape/reasoning as BY_PROGRAM_QUESTION_PATTERN above, for "which
// industry/sector" superlative-rate questions instead. Caught live: "Which
// industry has the highest promotion rate?" matched none of the industry
// topic's own branches (those only ever narrow to ONE named industry via
// filters.industry — there was no "rank every industry" counterpart at all)
// and fell through to the bare, unfiltered overall promotion rate — the
// same "silently answers a different, broader question" failure class
// BY_PROGRAM_QUESTION_PATTERN was built to close for programs.
const BY_INDUSTRY_QUESTION_PATTERN = /\b(?:which|what)\s+industry\b|\b(?:which|what)\s+sector\b|\b(?:aling|anong)\s+(?:industriya|sektor)\b|\bindustry\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:highest|lowest|best|worst)\b|\bby\s+industry\b|\bper\s+industry\b|\beach\s+industry\b/i;

const YES_RE = /^yes\b/i;

// Maps tookExam filter value → MongoDB match condition
function tookExamMatch(val) {
  if (val === 'passed') return { tookExam: { $regex: 'passed', $options: 'i' } };
  if (val === 'failed') return { tookExam: { $regex: 'failed', $options: 'i' } };
  if (val === 'yes')    return { tookExam: { $regex: '^yes',   $options: 'i' } };
  if (val === 'no')     return { tookExam: { $regex: '^no',    $options: 'i' } };
  return {};
}

// Deduplicate per person — email if available, else name, else MongoDB _id.
// Sort newest-first so $first picks the most recently ingested record.
const DEDUP = [
  { $sort: { createdAt: -1 } },
  { $group: {
    _id: { $toLower: { $trim: { input: {
      $cond: {
        if:   { $and: [{ $ne: ['$email', null] }, { $ne: ['$email', ''] }] },
        then: '$email',
        else: { $ifNull: ['$name', { $toString: '$_id' }] },
      },
    }}}},
    doc: { $first: '$$ROOT' },
  }},
  { $replaceRoot: { newRoot: '$doc' } },
];

// Resolves filters.yearFrom/yearTo (a closed range from "batch 2020 to 2022",
// or an open-ended lower bound from "past N years") into the $gte/$lte
// MongoDB condition every by-year-range function below needs. Returns null
// when neither bound is set.
function yearRangeCondition(filters) {
  if (!filters.yearFrom && !filters.yearTo) return null;
  const range = {};
  if (filters.yearFrom) range.$gte = filters.yearFrom;
  if (filters.yearTo)   range.$lte = filters.yearTo;
  return range;
}

// Resolves filters.yearGraduated/yearFrom/yearTo into the single $match value
// every exact-or-ranged year filter below needs. Centralized so the range fix
// only had to land once instead of separately in each call site that used to
// hardcode `filters.yearGraduated` alone and silently ignore a range.
function yearMatchCondition(filters) {
  if (filters.yearsGraduated) return { $in: filters.yearsGraduated };
  if (filters.yearGraduated) return filters.yearGraduated;
  return yearRangeCondition(filters);
}

// Graduate deliberately holds two different populations in one collection
// (see Graduate.js's own top-of-file comment): rows synced from a real live
// portal submission (user_id set, kept in lockstep with TracerStudyResponse
// by alumniController.syncGraduateAndEmbedding), AND rows from a historical
// Excel/CSV tracer sheet an admin bulk-uploaded, which never created a
// TracerStudyResponse at all. The Admin "Tracer Dashboard" reads
// TracerStudyResponse only, so a stat built from the FULL Graduate
// collection can legitimately disagree with the dashboard's own tile for
// the identical question — caught live: "how many CCS alumni are employed"
// answered 183 here vs. the dashboard's 181, a gap made entirely of alumni
// whose only tracer data came from a bulk-imported file, never a live
// submission. Restricting to rows with a matching TracerStudyResponse makes
// every stablePipeline()-based stat reconcile with the dashboard by
// construction. Deliberate tradeoff, not an oversight: alumni who only ever
// appear in a bulk-imported sheet (no live submission, so no User-linked
// portal activity at all) are now excluded from these stats, the same as
// the dashboard already excludes them.
const LIVE_SUBMISSION_ONLY = [
  { $lookup: {
      from:         'tracerstudyresponses',
      localField:   'user_id',
      foreignField: 'alumni_id',
      as:           '_tracerResponse',
  }},
  { $match: { '_tracerResponse.0': { $exists: true } } },
  { $unset: '_tracerResponse' },
];

// filters.program is used throughout this file as a ready-to-use MongoDB
// regex pattern (extracted straight from the question's own text — see
// extractFilters()'s own comments) — but at least one real stored
// Graduate.program value was found live to contain a NON-BREAKING SPACE
// (U+00A0, likely from a bad Excel/Word copy-paste when the tracer data was
// originally entered) in place of an ordinary space ("Bachelor of Science
// in Information Management;"). A `filters.program` pattern built from
// ordinary question text only ever contains normal spaces, so it silently
// matched ZERO real records for that program — "No records found for
// Bachelor of Science in Information Management" for a program that
// genuinely has respondents in the database. Replacing each literal space
// in the pattern with a class matching EITHER character fixes this at every
// call site that routes through it, without needing to touch the stored
// data itself (safer — a query-side fix, not a database mutation) or hunt
// down every individual `{ $regex: filters.program }` site in this file
// one at a time.
function programRegex(pattern) {
  // MongoDB's regex engine (PCRE2) does not understand the JavaScript/
  // ECMAScript " " Unicode ESCAPE SEQUENCE — it needs the actual
  // non-breaking-space CHARACTER embedded directly in the pattern string.
  // A double-escaped '\\u00A0' (as first written) sends PCRE2 the literal
  // 6-character text " ", which it rejects outright ("PCRE2 does not
  // support ... \u"). The single-backslash ' ' below IS interpreted by
  // JavaScript itself at this file's own parse time, substituting in the
  // real U+00A0 character before the string ever reaches MongoDB — so PCRE2
  // just sees an ordinary character inside the class, nothing to parse as
  // an escape at all.
  return pattern.replace(/ /g, '[\\s ]');
}

// Returns a pipeline prefix: filter by stable fields (program, year) then DEDUP.
// Variable fields (employmentStatus, industry, etc.) must be applied AFTER this
// so deduplication uses each person's newest record value.
function stablePipeline(filters) {
  const match = {};
  if (filters.program) match.program = { $regex: programRegex(filters.program), $options: 'i' };
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) match.yearGraduated = yearCond;
  // Was missing: filters.gender was extracted by extractFilters() but never
  // applied anywhere except queryGender() itself — every other function
  // (queryCount, queryEmployment, queryIndustry, etc.) silently ignored a
  // "male"/"female" qualifier and answered for everyone instead, with no
  // indication anything was dropped. Adding it here as a stable pre-filter
  // fixes every function that uses stablePipeline() in one place.
  if (filters.gender)        match.gender        = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };
  // Was missing: filters.industry/excludeIndustry were extracted by
  // extractFilters() but never applied by "rate" functions that build their
  // own base straight off stablePipeline() (queryPromotion, queryLicensure,
  // queryFurtherStudies, queryFurtherTraining) — those silently answered
  // with the UNFILTERED population rate for e.g. "promotion rate in the HR
  // industry" with no indication the industry qualifier was dropped (unlike
  // queryIndustry/queryJobPositions/queryTopCompanies, which each already
  // apply filters.industry/excludeIndustry themselves after their own
  // stablePipeline() call — this stays harmlessly redundant there, same
  // condition ANDed twice). Centralizing here fixes every current and future
  // stablePipeline() consumer in one place, same reasoning as the gender fix
  // above.
  if (filters.industry)      match.industry      = { $regex: filters.industry, $options: 'i' };
  else if (filters.excludeIndustry) match.industry = { $not: { $regex: filters.excludeIndustry, $options: 'i' } };
  // Was missing, same "extracted but never applied by every stablePipeline()
  // consumer" gap as gender/industry above — queryWorkLocation() (and every
  // other function that builds its own match straight off this base) had no
  // idea filters.employmentType existed at all. Caught live: "How many BS
  // Computer Science graduates are employed FULL-TIME locally versus
  // employed full-time abroad?" silently dropped the employment-type half
  // entirely and answered the unscoped Local/Abroad split for every
  // employment type combined.
  if (filters.employmentType) match.employmentType = { $regex: `^${escapeRegex(filters.employmentType)}`, $options: 'i' };
  // Was missing, same "extracted but never applied by every stablePipeline()
  // consumer" gap as gender/industry/employmentType above — any function
  // built straight off this base (queryPromotion, queryLicensure,
  // queryFurtherStudies, queryFurtherTraining, queryYearsInJobRate/Count,
  // queryCompetencyRatingCompare, queryJobRelatedCompare, ...) had no idea
  // filters.workLocation existed at all. Caught live: "...currently employed
  // full-time locally and reported that their job is 'directly related'
  // versus 'somewhat related'..." resolved workLocation='local' correctly
  // but the comparison silently included BOTH local AND abroad respondents
  // (2, not the real local-only 1) with no indication "locally" was ever
  // dropped. queryWorkLocation() already applies this exact same condition
  // itself after its own stablePipeline() call (for the by-location
  // breakdown shape) — harmlessly redundant there (same condition ANDed
  // twice), same as the industry case above.
  if (filters.workLocation) match.workLocation = workLocationCondition(filters.workLocation, filters.negateWorkLocation);
  // Was missing, same gap as gender/industry/employmentType/workLocation
  // above — queryCompare()'s own headcount comparison path (the one case
  // this was caught on) builds its base straight off stablePipeline() with
  // no separate postDedup step of its own (unlike queryCount(), which
  // already applies tookExamMatch() itself after its own stablePipeline()
  // call). Caught live: "How many respondents who PASSED PROFESSIONAL
  // EXAMINATIONS are currently in Regular/Permanent government positions
  // versus private sector roles?" correctly carried tookExam='passed' into
  // both comparison sides (see queryCompare()'s own sharedFilters fix) but
  // the headcount query itself had no idea what to do with it, silently
  // counting EVERY government/private alumnus regardless of exam result.
  if (filters.tookExam) Object.assign(match, tookExamMatch(filters.tookExam));
  return [...LIVE_SUBMISSION_ONLY, { $match: match }, ...DEDUP];
}

// Groups by a case/whitespace-insensitive key while keeping the majority
// casing as the display label — the same fix queryEmployment() applies to
// employmentStatus, generalized so every categorical breakdown (industry,
// employmentType, jobRelated, jobTitle, companyName...) merges data-entry
// variants like "yes"/"Yes" or "IT"/"it" instead of splitting them into
// separate rows. Audited this session: six sibling functions were each
// hand-rolling the same plain `{ $group: { _id: '$field' } }` without this
// merge — a shared helper stops the next new breakdown function from
// repeating that bug. Returns count as `count` and the display value as
// `_id`, matching what every existing display loop already expects.
function caseMergeGroup(fieldExpr) {
  return [
    { $addFields: { __cmg_trim: { $trim: { input: fieldExpr } } } },
    { $group: { _id: { norm: { $toLower: '$__cmg_trim' }, orig: '$__cmg_trim' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $group: { _id: '$_id.norm', label: { $first: '$_id.orig' }, count: { $sum: '$count' } } },
  ];
}
// caseMergeGroup() outputs {_id: norm, label, count} — most display loops
// expect {_id: displayValue, count}; this remaps in one place.
function toDisplayRows(rows) {
  return rows.map((r) => ({ _id: r.label, count: r.count }));
}

// ─── Query Functions ──────────────────────────────────────────────────────────

async function queryEmployment(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _status: { $trim: { input: '$employmentStatus' } } } },
    // Group case-insensitively so data-entry variants like "yes" vs "Yes"
    // merge into one row instead of splitting the same status across two
    // separate breakdown lines. The summary total below already folded
    // these together (YES_RE/self-employed regexes are case-insensitive),
    // so "Yes: 167" + a separate "yes: 2" line made the per-row breakdown
    // visibly disagree with its own combined total.
    { $group: { _id: { norm: { $toLower: '$_status' }, orig: '$_status' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $group: { _id: '$_id.norm', label: { $first: '$_id.orig' }, count: { $sum: '$count' } } },
    { $sort: { count: -1 } },
  ]);
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return null;

  const formal   = rows.filter(r => YES_RE.test(r.label) || /^employed$/i.test(r.label))
                       .reduce((s, r) => s + r.count, 0);
  const selfEmp  = rows.filter(r => /^self.?employed$/i.test(r.label))
                       .reduce((s, r) => s + r.count, 0);
  const employed = formal + selfEmp;

  // If the question named specific statuses ("employed and unemployed"),
  // only show those rows — answer exactly what was asked, not every status
  // that happens to exist in the data.
  const displayRows = filters.employmentStatuses
    ? rows.filter(r => filters.employmentStatuses.some(s => new RegExp(`^${s}$`, 'i').test(r.label)))
    : rows;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `Based on the tracer study data${lbl}, there are **${total}** ${gPrefix}respondents.\n\n`;
  out += `**Employment Breakdown:**\n`;
  displayRows.forEach(r => { out += `- ${r.label}: **${r.count}** (${pct(r.count, total)})\n`; });

  // The "overall employment rate" synthesizes beyond just the requested
  // statuses (it folds Self-Employed into "employed"), so only show it for
  // the full, unfiltered breakdown.
  if (!filters.employmentStatuses) {
    out += `\n**Overall employment rate: ${pct(employed, total)}** (${employed} out of ${total}, including self-employed)`;
  } else if (filters.employmentStatuses.includes('Yes') && filters.employmentStatuses.includes('Self-Employed')) {
    // A question that explicitly pairs "employed" with "self-employed"
    // ("employed together with self-employed") is asking for one combined
    // count, not two separate rows to add up by hand — self-employed is
    // conceptually a form of being employed (same as the unfiltered
    // "Overall employment rate" above already treats it).
    out += `\n**Combined (employed + self-employed): ${employed}** (${pct(employed, total)})`;
  }
  // filters.employmentStatuses is only ever set when 2+ statuses were named
  // ("employed and unemployed") — still a comparison across categories, so
  // it charts the same as the full unfiltered breakdown. Only a single named
  // status (filters.employmentStatus, singular) skips charting — that's
  // queryCount()'s territory, not this function's.
  return withChart(out, { type: 'donut', title: 'Employment Breakdown', rows: displayRows, labelField: 'label' });
}

// wantsHighest true = "most common"/top industries (highest count first,
// the long-standing default), false = "least common" industries (lowest
// count first) — see the fn.industry dispatch call site. Only affects the
// no-filter (open comparison) branch below; a specifically named
// filters.industry/excludeIndustry narrows to one industry regardless of
// direction, so reversing sort order there wouldn't mean anything.
//
// wantsSummarySentence (only meaningful for the no-filter branch) appends a
// one-line "X employs the most/fewest alumni" sentence naming the extreme —
// only when the caller's question actually asked for a superlative (see the
// fn.industry dispatch's isSuperlativeQuestion gate).
async function queryIndustry(filters, wantsHighest = true, wantsSummarySentence = false) {
  const pipeline = [
    ...stablePipeline(filters),
    // "Self-Employed" is an EMPLOYMENT STATUS, not an industry — but at
    // least one raw tracer submission has it literally typed into the
    // industry field too (job title "Graphics Designer / Layout Artist",
    // industry "Self-Employed"). Left in, it surfaced as a real "industry"
    // in the least-common breakdown, which reads as nonsense (self-employed
    // isn't a sector alumni "work in"). Excluded here rather than corrected
    // at the source record — the raw submission is left untouched, this
    // just stops it from being treated as a real industry value.
    { $match: { industry: { $nin: [null, ''], $not: { $regex: '^self-?employed$', $options: 'i' } } } },
  ];
  if (filters.industry) pipeline.push({ $match: { industry: { $regex: filters.industry, $options: 'i' } } });
  else if (filters.excludeIndustry) pipeline.push({ $match: { industry: { $not: { $regex: filters.excludeIndustry, $options: 'i' } } } });

  // Every other filter extractFilters() may have picked up alongside the
  // industry question ("what industries do SELF-EMPLOYED alumni work in?",
  // "...alumni working ABROAD?") was previously silently dropped here — this
  // function only ever applied filters.industry/excludeIndustry, so
  // "self-employed", "employed", and unfiltered all returned the exact same
  // top-10 list. Mirrors the same postDedup-style filters queryCount()/
  // queryNames() already apply.
  if (filters.employmentStatus) pipeline.push({ $match: { employmentStatus: { $regex: employedStatusPattern(filters.employmentStatus), $options: 'i' } } });
  if (filters.excludeEmploymentStatus) {
    pipeline.push({ $match: { employmentStatus: { $nin: [null, ''], $not: { $regex: employedStatusPattern(filters.excludeEmploymentStatus), $options: 'i' } } } });
  }
  if (filters.workLocation) {
    pipeline.push({ $match: { workLocation: workLocationCondition(filters.workLocation, filters.negateWorkLocation) } });
  }
  if (filters.jobTitleRegex) pipeline.push({ $match: { jobTitle: { $regex: filters.jobTitleRegex, $options: 'i' } } });

  // Kept separate from `pipeline` (below) so the tie-count check further
  // down can re-run JUST the grouping — without $sort/$limit — to find the
  // TRUE number of industries tied at the extreme value, not just how many
  // happened to survive the display list's $limit: 10.
  const groupedPipeline = [...pipeline, ...caseMergeGroup('$industry')];
  pipeline.push(
    ...caseMergeGroup('$industry'),
    { $sort: { count: wantsHighest ? -1 : 1 } },
  );
  // Same filters.showLimit gap as queryJobPositions()/queryTopCompanies() —
  // "top 3 industries" ignored the "3" and always showed 10 (or, with
  // showAllIndustries, every row) regardless of a specific number asked for.
  if (!filters.industry && !filters.excludeIndustry && !filters.showAllIndustries) pipeline.push({ $limit: filters.showLimit || 10 });

  const rows = toDisplayRows(await Graduate.aggregate(pipeline));
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  // "status" reads as an adjective before "alumni"/"graduates" ("self-employed
  // alumni"), so it's built and applied separately from the "working X/NOT
  // in Y" clauses that follow the noun.
  const statusAdj = filters.employmentStatus === 'Yes'                   ? 'employed '
                   : filters.employmentStatus === 'No'                    ? 'unemployed '
                   : filters.employmentStatus === 'Self-Employed'         ? 'self-employed '
                   : filters.employmentStatus === 'Never Employed'        ? '"never employed" '
                   : filters.excludeEmploymentStatus === 'Yes'            ? 'not-employed '
                   : filters.excludeEmploymentStatus === 'No'             ? 'not-unemployed '
                   : filters.excludeEmploymentStatus === 'Self-Employed'  ? 'not-self-employed '
                   : filters.excludeEmploymentStatus === 'Never Employed' ? 'not-"never employed" '
                   : '';
  const locLabel = filters.workLocation
    ? (filters.negateWorkLocation ? ` NOT working ${filters.workLocation}` : ` working ${filters.workLocation}`)
    : '';
  const subject = `${gPrefix}${statusAdj}alumni`;
  const subjectCap = subject.charAt(0).toUpperCase() + subject.slice(1);

  // filterLabel() now also mentions filters.industry/excludeIndustry itself
  // (see its own comment) — these two branches already name the industry in
  // their opening phrase ("working in X industry"), so they use this
  // industry-stripped variant to avoid saying it twice.
  const lblNoIndustry = filterLabel({ ...filters, industry: undefined, excludeIndustry: undefined });

  if (filters.industry) {
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `**${subjectCap} working in ${filters.industry} industry${locLabel}${lblNoIndustry}:**\n\n`;
    out += `Total: **${total}** graduate${total !== 1 ? 's' : ''}\n`;
    if (rows.length > 1) {
      out += `\nBreakdown:\n`;
      rows.forEach((r, i) => { out += `${i + 1}. **${r._id}** with ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
    }
    // No chart — a specific industry was named, so this narrows to that one
    // industry (the "breakdown" above is just near-duplicate name variants),
    // not an open comparison across all industries.
    return out;
  }

  if (filters.excludeIndustry) {
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `**${subjectCap} NOT working in ${filters.excludeIndustry} industry${locLabel}${lblNoIndustry}:**\n\n`;
    out += `Total: **${total}** graduate${total !== 1 ? 's' : ''}\n`;
    return out;
  }

  const headerVerb = wantsHighest ? 'Top' : 'Least common';
  let out = `**${headerVerb} industries where ${gPrefix}${statusAdj}graduates${locLabel}${lbl} are working:**\n\n`;

  // "show all"/"show all N industries" right after a superlative answer
  // ("15 industries are tied for fewest... showing the first 10 above")
  // means "show the complete TIED group" — displaying every one of the 28
  // industries top-to-bottom (most of which aren't part of the tie at all)
  // isn't what was actually asked to expand. Computed BEFORE the display
  // loop below (not just for the summary sentence further down) so
  // filters.showAllIndustries can swap the display list itself, not just
  // widen the count used in the sentence. Only narrows the display when this
  // IS a superlative question (wantsSummarySentence) — a plain "what
  // industries do alumni work in, show all" with no most/least direction has
  // no "tied group" concept to narrow to, so it keeps showing the full
  // ranked list (`rows`, already unlimited via the $limit skip above).
  let displayRows = rows;
  let tiedRows = null;
  if (wantsSummarySentence) {
    const extremeCount = rows[0].count;
    // Re-run the grouping WITHOUT $limit/$sort to find every industry tied
    // at the extreme value — the displayed `rows` above is capped at 10 (or,
    // once filters.showAllIndustries lifts that cap, at the true remaining
    // count), so counting ties within it alone undercounts whenever the tie
    // extends past whatever cap is in effect. Caught live: 15 industries
    // genuinely tied at 1 graduate each, but only 10 made the display list —
    // naming just the first one ("Retail employs the fewest") implied a
    // false uniqueness, and even a "10 industries are tied" sentence derived
    // from the truncated list would still have understated the real number
    // (15).
    tiedRows = toDisplayRows(await Graduate.aggregate([...groupedPipeline, { $match: { count: extremeCount } }]));
    if (filters.showAllIndustries) displayRows = tiedRows;
  }
  displayRows.forEach((r, i) => { out += `${i + 1}. **${r._id}** with ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });

  if (wantsSummarySentence) {
    const extremeCount = rows[0].count;
    const graduateWord = extremeCount === 1 ? 'graduate' : 'graduates';
    const sentence = tiedRows.length > 1
      ? `**${tiedRows.length} industries** are tied for ${wantsHighest ? 'most' : 'fewest'} alumni, each with **${extremeCount}** ${graduateWord}${(!filters.showAllIndustries && tiedRows.length > rows.length) ? ` (showing the first ${rows.length} above)` : ''}.`
      : `**${rows[0]._id}** ${wantsHighest ? 'employs the most' : 'employs the fewest'} alumni, with **${extremeCount}** ${graduateWord}.`;
    out += `\n${sentence}`;
  }

  return withChart(out, { type: 'bars', title: wantsHighest ? 'Top Industries' : 'Least Common Industries', rows: displayRows });
}

// "What are the most/least common job positions among alumni?" — same
// group-by-and-rank shape as queryIndustry() just above, but on the
// `jobTitle` field instead of `industry`. wantsHighest true = "most common"
// (highest count first), false = "least common" (lowest count first) — see
// wantsHighestDirection() at the call site.
async function queryJobPositions(filters, wantsHighest) {
  const pipeline = [
    ...stablePipeline(filters),
    // Some ingested rows have corrupted jobTitle values (stray braces/
    // symbols, e.g. "{sa") — same plausibility check queryPersonLookup()
    // already applies before displaying a job title (see isPlausibleTitle
    // above). Without it here, a "least common" ranking (every real value
    // tied at count 1) is dominated by garbage rows instead of genuinely
    // rare-but-real titles.
    { $match: { jobTitle: { $nin: [null, ''], $regex: /^[A-Za-z]/ } } },
  ];
  if (filters.employmentStatus) pipeline.push({ $match: { employmentStatus: { $regex: employedStatusPattern(filters.employmentStatus), $options: 'i' } } });
  if (filters.excludeEmploymentStatus) {
    pipeline.push({ $match: { employmentStatus: { $nin: [null, ''], $not: { $regex: employedStatusPattern(filters.excludeEmploymentStatus), $options: 'i' } } } });
  }
  if (filters.industry) pipeline.push({ $match: { industry: { $regex: filters.industry, $options: 'i' } } });
  if (filters.excludeIndustry) pipeline.push({ $match: { industry: { $not: { $regex: filters.excludeIndustry, $options: 'i' } } } });
  if (filters.workLocation) pipeline.push({ $match: { workLocation: workLocationCondition(filters.workLocation, filters.negateWorkLocation) } });

  // filters.showLimit ("top 5"/"top 3"/"top 10" — see extractFilters()'s own
  // comment on it) was resolved correctly but never read here at all — this
  // hardcoded $limit: 10 regardless, so "top 5 most common job titles"
  // silently returned the same 10-row list as a bare "most common job
  // titles" question with no number in it. Caught live.
  pipeline.push(
    ...caseMergeGroup('$jobTitle'),
    { $sort: { count: wantsHighest ? -1 : 1 } },
    { $limit: filters.showLimit || 10 },
  );

  const rows = toDisplayRows(await Graduate.aggregate(pipeline));
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const namedRows = rows.map(r => ({ _id: toTitleCase(cleanText(r._id)), count: r.count }));
  const directionLabel = wantsHighest ? 'Most common' : 'Least common';
  let out = `**${directionLabel} job positions among ${gPrefix}alumni${lbl}:**\n\n`;
  namedRows.forEach((r, i) => { out += `${i + 1}. **${r._id}** — ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
  return withChart(out, { type: 'bars', title: wantsHighest ? 'Most Common Job Positions' : 'Least Common Job Positions', rows: namedRows });
}

// "What companies employ the most/least alumni?" — same group-by-and-rank
// shape as queryJobPositions() just above, but on `companyName`.
async function queryTopCompanies(filters, wantsHighest) {
  const pipeline = [
    ...stablePipeline(filters),
    // Same corrupted-value guard as queryJobPositions()'s jobTitle filter —
    // ingested rows occasionally have stray-symbol company names.
    { $match: { companyName: { $nin: [null, ''], $regex: /^[A-Za-z]/ } } },
  ];
  if (filters.employmentStatus) pipeline.push({ $match: { employmentStatus: { $regex: employedStatusPattern(filters.employmentStatus), $options: 'i' } } });
  if (filters.excludeEmploymentStatus) {
    pipeline.push({ $match: { employmentStatus: { $nin: [null, ''], $not: { $regex: employedStatusPattern(filters.excludeEmploymentStatus), $options: 'i' } } } });
  }
  if (filters.industry) pipeline.push({ $match: { industry: { $regex: filters.industry, $options: 'i' } } });
  if (filters.excludeIndustry) pipeline.push({ $match: { industry: { $not: { $regex: filters.excludeIndustry, $options: 'i' } } } });
  if (filters.workLocation) pipeline.push({ $match: { workLocation: workLocationCondition(filters.workLocation, filters.negateWorkLocation) } });

  // Same filters.showLimit gap as queryJobPositions() just above — "top 5
  // companies employing the most alumni" ignored the "5" entirely.
  pipeline.push(
    ...caseMergeGroup('$companyName'),
    { $sort: { count: wantsHighest ? -1 : 1 } },
    { $limit: filters.showLimit || 10 },
  );

  const rows = toDisplayRows(await Graduate.aggregate(pipeline));
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const namedRows = rows.map(r => ({ _id: toTitleCase(cleanText(r._id)), count: r.count }));
  const directionLabel = wantsHighest ? 'Companies employing the most' : 'Companies employing the least';
  let out = `**${directionLabel} ${gPrefix}alumni${lbl}:**\n\n`;
  namedRows.forEach((r, i) => { out += `${i + 1}. **${r._id}** — ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
  return withChart(out, { type: 'bars', title: wantsHighest ? 'Companies Employing the Most Alumni' : 'Companies Employing the Least Alumni', rows: namedRows });
}

// Maps aggregationService's own employmentStatus vocabulary ('Yes'/'No'/
// 'Self-Employed'/'Never Employed', used everywhere else against Graduate/
// TracerStudyResponse) onto AlumniEmployment's own SEPARATE enum
// ('Employed'/'Unemployed'/'Self-employed'/'Not Yet Updated') — two
// different collections, two different status vocabularies for the same
// underlying idea. 'Never Employed' has no clean AlumniEmployment analog
// ("never had a job" vs "hasn't filled this section out yet" are different
// concepts) so it's left unfiltered rather than guessing a wrong mapping.
function alumniEmploymentStatusMatch(status) {
  if (status === 'Yes')           return { employment_status: { $in: ['Employed', 'Self-employed'] } };
  if (status === 'No')            return { employment_status: 'Unemployed' };
  if (status === 'Self-Employed') return { employment_status: 'Self-employed' };
  return null;
}

// "What are the most/least common skills reported by alumni?" — genuinely
// different data from queryCompetencies()'s 8 fixed self-rating categories:
// this is the free-text "Python, Java, SQL"-style list alumni type into
// their own Employment Details/Job Connect profile (AlumniEmployment.skills,
// a comma-separated string), not a tracer-form question. Queried directly
// from AlumniEmployment rather than Graduate — Graduate has no skills field
// of its own and this data was never meant to be part of the tracer-study
// snapshot Graduate mirrors (same reasoning as queryTracerActivity()
// querying TracerStudyResponse directly). Sparse by nature (this profile
// section is optional and separate from the required tracer survey) — the
// respondent count in the header is there so a ranking built from a
// handful of people doesn't read as more authoritative than it is.
// Reverse of the BS-prefixed ABBR table in extractFilters() (full program
// name -> abbreviation) — AlumniEmployment has no course/program field of
// its own (that lives on User.course, stored as the ABBREVIATION, e.g.
// "BSCS", not the full "Computer Science" filters.program holds), so
// resolving a program filter here means going through User the same way
// college-scoping already does.
const PROGRAM_TO_COURSE_ABBR = {
  'Computer Science':        'BSCS',
  'Information Technology':  'BSIT',
  'Information Systems':     'BSIS',
  'Information Management':  'BSIM',
  'Business Administration': 'BSBA',
  'Electronics':              'BSECE',
  'Civil Engineering':        'BSCE',
  'Electrical Engineering':   'BSEE',
  'Mechanical Engineering':   'BSME',
  'Education':                'BSED',
  'Nursing':                  'BSN',
  'Accountancy':               'BSACCT',
};

// A BSIT+track combo ("BSIT-TSM") resolves filters.program to a composite
// REGEX string ("Information Technology.*Technical Service Management" —
// see extractFilters()'s trackMatch), not one of the plain full names
// PROGRAM_TO_COURSE_ABBR's exact lookup above expects — so it silently
// failed that lookup and fell through with NO course/track filter applied
// at all. Caught live: "What skills do BSIT-TSM alumni have?" showed the
// exact same 5-respondent unfiltered global list as a bare "what skills do
// alumni have?" question, just mislabeled with the TSM header text (real
// data: 48 real BSIT-TSM alumni exist, 0 of them have filled in skills).
const TRACK_FULL_TO_ABBR = {
  'Technical Service Management': 'TSM',
  'Web and Mobile Application':   'WMA',
  'Network Administration':       'NA',
};

// Some free-text skill entries are genuine synonyms of each other typed out
// differently ("OOP" vs "Object Oriented Programming", "JS" vs
// "JavaScript") — the $toLower grouping in querySkillsList() below only
// merges CASE variants of the exact same string, so these still split into
// separate rows and each one undercounts the real total for the single
// skill actually being reported. Keyed by the exact lowercase/trimmed form
// $toLower produces, mapped to one canonical key + a preferred display
// spelling. toTitleCase() (see its own definition) would mangle either
// spelling anyway (turns "OOP" into "Oop", "JavaScript" into "Javascript",
// losing the intentional internal capitalization), so any skill matching an
// entry here skips toTitleCase entirely and uses this exact display string.
//
// Also covers standalone initialisms/proper nouns that have no spelled-out
// duplicate in the real data (so `key` just maps to itself — no merging
// needed, only the display override) but that toTitleCase() still mangles
// the exact same way: "HTML" -> "Html", "CSS" -> "Css", "SQL" -> "Sql",
// "PHP" -> "Php" (toTitleCase caps only the first letter, lowercasing the
// rest — correct for an ordinary word, wrong for an initialism where every
// letter is meaningful), and "Github" -> stays "Github" instead of the
// correctly mid-capitalized "GitHub" (toTitleCase has no way to know about
// a brand name's internal capital). Grounded in the actual distinct skill
// values present in AlumniEmployment at the time this was written — add
// more entries here as new acronym-shaped skills actually show up live,
// rather than speculatively pre-listing every tech acronym that could ever
// be typed in.
const SKILL_ALIASES = {
  'oop':                          { key: 'object oriented programming', display: 'Object-Oriented Programming (OOP)' },
  'object oriented programming':  { key: 'object oriented programming', display: 'Object-Oriented Programming (OOP)' },
  'object-oriented programming':  { key: 'object oriented programming', display: 'Object-Oriented Programming (OOP)' },
  'js':                           { key: 'javascript', display: 'JavaScript' },
  'javascript':                   { key: 'javascript', display: 'JavaScript' },
  'java script':                  { key: 'javascript', display: 'JavaScript' },
  'html':                         { key: 'html', display: 'HTML' },
  'css':                          { key: 'css', display: 'CSS' },
  'sql':                          { key: 'sql', display: 'SQL' },
  'php':                          { key: 'php', display: 'PHP' },
  'github':                       { key: 'github', display: 'GitHub' },
  // Not an acronym/casing issue like the others above — "Viu.js" is a plain
  // misspelling of "Vue.js" (one-letter typo), confirmed present as its own
  // distinct raw value in AlumniEmployment. Merged here on the same
  // mechanism since the effect is identical (one real skill undercounted by
  // splitting across two spellings).
  'viu.js':                       { key: 'vue.js', display: 'Vue.js' },
  'vue.js':                       { key: 'vue.js', display: 'Vue.js' },
};

async function querySkillsList(filters, wantsHighest = true) {
  // Was silently ignoring filters.program entirely — "What skills do BSCS
  // alumni have?" answered with the exact same unfiltered top-10 list as a
  // bare "what skills do alumni have?" question, since nothing here ever
  // consulted the program filter at all. Resolved via User (same join
  // college-scoping already needs) rather than AlumniEmployment directly,
  // which has no program/course field of its own.
  const userMatch = { role: 'alumni' };
  const scopedCollege = getCollegeScope();
  if (scopedCollege) userMatch.college = scopedCollege;
  let courseAbbr = filters.program && PROGRAM_TO_COURSE_ABBR[filters.program];
  if (!courseAbbr && filters.program && filters.program.includes('Information Technology')) {
    for (const [trackFull, trackAbbr] of Object.entries(TRACK_FULL_TO_ABBR)) {
      if (filters.program.includes(trackFull)) {
        courseAbbr = 'BSIT';
        userMatch.track = trackAbbr;
        break;
      }
    }
  }
  if (courseAbbr) userMatch.course = courseAbbr;
  // Same field-agnostic $gte/$lte/exact condition Graduate.yearGraduated
  // filtering already uses — User's equivalent field is graduationYear.
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) userMatch.graduationYear = yearCond;

  // Always resolved (not just when a scope filter is present) — needed as
  // the denominator below to tell apart "this cohort exists but genuinely
  // NONE of them have filled in skills yet" (a real, specific fact worth
  // stating) from "no such cohort at all" (defer to RAG). Caught live:
  // "What skills do BSIS alumni have?" — 67 real BSIS alumni exist, zero
  // have added skills — but the old bare "I don't have enough data in the
  // tracer study records" refusal reads as if something were broken/
  // unsupported rather than an honest, specific zero.
  const scopedUsers = await User.find(userMatch).select('_id').lean();
  const alumniScope = { alumni_id: { $in: scopedUsers.map(u => u._id) } };

  const match = { skills: { $nin: [null, ''] }, ...alumniScope };
  const statusMatch = filters.employmentStatus ? alumniEmploymentStatusMatch(filters.employmentStatus) : null;
  if (statusMatch) Object.assign(match, statusMatch);

  const [rawRows, respondentRows] = await Promise.all([
    AlumniEmployment.aggregate([
      { $match: match },
      { $project: { skillsArr: { $split: ['$skills', ','] } } },
      { $unwind: '$skillsArr' },
      { $project: { skill: { $trim: { input: '$skillsArr' } } } },
      { $match: { skill: { $ne: '' } } },
      // Grouped case-insensitively ($toLower key) so "REACT"/"React"/"react"
      // merge into one entry instead of splitting the same skill across
      // several near-duplicate rows — `display` keeps one actual-cased
      // spelling (from whichever document $unwind visits first) to show.
      // No $sort/$limit here (unlike before) — SKILL_ALIASES below still
      // needs to merge synonym rows (e.g. "oop" + "object oriented
      // programming") together BEFORE ranking/limiting, or a skill's real
      // combined count could rank lower than it should (or a synonym could
      // wrongly get cut by the $limit while its counterpart survives).
      { $group: { _id: { $toLower: '$skill' }, count: { $sum: 1 }, display: { $first: '$skill' } } },
    ]),
    AlumniEmployment.aggregate([{ $match: match }, { $count: 'total' }]),
  ]);
  if (!rawRows.length) {
    if (!scopedUsers.length) return null;
    const lbl = filterLabel(filters);
    return `None of the **${scopedUsers.length}** alumni${lbl} have added skills to their profile yet — this is an optional field on the Employment Details/Job Connect profile, separate from the tracer study survey.`;
  }

  // Merge SKILL_ALIASES synonyms together (see its own comment above), then
  // sort/limit in JS now that the merge can no longer happen inside the
  // Mongo $group stage (it needs the alias table, not just $toLower).
  const merged = new Map();
  for (const r of rawRows) {
    const alias = SKILL_ALIASES[r._id];
    const key = alias ? alias.key : r._id;
    const existing = merged.get(key);
    if (existing) existing.count += r.count;
    else merged.set(key, { count: r.count, display: alias ? alias.display : r.display, isAlias: !!alias });
  }
  const rows = [...merged.values()]
    .sort((a, b) => wantsHighest ? b.count - a.count : a.count - b.count)
    .slice(0, 10);
  const respondentCount = respondentRows[0]?.total ?? 0;

  const headerVerb  = wantsHighest ? 'Most' : 'Least';
  const statusLabel = filters.employmentStatus === 'Yes'            ? ' employed'
                     : filters.employmentStatus === 'No'             ? ' unemployed'
                     : filters.employmentStatus === 'Self-Employed'  ? ' self-employed'
                     : '';
  const lbl = filterLabel(filters);
  let out = `**${headerVerb} common skills reported by${statusLabel} alumni${lbl}:**\n\n`;
  rows.forEach((r, i) => { out += `${i + 1}. **${r.isAlias ? r.display : toTitleCase(r.display)}** — ${r.count} graduate${r.count > 1 ? 's' : ''}\n`; });
  out += `\n*Based on ${respondentCount} alumni who have listed skills on their profile — this is an optional profile field, separate from the tracer study survey, so coverage is still small.*`;
  const chartRows = rows.map(r => ({ _id: r.isAlias ? r.display : toTitleCase(r.display), count: r.count }));
  return withChart(out, { type: 'bars', title: `${headerVerb} Common Skills`, rows: chartRows });
}

async function queryGender(filters) {
  // Deliberately not using stablePipeline(filters) — gender is the dimension
  // being measured here, so pre-filtering by it (as stablePipeline now does
  // for every other function) would make every group collapse to just the
  // one gender asked about, breaking the "X% of Y total" denominator (it
  // would always show 100%). Only program/year make sense as pre-filters here.
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: programRegex(filters.program), $options: 'i' };
  const genderYearCond = yearMatchCondition(filters);
  if (genderYearCond !== null) stableMatch.yearGraduated = genderYearCond;

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { gender: { $nin: [null, ''] } } },
    { $addFields: { _trimmed: { $trim: { input: '$gender' } } } },
    { $addFields: { _key: { $toLower: '$_trimmed' } } },
    // Count each exact casing variant first ("Male" vs "MAle"), sorted so the
    // most common casing comes first within each group...
    { $group: { _id: { key: '$_key', variant: '$_trimmed' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    // ...then merge variants sharing the same normalized key, using $first to
    // pick the majority-casing spelling as the display label (not just
    // uppercasing everything, which would mangle "LGBTQIA+" into "Lgbtqia+").
    { $group: { _id: '$_id.key', count: { $sum: '$count' }, display: { $first: '$_id.variant' } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const lbl = filterLabel(filters);

  // Specific gender asked ("how many male?") → direct single count, not the
  // full breakdown, matching how queryCount() answers a specific-status ask.
  // No chart here — the question and answer are both a single specific
  // number, not a comparison across categories.
  if (filters.gender) {
    const match = rows.find(r => r._id === filters.gender.toLowerCase());
    const count = match?.count ?? 0;
    // Prefer the actual stored casing ("LGBTQIA+") over a blanket
    // .toLowerCase() of the filter — that read fine for "male"/"female" but
    // flattened "LGBTQIA+" into "lgbtqia+" in the narrated sentence.
    const label = match?.display || filters.gender.toLowerCase();
    const text = `There are **${count}** ${label} graduate${count !== 1 ? 's' : ''} in the tracer study database${lbl} (${pct(count, total)} of ${total} respondents with gender recorded).`;
    return text;
  }

  let out = `**Gender breakdown${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r.display}**: ${r.count} (${pct(r.count, total)})\n`; });
  // Missing before — every other breakdown in this file (promotion, further
  // training, licensure...) states its own denominator explicitly, but this
  // one didn't, so "693" here silently disagreeing with a plain "how many
  // alumni records are there" (702, every record regardless of whether
  // gender was ever filled in) read as a discrepancy/bug rather than what
  // it actually is — 9 real records just have no gender on file.
  out += `\nOut of **${total}** respondents with gender recorded.`;
  return withChart(out, { type: 'donut', title: 'Gender Breakdown', rows, labelField: 'display' });
}

async function queryWorkType(filters) {
  let rows = toDisplayRows(await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentType: { $nin: [null, ''] } } },
    ...caseMergeGroup('$employmentType'),
    { $sort: { count: -1 } },
  ]));
  if (!rows.length) return null;

  // A comparison ("Regular/Permanent vs Casual/Contractual") names SPECIFIC
  // types — narrow the full ~12-category breakdown down to just those,
  // rather than dumping every real+legacy category whenever only 2 or 3 were
  // actually asked about. Each requested label's own WORK_TYPE_MAP pattern is
  // reused so "contractual" still matches BOTH a standalone "Contractual" row
  // and a combined "Casual/Contractual" row (see that pattern's own comment).
  let requestedButMissing = [];
  if (filters.employmentTypesRequested?.length) {
    let relevant = WORK_TYPE_MAP.filter(([, label]) => filters.employmentTypesRequested.includes(label));
    // Casual and Contractual no longer round-trip to a real distinction
    // going forward — the CURRENT tracer form only offers ONE combined
    // "Casual/Contractual" checkbox; "Casual" and "Contractual" as separate
    // stored values are LEGACY (older form version) answers for the same
    // underlying concept. Comparing them as two separate slices either
    // strands the combined-option respondents in an unexplained 3rd row, or
    // (summing each matching label independently, tried first) double-
    // counts them into both slices, inflating the total past the real
    // respondent count (146 vs 145 actual). Collapsing the two into one
    // "Casual/Contractual" row whenever BOTH are part of the comparison
    // avoids both problems and matches what the current form actually asks.
    const hasCasual      = relevant.some(([, label]) => label === 'Casual');
    const hasContractual = relevant.some(([, label]) => label === 'Contractual');
    if (hasCasual && hasContractual) {
      relevant = relevant.filter(([, label]) => label !== 'Casual' && label !== 'Contractual');
      relevant.push([/\bcasual\b|\bcontractual\b/i, 'Casual/Contractual']);
    }
    // A single raw stored value can satisfy more than one requested label's
    // pattern (e.g. "Casual/Contractual" also matches a standalone
    // "Contractual" comparison target) — summed into each matching label so
    // the comparison always adds up to exactly the requested labels.
    rows = relevant
      .map(([pat, label]) => ({
        _id:   label,
        count: rows.filter(r => pat.test(r._id)).reduce((s, r) => s + r.count, 0),
      }))
      // Always narrow, even down to zero real rows (e.g. neither requested
      // type has any submissions yet) — requestedButMissing below supplies
      // an explicit "0" line for each in that case. Falling back to the
      // full, unfiltered breakdown here would silently ignore the fact that
      // a real comparison was asked for, dumping every one of the ~12
      // real+legacy categories instead of the 2-3 specifically named ones.
      .filter(r => r.count > 0);
    // A requested type with zero matching rows (e.g. "Part-time" or "Self-
    // employed" — both real dropdown options with no submissions yet) would
    // otherwise silently vanish from the comparison instead of reading as
    // "0" the way the other side of the comparison does.
    requestedButMissing = relevant
      .filter(([, label]) => !rows.some(r => r._id === label))
      .map(([, label]) => label);
  }

  const total = rows.reduce((s, r) => s + r.count, 0);
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const isComparison = filters.employmentTypesRequested?.length > 0;
  let out = isComparison
    ? `**Employment type comparison${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`
    : `**Employment type breakdown${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  requestedButMissing.forEach(label => { out += `- **${label}**: 0 (0.0%) — no alumni recorded under this type yet\n`; });
  // A redirect to the closest real category ("the closest real category is
  // Regular/Permanent" below) used to just sit there as a sentence — the
  // admin still had to notice it, then type a brand new question to
  // actually SEE that number, when the whole point of naming the closest
  // category was to offer it as the next thing to look at. Computed BEFORE
  // `out` is finalized so the SAME question can be woven into the answer
  // text itself (inline, impossible to miss — feedback live: "mas maganda
  // kung sa mismong narration rin may suggestion katulad sa chip"), not just
  // left as a separate "you might also ask" chip below it (that chip is
  // still ALSO set, via this function's own `suggestions` field — see
  // queryInner()'s final return further down this file — for admins who
  // scroll past the text and click chips directly). If the original
  // question already named another REAL employment type alongside the
  // untracked "full-time" (e.g. "full-time vs self-employed" resolved
  // employmentTypesRequested=['Self-employed'], the untracked half silently
  // dropped from that list), the comparison the admin actually wanted is
  // still answerable, just with Regular/Permanent standing in for
  // "full-time": "Regular/Permanent vs Self-employed." Only a bare
  // single-category offer otherwise. Self-contained (names the same
  // program/gender scope `out` already uses) so it resolves correctly even
  // asked as a fresh, standalone question later, not just in this exchange.
  let closestCategorySuggestion = null;
  if (filters.mentionsUntrackedFullTime) {
    // "for X graduates" (a trailing clause), not a leading noun pile-up
    // ("...see Information Technology Regular/Permanent...", which reads as
    // one garbled phrase) — program/gender context sits more naturally
    // attached to "graduates" than wedged directly in front of the category
    // names themselves.
    const gradsClause = `${genderPrefix(filters)}${(filters.programLabel || filters.program) ? `${filters.programLabel || filters.program} ` : ''}graduates`;
    const otherTypes = (filters.employmentTypesRequested || []).filter((t) => t !== 'Regular/Permanent');
    closestCategorySuggestion = otherTypes.length
      ? `Would you like to see Regular/Permanent versus ${otherTypes.join(' versus ')} for ${gradsClause} instead?`
      : `Would you like to see how many ${gradsClause} are Regular/Permanent employees instead?`;
    out += `\n"Full-time" is not tracked as its own separate category in the tracer study data — the closest real category is **Regular/Permanent**. ${closestCategorySuggestion}`;
  }
  const chartResult = withChart(out, { type: 'donut', title: isComparison ? 'Employment Type Comparison' : 'Employment Type', rows });
  if (!closestCategorySuggestion || !chartResult) return chartResult;
  // The chip reuses a direct, answerable QUESTION phrasing (not the
  // "Would you like..." framing woven into `out` above, which reads
  // naturally inline but would resolve oddly if re-asked verbatim as its
  // own fresh question later).
  const progPrefix = (filters.programLabel || filters.program) ? `${filters.programLabel || filters.program} ` : '';
  const otherTypes = (filters.employmentTypesRequested || []).filter((t) => t !== 'Regular/Permanent');
  const chipSuggestion = otherTypes.length
    ? `How many ${genderPrefix(filters)}${progPrefix}graduates are Regular/Permanent versus ${otherTypes.join(' versus ')}?`
    : `How many ${genderPrefix(filters)}${progPrefix}graduates are Regular/Permanent employees?`;
  return typeof chartResult === 'string'
    ? { text: chartResult, suggestions: [chipSuggestion] }
    : { ...chartResult, suggestions: [chipSuggestion] };
}

async function querySector(filters) {
  const rows = toDisplayRows(await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentType: { $nin: [null, ''] } } },
    ...caseMergeGroup('$employmentType'),
    { $sort: { count: -1 } },
  ]));
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `> **Note:** The tracer study data does not have a dedicated government/private sector column. `;
  out += `The employment type breakdown below is the closest available data${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}.\n\n`;
  out += `**Employment Type Breakdown:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  out += `\n*For accurate sector data, the survey would need a dedicated "employer type" (government/private) question.*`;
  return withChart(out, { type: 'donut', title: 'Employment Type', rows });
}

async function queryJobRelevance(filters) {
  const rows = toDisplayRows(await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { jobRelated: { $nin: [null, ''] } } },
    ...caseMergeGroup('$jobRelated'),
    { $sort: { count: -1 } },
  ]));
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const yes   = rows.filter(r => /yes/i.test(r._id)).reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Job relevance to course of study${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  out += `\n${pct(yes, total)} of ${gPrefix}graduates work in a field related to their course.`;
  return withChart(out, { type: 'donut', title: 'Job Relevance to Course', rows });
}

// Shared by every by-program query function below (right after each one's
// own `_prog` field is computed) — narrows the breakdown to genuine
// specialization/track rows only ("- Specialized in ...", e.g. TSM/NA/WMA/
// Business Analytics — see PROGRAM_SPECIALIZATIONS above) when
// filters.specializationsOnly is set (see extractFilters()'s own comment on
// that flag), a no-op empty spread otherwise. One shared definition so the
// "specialization(s)" vs "program(s)" distinction only had to be taught to
// the pipeline once, not separately re-derived in all 6 of these functions.
function specializationOnlyStage(filters) {
  return filters.specializationsOnly
    ? [{ $match: { _prog: { $regex: '-\\s*Specialized in', $options: 'i' } } }]
    : [];
}

// Standard short codes for this file's own base-program/specialization
// vocabulary — mirrors the BSIT/BSCS/BSIS/BSIM course abbreviations
// Charts.jsx's own COURSE_COLORS already uses, and the TSM/WMA/NA codes
// PROGRAM_SPECIALIZATIONS (in extractFilters() above) already recognizes as
// input. A separate small map rather than importing PROGRAM_SPECIALIZATIONS
// itself — that one is declared local to extractFilters() (a parsing
// concern: recognizing a specialization NAMED in a question), while this is
// purely a DISPLAY concern for chart labels, with no need for the aliases/
// glue-pattern machinery the parsing one carries.
const BASE_PROGRAM_ABBR = {
  'Information Technology': 'BSIT',
  'Computer Science':       'BSCS',
  'Information Systems':    'BSIS',
  'Information Management': 'BSIM',
};
const SPECIALIZATION_ABBR = {
  'Technical Service Management':  'TSM',
  'Web and Mobile Application':    'WMA',
  'Network Administration':        'NA',
  // No 3-letter code exists for this one (see PROGRAM_SPECIALIZATIONS'
  // own comment on why "BA" was never added — collides with "Bachelor of
  // Arts"/"Business Administration") — already short enough as-is.
  'Business Analytics':            'Business Analytics',
};

// A raw Graduate.program value ("Bachelor of Science in Information
// Technology - Specialized in Technical Service Management") is far too
// long to fit as a vertical bar-graph label — MiniBarChart's columns clamp
// to 2 lines and silently cut the text off mid-word ("Bachelor of Science
// in Information Technolo...", "- Specialized in Web..."), unreadable.
// Caught live. Shortens it to "BSIT - TSM" (or just "BSCS"/"BSIS"/"BSIM" for
// a base program with no specialization) for the CHART label only — the
// prose bullet list above each chart still uses the full, unabbreviated
// name (r._id directly), so nothing about the actual answer text changes.
function shortProgramLabel(fullName) {
  if (!fullName) return fullName;
  // \s+ between every word of "Bachelor of Science in" — NOT literal spaces
  // — at least one real stored Graduate.program value was found live to use
  // a NON-BREAKING SPACE (U+00A0, a bad Excel/Word copy-paste artifact —
  // same known issue this file's own programRegex()/filters.program
  // comments elsewhere already document) between "of" and "Science". \s
  // matches both; a literal space in the pattern only matches the first.
  // Caught live: "Bachelor of Science in Information Management" silently
  // never shortened to "BSIM" while every OTHER program on the same chart
  // did, because only THIS one record's text actually had the NBSP.
  const specMatch = fullName.match(/^Bachelor\s+of\s+Science\s+in\s+(.+?)\s*-\s*Specialized\s+in\s*(.+)$/i);
  if (specMatch) {
    const base = BASE_PROGRAM_ABBR[specMatch[1].trim()] || specMatch[1].trim();
    const spec = SPECIALIZATION_ABBR[specMatch[2].trim()] || specMatch[2].trim();
    return `${base} - ${spec}`;
  }
  const baseMatch = fullName.match(/^Bachelor\s+of\s+Science\s+in\s+(.+)$/i);
  if (baseMatch) return BASE_PROGRAM_ABBR[baseMatch[1].trim()] || fullName;
  return fullName;
}

// Answers "which program leads to the most job-aligned graduates?" — computed
// directly from MongoDB (job-related rate per program), never estimated by
// the LLM. Programs with fewer than 3 respondents are excluded so a single
// lucky/unlucky record can't swing the "highest" result.
async function queryJobAlignmentByProgram(filters) {
  const stableMatch = {};
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) stableMatch.yearGraduated = yearCond;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, jobRelated: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    ...specializationOnlyStage(filters),
    {
      $group: {
        _id:     '$_prog',
        total:   { $sum: 1 },
        related: { $sum: { $cond: [{ $regexMatch: { input: '$jobRelated', regex: /^yes/i } }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const ranked = rows
    .map(r => ({ ...r, rate: r.total > 0 ? r.related / r.total : 0 }))
    .sort((a, b) => b.rate - a.rate);
  const top = ranked[0];

  let out = `**Job alignment to field of study, by program:**\n\n`;
  ranked.forEach(r => { out += `- **${r._id}**: ${r.related}/${r.total} job-related (${pct(r.related, r.total)})\n`; });
  out += `\n**${top._id}** has the highest rate of graduates whose job aligns with what they studied, at **${pct(top.related, top.total)}**.`;
  const chartRows = ranked.map(r => ({ _id: shortProgramLabel(r._id), count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: 'Job Alignment Rate by Program (%)', rows: chartRows, unit: '%' });
}

async function queryLicensure(filters) {
  const base = stablePipeline(filters);
  const [totalRows, passedRows, failedRows] = await Promise.all([
    Graduate.aggregate([...base, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: { tookExam: { $regex: 'passed', $options: 'i' } } }, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: { tookExam: { $regex: 'failed', $options: 'i' } } }, { $count: 'total' }]),
  ]);
  const total  = totalRows[0]?.total  ?? 0;
  const passed = passedRows[0]?.total ?? 0;
  const failed = failedRows[0]?.total ?? 0;
  const tookAny = passed + failed;
  const notTook = total - tookAny;
  if (total === 0) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Professional/licensure exam statistics${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  out += `- Took a professional exam: **${tookAny}** (${pct(tookAny, total)})\n`;
  out += `  - Passed: **${passed}**\n`;
  out += `  - Failed: **${failed}**\n`;
  out += `- Did not take: **${notTook}** (${pct(notTook, total)})\n`;
  out += `\nOut of **${total}** ${gPrefix}respondents.`;
  const chartRows = [
    { _id: 'Passed', count: passed },
    { _id: 'Failed', count: failed },
    { _id: 'Did not take', count: notTook },
  ].filter(r => r.count > 0);
  return withChart(out, { type: 'donut', title: 'Licensure Exam Results', rows: chartRows });
}

// `askedSpecificDegree` — the question named a SPECIFIC degree type
// ("masters", "doctorate", "PhD") but the tracer form only ever records a
// plain Yes/No "pursued further education" field (Graduate.furtherEducation
// — no degree-type breakdown exists at all). Caught live: "How many alumni
// took a masters degree?" returned the real further-education total (32)
// through RAG's narration layer, which then asserted "...these individuals
// have taken a master's degree or another advanced degree" — a specific
// claim the underlying data has no way to support (those 32 could be
// pursuing a second bachelor's, a certificate program, anything). The
// caveat here is prepended to the deterministic text itself (not left to
// the LLM narration step to maybe mention) so it can't be dropped.
async function queryFurtherStudies(filters, askedSpecificDegree = false) {
  const base = stablePipeline(filters);

  // Alumni who didn't pursue have null furtherEducation, so count against total
  const [totalRows, pursuedRows] = await Promise.all([
    Graduate.aggregate([...base, { $count: 'total' }]),
    Graduate.aggregate([
      ...base,
      { $match: { furtherEducation: { $regex: '^yes', $options: 'i' } } },
      { $count: 'total' },
    ]),
  ]);

  const total      = totalRows[0]?.total ?? 0;
  const pursued    = pursuedRows[0]?.total ?? 0;
  const notPursued = total - pursued;

  if (total === 0) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = askedSpecificDegree
    ? `> **Note:** The tracer study only records whether alumni pursued further education at all (Yes/No) — it does not record WHICH specific degree (masters, doctorate, etc.) they pursued. The breakdown below is the closest available data.\n\n`
    : '';
  out += `**Further education after graduation${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  out += `- Pursued further education: **${pursued}** (${pct(pursued, total)})\n`;
  out += `- Did not pursue: **${notPursued}** (${pct(notPursued, total)})\n`;
  out += `\nOut of **${total}** ${gPrefix}respondents.`;
  const chartRows = [
    { _id: 'Pursued further education', count: pursued },
    { _id: 'Did not pursue', count: notPursued },
  ].filter(r => r.count > 0);
  return withChart(out, { type: 'donut', title: 'Further Education', rows: chartRows });
}

// Graduate.hasPromotion — populated from the tracer form's "Have you been
// promoted in your current job?" Yes/No question (see
// alumniController.js:499/aiController.js:41) but had no TOPIC_PATTERNS
// entry or query function at all until now, so a question like "how many
// alumni were promoted?" matched nothing and fell through to the generic
// refusal despite the data being right there, already normalized and ready
// to query — same shape as queryFurtherStudies() just above.
async function queryPromotion(filters) {
  const base = stablePipeline(filters);
  const [totalRows, promotedRows] = await Promise.all([
    // Denominator restricted to respondents who actually answered this
    // question (hasPromotion recorded) — same "respondents, not every
    // graduate" reasoning as queryEmploymentStatusRate()/
    // queryJobRelatedRate() above, so this percentage stays consistent with
    // every other rate this app reports rather than silently diluting it
    // against alumni who never answered at all.
    Graduate.aggregate([...base, { $match: { hasPromotion: { $nin: [null, ''] } } }, { $count: 'total' }]),
    Graduate.aggregate([
      ...base,
      { $match: { hasPromotion: { $regex: '^yes', $options: 'i' } } },
      { $count: 'total' },
    ]),
  ]);
  const total        = totalRows[0]?.total ?? 0;
  const promoted     = promotedRows[0]?.total ?? 0;
  const notPromoted  = total - promoted;
  if (total === 0) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Job promotion statistics${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  out += `- Promoted in their current job: **${promoted}** (${pct(promoted, total)})\n`;
  out += `- Not promoted: **${notPromoted}** (${pct(notPromoted, total)})\n`;
  out += `\nOut of **${total}** ${gPrefix}respondents.`;
  const chartRows = [
    { _id: 'Promoted', count: promoted },
    { _id: 'Not promoted', count: notPromoted },
  ].filter(r => r.count > 0);
  return withChart(out, { type: 'donut', title: 'Job Promotion', rows: chartRows });
}

// Graduate.furtherTraining — same gap and same fix shape as hasPromotion
// above, populated from the "Have you pursued any trainings after
// graduating?" Yes/No question. Distinct from `further_studies`
// (Graduate.furtherEducation — graduate school/masters/PhD), which never
// covered trainings/seminars/workshops at all.
async function queryFurtherTraining(filters) {
  const base = stablePipeline(filters);
  const [totalRows, trainedRows] = await Promise.all([
    Graduate.aggregate([...base, { $count: 'total' }]),
    Graduate.aggregate([
      ...base,
      { $match: { furtherTraining: { $regex: '^yes', $options: 'i' } } },
      { $count: 'total' },
    ]),
  ]);
  const total       = totalRows[0]?.total ?? 0;
  const trained      = trainedRows[0]?.total ?? 0;
  const notTrained   = total - trained;
  if (total === 0) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Post-graduation training/seminar attendance${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  out += `- Pursued trainings/seminars after graduating: **${trained}** (${pct(trained, total)})\n`;
  out += `- Did not pursue any: **${notTrained}** (${pct(notTrained, total)})\n`;
  out += `\nOut of **${total}** ${gPrefix}respondents.`;
  const chartRows = [
    { _id: 'Pursued trainings/seminars', count: trained },
    { _id: 'Did not pursue any', count: notTrained },
  ].filter(r => r.count > 0);
  return withChart(out, { type: 'donut', title: 'Further Training', rows: chartRows });
}

// "What trainings did alumni attend?" (asking WHAT, not "how many pursued")
// needs the actual training/seminar NAMES, not queryFurtherTraining()'s
// yes/no breakdown above — Graduate.trainingType (see its own schema
// comment) holds that free text, a separate tracer-study question from
// furtherTraining (Yes/No only). trainingType is blank by tracer-form design
// for anyone who answered "No" to furtherTraining, so this naturally scopes
// to respondents who actually named a specific training, the same way
// queryExamPassRate() scopes to exam-takers rather than all graduates.
async function queryTrainingTypes(filters) {
  const rows = toDisplayRows(await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { trainingType: { $nin: [null, ''] } } },
    ...caseMergeGroup('$trainingType'),
    { $sort: { count: -1 } },
  ]));
  if (!rows.length) return null;

  const total = rows.reduce((s, r) => s + r.count, 0);
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Trainings/seminars ${gPrefix}alumni attended${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  out += `\nOut of **${total}** respondents who named a specific training.`;
  // No chart here on purpose — trainingType is free text an alumnus typed in
  // their own words, so almost every row is a unique one-off phrase with
  // count: 1 (21 slices each at 4.8%, as seen live) — a donut of 21
  // near-identical slivers conveys nothing a chart should, unlike every
  // other breakdown in this file where rows are a real, small set of
  // categories. Plain text only; a "make it a chart" follow-up still gets a
  // clear decline (queryInner()'s requestedChartType override) rather than
  // silently fabricating a meaningless chart.
  return out;
}

// "What are the significant accomplishments of alumni?" needs
// Graduate.significantAccomplishments — but the tracer form's actual
// question here is a fixed Yes/No RADIO ("Have you achieved any significant
// accomplishments in your current job?", options "Yes, I have received
// significant awards or recognitions" / "No, I have not yet..."), confirmed
// against tracerFormConfigController.js's own question list — NOT a
// free-text description of what those accomplishments were (unlike
// trainingType just above, which genuinely is free text). There is no field
// anywhere capturing the actual accomplishment/award details, so this can
// only ever report HOW MANY reported having one, never a list of what they
// are — same Yes/No breakdown shape as queryPromotion() just above, not a
// per-person list.
async function queryAccomplishments(filters) {
  const base = stablePipeline(filters);
  const [totalRows, achievedRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: { significantAccomplishments: { $nin: [null, ''] } } }, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: { significantAccomplishments: { $regex: '^yes', $options: 'i' } } }, { $count: 'total' }]),
  ]);
  const total = totalRows[0]?.total ?? 0;
  const achieved = achievedRows[0]?.total ?? 0;
  const notAchieved = total - achieved;
  if (total === 0) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Significant accomplishments${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  out += `- Reported receiving a significant award/recognition: **${achieved}** (${pct(achieved, total)})\n`;
  out += `- Reported none yet: **${notAchieved}** (${pct(notAchieved, total)})\n`;
  out += `\nOut of **${total}** respondents.`;
  const chartRows = [
    { _id: 'Received award/recognition', count: achieved },
    { _id: 'None yet', count: notAchieved },
  ].filter(r => r.count > 0);
  return withChart(out, { type: 'donut', title: 'Significant Accomplishments', rows: chartRows });
}

// "...graduates in the Customer Service and Support industry who have
// participated in professional development activities (workshops/seminars)
// OR earned awards" — an OR combination of two separate Yes/No fields
// (furtherTraining, significantAccomplishments), scoped by whatever other
// filters (here, industry) are already set. Checked as an early bypass in
// queryInner() (see its own call site) rather than wired into one specific
// topic's dispatch arm, same reasoning as queryJobRelatedCompare() above.
const WANTS_TRAINING_OR_AWARDS_PATTERN = /\b(?:professional\s+development|trainings?|seminars?|workshops?)\b[^.?!]{0,40}\bor\b[^.?!]{0,40}\b(?:awards?|accomplishments?|recognitions?)\b|\b(?:awards?|accomplishments?|recognitions?)\b[^.?!]{0,40}\bor\b[^.?!]{0,40}\b(?:professional\s+development|trainings?|seminars?|workshops?)\b/i;
async function queryTrainingOrAwards(filters) {
  const base = stablePipeline(filters);
  const condition = {
    $or: [
      { furtherTraining: { $regex: '^yes', $options: 'i' } },
      { significantAccomplishments: { $regex: '^yes', $options: 'i' } },
    ],
  };
  const matchRows = await Graduate.aggregate([...base, { $match: condition }, { $count: 'total' }]);
  const matched = matchRows[0]?.total ?? 0;
  const lbl = filterLabel(filters);
  return `There are **${matched}** graduates${lbl} who have participated in professional development activities (trainings/seminars/workshops) or reported a significant accomplishment/award.`;
}

const COMP_LABEL = {
  technicalSkills:   'Technical Skills',
  communication:     'Communication',
  problemSolving:    'Problem Solving',
  projectManagement: 'Project Management',
  teamwork:          'Teamwork',
  adaptability:      'Adaptability',
  workLifeBalance:   'Work-Life Balance',
  criticalThinking:  'Critical Thinking',
};

// Every rating-level word actually mentioned in the question, in FIXED
// canonical order (not text left-to-right) — used for "rated Technical
// Skills as Excellent vs Competent"-style comparisons, where BOTH levels
// matter, unlike extractFilters()'s own single-level filters.competencyRating
// (which only ever needs the first/dominant one for a plain scoped count).
// Same intensifier-stripping + literal-vocabulary-match reasoning as that
// extraction — see its own comment in extractFilters().
function extractAllRatingLevels(text) {
  const stripped = text.replace(/\b(?:high|highly|very|extremely|so|quite|really)\b/gi, ' ');
  const RATING_LEVEL_WORDS = [
    [/\b(?:excellent|outstanding|exceptional|expert)\b/i, 'Excellent'],
    [/\bcompetent\b/i,                                     'Competent'],
    [/\bsatisfactory\b/i,                                  'Satisfactory'],
    [/\b(?:non-?acceptable|unacceptable|poor|weak)\b/i,    'Non-Acceptable'],
    [/\b(?:beginner|novice|basic)\b/i,                     'Beginner'],
  ];
  const found = [];
  for (const [pat, value] of RATING_LEVEL_WORDS) {
    if (pat.test(stripped) && !found.includes(value)) found.push(value);
  }
  return found;
}

// "What percentage rated Technical Skills as 'Excellent' vs. 'Competent'?"
// — compares TWO (or more) rating LEVELS for the SAME skill side by side,
// rather than a single filtered percentage (queryInner()'s 'rate' dispatch
// arm checks this before the single competency+competencyRating case just
// below, which only ever resolves one level). Known, documented scope
// limit: a question naming TWO skills together ("Technical Skills or
// Problem-Solving Skills") only ever compares ratings for the FIRST skill
// COMP_MAP resolves (extractFilters()'s own single-competency extraction,
// unchanged here) — comparing two SKILLS at once as well as two RATINGS at
// once is a real but rarer compound shape, left for a future pass rather
// than guessed at now.
async function queryCompetencyRatingCompare(filters, levels) {
  const field = `competencies.${filters.competency}`;
  const skillLabel = COMP_LABEL[filters.competency] || filters.competency;
  const base = stablePipeline({ ...filters, competency: undefined, competencyRating: undefined });
  const [totalRows, ...levelRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: { [field]: { $nin: [null, ''] } } }, { $count: 'total' }]),
    ...levels.map((lvl) => Graduate.aggregate([...base, { $match: { [field]: { $regex: `^${lvl}`, $options: 'i' } } }, { $count: 'total' }])),
  ]);
  const total = totalRows[0]?.total ?? 0;
  if (total === 0) return null;
  const lbl = filterLabel({ ...filters, competency: undefined, competencyRating: undefined });
  let out = `**${skillLabel} rating comparison${lbl}:**\n\n`;
  const chartRows = [];
  levels.forEach((lvl, i) => {
    const count = levelRows[i][0]?.total ?? 0;
    out += `- **${lvl}**: ${pct(count, total)} (${count}/${total})\n`;
    chartRows.push({ _id: lvl, count: Math.round((count / total) * 100) });
  });
  return withChart(out, { type: 'bars', title: `${skillLabel} Ratings (%)`, rows: chartRows, unit: '%' });
}

// wantsHighest true = "most common" self-rating per category (the
// long-standing default), false = "least common" — the rating VALUE
// reported least often within each category (e.g. "Poor" being rare is
// good news, not a data gap). There's no free-text "skills" list to rank by
// frequency (see TOPIC_PATTERNS.competencies's own comment) — this is the
// closest honest reading of "least common skill" the actual data supports.
async function queryCompetencies(filters, wantsHighest = true) {
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);

  // stablePipeline() only applies program/year/gender — employmentStatus
  // isn't one of its stable pre-filters (see its own comment), so "skills
  // reported by EMPLOYED alumni" silently ignored "employed" and rated
  // everyone (employed or not) until this was added.
  const statusMatch = {};
  if (filters.employmentStatus) statusMatch.employmentStatus = { $regex: employedStatusPattern(filters.employmentStatus), $options: 'i' };
  if (filters.excludeEmploymentStatus) {
    statusMatch.employmentStatus = { $nin: [null, ''], $not: { $regex: employedStatusPattern(filters.excludeEmploymentStatus), $options: 'i' } };
  }

  // Single competency asked → show full rating distribution for that skill
  if (filters.competency) {
    const field = `competencies.${filters.competency}`;
    const label = COMP_LABEL[filters.competency] || filters.competency;
    const rows = await Graduate.aggregate([
      ...stablePipeline(filters),
      ...(Object.keys(statusMatch).length ? [{ $match: statusMatch }] : []),
      { $match: { [field]: { $nin: [null, ''] } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    if (!rows.length) return null;
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `**${label} self-ratings${lbl} (${total} ${gPrefix}respondents):**\n\n`;
    rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
    return withChart(out, { type: 'donut', title: `${label} Self-Ratings`, rows });
  }

  // No specific competency → show most common rating for all 8
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    ...(Object.keys(statusMatch).length ? [{ $match: statusMatch }] : []),
    { $match: { 'competencies.technicalSkills': { $nin: [null, ''] } } },
    {
      $group: {
        _id:      null,
        technical:  { $push: '$competencies.technicalSkills' },
        comm:       { $push: '$competencies.communication' },
        problem:    { $push: '$competencies.problemSolving' },
        project:    { $push: '$competencies.projectManagement' },
        team:       { $push: '$competencies.teamwork' },
        adapt:      { $push: '$competencies.adaptability' },
        wlb:        { $push: '$competencies.workLifeBalance' },
        critical:   { $push: '$competencies.criticalThinking' },
        count:      { $sum: 1 },
      },
    },
  ]);
  if (!rows.length) return null;

  const r = rows[0];
  // Returns [ratingLabel, count] — the count rides along now (previously
  // discarded) so the 8 categories can be charted as a bars comparison, not
  // just narrated as text. All 8 share the same unit (number of respondents
  // giving that category's own top rating), so they're comparable side by
  // side even though the top RATING itself can differ per category.
  const topRatingEntry = arr => {
    const freq = {};
    arr.forEach(v => { if (v) freq[v] = (freq[v] || 0) + 1; });
    const sorted = Object.entries(freq).sort((a, b) => wantsHighest ? b[1] - a[1] : a[1] - b[1]);
    return sorted[0] || ['—', 0];
  };

  const headerVerb  = wantsHighest ? 'Most' : 'Least';
  const statusAdj   = filters.employmentStatus === 'Yes'                   ? 'employed '
                     : filters.employmentStatus === 'No'                    ? 'unemployed '
                     : filters.employmentStatus === 'Self-Employed'         ? 'self-employed '
                     : filters.employmentStatus === 'Never Employed'        ? '"never employed" '
                     : '';
  const categories = [
    { label: 'Technical Skills',   values: r.technical },
    { label: 'Communication',      values: r.comm },
    { label: 'Problem Solving',    values: r.problem },
    { label: 'Project Management', values: r.project },
    { label: 'Teamwork',           values: r.team },
    { label: 'Adaptability',       values: r.adapt },
    { label: 'Work-Life Balance',  values: r.wlb },
    { label: 'Critical Thinking',  values: r.critical },
  ].map(c => {
    const [rating, count] = topRatingEntry(c.values);
    return { ...c, rating, count };
  });

  let out = `**${headerVerb} common competency self-ratings among ${gPrefix}${statusAdj}respondents${lbl} (${r.count} total):**\n\n`;
  categories.forEach(c => { out += `- ${c.label}: **${c.rating}**\n`; });

  const chartRows = categories.filter(c => c.count > 0).map(c => ({ _id: c.label, count: c.count }));
  return withChart(out, { type: 'bars', title: `${headerVerb} Common Competency Ratings`, rows: chartRows });
}

// "Which skill do alumni rate themselves lowest/highest in?" is a genuinely
// DIFFERENT question from queryCompetencies() above — that function compares
// RATING LEVELS (Excellent vs Competent vs...) WITHIN each of the 8
// categories separately, so "Competent" (the most common level in nearly
// every category) showed up as the "most common rating" for all 8 at once,
// and "Non-Acceptable" (the rarest level everywhere) showed up as "least
// common" for all 8 — never actually comparing the 8 SKILLS against each
// OTHER, which is what "which skill" (singular) is actually asking for.
// Caught live: both "which skill...highest" and "which skill...lowest"
// returned the exact same 8-category list with the exact same two labels
// repeated, giving no way to tell which ONE skill is really the strongest or
// weakest. Ranks each of the 8 categories by its own % of Excellent+Competent
// self-ratings (the two "positive" bands) — the category with the highest
// share is the alumni's strongest reported skill, lowest is the weakest.
async function queryCompetencyRanking(filters, wantsHighest = true) {
  const lbl = filterLabel(filters);
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { 'competencies.technicalSkills': { $nin: [null, ''] } } },
    {
      $group: {
        _id:      null,
        technical:  { $push: '$competencies.technicalSkills' },
        comm:       { $push: '$competencies.communication' },
        problem:    { $push: '$competencies.problemSolving' },
        project:    { $push: '$competencies.projectManagement' },
        team:       { $push: '$competencies.teamwork' },
        adapt:      { $push: '$competencies.adaptability' },
        wlb:        { $push: '$competencies.workLifeBalance' },
        critical:   { $push: '$competencies.criticalThinking' },
      },
    },
  ]);
  if (!rows.length) return null;
  const r = rows[0];

  const positiveShare = (arr) => {
    const valid = arr.filter(Boolean);
    if (!valid.length) return null;
    const positive = valid.filter(v => /^(excellent|competent)$/i.test(v)).length;
    return { positive, total: valid.length };
  };

  const categories = [
    { label: 'Technical Skills',   values: r.technical },
    { label: 'Communication',      values: r.comm },
    { label: 'Problem Solving',    values: r.problem },
    { label: 'Project Management', values: r.project },
    { label: 'Teamwork',           values: r.team },
    { label: 'Adaptability',       values: r.adapt },
    { label: 'Work-Life Balance',  values: r.wlb },
    { label: 'Critical Thinking',  values: r.critical },
  ].map(c => ({ label: c.label, ...positiveShare(c.values) })).filter(c => c.total);
  if (!categories.length) return null;

  const ranked = categories
    .map(c => ({ ...c, rate: c.positive / c.total }))
    .sort((a, b) => wantsHighest ? b.rate - a.rate : a.rate - b.rate);
  const top = ranked[0];
  const direction = wantsHighest ? 'highest' : 'lowest';

  let out = `**Competency self-ratings compared across skills${lbl}:**\n\n`;
  ranked.forEach(c => { out += `- ${c.label}: ${pct(c.positive, c.total)} rated Excellent or Competent\n`; });
  out += `\n**${top.label}** has the ${direction} share of Excellent/Competent self-ratings, at **${pct(top.positive, top.total)}**.`;
  const chartRows = ranked.map(c => ({ _id: c.label, count: Math.round(c.rate * 100) }));
  return withChart(out, { type: 'bars', title: 'Competency Comparison (% Excellent/Competent)', rows: chartRows, unit: '%' });
}

async function queryWorkLocation(filters) {
  const locMatch = { workLocation: { $nin: [null, ''] } };
  if (filters.workLocation) {
    locMatch.workLocation = workLocationCondition(filters.workLocation, filters.negateWorkLocation);
  }

  // Also count the STABLE cohort alone (program/year/gender, workLocation
  // recorded at all) so a zero result for the specific abroad/local filter
  // can be told apart from "this cohort has no work-location data at all" —
  // e.g. Batch 2023 genuinely has 43 people with a recorded work location
  // but 0 working abroad, which is a real, confident answer; without this
  // distinction the query returned null for that real "0" the same way it
  // would for a cohort with no data whatsoever, sending it to RAG instead.
  const [rows, stableRows] = await Promise.all([
    Graduate.aggregate([
      ...stablePipeline(filters),
      { $match: locMatch },
      { $group: { _id: { $cond: [{ $regexMatch: { input: '$workLocation', regex: ABROAD_REGEX } }, 'Abroad (outside your home country)', 'Local (within your home country)'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Graduate.aggregate([
      ...stablePipeline(filters),
      { $match: { workLocation: { $nin: [null, ''] } } },
      { $count: 'total' },
    ]),
  ]);
  const stableTotal = stableRows[0]?.total ?? 0;
  if (stableTotal === 0) return null;

  const total = rows.reduce((s, r) => s + r.count, 0);
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  if (filters.workLocation) {
    const label = filters.workLocation === 'local' ? 'locally (within the Philippines)'
                : filters.workLocation === 'abroad' ? 'abroad / overseas'
                : filters.workLocation;
    const verb = filters.negateWorkLocation ? 'NOT working' : 'working';
    return `There are **${total}** ${gPrefix}graduate${total !== 1 ? 's' : ''} ${verb} **${label}**${lbl}.`;
  }
  if (!rows.length) return null;
  let out = `**Work location of ${gPrefix}graduates${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  return withChart(out, { type: 'donut', title: 'Work Location', rows });
}

async function queryByProgram(filters) {
  const stableMatch = {};
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) stableMatch.yearGraduated = yearCond;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
    // Some alumni listed multiple programs separated by ";". Take only the first one.
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    ...specializationOnlyStage(filters),
    {
      $group: {
        _id:      '$_prog',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^yes\b/i } }, 1, 0] } },
        selfEmp:  { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^self.?employed$/i } }, 1, 0] } },
      },
    },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**${gPrefix ? `${gPrefix.charAt(0).toUpperCase() + gPrefix.slice(1)}respondents` : 'Respondents'} by program${lbl}:**\n\n`;
  rows.forEach(r => {
    const emp = r.employed + r.selfEmp;
    out += `- **${r._id}**: ${r.total} respondents, ${emp} employed (${pct(emp, r.total)})\n`;
  });
  const chartRows = rows.map(r => ({ _id: shortProgramLabel(r._id), count: r.total }));
  return withChart(out, { type: 'bars', title: 'Respondents by Program', rows: chartRows });
}

// Answers "which course/program has the highest employment rate?" — same
// underlying data as queryByProgram(), computed directly from MongoDB, but
// sorted by rate and calling out the top program instead of just listing all.
// Programs with fewer than 3 respondents are excluded so a single
// lucky/unlucky record can't swing the "highest" result.
// direction: 'highest' (default) or 'lowest' — was previously hardcoded to
// always report the highest-rate program regardless of what was asked, so
// "Which program has the LOWEST employment rate?" answered with the exact
// same "X has the highest employment rate" sentence as the highest-rate
// question. queryProgramRateExtreme() (below) already got this fix for the
// unemployment metric; this is the equivalent for the plain employment-rate
// metric, which had no direction parameter at all until now.
async function queryEmploymentRateByProgram(filters, direction = 'highest') {
  const stableMatch = {};
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) stableMatch.yearGraduated = yearCond;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    ...specializationOnlyStage(filters),
    {
      $group: {
        _id:      '$_prog',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^yes\b/i } }, 1, 0] } },
        selfEmp:  { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^self.?employed$/i } }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const ranked = rows
    .map(r => { const emp = r.employed + r.selfEmp; return { ...r, emp, rate: r.total > 0 ? emp / r.total : 0 }; })
    .sort((a, b) => b.rate - a.rate);
  const top = direction === 'lowest' ? ranked[ranked.length - 1] : ranked[0];

  let out = `**Employment rate by program:**\n\n`;
  ranked.forEach(r => { out += `- **${r._id}**: ${r.emp}/${r.total} employed (${pct(r.emp, r.total)})\n`; });
  out += `\n**${top._id}** has the ${direction} employment rate at **${pct(top.emp, top.total)}** (${top.emp} out of ${top.total}, including self-employed).`;
  // Chart bars show each program's employment RATE (%), not raw headcount —
  // that's the actual thing being compared/ranked here.
  const chartRows = ranked.map(r => ({ _id: shortProgramLabel(r._id), count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: 'Employment Rate by Program (%)', rows: chartRows, unit: '%' });
}

// Answers "which course produces the most unemployed graduates?" / "which
// program has the lowest unemployment rate?" — queryEmploymentRateByProgram()
// only ever ranks by highest EMPLOYMENT rate with no way to ask about
// unemployment or "lowest" instead, so a question like this used to route
// there anyway and silently answer with the wrong metric (which program is
// most employed, not which one produces the most unemployed graduates).
// Program-grouped twin of queryYearRateExtreme() — same rate-based ranking,
// just by program instead of batch year, for the same reason: a raw
// headcount of unemployed people is misleading without normalizing by each
// program's total respondents, so "most unemployed" is answered as "highest
// unemployment rate," consistent with how the equivalent by-year question
// is handled.
async function queryProgramRateExtreme(filters, direction, metric) {
  const stableMatch = {};
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) stableMatch.yearGraduated = yearCond;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    ...specializationOnlyStage(filters),
    {
      $group: {
        _id:      '$_prog',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^yes\b/i } }, 1, 0] } },
        selfEmp:  { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^self.?employed$/i } }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { total: -1 } },
  ]);
  if (!rows.length) return null;

  const withRate = rows.map(r => {
    const emp    = r.employed + r.selfEmp;
    const notEmp = r.total - emp;
    const rate   = metric === 'unemployment' ? notEmp / r.total : emp / r.total;
    return { ...r, emp, notEmp, rate };
  });
  const ranked = [...withRate].sort((a, b) => direction === 'highest' ? b.rate - a.rate : a.rate - b.rate);
  const top = ranked[0];
  const label = metric === 'unemployment' ? 'Unemployment' : 'Employment';
  const lbl = filterLabel(filters);

  let out = `**${label} rate by program${lbl}:**\n\n`;
  withRate.forEach(r => {
    const shown = metric === 'unemployment' ? r.notEmp : r.emp;
    out += `- **${r._id}**: ${pct(shown, r.total)} (${shown}/${r.total})\n`;
  });
  const topShown = metric === 'unemployment' ? top.notEmp : top.emp;
  out += `\n**${top._id}** had the ${direction} ${metric} rate, at **${pct(topShown, top.total)}** (${topShown} out of ${top.total}).`;
  const chartRows = ranked.map(r => ({ _id: shortProgramLabel(r._id), count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: `${label} Rate by Program (%)`, rows: chartRows, unit: '%' });
}

// Generic per-program breakdown for any simple Yes/No Graduate field
// (hasPromotion, furtherEducation) — same shape as queryEmploymentRateByProgram
// above, just parameterized over the field/regex/labels instead of being
// re-implemented per field. Added after systematic testing found THREE
// separate "X by program" questions (licensure pass rate, further-studies
// rate, promotion rate) all silently fell through to the generic OVERALL
// figure — "by program" was recognized for employment questions only
// (queryEmploymentRateByProgram), nothing else had a by-program counterpart
// at all. `restrictRegex` optionally narrows the DENOMINATOR itself (e.g.
// licensure pass rate must be computed among EXAM TAKERS only, not every
// alumnus — most never took the exam at all) — when omitted, the denominator
// is simply every respondent with a non-empty value for `field`.
async function queryYesNoFieldByProgram(filters, { field, yesRegex, restrictRegex, label, chartTitle, direction = 'highest', minSample = 3 }) {
  const stableMatch = {};
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) stableMatch.yearGraduated = yearCond;
  if (filters.gender) stableMatch.gender = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const fieldMatch = restrictRegex
    ? { $regexMatch: { input: { $trim: { input: `$${field}` } }, regex: restrictRegex } }
    : null;

  const allRows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, [field]: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    ...specializationOnlyStage(filters),
    ...(restrictRegex ? [{ $match: { [field]: { $regex: restrictRegex } } }] : []),
    {
      $group: {
        _id:   '$_prog',
        total: { $sum: 1 },
        yes:   { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: `$${field}` } }, regex: yesRegex } }, 1, 0] } },
      },
    },
    { $sort: { total: -1 } },
  ]);
  if (!allRows.length) return null;

  // Programs below minSample are excluded from the ranked list itself (a
  // "rate" computed from 1-2 people is statistically meaningless and would
  // misleadingly show up as a confident 0%/50%/100% bar) — but silently
  // dropping them also silently drops their takers/passers from the VISIBLE
  // total, with no indication anything was excluded at all. Caught live via
  // a reported inconsistency: "What is the licensure exam pass rate by
  // program?" showed 3 programs summing to 7/14, while "How many alumni
  // passed the licensure exam?" (the same underlying population, no program
  // filter) answered 13/22 — a 6/8 gap with zero acknowledgment, reading as
  // if the two answers simply disagreed rather than one being a partial,
  // unlabeled view of the other. The omitted-programs footnote below closes
  // that gap by naming exactly how many takers/passers aren't shown
  // individually and why, so the two numbers visibly reconcile instead of
  // just looking wrong.
  const rows = allRows.filter(r => r.total >= minSample);
  const omitted = allRows.filter(r => r.total < minSample);
  if (!rows.length) return null;

  const ranked = rows
    .map(r => ({ ...r, rate: r.total > 0 ? r.yes / r.total : 0 }))
    .sort((a, b) => direction === 'lowest' ? a.rate - b.rate : b.rate - a.rate);
  const top = ranked[0];
  const lbl = filterLabel(filters);

  // More than one program can land on the exact same rate (small integer
  // ratios collide often — 1/3 and 1/3 are both 33.3%) — naming only
  // ranked[0] then reads as if it alone were the extreme, silently erasing
  // every other program genuinely tied with it. Caught live: a 3-program
  // licensure breakdown had TWO programs tied at 33.3% (1/3 each), but the
  // summary sentence named only the first one as "the lowest," as if the
  // second didn't exist.
  const tied = ranked.filter(r => r.rate === top.rate);

  // filters.showAll ("show all the programs") means literally that — include
  // the below-minSample programs in the LISTED rows/chart too, not just name
  // their combined total in a footnote. The "tied for lowest/highest" claim
  // below still only ever draws from `ranked` (minSample-respecting) even in
  // this branch — a rate from 1-2 people stays too unreliable to crown as
  // "the lowest," regardless of whether the user wants to see the row.
  const displayRows = filters.showAll
    ? allRows
        .map(r => ({ ...r, rate: r.total > 0 ? r.yes / r.total : 0 }))
        .sort((a, b) => direction === 'lowest' ? a.rate - b.rate : b.rate - a.rate)
    : ranked;

  let out = `**${label} by program${lbl}:**\n\n`;
  displayRows.forEach(r => {
    const smallSampleNote = r.total < minSample ? ' *(small sample)*' : '';
    out += `- **${r._id}**: ${r.yes}/${r.total} (${pct(r.yes, r.total)})${smallSampleNote}\n`;
  });
  if (tied.length > 1) {
    const names = tied.map(r => `**${r._id}**`);
    const namesJoined = names.length === 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
    out += `\n${namesJoined} are tied for the ${direction} rate at **${pct(top.yes, top.total)}** each.`;
  } else {
    out += `\n**${top._id}** has the ${direction} rate at **${pct(top.yes, top.total)}** (${top.yes} out of ${top.total}).`;
  }
  if (omitted.length) {
    if (filters.showAll) {
      out += `\n\n*${omitted.length} additional program${omitted.length === 1 ? '' : 's'} above have fewer than ${minSample} respondents — shown for completeness, but too small a sample to count toward the ${direction}-rate claim above.*`;
    } else {
      const omittedTotal = omitted.reduce((s, r) => s + r.total, 0);
      const omittedYes = omitted.reduce((s, r) => s + r.yes, 0);
      const programWord = omitted.length === 1 ? 'program has' : 'programs have';
      out += `\n\n*${omitted.length} additional ${programWord} fewer than ${minSample} respondents (${omittedTotal} total, ${omittedYes} matching) and ${omitted.length === 1 ? 'is' : 'are'} omitted from the per-program ranking above as too small a sample for a reliable rate — still included in the overall (non-by-program) total. Say "show all the programs" to list them individually.*`;
    }
  }
  const chartRows = displayRows.map(r => ({ _id: shortProgramLabel(r._id), count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: `${chartTitle} (%)`, rows: chartRows, unit: '%' });
}

// Same shape as queryYesNoFieldByProgram() just above — grouped by
// `industry` instead of `program` — for "which industry has the
// highest/lowest promotion/licensure/further-education rate" questions.
// Kept as its own separate function rather than parameterizing
// queryYesNoFieldByProgram() over the group field: mirrors this file's own
// existing convention of near-duplicate sibling functions for different
// group-by dimensions (queryJobPositions/queryTopCompanies group by
// jobTitle/companyName the same way) rather than a shared helper threading
// one more parameter through an already-long function signature.
async function queryYesNoFieldByIndustry(filters, { field, yesRegex, restrictRegex, label, chartTitle, direction = 'highest', minSample = 3 }) {
  const stableMatch = {};
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) stableMatch.yearGraduated = yearCond;
  if (filters.gender) stableMatch.gender = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const fieldMatch = restrictRegex
    ? { $regexMatch: { input: { $trim: { input: `$${field}` } }, regex: restrictRegex } }
    : null;

  const allRows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { industry: { $nin: [null, ''] }, [field]: { $nin: [null, ''] } } },
    // Same self-employed-mistyped-into-industry guard as queryIndustry()'s
    // own pipeline above — without it, "Self-Employed" surfaces as a fake
    // "industry" row in this ranking too.
    { $match: { industry: { $not: { $regex: '^self-?employed$', $options: 'i' } } } },
    { $addFields: { _ind: { $trim: { input: '$industry' } } } },
    { $match: { _ind: { $gt: '' } } },
    ...(restrictRegex ? [{ $match: { [field]: { $regex: restrictRegex } } }] : []),
    {
      $group: {
        _id:   { $toLower: '$_ind' },
        label: { $first: '$_ind' },
        total: { $sum: 1 },
        yes:   { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: `$${field}` } }, regex: yesRegex } }, 1, 0] } },
      },
    },
    { $sort: { total: -1 } },
  ]);
  if (!allRows.length) return null;

  const rows = allRows.filter(r => r.total >= minSample);
  const omitted = allRows.filter(r => r.total < minSample);
  if (!rows.length) return null;

  const ranked = rows
    .map(r => ({ ...r, rate: r.total > 0 ? r.yes / r.total : 0 }))
    .sort((a, b) => direction === 'lowest' ? a.rate - b.rate : b.rate - a.rate);
  const top = ranked[0];
  const lbl = filterLabel(filters);
  const tied = ranked.filter(r => r.rate === top.rate);

  const displayRows = filters.showAll
    ? allRows
        .map(r => ({ ...r, rate: r.total > 0 ? r.yes / r.total : 0 }))
        .sort((a, b) => direction === 'lowest' ? a.rate - b.rate : b.rate - a.rate)
    : ranked;

  let out = `**${label} by industry${lbl}:**\n\n`;
  displayRows.forEach(r => {
    const smallSampleNote = r.total < minSample ? ' *(small sample)*' : '';
    out += `- **${r.label}**: ${r.yes}/${r.total} (${pct(r.yes, r.total)})${smallSampleNote}\n`;
  });
  if (tied.length > 1) {
    const names = tied.map(r => `**${r.label}**`);
    const namesJoined = names.length === 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
    out += `\n${namesJoined} are tied for the ${direction} rate at **${pct(top.yes, top.total)}** each.`;
  } else {
    out += `\n**${top.label}** has the ${direction} rate at **${pct(top.yes, top.total)}** (${top.yes} out of ${top.total}).`;
  }
  if (omitted.length) {
    const omittedTotal = omitted.reduce((s, r) => s + r.total, 0);
    const omittedYes = omitted.reduce((s, r) => s + r.yes, 0);
    const industryWord = omitted.length === 1 ? 'industry has' : 'industries have';
    out += `\n\n*${omitted.length} additional ${industryWord} fewer than ${minSample} respondents (${omittedTotal} total, ${omittedYes} matching) and ${omitted.length === 1 ? 'is' : 'are'} omitted from the per-industry ranking above as too small a sample for a reliable rate — still included in the overall (non-by-industry) total.*`;
  }
  const chartRows = displayRows.map(r => ({ _id: r.label, count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: `${chartTitle} (%)`, rows: chartRows, unit: '%' });
}

// Answers "which program has the most alumni working abroad/locally?" — a
// per-program HEADCOUNT for one specific work location, not the generic
// employment rate. Without this, "which program" superlative questions
// always routed to queryEmploymentRateByProgram() regardless of what was
// actually asked, silently discarding an already-extracted workLocation
// filter and answering a completely different question. Programs with fewer
// than 3 respondents are excluded so a single record can't swing "the most."
async function queryWorkLocationByProgram(filters, location) {
  const stableMatch = {};
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) stableMatch.yearGraduated = yearCond;
  if (filters.gender)        stableMatch.gender        = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, workLocation: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
    ...specializationOnlyStage(filters),
    {
      $group: {
        _id:     '$_prog',
        total:   { $sum: 1 },
        matched: { $sum: { $cond: [
          location === 'abroad'
            ? { $regexMatch: { input: '$workLocation', regex: ABROAD_REGEX } }
            : { $not: [{ $regexMatch: { input: '$workLocation', regex: ABROAD_REGEX } }] },
          1, 0,
        ] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { matched: -1 } },
  ]);
  if (!rows.length) return null;

  const label = location === 'abroad' ? 'working abroad' : 'working locally';
  const top = rows[0];

  let out = `**Alumni ${label}, by program:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.matched}/${r.total} ${label} (${pct(r.matched, r.total)})\n`; });
  out += `\n**${top._id}** has the most alumni ${label}, with **${top.matched}**.`;
  const chartRows = rows.map(r => ({ _id: shortProgramLabel(r._id), count: Math.round((r.matched / r.total) * 100) }));
  return withChart(out, { type: 'bars', title: `Alumni ${toTitleCase(label)} Rate by Program (%)`, rows: chartRows, unit: '%' });
}

// Same shape as queryWorkLocationByProgram() just above, grouped by
// yearGraduated instead of program — the by-YEAR equivalent needed for
// "which batch has the highest ratio of abroad versus local employment"
// (see queryInner()'s "which batch/year has the highest/lowest X" bypass
// below). That bypass had branches for job alignment/unemployment/self-
// employment/generic employment rate but NONE for work location — "abroad
// VERSUS LOCAL EMPLOYMENT" contains the bare substring "employ," so it fell
// into the generic employment-RATE branch and silently answered a
// completely different metric ("Batch 2020 had the highest employment
// rate...") than the abroad-vs-local ratio actually asked about. `direction`
// ('highest'/'lowest') mirrors every sibling ranking function in that same
// bypass — unlike queryWorkLocationByProgram() (which only ever answers
// "most"), a by-year ranking question can just as naturally ask for the
// LOWEST ratio.
async function queryWorkLocationByYear(filters, location, direction = 'highest') {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: programRegex(filters.program), $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };
  const yearRange = yearRangeCondition(filters);
  if (yearRange) stableMatch.yearGraduated = yearRange;

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { yearGraduated: { $ne: null }, workLocation: { $nin: [null, ''] } } },
    {
      $group: {
        _id:     '$yearGraduated',
        total:   { $sum: 1 },
        matched: { $sum: { $cond: [
          location === 'abroad'
            ? { $regexMatch: { input: '$workLocation', regex: ABROAD_REGEX } }
            : { $not: [{ $regexMatch: { input: '$workLocation', regex: ABROAD_REGEX } }] },
          1, 0,
        ] } },
      },
    },
    // Same minimum-sample guard as queryWorkLocationByProgram() — a batch
    // with only 1-2 people reporting a work location would otherwise let a
    // trivial 100%/0% swing win the "highest/lowest ratio" ranking.
    { $match: { total: { $gte: 3 } } },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  const label = location === 'abroad' ? 'working abroad' : 'working locally';
  const ranked = [...rows].sort((a, b) => direction === 'highest'
    ? (b.matched / b.total) - (a.matched / a.total)
    : (a.matched / a.total) - (b.matched / b.total));
  const top = ranked[0];

  let out = `**Alumni ${label}, by batch:**\n\n`;
  rows.forEach(r => { out += `- **Batch ${r._id}**: ${r.matched}/${r.total} ${label} (${pct(r.matched, r.total)})\n`; });
  out += `\n**Batch ${top._id}** has the ${direction} ratio of alumni ${label}, at **${pct(top.matched, top.total)}**.`;
  const chartRows = rows.map(r => ({ _id: `Batch ${r._id}`, count: Math.round((r.matched / r.total) * 100) }));
  return withChart(out, { type: 'bars', title: `Alumni ${toTitleCase(label)} Rate by Batch (%)`, rows: chartRows, unit: '%' });
}

async function queryByYear(filters) {
  // Group BY year — only pre-filter by program/gender/yearFrom (stable), not
  // a single exact year (that would collapse the grouping to one row).
  const stableMatch = {};
  if (filters.program)  stableMatch.program       = { $regex: programRegex(filters.program), $options: 'i' };
  if (filters.gender)   stableMatch.gender         = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };
  const yearRange = yearRangeCondition(filters);
  if (yearRange) stableMatch.yearGraduated = yearRange;

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { yearGraduated: { $ne: null }, employmentStatus: { $nin: [null, ''] } } },
    {
      $group: {
        _id:      '$yearGraduated',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^yes\b/i } }, 1, 0] } },
        selfEmp:  { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^self.?employed$/i } }, 1, 0] } },
      },
    },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  // When the question named an explicit year window (a "batch A to B" range,
  // or the "past N years" open-ended case sets yearFrom alone), fill in every
  // year in that window with zero — a batch with no submitted tracer
  // responses yet is a real, meaningful "0" data point for a trend view, not
  // something to silently omit. Without this, "employment trend over the past
  // 3 years" with only one reporting batch so far rendered a single bar
  // holding 100% of the (trivial, one-row) total — a share number that's
  // mathematically correct but reads as broken/meaningless, and hides the
  // very fact (no data yet for the newer years) the trend question was
  // actually asking about.
  let displayRows = rows;
  if (filters.yearFrom) {
    const from = filters.yearFrom;
    const to   = filters.yearTo || new Date().getFullYear();
    const byYear = new Map(rows.map(r => [r._id, r]));
    displayRows = [];
    for (let y = to; y >= from; y--) {
      displayRows.push(byYear.get(y) || { _id: y, total: 0, employed: 0, selfEmp: 0 });
    }
  }

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**${gPrefix ? `${gPrefix.charAt(0).toUpperCase() + gPrefix.slice(1)}employment` : 'Employment'} by graduation year${lbl}:**\n\n`;
  displayRows.forEach(r => {
    const emp = r.employed + r.selfEmp;
    out += r.total > 0
      ? `- **Batch ${r._id}**: ${emp}/${r.total} employed (${pct(emp, r.total)})\n`
      : `- **Batch ${r._id}**: no tracer study responses on file yet\n`;
  });
  // Employment RATE (%) per batch, not respondent count — a line chart is
  // for the trend the question and text are actually about ("employment BY
  // graduation year"), and respondent count was never that trend to begin
  // with. `count: null` (not 0) for a batch with zero tracer responses —
  // see TrendLine's own comment on why a real gap beats a misleading "0%".
  // .reverse() puts oldest-first (displayRows is newest-first, matching the
  // sentence list above) — a trend line reads left-to-right as time moving
  // forward, the opposite order of the bullet list right above it.
  const chartRows = displayRows.map(r => ({
    _id: `Batch ${r._id}`,
    count: r.total > 0 ? Math.round(((r.employed + r.selfEmp) / r.total) * 100) : null,
  })).reverse();
  return withChart(out, { type: 'line', title: 'Employment Rate by Batch Year (%)', rows: chartRows, unit: '%', max: 100 });
}

// Answers "which batch/year had the most/fewest graduates?" — raw headcount
// per year, computed directly from MongoDB. Unlike the rate-ranking function
// below, no minimum-sample threshold applies here: a year with few graduates
// is itself a real, meaningful answer to a headcount question, not noise.
async function queryYearWithMostGraduates(filters, direction, wantsChart = false) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: programRegex(filters.program), $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { yearGraduated: { $ne: null } } },
    { $group: { _id: '$yearGraduated', total: { $sum: 1 } } },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  const ranked = [...rows].sort((a, b) => direction === 'highest' ? b.total - a.total : a.total - b.total);
  const top = ranked[0];
  const tied = ranked.filter(r => r.total === top.total);
  const lbl = filterLabel(filters);

  let out = `**Graduates by batch year${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **Batch ${r._id}**: ${r.total} graduate${r.total !== 1 ? 's' : ''}\n`; });
  // Naming only ONE batch as having "the most/fewest" implied a false
  // uniqueness whenever several batches are genuinely tied — caught live:
  // 7 different batches tied at 1 graduate each for "fewest," but the
  // sentence singled out just whichever one happened to sort first.
  out += tied.length > 1
    ? `\n**${tied.length} batches** are tied for the ${direction === 'highest' ? 'most' : 'fewest'} graduates, each with **${top.total}**: ${tied.map(r => `Batch ${r._id}`).join(', ')}.`
    : `\n**Batch ${top._id}** had the ${direction === 'highest' ? 'most' : 'fewest'} graduates, with **${top.total}**.`;
  // A "which batch/year" superlative question already names ONE winning
  // batch in plain text above — attaching a full by-year chart by default
  // added visual noise (most bars near-zero/irrelevant) to what's really a
  // single-fact answer. Chart now only renders when explicitly asked for,
  // same wantsChart gating queryRate()/queryCount() already use. Caught live.
  if (!wantsChart) return out;
  const chartRows = [...rows].reverse().map(r => ({ _id: `Batch ${r._id}`, count: r.total }));
  return withChart(out, { type: 'bars', title: 'Graduates by Batch Year', rows: chartRows });
}

// Answers "which year had the highest/lowest employment/unemployment rate?"
// — same per-year grouping shape as queryByYear(), computed directly from
// MongoDB, but ranked by rate and calling out the extreme year instead of
// just listing all of them. Years with fewer than 3 respondents are excluded
// so a single lucky/unlucky record can't swing the "highest/lowest" result —
// same threshold used by queryEmploymentRateByProgram() for the same reason.
async function queryYearRateExtreme(filters, direction, metric, asRate = false, wantsChart = false) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: programRegex(filters.program), $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { yearGraduated: { $ne: null }, employmentStatus: { $nin: [null, ''] } } },
    {
      $group: {
        _id:      '$yearGraduated',
        total:    { $sum: 1 },
        employed: { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^yes\b/i } }, 1, 0] } },
        selfEmp:  { $sum: { $cond: [{ $regexMatch: { input: { $trim: { input: '$employmentStatus' } }, regex: /^self.?employed$/i } }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  // metric === 'self-employed' was missing entirely — r.selfEmp was already
  // computed in the $group stage above but only ever folded into the
  // combined 'employment' figure (emp = employed + selfEmp), with no way to
  // isolate it on its own. "Which graduation year has the highest number of
  // self-employed respondents?" has no dedicated metric to ask for, so the
  // dispatch site below fell through to the generic 'employment' branch
  // (its own \bemploy\b-style check matches the substring inside "self-
  // employed" too) and answered with the combined employed+self-employed
  // rate — mixing the two statuses together instead of isolating the one
  // actually asked about, with no "self" distinction anywhere in the answer.
  //
  // Was first treated as a RATE (self-employed / respondents that year),
  // mirroring how "most unemployed" is normalized to a rate elsewhere in
  // this file — but corrected live: the question literally says "highest
  // NUMBER of self-employed respondents," a raw headcount ranking, not a
  // rate one, and the rate framing also produced a nonsensical chart (its
  // "count" field held a RATE-as-percentage value like 9, which the chart
  // widget then treated as a literal count and computed a second,
  // meaningless "share of all these percentages added together" percentage
  // on top of it). employment/unemployment keep their existing RATE-based
  // ranking (not reported as wrong) — only self-employed switches to a raw
  // count. BUT that fix was itself only half right — it made EVERY
  // self-employed question a raw count, so "which year has the highest
  // RATE of self-employed respondents" (explicit "rate" wording) now
  // wrongly got the raw-count answer too (Batch 2022, the headcount winner)
  // instead of the genuinely different rate winner (Batch 2021). `asRate`
  // (set by the caller from the question's own "rate"/"percentage" wording)
  // lets the two phrasings diverge correctly instead of collapsing onto
  // whichever one was fixed most recently.
  const isRawCount = metric === 'self-employed' && !asRate;
  const withRate = rows.map(r => {
    const emp    = r.employed + r.selfEmp;
    const notEmp = r.total - emp;
    // self-employed-as-RATE needs r.selfEmp/r.total specifically — the
    // combined `emp` (employed + self-employed) the plain 'employment'
    // branch uses would silently answer a different, broader metric than
    // "self-employed rate" actually asked for.
    const rate   = metric === 'unemployment'  ? notEmp / r.total
                 : metric === 'self-employed' ? r.selfEmp / r.total
                 : emp / r.total;
    return { ...r, emp, notEmp, rate };
  });
  const rankValue = (r) => isRawCount ? r.selfEmp : r.rate;
  const ranked = [...withRate].sort((a, b) => direction === 'highest' ? rankValue(b) - rankValue(a) : rankValue(a) - rankValue(b));
  const top = ranked[0];
  const label = metric === 'unemployment' ? 'Unemployment' : metric === 'self-employed' ? 'Self-Employment' : 'Employment';
  const lbl = filterLabel(filters);

  // This only ever answers a "WHICH batch/year had the highest/lowest X"
  // superlative question (its one and only call site) — the user asked to
  // name ONE winning batch, not to see every batch's figure restated first.
  // Was a full bulleted breakdown of every batch PLUS this sentence; trimmed
  // to just the direct answer — the chart below still carries the full
  // per-batch breakdown visually for anyone who wants it.
  // lbl (program/gender scope, if any — see filterLabel()) kept in the
  // sentence itself, not dropped along with the rest of the breakdown — a
  // scoped question ("...for BSIT?") must still say so in the one sentence
  // that survives, or the answer reads as if it covered every program.
  const topShown = metric === 'unemployment' ? top.notEmp : metric === 'self-employed' ? top.selfEmp : top.emp;
  const out = isRawCount
    ? `**Batch ${top._id}** had the ${direction} number of self-employed respondents${lbl}, with **${topShown}** (out of ${top.total} total respondents that year).`
    : `**Batch ${top._id}** had the ${direction} ${metric === 'self-employed' ? 'self-employment' : metric} rate${lbl}, at **${pct(topShown, top.total)}** (${topShown} out of ${top.total}).`;
  // Same "which batch/year" superlative shape as queryYearWithMostGraduates()
  // just above — one winning batch is the whole answer, so the full by-year
  // chart (mostly nonzero-only-for-one-bar noise, as seen live with the
  // self-employment-rate case) only renders on an explicit chart/graph ask.
  if (!wantsChart) return out;
  const chartRows = [...ranked].reverse().map(r => ({ _id: `Batch ${r._id}`, count: isRawCount ? r.selfEmp : Math.round(r.rate * 100) }));
  const chartTitle = isRawCount ? 'Self-Employed Respondents by Batch Year' : `${label} Rate by Batch Year (%)`;
  // unit: '%' only for the rate case — isRawCount's rows are a genuine
  // headcount (r.selfEmp), not a 0-100 percentage, so it must keep the
  // dynamic max a raw-count chart needs (see withChart()'s own line-chart-
  // conversion comment in queryInner() for what this flag controls).
  return withChart(out, { type: 'bars', title: chartTitle, rows: chartRows, ...(isRawCount ? {} : { unit: '%' }) });
}

// Answers "which batch has the highest/lowest job-course relevance rate?" —
// same shape as queryJobAlignmentByProgram() but grouped by yearGraduated
// instead of program, and parameterized by direction so it can also answer
// "lowest" (queryJobAlignmentByProgram() only ever surfaces the highest).
// Years with fewer than 3 respondents are excluded for the same small-sample
// reason used everywhere else in this file.
async function queryYearJobAlignment(filters, direction, wantsChart = false) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: programRegex(filters.program), $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
    ...LIVE_SUBMISSION_ONLY,
    { $match: stableMatch },
    ...DEDUP,
    { $match: { yearGraduated: { $ne: null }, jobRelated: { $nin: [null, ''] } } },
    {
      $group: {
        _id:     '$yearGraduated',
        total:   { $sum: 1 },
        related: { $sum: { $cond: [{ $regexMatch: { input: '$jobRelated', regex: /^yes/i } }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 3 } } },
    { $sort: { _id: -1 } },
  ]);
  if (!rows.length) return null;

  const ranked = rows
    .map(r => ({ ...r, rate: r.total > 0 ? r.related / r.total : 0 }))
    .sort((a, b) => direction === 'highest' ? b.rate - a.rate : a.rate - b.rate);
  const top = ranked[0];
  const lbl = filterLabel(filters);

  let out = `**Job-course relevance rate by batch year${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **Batch ${r._id}**: ${r.related}/${r.total} job-related (${pct(r.related, r.total)})\n`; });
  out += `\n**Batch ${top._id}** had the ${direction} job-course relevance rate, at **${pct(top.related, top.total)}** (${top.related} out of ${top.total}).`;
  // Same wantsChart gating as queryYearRateExtreme()/queryYearWithMostGraduates()
  // just above — this is a "which batch" superlative question first.
  if (!wantsChart) return out;
  const chartRows = [...ranked].reverse().map(r => ({ _id: `Batch ${r._id}`, count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: 'Job-Course Relevance Rate by Batch Year (%)', rows: chartRows, unit: '%' });
}

const EMOJI_RE = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu;

function cleanText(str) {
  return str ? str.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim() : str;
}

function toTitleCase(str) {
  if (!str) return str;
  return str.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part)) return part;
    if (/^[A-Za-zÁÉÍÓÚÑÜ]\.?$/.test(part)) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join('');
}

// Recognizes a question asking about ONE specific named individual ("Where
// is Bryan Canlapan currently working?") rather than a statistic — a proper
// noun doesn't match any TOPIC_PATTERNS keyword, so without this these
// questions silently fell through to the generic 'employment' default and
// answered with the OVERALL 254-respondent breakdown, completely unrelated
// to the person actually asked about.
const PERSON_LOOKUP_PATTERNS = [
  // Tagalog yes/no question particle "ba" placed right after the PREDICATE,
  // before the "si X" name marker ("Employed BA SI Liam Miranda?" = "Is
  // Liam Miranda employed?") — a completely different word order from every
  // English pattern below (predicate-ba-name, not name-first), and none of
  // them have any "ba" concept at all. Caught live: "Employed ba si Liam
  // Miranda?" matched nothing anywhere in this file and fell through to the
  // generic bare employment count, dropping the named person entirely.
  // "pumasa"/"nakapasa" ("passed") and "bumagsak"/"nabagsak" ("failed")
  // added — caught live: "Pumasa ba si Liam Miranda sa board exam?" ("DID
  // Liam Miranda pass the board exam?") matched none of the original
  // predicate words (none of them are exam-related), so it fell through to
  // the generic bare licensure-pass COUNT instead of a real per-person
  // yes/no lookup.
  /\b(?:employed|working|promoted|nagtatrabaho|may\s+trabaho|pumasa|nakapasa|bumagsak|nabagsak)\s+ba\s+si\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
  /\bwhere\s+is\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\s+(?:currently\s+)?working\b/i,
  // "where does X work" — simple present tense, distinct regex shape from
  // "where IS X working" above (progressive tense); a real, common phrasing
  // that fell all the way through to the generic employment breakdown with
  // no match at all before this.
  /\bwhere\s+does\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\s+(?:currently\s+)?work\b/i,
  // "what's X's phone number" — the contraction "what's" is at least as
  // common as spelled-out "what is", but only "what is|does" was ever
  // matched here. Caught live: "What's Maria Santos's phone number?" matched
  // nothing in this whole array and fell all the way through to the generic
  // fallback instead of a real (or honest "no record of") lookup. "was" added
  // alongside "is/does" — "What WAS X's first job" (past tense, asking about
  // something the tracer study doesn't track at all — see the first-job
  // decline check above) previously extracted no name whatsoever and fell
  // through to an unrelated bulk employment breakdown instead of either a
  // real lookup or an honest "not tracked" answer.
  // "industry"/"work location"/"status" added to the trailing-attribute list
  // — PERSON_ATTRIBUTE_TRIGGERS (used further below to pick which single
  // fact to return once a person IS found) already recognizes these as valid
  // person attributes, but this pattern is what actually TRIGGERS a person
  // lookup in the first place, and it never listed them — caught live via a
  // conversational follow-up: "Who is Liam Miranda?" then "What is his
  // industry?" correctly resolved the pronoun to "What is Liam Miranda's
  // industry?" (condenseQuestion() did its job), but this pattern still
  // didn't match (no "industry" in its trigger list), so extractPersonName()
  // returned null, the question fell through to the generic bare 'industry'
  // topic, and answered with the TSU-wide top-10 industries list — a
  // population-level statistic standing in for what should have been one
  // specific person's own industry (Information Technology).
  /\bwhat(?:'s|\s+(?:is|does|was))\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})(?:'s)?\s+(?:first\s+(?:job|position|occupation|employer|company)|job|occupation|position|current\s+job|current\s+role|working\s+as|company|employer|industry|(?:work(?:ing)?\s+)?location|employment\s+status|(?:contact|phone|cell(?:phone)?|mobile)\s+number|number|contact\s+(?:info|information|details)|email(?:\s+address)?|(?:exact\s+)?(?:salary|income|compensation|wage))\b/i,
  // Mirror-image word order of the possessive pattern just above — "what is
  // the JOB OF X" instead of "what is X's JOB". English speakers use both
  // interchangeably, but only the possessive form was ever recognized here.
  // Caught live: "what is the job of Liam Miranda" matched nothing in this
  // whole array, fell through to the generic employment topic, which ALSO
  // found nothing specific to say, and ultimately landed in the catch-all
  // "I'm not sure what you're asking" clarify fallback — for a question that
  // named a real, on-file alumnus by name.
  /\bwhat(?:'s|\s+(?:is|does|was))\s+(?:the\s+)?(?:first\s+(?:job|position|occupation|employer|company)|job|occupation|position|current\s+job|current\s+role|company|employer|industry|(?:work(?:ing)?\s+)?location|employment\s+status|(?:exact\s+)?(?:salary|income|compensation|wage))\s+of\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
  // "show me/give me/tell me the (exact) salary of X" — the two patterns
  // above only ever fire off a "what is/what's/what does/what was" lead-in;
  // a direct imperative ("show me...") is at least as natural a way to ask
  // for one person's own salary and matched NEITHER of them. Caught live:
  // "show me the exact salary of Nani Nateetorn" extracted no name at all
  // and fell straight through to the generic, population-wide "salary isn't
  // tracked" decline — true for the TRACER STUDY, but not the whole truth:
  // a few alumni have separately added a salary range to their own
  // Employment Details profile (AlumniEmployment.salary_range, surfaced by
  // buildPersonLookupResult() below) — the decline never even looked.
  /\b(?:show\s+me|give\s+me|tell\s+me)\s+(?:the\s+)?(?:exact\s+)?(?:salary|income|compensation|wage)\s+(?:of|for)\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
  /\bis\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\s+(?:currently\s+)?employed\b/i,
  /\bwhat\s+company\s+does\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\s+work\s+(?:for|at)\b/i,
  // "who is X working for/with/at" is now handled by WHO_IS_PATTERN below
  // (it's a strict superset — bare "who is X" AND this trailing-clause form).
  // Trailing "of X" form ("contact number of X", "phone number of X") —
  // requires the captured span to start with a capital letter (same as
  // every pattern above), so this never collides with the existing
  // "number of" STATISTICAL_PATTERNS trigger ("number of graduates" has no
  // capitalized name to capture, so it just never matches here).
  /\b(?:contact|phone|cell(?:phone)?|mobile)?\s*number\s+of\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
  /\bhow\s+(?:can|do)\s+i\s+(?:contact|reach)\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
  // "email of X" / "email address of X" — same trailing-of-X shape as the
  // number pattern above.
  /\bemail(?:\s+address)?\s+of\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
  // Broadest, most generic phrasing — "give me info about X" / "tell me
  // about X" / "details on X" carries no specific attribute at all (unlike
  // every pattern above, which names a job/number/status), so it has to be
  // last and is deliberately the widest net: any capitalized 1-5 word span
  // right after one of these trigger phrases.
  /\b(?:give\s+me|show\s+me|what\s+is)?\s*(?:the\s+)?(?:info(?:rmation)?|details?)\s+(?:about|on|for|of)\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
  /\btell\s+me\s+about\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
  // "what can you/u say about X" / "what do you/u know about X" — same
  // broadest-generic-phrasing shape as "tell me about X" right above, just a
  // different verb. Missed live: "what can u say about Gilbert Gonzales"
  // matched no pattern here at all and fell through to the generic
  // statistical/RAG fallback refusal instead of a real person lookup.
  /\bwhat\s+(?:can|do)\s+(?:you|u)\s+(?:say|tell\s+me|know)\s+about\s+([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]+){0,4})\b/i,
];

// "Is there an alumni/alumnus named vincent?" / "Do you have a graduate
// called Vincent?" — a completely different question shape from the
// patterns above (existence-check, not a job-detail request), and one where
// real users commonly type the name in lowercase. The patterns above rely
// on capitalization to tell a name apart from an ordinary word elsewhere in
// the sentence, then re-extract case-sensitively for that exact reason —
// but the trigger word "named"/"called" here is unambiguous on its own, so
// this intentionally skips that capitalization requirement. Without this,
// "is there alumni named vincent" matched the 'names' TOPIC_PATTERNS
// ("alumni" ... "name" — "named" contains "name" as a prefix) with no name
// filter ever extracted, silently dumping the entire unfiltered 50-alumni
// roster as if it had answered the question.
const NAMED_LOOKUP_PATTERN = /\b(?:alumni|alumnus|alumna|graduates?)\s+(?:named|called)\s+([a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*(?:\s+[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*){0,4})(?=[?,!.]|$)/i;

// "Is Joseph Tolentino alumni?" / "is joseph tolentino an alumnus?" — a
// database-membership existence question, structurally different from every
// other pattern here (none of them are phrased as a yes/no question). Not
// capitalization-dependent, unlike most patterns below — the trigger words
// ("is" ... "alumni/alumnus/...") anchor BOTH ends of the name already, so a
// lowercase-typed name (the common case) needs no extra capitalized-word
// re-match to isolate it. Shared by extractPersonName() below AND
// ragService.js's own final-fallback rewrite (see its own comment) so a
// no-match at either the structured-lookup stage or the RAG stage names the
// SAME person consistently.
// The captured span is capped at 1-4 WORDS (matching every other name
// pattern's own word-count shape), NOT an unbounded `.+?` — a bare "is"
// anchor with no length limit matches "is" inside almost any "What IS...
// alumni" question, not just a genuine "is [Name] alumni?" one. Caught
// live: "What is the employment breakdown of BSIT alumni?" satisfied "is"
// ... "alumni" and captured "the employment breakdown of BSIT" as if it
// were a person's name, then confidently reported "no record of 'the
// employment breakdown of BSIT'" for a completely unrelated, perfectly
// answerable statistics question. Capping the word count means "the
// employment breakdown of BSIT" (5 words) can no longer reach "alumni" at
// all, while a genuine 1-4 word name still matches fine.
// Each word token excludes "a"/"an"/"the" (negative lookahead) — without it,
// the greedy word-count cap swallowed the article meant for the OPTIONAL
// "(?:an?\s+)?" group right after it: "is Liam Miranda an alumnus?"
// captured "Liam Miranda an" (3 words, still under the cap) instead of the
// clean "Liam Miranda", since the capture group tries to consume as many
// words as its cap allows before the trailing "alumni/alumnus" literal.
const IS_ALUMNI_PATTERN = /\bis\s+((?:(?!\b(?:an?|the)\b)[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*)(?:\s+(?:(?!\b(?:an?|the)\b)[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*)){0,3})\s+(?:an?\s+)?(?:alumni|alumnus|alumna|a\s+graduate|part\s+of\s+(?:the\s+)?(?:alumni|tracer\s+study))\b/i;

// "Is Liam Miranda directly related to his job?" / "is Meg Serrano's job
// related to her course?" — same "is NAME ..." yes/no-about-one-person shape
// as IS_ALUMNI_PATTERN just above, but for job-relevance specifically.
// Without this, extractPersonName() found no name at all (none of the other
// patterns require this exact "is X [adverb] related to ... job" shape
// either), so the question fell all the way through to the generic TSU-wide
// job-relevance COUNT ("67 graduates with jobs directly related...") instead
// of ever naming Liam Miranda specifically — a confidently wrong answer to a
// question about one person, not the whole cohort.
// "directly"/"somewhat" excluded from the name-capture itself (same
// exclusion shape as "a(n)"/"the") — being optional further down in the
// pattern, the capture group's own greediness otherwise swallows "directly"
// as if it were the LAST word of the name ("Liam Miranda directly") since
// the rest of the pattern still matches fine either way (the adverb is
// optional there too). Caught live via automated testing, not just theory.
//
// No "'" in the per-word character class here (unlike every other name
// pattern in this file) — condenseQuestion()'s LLM rewrite commonly turns
// "is X directly related to his job" into the equally natural "is X's job
// directly related to his course", and allowing an apostrophe mid-token let
// the greedy name-capture swallow "Miranda's" whole (both interpretations —
// name="Liam Miranda" and name="Liam Miranda's job" — satisfy the rest of
// the pattern, since "job"/"course" at the end is matched by alternation
// either way, so the engine never needs to backtrack off the first, wrong,
// greedier match). Caught live: this produced namedPerson="Liam Miranda's
// job", which the RAG fallback then searched for verbatim and failed to
// find anywhere, answering "There is no record of 'Liam Miranda's job'" for
// a real, on-file alumnus. Dropping "'" forces the per-word match to stop
// cleanly at "Miranda" (apostrophe is no longer a valid token character), so
// the explicit `(?:'s\s+job)?` group below is what consumes the possessive
// instead — the trade-off (an apostrophe'd surname like "O'Brien" won't
// match THIS one pattern) is acceptable since extractPersonName()'s other
// patterns still support apostrophes for every other question shape.
const IS_JOB_RELATED_PATTERN = /\bis\s+((?:(?!\b(?:an?|the|directly|somewhat)\b)[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.-]*)(?:\s+(?:(?!\b(?:an?|the|directly|somewhat)\b)[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.-]*)){0,3})(?:'s\s+job)?\s+(?:directly\s+|somewhat\s+)?related\s+to\s+(?:his|her|their|its|the(?:ir)?)?\s*(?:job|course|degree|field|program)\b/i;

// "Who is Vincent De Jesus?" / "who is vincent de jesus" — the single most
// natural way to ask about one specific person, but every PERSON_LOOKUP_PATTERNS
// entry above requires a trailing clause ("... working for/at/with"). A bare
// "who is X" with nothing after it matched NONE of them, so it silently fell
// through this file entirely to RAG/LLM narration instead of the verified,
// structured lookup below — producing a vague, sometimes-hallucinated answer
// for the most common phrasing of the most common question type. Lowercase-
// tolerant for the same reason NAMED_LOOKUP_PATTERN is (casual typing is the
// norm, not the exception); the lookahead stops the capture at an optional
// "working for/with/at" clause, sentence punctuation, or end of string so it
// doesn't swallow a trailing clause into the "name".
//
// Rhetorical/definition-style "who is X" questions aren't person lookups at
// all ("who is available", "who is responsible for grading", "who is the
// best program") — excluding their common leading words (same
// STATUS_EXCLUDE_WORDS/STATUS_NAME_WORD approach as below) keeps those from
// misfiring into a Graduate-name search that can never match.
// working|employed|unemployed|self-employed|graduating|hired|hiring|retired
// added after a live bug: "Who is working?" (a legitimate employment-status
// question, meaning "which alumni are working") matched WHO_IS_PATTERN with
// "working" captured as the "name" (it satisfied WHO_IS_NAME_WORD and was
// immediately followed by "?", which the pattern's own lookahead accepts),
// so it searched Graduate for someone literally named "working", found no
// one, and the question fell all the way through to the generic "I can't
// answer unrelated questions" refusal instead of ever reaching detectTopic()/
// EMPLOYMENT_SIGNAL — a confident wrong refusal to a perfectly answerable
// question, not just a missed match.
const WHO_IS_EXCLUDE_WORDS = 'the|a|an|this|that|these|those|available|going|responsible|eligible|allowed|able|qualified|assigned|in|charge|best|worst|good|great|new|old|it|he|she|they|we|you|i|there|here|working|employed|unemployed|self-employed|graduating|hired|hiring|retired';
const WHO_IS_NAME_WORD = String.raw`(?!(?:${WHO_IS_EXCLUDE_WORDS})\b)[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*`;
// The optional filler-adverb group before "working" stops a word like
// "currently"/"still" sitting between the name and the working-clause from
// being swallowed into the captured name (it used to be, since the lookahead
// required "working" to follow immediately) — the filler is matched by the
// lookahead itself, not the capture group, so it's consumed without being
// part of the returned name.
// "\s+from\s+\S" ADDED to the lookahead — without a terminator for it, "Who
// is Rain Thora FROM BATCH 2025?" / "...FROM BSIT?" (the natural way to
// answer the ambiguous-match prompt's own "Batch 2025"/"BSIT" disambiguation
// hints) had no valid stopping point after the name, so the whole pattern
// failed to match at all and the question fell through to a generic
// names-list query instead of a real person lookup. Broad on purpose (any
// "from X", not just "from batch/year") — a real person's name is never
// itself followed by the literal word "from", so this carries no collision
// risk with a legitimate multi-word name.
const WHO_IS_PATTERN = new RegExp(
  String.raw`\bwho\s+is\s+(${WHO_IS_NAME_WORD}(?:\s+${WHO_IS_NAME_WORD}){0,4}?)(?=(?:\s+(?:currently|now|still|recently|presently))?\s+working\s+(?:for|with|at)\b|\s+from\s+\S|[?,!.]|\s*$)`,
  'i'
);

// "Sino si Liam Miranda?" / "sino si liam" — the Tagalog equivalent of
// WHO_IS_PATTERN above, previously unrecognized ("who is X" worked, "sino si
// X" silently fell through to RAG instead of the verified structured
// lookup). Narrower than WHO_IS_PATTERN and doesn't need its
// WHO_IS_EXCLUDE_WORDS guard: "si" is a Filipino personal-name marker
// particle that only ever precedes an actual name, unlike English "is"
// (which also precedes rhetorical predicates like "available"/"responsible"
// — there's no Tagalog "sino si available" equivalent to guard against).
// "ba"/"po" are optional trailing question/politeness particles, same
// trailing-word idea as GREETING_PATTERN's own po/ho handling.
const SINO_SI_PATTERN = /\bsino\s+si\s+([a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*(?:\s+[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*){0,4}?)(?=\s+(?:ba|po)\b|[?,!.]|\s*$)/i;

// "Saan/san nagtatrabaho si Liam Miranda?" / "san nag tatrabaho si X" (casual
// spacing) — the Tagalog equivalent of PERSON_LOOKUP_PATTERNS' English
// "where does X work" entry, missing until this was caught live: the
// question fell through every other pattern (SINO_SI_PATTERN needs "sino",
// not "saan"), extractPersonName() returned null, and the question dropped
// all the way to RAG for a person the structured Graduate lookup could have
// answered directly and accurately. "trabaho" matched as a bare substring
// (no leading \b) on purpose — it needs to match inside "nagtatrabaho"/
// "tatrabaho" too, not just the bare root word, and "trabaho" is distinctive
// enough as Filipino vocabulary that there's no realistic English collision
// risk. Same "si X ... ba/po" capture shape as SINO_SI_PATTERN above.
// "saang" (NOT just "saan"/"san") added — "saan" contracts to "saang" before
// a following noun in standard Filipino grammar ("saan" + the linker "-ng"),
// an extremely common construction ("saaNG kumpanya", "saaNG lugar") that
// the bare \b(?:saan|san)\b word-boundary match can never satisfy ("saang"
// is a different literal token). Caught live: "Saang kumpanya nagtatrabaho
// si Liam Miranda?" ("AT WHAT COMPANY does Liam Miranda work?") matched
// NOTHING in this whole file (not this pattern, not any PERSON_LOOKUP_PATTERNS
// entry either — all English), so extractPersonName() returned null and the
// question fell all the way through to the generic bare employment count,
// completely dropping the person being asked about.
const SAAN_NAGTATRABAHO_PATTERN = /\b(?:saan|san|saang)\b.{0,20}trabaho.{0,10}\bsi\s+([a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*(?:\s+[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*){0,4}?)(?=\s+(?:ba|po)\b|[?,!.]|\s*$)/i;

// "trabaho ni Liam Miranda" / "kamusta na ang tracer study ni Liam Miranda"
// — "ni" is the Filipino GENITIVE personal-name marker ("of"/possessive
// "X's"), the mirror-image case of "si"/"sina" above (subject-position
// name markers). Unlike those, "ni X" can land anywhere in the sentence,
// not just right after a fixed trigger phrase — checked LAST (after every
// other pattern in extractPersonName() below) precisely because it's this
// unanchored, so it only gets a chance once every more specific pattern has
// already failed to match. Same "ba"/"po" trailing-particle allowance as
// SINO_SI_PATTERN.
const NI_POSSESSIVE_PATTERN = /\bni\s+([a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*(?:\s+[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*){0,4}?)(?=\s+(?:ba|po)\b|[?,!.]|\s*$)/i;

// "what dani manlapig status" (casual, ungrammatical, lowercase — no "is",
// no possessive) / "what is Dani Manlapig's status" — none of the
// PERSON_LOOKUP_PATTERNS below list "status" as a trigger keyword, and all
// of them require capitalization to identify a name. Real users routinely
// type a name in lowercase and skip "is"/apostrophe-s entirely, so this
// deliberately skips the capitalization requirement, the same tradeoff
// NAMED_LOOKUP_PATTERN above already makes — "status" preceded by a genuine
// 2-4 word span is a strong enough signal on its own. Without this, a
// question about one specific (possibly nonexistent) person fell through to
// the generic 'status' keyword match and silently answered with the
// unrelated, unfiltered 254-respondent employment breakdown instead of
// attempting a person lookup (or admitting no record was found). A leading
// pronoun/determiner is excluded so ordinary aggregate questions ("what is
// the employment status") aren't misread as a person lookup.
//
// The exclusion has to apply to EVERY word position, not just the first —
// "what is Bryan Canlapan employment status" has a descriptor word
// ("employment") sitting directly between the name and "status" with no
// delimiter, so a plain greedy word-repetition swallowed it straight into
// the captured name ("Bryan Canlapan Employment"), which then broke the
// Graduate token-match AND fed a still-partly-correct-looking name into the
// RAG hallucination guard downstream (ragService.js), letting a bogus
// "employment"-only token match slip through. Known descriptor words
// between the name and "status" are matched separately (and can repeat —
// "current employment status") instead of being eligible for capture.
const STATUS_EXCLUDE_WORDS = 'the|a|an|this|that|each|every|overall|current|general|my|our|your|his|her|its|their|employment|job|marital|civil|account|graduates?|alumni|alumnus|alumna|is|does|do|are|was|were|status';
const STATUS_NAME_WORD = String.raw`(?!(?:${STATUS_EXCLUDE_WORDS})\b)[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*`;
// "what's X's status" — same contraction gap as the phone-number pattern
// above ("what's" doesn't match a literal "what\s+" + optional "is/does",
// since there's no space between "what" and "'s").
const STATUS_LOOKUP_PATTERN = new RegExp(
  String.raw`\bwhat(?:'s|\s+(?:is|does))?\s+(${STATUS_NAME_WORD}(?:\s+${STATUS_NAME_WORD}){1,3})(?:'s)?\s+(?:(?:employment|job|marital|civil|account|current)\s+)*status\b`,
  'i'
);

function extractPersonName(question) {
  const namedMatch = question.match(NAMED_LOOKUP_PATTERN);
  if (namedMatch) return namedMatch[1].trim();

  const isAlumniMatch = question.match(IS_ALUMNI_PATTERN);
  if (isAlumniMatch) return isAlumniMatch[1].trim();

  const isJobRelatedMatch = question.match(IS_JOB_RELATED_PATTERN);
  if (isJobRelatedMatch) return isJobRelatedMatch[1].trim();

  const whoIsMatch = question.match(WHO_IS_PATTERN);
  if (whoIsMatch) return whoIsMatch[1].trim();

  const sinoSiMatch = question.match(SINO_SI_PATTERN);
  if (sinoSiMatch) return sinoSiMatch[1].trim();

  const saanTrabahoMatch = question.match(SAAN_NAGTATRABAHO_PATTERN);
  if (saanTrabahoMatch) return saanTrabahoMatch[1].trim();

  const statusMatch = question.match(STATUS_LOOKUP_PATTERN);
  if (statusMatch) return statusMatch[1].replace(/'s?$/i, '').trim();

  for (const pat of PERSON_LOOKUP_PATTERNS) {
    const m = question.match(pat);
    if (m) {
      // The outer match is case-INsensitive (/i, needed for trigger words
      // like "where is"/"currently"), which also makes [A-Z] match lowercase
      // letters — so a trailing filler word ("currently", "still") leaks
      // into the captured group too. Re-extract just the capitalized-word
      // span, this time WITHOUT /i, so the name correctly stops at the
      // first lowercase-starting word.
      const nameMatch = m[1].match(/[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*)*/);
      // Apostrophe is a valid mid-name character (O'Brien), but a trailing
      // possessive — "'s" ("Canlapan's job") OR a bare "'" for a name
      // already ending in s ("Gonzales' phone number", standard English
      // possessive form) — is grammar, not part of the name. The
      // name-token character class can't tell the difference (it happily
      // includes that trailing apostrophe as a "valid" name character), so
      // it must be stripped after the fact or neither form matches the
      // stored name at all. Caught live: "what is his phone number" ->
      // condenseQuestion() correctly resolved "his" to "Gilbert G.
      // Gonzales", but the trailing bare "'" from "Gonzales' phone number"
      // rode along into the captured name, and "Gilbert G. Gonzales'" (with
      // the stray apostrophe) matched zero real records.
      if (nameMatch) return nameMatch[0].replace(/'s?$/i, '').trim();
    }
  }

  // Checked LAST — see NI_POSSESSIVE_PATTERN's own comment above for why
  // this unanchored pattern only gets a turn once every more specific one
  // above has already failed.
  const niMatch = question.match(NI_POSSESSIVE_PATTERN);
  if (niMatch) return niMatch[1].trim();

  return null;
}

// A broad "who is X" / "tell me about X" / "info about X" question wants the
// whole picture — only a question that names ONE specific attribute should
// get a scoped, single-fact answer instead of the full profile dump. Checked
// first so these always win even if the question also happens to contain an
// attribute-shaped word.
const GENERAL_PERSON_INFO_PATTERN = /\b(?:info(?:rmation)?|details?)\s+(?:about|on|for|of)\b|\btell\s+me\s+about\b|\bwhat\s+(?:can|do)\s+(?:you|u)\s+(?:say|tell\s+me|know)\s+about\b|\bwho\s+is\b|\bwho'?s\b/i;

// Maps a specific-attribute trigger to the exact "- Label:" prefix
// buildPersonLookupResult() already builds that fact line with — reusing its
// existing formatting/edge-case handling (plausible-title check, work-location
// wording, etc.) rather than re-implementing it here. Order matters: checked
// top to bottom, first match wins (e.g. "job" is checked after "company" so
// "what company does X work for" doesn't also trip the bare "work" word some
// other attribute might reuse).
const PERSON_ATTRIBUTE_TRIGGERS = [
  { attribute: 'company',  label: '- Company:',           pattern: /\b(?:company|employer)\b/i },
  { attribute: 'contact',  label: '- Contact Number:',    pattern: /\b(?:phone|contact|cell(?:phone)?|mobile)\s*(?:number)?\b/i },
  { attribute: 'email',    label: '- Email:',             pattern: /\bemail(?:\s+address)?\b/i },
  { attribute: 'industry', label: '- Industry:',          pattern: /\bindustry\b/i },
  { attribute: 'location', label: '- Work Location:',     pattern: /\bwork(?:ing)?\s+location\b|\bwhere\s+(?:is|does)\b.*\bwork(?:ing)?\b/i },
  { attribute: 'status',   label: '- Employment Status:', pattern: /\bemployment\s+status\b|\bis\b.{0,40}\b(?:currently\s+)?employed\b|\bemployed\s+ba\b/i },
  { attribute: 'job',      label: '- Job Title:',         pattern: /\bjob\s+title\b|\boccupation\b|\bposition\b|\bcurrent\s+job\b|\bcurrent\s+role\b|\bworking\s+as\b/i },
  { attribute: 'exam',     label: '- Board/Licensure Exam:', pattern: /\b(?:board|licensure)\s+exam\b|\bpumasa\b|\bnakapasa\b|\bbumagsak\b|\bnabagsak\b/i },
  // "is Liam Miranda directly related to his job?" / "is X's job related to
  // their course?" — checked BEFORE 'job' above isn't necessary (neither
  // pattern collides), but placed here alongside it since both concern the
  // same underlying job-title context.
  { attribute: 'jobRelated', label: '- Job Related to Course:', pattern: /\brelated\s+to\s+(?:his|her|their|its|the(?:ir)?)?\s*(?:job|course|degree|field|program)\b/i },
  // Not a tracer study field — see buildPersonLookupResult()'s own comment
  // on where this line actually comes from (AlumniEmployment.salary_range,
  // a separate, optional self-reported profile field).
  { attribute: 'salary', label: '- Salary Range:', pattern: /\b(?:salary|income|compensation|wages?)\b/i },
];

// Returns which single attribute (if any) a person-lookup question targets,
// so buildPersonLookupResult() can answer with just that one fact instead of
// the full bullet-point profile — caught live: "What company does Liam
// Miranda currently work for?" returned his entire profile (program, year,
// job title, industry, work location, status, contact, email) when only the
// company was asked.
function extractRequestedPersonAttribute(question) {
  if (GENERAL_PERSON_INFO_PATTERN.test(question)) return null;
  for (const { attribute, pattern } of PERSON_ATTRIBUTE_TRIGGERS) {
    if (pattern.test(question)) return attribute;
  }
  return null;
}

// A separate, narrower trigger list for "who are X and Y" / "contact
// numbers of X and Y" style questions — deliberately NOT a retrofit of the
// 10 single-name patterns above (extractPersonName's own PERSON_LOOKUP_
// PATTERNS/WHO_IS_PATTERN/etc.), to keep this addition's blast radius small.
// Falls back to the existing single-name extractPersonName() when this
// narrower pattern doesn't match, so every existing single-person phrasing
// is completely unaffected.
// "sino sina" — "sina" is the Filipino PLURAL personal-name marker (the
// plural of "si", the same marker SINO_SI_PATTERN above relies on for the
// single-person case) — like "si", it only ever precedes actual proper
// names, never a rhetorical predicate, so it's just as safe a trigger as the
// English "who are" alternative here.
// Captures everything after the trigger phrase as one blob (up to sentence-
// ending punctuation or end of string), rather than trying to match each
// individual name span with its own MULTI_NAME_SPAN repetition inline here
// — an earlier version interpolated MULTI_NAME_SPAN's `{0,4}` quantifier
// TWICE into one pattern (once for the leading name, once for the optional
// "and/at trailing name"), which V8's regex backtracking handled
// inconsistently for certain word-count combinations: caught live via
// automated test — "sino sina Meg Nicole Serrano at Liam Miranda" (3-word
// name + 2-word name) silently truncated the second person to just "Liam",
// dropping "Miranda" — while other word-count combinations matched fine.
// Splitting the blob in JS (below) instead of trying to do it all in one
// regex sidesteps that whole class of nested-quantifier backtracking bug.
// "sino si" (not just "sino sina") is ALSO a valid multi-person trigger —
// caught live: "sino si Liam Miranda at Meg Nicole" (casual/common usage
// that keeps the singular marker "si" even when listing two names, rather
// than the grammatically "correct" plural "sina") extracted as ONE garbled
// name, "Liam Miranda at Meg Nicole", instead of two people. Safe to add
// without a separate single-vs-multi trigger split: extractPersonNames()
// below only commits to the multi-person interpretation when splitting the
// captured blob actually yields 2+ names — a genuine single-name "sino si
// Liam Miranda?" still splits to exactly 1 name and falls through to
// extractPersonName() unaffected, same as before this change.
const MULTI_PERSON_PATTERN = new RegExp(
  String.raw`\b(?:who\s+are|sino\s+si(?:na)?\b|(?:contact\s+numbers?|phone\s+numbers?|emails?|info(?:rmation)?|details?)\s+(?:of|for|about))\s+(.+?)(?:[?!.]|\s*$)`,
  'i'
);

// Deliberately does NOT require capitalization — a name typed lowercase
// ("give me info about juan dela cruz") is just as real as one typed
// properly, and queryPersonLookup()'s own name matching is already
// case-insensitive. The trade-off (this can also split out ordinary
// lowercase phrases that aren't names at all, e.g. "information about the
// skills and companies...") is resolved downstream in queryInner: every
// candidate here gets checked against the real Graduate collection, and the
// whole multi-person interpretation is discarded (not reported as "no
// record found") unless at least one candidate is an actual match — see the
// personNames branch below.
function extractPersonNames(question) {
  const m = question.match(MULTI_PERSON_PATTERN);
  if (m) {
    // "at" (Tagalog "and") only ever shows up here as a separator BETWEEN
    // two already-matched name spans (this only splits the text MULTI_
    // PERSON_PATTERN's own capture group already isolated, not the whole
    // question) — safe despite "at" also being an ordinary English
    // preposition elsewhere. A 60-char-per-piece cap (matching
    // COMPANY_LOOKUP_PATTERN's own convention) rejects a piece that's
    // clearly not a name (e.g. the whole blob failed to split at all).
    const names = m[1].split(/\s*,\s*|\s+(?:and|at)\s+/i)
      .map(s => s.trim())
      .filter(s => s && s.length <= 60);
    if (names.length >= 2) return names.slice(0, 5);
  }
  const single = extractPersonName(question);
  return single ? [single] : [];
}

// Recognizes a known program keyword inside a Graduate.program value — that
// field stores the FULL spelled-out name as entered ("Bachelor of Science in
// Computer Science", sometimes with a trailing ";" from a messy import), not
// an abbreviation, so it's a different parsing problem from extractFilters()
// above (which parses abbreviations like "BSCS"/"IT" out of free-text
// QUESTIONS). Kept as its own short list rather than reaching into
// extractFilters()'s internal ABBR/SPEC_ABBR, which aren't built for this.
const PROGRAM_KEYWORDS = [
  'Information Technology', 'Computer Science', 'Information Systems', 'Information Management',
  'Business Administration', 'Electronics', 'Civil Engineering', 'Electrical Engineering',
  'Mechanical Engineering', 'Education', 'Nursing', 'Accountancy',
];
function programKeywordFrom(rawProgram) {
  if (!rawProgram) return null;
  return PROGRAM_KEYWORDS.find(k => rawProgram.toLowerCase().includes(k.toLowerCase())) || null;
}

// Used only by extractFilters()'s multi-program combination pass further up
// (the "Computer Science and TSM graduates" case) — kept as its own
// independent flat list, same reasoning as PROGRAM_KEYWORDS' own comment
// just above ("rather than reaching into extractFilters()'s internal ABBR/
// SPEC_ABBR, which aren't built for this"): those are tuned for picking a
// SINGLE winning match with early-exit `break`/`find()` semantics, not for
// collecting every distinct program/specialization mentioned in one
// question. Each `re` is deliberately simpler than extractFilters()'s own
// single-value SPEC_ABBR patterns (no "nasa"/"-related"/"industry" negative
// lookahead) — those exist to stop a BARE "IT"/"CS" abbreviation from being
// misread as a program when it actually meant an industry/workplace
// elsewhere in the question; this list only ever matches the spelled-out
// PROGRAM_KEYWORDS names plus specialization NAMES/codes that are never
// legitimately read as anything else, so that ambiguity doesn't apply here.
const PROGRAM_MENTION_CANDIDATES = [
  ...PROGRAM_KEYWORDS.map((k) => ({ label: k, pattern: k, re: new RegExp(`\\b${k}\\b(?!\\s+(?:industry|sector|field)\\b)`, 'i') })),
  { label: 'Technical Service Management', pattern: 'Technical Service Management', re: /\bTSM\b/i },
  { label: 'Web and Mobile Application',    pattern: 'Web and Mobile Application',    re: /\bWMA\b|\bWeb\s+(?:and|&)\s+Mobile\s+(?:Application|Applications|App|Apps)\b/i },
  { label: 'Network Administration',        pattern: 'Network Administration',        re: /\bNet(?:work)?\s*Admin\w*\b/i },
  // Bare "Networking" deliberately excluded here too — same collision-risk
  // reasoning as extractFilters()'s own PROGRAM_SPECIALIZATIONS aliases
  // comment (an ordinary English word, far too likely to appear in an
  // unrelated question to ever safely stand alone as a program trigger).
  { label: 'Business Analytics',            pattern: 'Business Analytics',            re: /\bBusiness\s*Analytics?\b/i },
];
// "further education"/"continuing education"/"pursue(d) education" is the
// idiom-not-a-program-name guard PROGRAM_KEYWORDS' own single-value match
// already applies (see its own comment) — duplicated here since this is a
// deliberately separate list/pass, not a shared call site.
function findAllProgramMentions(question) {
  const found = [];
  for (const { label, pattern, re } of PROGRAM_MENTION_CANDIDATES) {
    if (label === 'Education' && /\b(further|continuing|pursue[ds]?)\s+education\b/i.test(question)) continue;
    const m = re.exec(question);
    if (m) found.push({ label, pattern, index: m.index, end: m.index + m[0].length });
  }
  return found.sort((a, b) => a.index - b.index);
}

// Names in this dataset appear in inconsistent formats ("Bryan Canlapan" vs
// "Canlapan, Bryan T.") — matching requires every name TOKEN to appear
// somewhere in the stored name, regardless of order, rather than an exact
// substring match that would miss reordered/comma-separated variants.
// Returns a compact, verified FACTS block (not a hand-composed sentence) —
// ragService.js always runs this through LLM narration now, so the model
// (not another hand-coded template branch here) decides what's relevant to
// whatever the user actually asked ("give me his info" -> summarize
// everything; "what's his number" -> just the number). Every value is
// **bolded** so the narration's own verification check (in ragService.js)
// can confirm nothing the model states was invented beyond what's listed
// here.
// `disambiguators` (yearGraduated and/or program, resolved from the SAME
// question's own extractFilters() output) narrows an ambiguous multi-match
// BEFORE declaring it ambiguous — this is exactly the info the ambiguous
// list itself now displays (see its own comment below) to tell same-named
// people apart, so a natural follow-up like "Rain Thora from Batch 2025" /
// "who is Rain Thora from Batch 2025" should actually resolve to that ONE
// person instead of re-showing the identical list with no progress made.
async function queryPersonLookup(name, disambiguators = {}, requestedAttribute = null) {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  // \b...\b (whole-word), NOT a bare substring match — caught live: "Tell me
  // about alumni from Mars" extracted "Mars" as the candidate name (the only
  // capitalized word), and an unanchored /mars/i regex matched "Jomarson" as
  // a pure substring collision (jo-MARS-on), leaking that real alumnus's
  // full profile — contact number and email included — for a nonsense
  // question about a planet. Word boundaries stop any token shorter than a
  // full name-word from matching mid-word inside an unrelated name.
  const tokenPatterns = tokens.map(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));

  const rows = await Graduate.aggregate([
    { $match: { name: { $nin: [null, ''] } } },
    ...DEDUP,
  ]);
  // .filter(), not .find() — this used to silently return the FIRST token
  // match and ignore every other equally-valid match, so a question naming
  // one of two alumni sharing a first/last name always resolved to whichever
  // happened to come first in the aggregate, with no indication a second
  // person even existed. Same 0/1/multiple-match shape resolveEvent() (event
  // lookups, below) already uses.
  let matches = rows.filter(r => tokenPatterns.every(re => re.test(r.name)));
  if (!matches.length) return null;
  if (matches.length > 1 && disambiguators.yearGraduated) {
    const narrowed = matches.filter(r => r.yearGraduated === disambiguators.yearGraduated);
    if (narrowed.length) matches = narrowed;
  }
  if (matches.length > 1 && disambiguators.program) {
    // Raw, NOT escapeRegex()'d — disambiguators.program comes straight from
    // extractFilters().program, which is ALREADY a ready-to-use regex
    // pattern everywhere else this file uses it (e.g. a track-specific
    // mention resolves to a composite "Information Technology.*Technical
    // Service Management" pattern, not a literal string). Escaping it here
    // would have literal-matched the ".*" as two literal characters instead
    // of "any text in between," silently breaking every track-specific
    // disambiguation.
    let narrowed = matches.filter(r => r.program && new RegExp(programRegex(disambiguators.program), 'i').test(r.program));
    // A BARE course mention ("from BSIT") with no track/specialization named
    // should mean the UNTRACKED program specifically, not every track
    // variant that also happens to contain the same base course name —
    // "Information Technology" is a substring of both "Bachelor of Science
    // in Information Technology" AND "...Specialized in Technical Service
    // Management," so a plain substring match alone can't tell two
    // same-named people on different tracks apart. Generalized on the
    // "Specialized in" phrasing every track-style program value shares
    // (not hardcoded to BSIT/CCS) so this applies automatically to any
    // other college/course that adds its own track specializations later.
    // Skipped when the disambiguator is ITSELF already track-specific
    // (contains the ".*" composite-pattern joiner) — that mention already
    // named an exact track, so excluding "Specialized in" entries would
    // exclude the very match being asked for.
    if (!disambiguators.program.includes('.*') && narrowed.length > 1) {
      const untracked = narrowed.filter(r => !/specialized\s+in/i.test(r.program));
      if (untracked.length) narrowed = untracked;
    }
    if (narrowed.length) matches = narrowed;
  }
  if (matches.length > 1) {
    // Two DIFFERENT people can share the exact same full name (caught live:
    // two separate "Rain Thora" accounts, same college, same course) — a
    // disambiguation list built from just the name repeats the identical
    // string for every entry, giving the admin nothing to actually choose
    // between despite the whole point of asking being to let them pick.
    // Each line adds whatever DOES differ (program, batch year, employment
    // status) plus the one field guaranteed unique per account — email — so
    // there's always at least one way to tell the entries apart.
    const lines = matches.slice(0, 8).map(r => {
      const displayName = toTitleCase(cleanText(r.name));
      const details = [
        r.program && toTitleCase(cleanText(r.program)),
        r.yearGraduated && `Batch ${r.yearGraduated}`,
        r.employmentStatus && cleanText(r.employmentStatus),
        r.email,
      ].filter(Boolean).join(', ');
      return details ? `- **${displayName}** — ${details}` : `- **${displayName}**`;
    });
    // ambiguous: true — this is a deterministic instruction to the user, not
    // narratable data. ragService.js must show it verbatim, never send it
    // to the LLM (which could easily garble or drop entries from the list).
    return { text: `Multiple alumni match "${name}" — please be more specific:\n\n${lines.join('\n')}`, ambiguous: true };
  }
  return buildPersonLookupResult(matches[0], requestedAttribute);
}

// Shared by both name-based lookup (queryPersonLookup, above) and
// email-based lookup (queryPersonLookupByEmail, below) — an email uniquely
// identifies one Graduate row directly, with no name-matching/ambiguity
// step needed at all, but the actual fact-block text should read identically
// either way.
async function buildPersonLookupResult(match, requestedAttribute = null) {
  const displayName = toTitleCase(cleanText(match.name));

  // A Graduate row created at account-signup time (see adminController.js
  // createUser/importUsers) exists the moment an admin adds/imports the
  // account — before the alumnus/alumna has ever logged in. Distinguishing
  // "never activated their account at all" from "activated, just hasn't
  // submitted the tracer study yet" matters: the second one is a normal,
  // expected gap; the first means AC is describing someone who may not even
  // know the account exists yet. Only meaningful when user_id is actually
  // set — a legacy bulk-imported historical row with no linked portal
  // account at all isn't "pending" in this sense, it just never had one.
  let accountPending = false;
  if (match.user_id) {
    const linkedUser = await User.findById(match.user_id).select('status').lean();
    accountPending = linkedUser?.status === 'pending';
  }

  // Some ingested rows have corrupted jobTitle values (stray braces/symbols
  // from a bad Excel import) — a real-looking title needs to be mostly
  // letters/spaces/punctuation, not just any non-empty string.
  const isPlausibleTitle = match.jobTitle && /^[A-Za-z][A-Za-z\s.,'/&()-]{2,80}$/.test(match.jobTitle.trim());

  // Bulleted, not bare "Label: value" lines — the frontend's markdown
  // renderer only preserves line breaks inside a recognized list/heading
  // block; plain consecutive lines with no bullet marker get flattened into
  // one run-on paragraph and re-split on sentence punctuation instead,
  // which mangled names containing a middle-initial period ("Vincent Louie
  // B. Dejesus" split right after "B."). This only matters when narration
  // (below, in ragService.js) fails and this raw text is shown as-is — a
  // real list block survives that fallback path intact.
  const facts = [];
  // Program/graduation year are shown regardless of tracer-study submission
  // status — a "Not yet submitted" record used to have nothing to say beyond
  // that one line plus an email, when the academic side (what they studied,
  // when they graduated) is already on file from registration and doesn't
  // depend on the tracer survey at all. Raw field, only cleaned (whitespace/
  // emoji/trailing ";" from messy imports) rather than run through
  // toTitleCase — program values are already properly-cased full names
  // ("Bachelor of Science in Computer Science"), and title-casing would
  // wrongly lowercase embedded abbreviations.
  if (match.program) facts.push(`- Program: **${cleanText(match.program).replace(/;+\s*$/, '')}**`);
  if (match.yearGraduated) facts.push(`- Year Graduated: **${match.yearGraduated}**`);
  if (isPlausibleTitle) facts.push(`- Job Title: **${toTitleCase(cleanText(match.jobTitle))}**`);
  // Was computed on Graduate (synced from AlumniEmployment.company_name /
  // TracerStudyResponse.companyName, see Graduate.js) but never actually
  // surfaced here — "what company does X work for" had no Company line to
  // answer from at all, even though the data existed.
  if (match.companyName) facts.push(`- Company: **${cleanText(match.companyName)}**`);
  if (match.industry) facts.push(`- Industry: **${match.industry}**`);
  // Was computed on Graduate but never surfaced in a person lookup at all —
  // "is Liam Miranda directly related to his job?" had no per-person fact to
  // answer from, so it fell through to the generic TSU-wide job-relevance
  // COUNT ("67 graduates...") instead of ever naming him specifically. Raw
  // stored value ("Yes, it is directly related" / "...somewhat related" /
  // "No, it is not related") is already a complete, readable sentence on its
  // own — shown verbatim rather than re-parsed into a Yes/No + qualifier.
  if (match.jobRelated) facts.push(`- Job Related to Course: **${cleanText(match.jobRelated)}**`);
  // Was never surfaced in a person lookup at all despite the field existing
  // on Graduate — "Pumasa ba si Liam Miranda sa board exam?" ("DID Liam
  // Miranda pass the board exam?") had no per-person fact to answer from, so
  // it fell through to the generic TSU-wide licensure-pass COUNT instead of
  // ever naming him specifically. Raw stored value (passed/failed/yes/no) is
  // title-cased for display consistency with the other fact lines.
  if (match.tookExam) facts.push(`- Board/Licensure Exam: **${toTitleCase(cleanText(match.tookExam))}**`);
  if (match.workLocation) {
    const loc = /local/i.test(match.workLocation) ? 'Local (within the Philippines)'
              : /abroad/i.test(match.workLocation) ? 'Abroad / overseas'
              : match.workLocation;
    facts.push(`- Work Location: **${loc}**`);
  }
  if (match.employmentStatus) {
    facts.push(`- Employment Status: **${match.employmentStatus}**`);
  } else if (accountPending) {
    // Distinct from the "Not yet submitted" case below — this account has
    // never even been activated (no first login yet), so there's no sense
    // in which the alumnus/alumna "hasn't gotten around to" the tracer study
    // — they may not know the account exists at all.
    facts.push('- Account Status: **Pending** — this account has been created but the alumnus/alumna hasn\'t activated it yet (no first login), so no employment details are available.');
  } else {
    // A registered alumni account with no employmentStatus at all means the
    // Graduate row is only a placeholder (created at account-signup time —
    // see adminController.createUser/updateUser) — this person hasn't
    // actually submitted their tracer study yet, which is different from
    // (and shouldn't be silently confused with) "on file but chose not to
    // report a job." Stated explicitly so the answer doesn't just show
    // whatever scraps ARE on file (email, etc.) with no explanation for why
    // nothing else is there.
    facts.push('- Tracer Study Status: **Not yet submitted** — this alumnus/alumna is registered but hasn\'t completed the tracer study survey yet, so no employment details are available.');
  }
  if (match.contact) facts.push(`- Contact Number: **${match.contact}**`);
  if (match.email) facts.push(`- Email: **${match.email}**`);
  // NOT a tracer study field — Graduate/TracerStudyResponse have no salary
  // question at all (see SALARY_PATTERN's own comment, aggregationService.js
  // top of file). This is a SEPARATE, optional field on the alumnus's own
  // self-maintained Employment Details profile (AlumniEmployment.salary_range)
  // that most alumni never fill in — only shown when actually on file, same
  // as every other optional fact above, never asserted as "not tracked" for
  // THIS person just because it's rare overall. Looked up by user_id (shared
  // key between Graduate and AlumniEmployment, both reference User._id) —
  // a legacy bulk-imported Graduate row with no linked portal account has no
  // user_id and so can never have an AlumniEmployment profile either.
  if (match.user_id) {
    const employmentProfile = await AlumniEmployment.findOne({ alumni_id: match.user_id }).select('salary_range').lean();
    // "(only a range, not an exact figure)" disclaimer — the profile field
    // itself only ever stores a bracket ("PHP 25,000 - PHP 35,000"), never a
    // precise number, so a question asking for the "EXACT salary" needs this
    // stated up front rather than silently showing a range as if it were the
    // exact figure asked for.
    if (employmentProfile?.salary_range) facts.push(`- Salary Range: **${employmentProfile.salary_range}** (only a range is recorded, not an exact figure)`);
  }
  if (!facts.length) {
    facts.push('- (No further details on file — no job title, industry, location, employment status, contact number, or email recorded.)');
  }
  // Carried into suggestFollowUps() so post-lookup chips can be about THIS
  // person's own industry/program/gender instead of the generic tracer-study
  // default — see RELATED_TOPICS.person_lookup below.
  const programKeyword = programKeywordFrom(match.program);
  const personFilters = {
    industry: match.industry || null,
    gender: match.gender || null,
    program: programKeyword,
    programLabel: programKeyword,
  };

  // A question that named ONE specific attribute ("what company does X work
  // for?") gets just that one fact, reusing the exact line already built
  // above (same wording/edge-case handling) instead of the full profile —
  // caught live: that exact question returned program/year/job title/
  // industry/work location/status/contact/email when only the company was
  // asked. Falls through to the full dump below if that specific fact isn't
  // actually on file, rather than returning an empty answer.
  const attributeTrigger = requestedAttribute && PERSON_ATTRIBUTE_TRIGGERS.find((t) => t.attribute === requestedAttribute);
  if (attributeTrigger) {
    const scopedFact = facts.find((f) => f.startsWith(attributeTrigger.label));
    if (scopedFact) {
      return { text: `**${displayName}**\n\n${scopedFact}`, ambiguous: false, personFilters };
    }
    // Salary is the one exception to "fall through to the full dump" just
    // below — every OTHER attribute here is a real tracer-study field, so a
    // missing one is already explained by the Tracer Study Status line
    // elsewhere in the dump (not submitted yet / submitted but left blank),
    // making the full profile a genuinely useful fallback. Salary Range
    // isn't a tracer-study field at all (see the fact-building block above)
    // — showing someone's entire UNRELATED profile (program, job title,
    // company...) in response to a salary question, with no mention of
    // salary anywhere in it, reads as if the question got ignored rather
    // than honestly answered "not on file." Caught live: "show me the exact
    // salary of Nani Nateetorn" (no salary on her Employment Details
    // profile) dumped her full tracer-study profile instead.
    if (attributeTrigger.attribute === 'salary') {
      return {
        text: `**${displayName}**\n\n- Salary Range: Not available — this alumnus/alumna hasn't added a salary range to their Employment Details profile.`,
        ambiguous: false,
        personFilters,
      };
    }
  }

  return {
    text: `**${displayName}**\n\n${facts.join('\n')}`,
    ambiguous: false,
    personFilters,
  };
}

// "who is danicamanlapig@gmail.com?" / a bare email address alone — the
// single most UNAMBIGUOUS way to identify one specific person (every
// account has a unique email), so this never needs queryPersonLookup()'s
// name-token/ambiguous-match machinery at all. Added specifically so the
// email shown in an ambiguous-match disambiguation list (see
// queryPersonLookup()'s own comment) is itself a valid, resolving follow-up
// answer, the same way "from Batch YYYY" already is.
async function queryPersonLookupByEmail(email) {
  const match = await Graduate.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') }).lean();
  if (!match) return null;
  return buildPersonLookupResult(match);
}

async function queryNames(filters, question = '') {
  const pipeline = [
    ...stablePipeline(filters),
    { $match: { name: { $nin: [null, ''] } } },
  ];

  // Apply variable filters after dedup
  if (filters.jobTitleRegex)    pipeline.push({ $match: { jobTitle: { $regex: filters.jobTitleRegex, $options: 'i' } } });
  if (filters.companyRegex)     pipeline.push({ $match: { companyName: { $regex: filters.companyRegex, $options: 'i' } } });
  if (filters.industry)         pipeline.push({ $match: { industry:         { $regex: filters.industry, $options: 'i' } } });
  if (filters.excludeIndustry) {
    pipeline.push({ $match: { industry: { $nin: [null, ''], $not: { $regex: filters.excludeIndustry, $options: 'i' } } } });
  }
  if (filters.employmentStatus) pipeline.push({ $match: { employmentStatus: { $regex: employedStatusPattern(filters.employmentStatus), $options: 'i' } } });
  if (filters.excludeEmploymentStatus) {
    pipeline.push({ $match: { employmentStatus: { $nin: [null, ''], $not: { $regex: employedStatusPattern(filters.excludeEmploymentStatus), $options: 'i' } } } });
  }
  if (filters.workLocation) {
    pipeline.push({ $match: { workLocation: workLocationCondition(filters.workLocation, filters.negateWorkLocation) } });
  }
  if (filters.furtherEducation === 'No') {
    // Alumni who didn't pursue often have null/empty furtherEducation, not the string "No"
    pipeline.push({ $match: { $or: [
      { furtherEducation: { $in: [null, ''] } },
      { furtherEducation: { $regex: '^No', $options: 'i' } },
    ]}});
  } else if (filters.furtherEducation) {
    pipeline.push({ $match: { furtherEducation: { $regex: `^${filters.furtherEducation}`, $options: 'i' } } });
  }
  if (filters.jobRelated === 'directly') {
    pipeline.push({ $match: { $and: [
      { jobRelated: { $regex: '^yes', $options: 'i' } },
      { jobRelated: { $not: { $regex: 'somewhat', $options: 'i' } } },
    ]}});
  } else if (filters.jobRelated === 'somewhat') {
    pipeline.push({ $match: { jobRelated: { $regex: 'somewhat', $options: 'i' } } });
  } else if (filters.jobRelated) {
    pipeline.push({ $match: { jobRelated: { $regex: `^${filters.jobRelated}`, $options: 'i' } } });
  }
  if (filters.tookExam) {
    pipeline.push({ $match: tookExamMatch(filters.tookExam) });
  }
  if (filters.hasPromotion === 'No') {
    pipeline.push({ $match: { $or: [
      { hasPromotion: { $in: [null, ''] } },
      { hasPromotion: { $regex: '^no', $options: 'i' } },
    ]}});
  } else if (filters.hasPromotion) {
    pipeline.push({ $match: { hasPromotion: { $regex: '^yes', $options: 'i' } } });
  }
  // Same competency+rating-level filter queryCount() now applies — see its
  // own comment for the live bug this fixes. Mirrored here so "WHO rated
  // their Critical Thinking as High Competent and works as a supervisor"
  // (a names request, not just a count) is equally answerable.
  if (filters.competency && filters.competencyRating) {
    pipeline.push({ $match: { [`competencies.${filters.competency}`]: { $regex: `^${escapeRegex(filters.competencyRating)}`, $options: 'i' } } });
  }

  // Was a flat 50 always — a bare "who is working?"-style question dumped up
  // to 50 names on the very first answer, before the user had any chance to
  // say whether they actually wanted the full roster. Now previews a much
  // shorter list by default and asks explicitly (see the suffix message
  // below) — filters.showAll ("show all"/"see the full list") lifts the cap
  // all the way, filters.showLimit ("show 50") sets an exact requested size;
  // both are recognized continuations (see CONTINUATION_PATTERN in
  // ragService.js) so either still applies on top of the SAME filters
  // (e.g. "employed") the truncated list was already scoped to.
  const limit = filters.showLimit || (filters.showAll ? NAMES_FULL_LIMIT : NAMES_PREVIEW_LIMIT);
  const [docs, totalRows] = await Promise.all([
    Graduate.aggregate([...pipeline, { $sort: { name: 1 } }, { $limit: limit }]),
    Graduate.aggregate([...pipeline, { $count: 'total' }]),
  ]);
  const total = totalRows[0]?.total ?? docs.length;

  // Built BEFORE the zero-match check below (not just for the found-results
  // case further down) — a "no alumni found" answer needs to name exactly
  // which combination of filters came up empty just as much as the
  // found-results heading does. Moved up from where it used to sit (right
  // before the found-results heading) for that reason.
  const label = [
    filters.jobTitle          && `working as ${filters.jobTitle}`,
    filters.company           && `at ${filters.company}`,
    filters.industry          && `in ${filters.industry}`,
    filters.excludeIndustry   && `NOT in ${filters.excludeIndustry}`,
    filters.program           && `from ${filters.programLabel || filters.program}`,
    filters.yearsGraduated ? `Batches ${filters.yearsGraduated.slice().sort((a, b) => a - b).join(', ')}`
      : filters.yearGraduated ? `Batch ${filters.yearGraduated}`
      : (filters.yearFrom && filters.yearTo) ? `Batch ${filters.yearFrom} to ${filters.yearTo}` : null,
    // Same LGBTQIA+ special-case genderPrefix() already applies elsewhere —
    // a blanket .toLowerCase() reads fine for "male"/"female" but flattens
    // the acronym into "lgbtqia+".
    filters.gender            && (filters.gender.toUpperCase() === 'LGBTQIA+' ? 'LGBTQIA+' : filters.gender.toLowerCase()),
    filters.employmentStatus  && (filters.employmentStatus === 'Yes' ? 'employed' : filters.employmentStatus === 'No' ? 'unemployed' : filters.employmentStatus.toLowerCase()),
    filters.excludeEmploymentStatus && `who are NOT ${filters.excludeEmploymentStatus === 'Yes' ? 'employed' : filters.excludeEmploymentStatus === 'No' ? 'unemployed' : filters.excludeEmploymentStatus.toLowerCase()}`,
    filters.workLocation      && (filters.negateWorkLocation ? `NOT working ${filters.workLocation}` : `working ${filters.workLocation}`),
    filters.furtherEducation  && (filters.furtherEducation === 'Yes' ? 'who pursued further education' : 'who did not pursue further education'),
    filters.tookExam          && (filters.tookExam === 'passed' ? 'who passed a board/licensure exam'
                                : filters.tookExam === 'failed' ? 'who failed a board/licensure exam'
                                : filters.tookExam === 'yes'    ? 'who took a board/licensure exam'
                                :                                 'who did not take a board/licensure exam'),
    filters.hasPromotion      && (filters.hasPromotion === 'No' ? 'who were NOT promoted' : 'who were promoted'),
  ].filter(Boolean).join(', ');

  if (!docs.length) {
    // Used to only give a specific "no records found" message when a
    // `program` filter was set, and silently return null (falling through
    // to a generic, vague RAG refusal — "I don't have enough data in the
    // tracer study records to answer that accurately" — that reads as if
    // the question wasn't understood) for every OTHER filter combination.
    // Caught live: "who are the female alumni working as accountants?"
    // (gender + job title, genuinely zero real matches) got that same vague
    // refusal instead of a direct, confident zero-result answer — even
    // though this function had already correctly parsed and searched for
    // exactly what was asked. A real "zero matches" is a complete, verified
    // answer in its own right, not a failure to understand the question, so
    // it's answered as directly as a found-results list would be — with a
    // fallback to null only in the unfiltered edge case (no criteria at all
    // yet still zero total alumni), which real data should never hit.
    //
    // The program-name hint is appended (not a separate exclusive branch)
    // whenever a program filter is part of the query, even combined with
    // other filters — a mistyped program name/abbreviation is just as
    // plausible an explanation for zero matches then as it is alone.
    const programHint = filters.program ? ' Please check the program name or abbreviation.' : '';
    if (label) return `No alumni found ${label}.${programHint}`;
    return null;
  }

  const showJob = !!(filters.jobTitle || filters.company || filters.industry || filters.excludeIndustry || filters.employmentStatus || filters.excludeEmploymentStatus);
  const showCompany = !!filters.company;
  // Neither of these is a FILTER (no "abroad"/"2022" was asked to narrow
  // the group by) — they're a request to DISPLAY that attribute for the
  // group already established by the filters above. "Saan sila
  // nagtatrabaho?" ("where do they work?") and "Kailan sila nagtapos?"
  // ("when did they graduate?") both resolve to this 'names' topic (see
  // TOPIC_PATTERNS.names) but need a different per-person detail shown than
  // the job-title default.
  const showLocation = /\b(saan|where)\b.{0,25}\b(nagtatrabaho|nagwowork|naninirahan|nakatira|work(?:ing)?)\b/i.test(question);
  const showYear = /\b(kailan|when)\b.{0,20}\b(nagtapos|natapos|graduate)\b/i.test(question);
  // "list all unemployed and their CONTACT INFORMATION" — a request to
  // display Graduate.contact alongside each name, same "detail flag read
  // off the question text" shape as showLocation/showYear above. Without
  // this, the field simply never appeared in any queryNames() output no
  // matter how explicitly asked for — the list only ever showed job
  // title/company, regardless of question wording. Caught live.
  const showContact = /\bcontacts?\b|\bphone\s*(?:number)?\b|\bnumbers?\s+to\s+(?:call|reach)\b|\bmobile\s*(?:number)?\b/i.test(question);
  // UNLIKE showLocation/showYear/showContact above, home address is not a
  // Graduate field AT ALL — no tracer study question or alumni profile
  // field ever collects it (see SYSTEM_PROMPT's own "NOT tracked" list in
  // ragService.js). A per-row "— address not on file" would read as if it
  // were a real field that just happens to be empty for everyone, the same
  // misleading shape queryPersonLookup() deliberately avoids for untracked
  // concepts. Flagged once, up front, instead — caught live: "Export the
  // full list of unemployed graduates with their home addresses" silently
  // answered with names only and zero acknowledgment that half the request
  // (the address half) was never addressed at all, reading as if the
  // question had been fully understood when only the "unemployed" keyword
  // actually got matched.
  const requestsAddress = /\b(?:home\s+)?address(?:es)?\b|\btirahan\b/i.test(question);

  const suffix = docs.length < total ? ` (showing ${docs.length} of ${total} — say "show all" or "show 50" to see more)` : ` (${total} total)`;
  let out = `**Alumni${label ? ` ${label}` : ''}${suffix}:**\n\n`;
  docs.forEach((d, i) => {
    out += `${i + 1}. **${toTitleCase(cleanText(d.name))}**`;
    if (showJob && d.jobTitle) out += `, ${toTitleCase(cleanText(d.jobTitle))}`;
    if (showCompany && d.companyName) out += ` at ${toTitleCase(cleanText(d.companyName))}`;
    if (showLocation) out += d.workLocation ? ` — ${toTitleCase(cleanText(d.workLocation))}` : ` — location not on file`;
    if (showYear) out += d.yearGraduated ? ` — graduated ${d.yearGraduated}` : ` — graduation year not on file`;
    if (showContact) out += d.contact ? ` — ${d.contact}` : ` — no contact number on file`;
    out += '\n';
  });
  // rephraseNotice: a short, FIXED fact ragService.js rewords into one
  // natural sentence before prepending to this (untouched) list — see
  // ragService.js's own comment on why this is safe to narrate (a short,
  // already-fully-known scope-limitation sentence) when the names/numbers
  // below it deliberately are not. Returning an object here (instead of the
  // plain string every other queryNames() call returns) is safe everywhere
  // this function is called — every call site already unwraps either shape
  // via the shared `typeof result === 'string' ? ... : result` check in
  // queryInner().
  return requestsAddress
    ? { text: out, rephraseNotice: 'Home address is not tracked by the tracer study or any alumni profile.' }
    : out;
}

// ─── Events ─────────────────────────────────────────────────────────────────
// Event/AttendanceLog aren't Graduate documents, so they get none of the
// college-scoping the Mongoose pre-hook gives every function above "for
// free" — every function here filters by getCollegeScope() itself, the same
// college field eventController.js's own coordinator-facing endpoints
// already scope by (not `visibility`, which is audience, not ownership).
const ATTENDED_STATUSES = ['Present', 'Late'];

// Same list ragService.js's COLLEGE_CODES uses (kept as its own small copy
// here rather than a shared import — see DOMAIN_KEYWORDS above for why this
// file already avoids cross-module vocabulary reuse for this kind of list).
const COLLEGE_CODES = ['CPAG', 'CCS', 'COS', 'CIT', 'COE', 'CBA', 'COED', 'CASS', 'CCJE', 'CAFA'];

// A coordinator's own scope (getCollegeScope()) always wins and is never
// overridden by this — it only matters for an unscoped admin request, who
// can otherwise see every college's events and may want to name one
// specifically ("list of events for CCS") rather than get the full dump.
function extractRequestedCollege(question) {
  return COLLEGE_CODES.find(c => new RegExp(`\\b${c}\\b`, 'i').test(question)) || null;
}

// Explicit opt-out for an admin who really does want every college's events
// combined in one answer, rather than being asked to pick one — checked
// before the clarifying question below is triggered.
const ALL_COLLEGES_PATTERN = /\ball\s+colleges?\b|\bevery\s+college\b|\btsu[\s-]?wide\b|\bentire\s+tsu\b|\bwhole\s+tsu\b|\blahat\s+ng\s+college\b/i;

// An admin managing the whole TSU asking a bare "list events"/"upcoming
// events" with no college named used to silently combine every college's
// events into one list — which, with real data skewed toward one college,
// reads as if there's only one college's worth of events rather than a
// TSU-wide combined view. Ask which college instead (mirrors how a
// coordinator is implicitly scoped) unless the admin explicitly asked for
// everything (ALL_COLLEGES_PATTERN) — see ragService.js's
// resolveCollegeClarification() for how the admin's one-word reply ("CCS")
// gets merged back into the original question on the next turn.
const CLARIFY_COLLEGE_QUESTION = 'Which college would you like to see this for — CPAG, CCS, COS, CIT, COE, CBA, COED, CASS, CCJE, or CAFA? (Or say "all colleges" for a TSU-wide view.)';

// "curriculum relevance" has no dedicated tracer-study question at all
// (confirmed against tracerFormConfigController.js's actual question list —
// only jobRelatedToDegree exists). Asked as a clarifying question INSTEAD of
// silently showing job_relevance data with a disclaimer — a real user
// (Danica) read the earlier disclaimer-then-data version as the bot still
// hallucinating/guessing, even with the caveat attached, because it answered
// before being asked to. See ragService.js's resolveCurriculumRelevance
// Clarification() for how a short affirmative reply ("yes", "oo") on the
// next turn gets merged back into an actual job_relevance question, same
// merge-the-short-reply-into-the-prior-question shape resolveCollegeClarification()
// already uses for CLARIFY_COLLEGE_QUESTION above.
const CLARIFY_CURRICULUM_RELEVANCE = 'The tracer study does not track "curriculum relevance" as its own separate question. The closest available data is whether alumni\'s jobs are related to their course of study — would you like to see that instead?';

// Same trigger-then-capture shape as NAMED_LOOKUP_PATTERN/WHO_IS_PATTERN
// above, adapted for event titles instead of alumni names — captures free
// text after an attendance/reference trigger word, trimmed of a trailing
// "event" filler word the trigger itself doesn't consume. The chained
// (?:\s+(?:for|of|the|count))* skips any run of connector/filler words
// between the trigger and the actual title — "attendance for the Job Fair"
// and "attendance count for Job Fair" both need to reach "Job Fair", not
// stop at the first non-"the" word and capture "for the Job Fair"/"count
// for Job Fair" verbatim (verified against real phrasings before landing
// on this shape — a single optional "the" wasn't enough).
// "dumalo"/"pagdalo" + "sa"/"ang" cover the Tagalog equivalent shape
// ("Pagdalo sa Career Fair", "Ilan ang dumalo sa Career Fair") — same
// reasoning as TOPIC_PATTERNS.events' own Tagalog support above.
// "graph(s)"/"chart(s)"/"visualization(s)"/"plot(s)" and a broader set of
// report-shaped nouns (breakdown/report/summary/rate/status/list/number/
// percentage/statistics/data/info/details/record) added to the same
// connector-skip list as "count" — "show me the attendance GRAPH for Annual
// Career Fair 2026" needs to reach "Annual Career Fair 2026" the same way
// "attendance count for X" already does, not stop at "graph" and capture
// "graph for Annual Career Fair 2026" as if that whole phrase were the
// title (VISUALIZATION_REQUEST_PATTERN's own vocabulary plus the generic
// filler nouns ragService.js's own INCOMPLETE_THOUGHT_PATTERNS recognizes,
// reused here for the same reason "count" already sat in this list).
// The trigger words themselves (attend*/about/dumalo/pagdalo) are ALSO
// repeated inside this same connector list — the same thought can be
// phrased with the filler word EITHER side of "attendance" ("attendance
// graph for X" vs "graph of attendance for X" vs "graph for the attendance
// of X"), and the leftmost trigger match can land on any one of them
// depending on word order, so every OTHER trigger word must also be
// skippable as filler once one of them has already fired as the anchor —
// without this, "show me a graph of attendance for X" anchored on "of" and
// then stopped at the next word ("attendance", not yet a recognized
// connector), capturing "attendance for X" instead of just "X".
const EVENT_NAME_TRIGGER = /(?:attend(?:ed|ees|ance)?|about|for|of|dumalo|pagdalo)\b(?:\s+(?:for|of|the|count|sa|ang|graphs?|charts?|visuali[sz]ations?|plots?|breakdowns?|reports?|summar(?:y|ies)|rates?|status(?:es)?|lists?|numbers?|percentages?|statistics?|stats?|data|info(?:rmation)?|details?|records?|attend(?:ed|ees|ance)?|about|dumalo|pagdalo))*\s+(.+?)(?:\s+event)?[?.!]*$/i;

// A follow-up referring to EVERY/EACH event just listed ("each of the
// events", "individual events", "all of the events") rather than one
// specific named event still matches EVENT_NAME_TRIGGER, capturing the
// whole generic phrase as if it were a literal title — resolveEvent() then
// token-matched words like "each"/"of"/"the"/"events" against every event's
// title and, finding none, returned a confusing "No event matching 'each of
// the events' found." instead of recognizing no single event was named.
// Left unresolved here (same as the bare "event(s)" case below) so
// resolveEvent() reports {none: true} and callers fall back to the plain
// event list, the same way they already do for a bare "the event?".
// The trailing "(?:\s+(?:of|for|in)\s+[a-z]+)?" tolerates a college named IN
// THE SAME referent phrase ("each of the events OF CCS") — without it, that
// one extra trailing word made the $ anchor fail to match at all, so the
// whole "each of the events of CCS" string fell through as if it were a
// real (if unmatchable) event title instead of being recognized as the same
// generic referent plus a college mention.
// Tagalog equivalents added — "bawat kaganapan"/"bawat event" (each event),
// "lahat ng (mga) event/kaganapan" (all events), "indibiduwal na (mga)
// event/kaganapan" (individual events) — same referent shapes, just phrased
// in Filipino, matching how EVENT_NAME_TRIGGER's own "dumalo"/"pagdalo"/
// "sa"/"ang" alternatives already support Tagalog for attendance.
const GENERIC_EVENT_REFERENT = /^(?:(?:the\s+)?events?|(?:the\s+)?kaganapan|each\s*(?:one)?\s*(?:of\s*(?:the\s*)?)?events?|individual\s+events?|all\s*(?:of\s*(?:the\s*)?)?events?|every\s+events?|indibiduwal\s+na\s+(?:mga\s+)?(?:events?|kaganapan)|bawat\s+(?:isa\s+sa\s+)?(?:mga\s+)?(?:events?|kaganapan)|lahat\s+ng\s+(?:mga\s+)?(?:events?|kaganapan))(?:\s+(?:of|for|in|sa|ng)\s+[a-z]+)?$|^(?:all\s+)?of\s+them$|^(?:silang\s+)?lahat$|^them$/i;

function extractEventName(question) {
  const m = question.match(EVENT_NAME_TRIGGER);
  if (!m) return null;
  const name = m[1].trim();
  // A generic "how many attended THE EVENT?" (no real name at all) still
  // matches EVENT_NAME_TRIGGER, capturing the bare trigger word "event(s)"
  // itself as if it were the title — resolveEvent() then token-matched that
  // against every event's title looking for the literal substring "event",
  // which silently resolved to whichever event happened to have "Event"
  // literally in its name (e.g. one titled "Test Event") instead of
  // recognizing the question never named a specific event and asking which
  // one was meant. Caught live: "how many attended the event?" answered
  // "0 alumni attended Test Event" — a real event, just not the one (any
  // one) the question was actually about.
  if (GENERIC_EVENT_REFERENT.test(name)) return null;
  return name;
}

// Distinguishes "explicitly asked about EVERY/EACH event" from "named no
// event at all" — both make extractEventName() return null (see
// GENERIC_EVENT_REFERENT above), but queryEventAttendees() needs to tell
// them apart: a bare "who attended?" with nothing else genuinely doesn't
// name a group to fall back on (show the plain event list, same as always),
// while "list the participants who attended each of the events?" DOES name
// a real, answerable group (every currently-listed event) that should
// actually be resolved rather than treated the same as "no info at all."
function isGenericMultiEventRequest(question) {
  const m = question.match(EVENT_NAME_TRIGGER);
  return !!m && GENERIC_EVENT_REFERENT.test(m[1].trim());
}

// "the LAST/LATEST/most recent event" names no real title at all — it's a
// relative reference to whichever past event happened most recently — but
// EVENT_NAME_TRIGGER still captures the bare word "last"/"latest"/"most
// recent" as if it WERE a literal title, and resolveEvent()'s token-match
// below then searched every event's title for the literal substring "last"
// and found nothing. Caught live: "How many alumni attended the last
// event?" answered "No event matching 'last' found" instead of resolving to
// whichever event actually most recently happened.
const LATEST_EVENT_REFERENT_PATTERN = /^(?:the\s+)?(?:last|latest|most\s+recent|newest|previous)$/i;

// Same token-matching approach queryPersonLookup() uses for alumni names
// (aggregationService.js above) — event titles get typed back inexactly
// ("job fair" vs "IT Job Fair 2026"), so every word in the extracted phrase
// must appear somewhere in the title, in any order, rather than requiring an
// exact substring match.
async function resolveEvent(question) {
  let name = extractEventName(question);
  if (!name) return { none: true };

  if (LATEST_EVENT_REFERENT_PATTERN.test(name)) {
    const college = getCollegeScope();
    const latest = await Event.findOne({ ...(college ? { college } : {}), event_datetime: { $lte: new Date() } })
      .sort({ event_datetime: -1 })
      .select('title event_datetime')
      .lean();
    if (!latest) return { error: `No past events found${college ? ` in ${college}'s events` : ''}.` };
    return { event: latest };
  }

  // A reply to this function's OWN "Multiple events match ... please be
  // more specific" list (below) is one of the rendered bullets copied back
  // verbatim — "Title (M/D/YYYY)", the exact `toLocaleDateString()` format
  // the list itself prints. The trailing date is NOT part of the event's
  // title, so leaving it in the token-matching below required every token
  // (including the literal date string) to appear in the title text, which
  // no real title ever contains — silently matching ZERO events instead of
  // using the date to pick the one specific event out of several
  // same-named candidates the user was actually trying to disambiguate.
  // ragService.js's resolveEventDisambiguation() is what actually re-merges
  // a bare "Title (date)" reply with the ORIGINAL "how many attended"
  // question — this just needs to not choke on the date once that merge
  // hands it back here.
  let dateFilter = null;
  const dateMatch = name.match(/\(?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*\)?\s*$/);
  if (dateMatch) {
    dateFilter = { month: parseInt(dateMatch[1], 10), day: parseInt(dateMatch[2], 10), year: parseInt(dateMatch[3], 10) };
    name = name.slice(0, dateMatch.index).trim();
  }
  if (!name) return { none: true };

  const tokens = name.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { none: true };
  // \b...\b, not a bare substring — same reasoning as queryPersonLookup()'s
  // token matcher above (a short event-title word could otherwise collide
  // mid-word with an unrelated event's title).
  const tokenPatterns = tokens.map(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));

  const college = getCollegeScope();
  const events = await Event.find(college ? { college } : {}).select('title event_datetime').lean();
  let matches = events.filter(e => tokenPatterns.every(re => re.test(e.title)));

  // Narrow by the disambiguating date, if the reply carried one — matched on
  // CALENDAR DAY (not exact timestamp) since the date came from a
  // human-readable "M/D/YYYY" the clarify list rendered, not the event's
  // stored time-of-day. Only applied when it actually narrows to at least
  // one match — an unparseable/stale date should fall back to the plain
  // title-token matches rather than wiping out real candidates.
  if (dateFilter && matches.length > 1) {
    const dateMatches = matches.filter(e => {
      const d = new Date(e.event_datetime);
      return d.getMonth() + 1 === dateFilter.month && d.getDate() === dateFilter.day && d.getFullYear() === dateFilter.year;
    });
    if (dateMatches.length) matches = dateMatches;
  }

  if (!matches.length) {
    // `name` (the extracted phrase, date suffix already stripped) rides
    // along with the error so queryEventAttendees() can try it as a
    // trainingType lookup before giving up — see
    // queryTrainingAttendeesByName()'s own comment.
    return { error: `No event matching "${name}" found${college ? ` in ${college}'s events` : ''}.`, name };
  }
  if (matches.length > 1) {
    const list = matches
      .sort((a, b) => new Date(b.event_datetime) - new Date(a.event_datetime))
      .slice(0, 8)
      .map(e => `- **${e.title}** (${new Date(e.event_datetime).toLocaleDateString()})`)
      .join('\n');
    return { error: `Multiple events match "${name}" — please be more specific:\n\n${list}` };
  }
  return { event: matches[0] };
}

async function queryEventOverview(question = '') {
  const scopedCollege = getCollegeScope();
  const requestedCollege = extractRequestedCollege(question);
  // A coordinator naming a DIFFERENT college than their own scope used to
  // silently fall through to their own college's events with no explanation
  // — a coordinator asking "list of events of COE" while scoped to CCS just
  // got back CCS's events, which reads as a wrong/broken answer rather than
  // an intentional restriction. Say so explicitly instead, same wording
  // shape as ragService.js's own cross-college tracer-study denial message.
  if (scopedCollege && requestedCollege && requestedCollege !== scopedCollege) {
    return `As a ${scopedCollege} coordinator, you may only access ${scopedCollege}'s events — access to ${requestedCollege} or other colleges' events is not available.`;
  }
  if (!scopedCollege && !requestedCollege && !ALL_COLLEGES_PATTERN.test(question)) {
    return CLARIFY_COLLEGE_QUESTION;
  }
  const college = scopedCollege || requestedCollege;
  // "List upcoming events" was silently ignoring "upcoming" entirely — this
  // returned the latest 50 events by date regardless of whether they'd
  // already happened, so a request for upcoming events could (and did)
  // surface events dated in the past with no indication they were over.
  const isUpcoming = /\b(upcoming|forthcoming|future|next)\b/i.test(question);
  const isPast     = /\b(past|previous|completed|already\s+(held|happened|occurred)|finished)\b/i.test(question);
  const dateFilter = isUpcoming ? { event_datetime: { $gte: new Date() } }
                    : isPast    ? { event_datetime: { $lt: new Date() } }
                    : {};
  const events = await Event.find({ ...(college ? { college } : {}), ...dateFilter })
    .select('title event_datetime location')
    .sort({ event_datetime: isUpcoming ? 1 : -1 })
    .limit(50)
    .lean();
  const scopeLabel = isUpcoming ? 'upcoming ' : isPast ? 'past ' : '';
  if (!events.length) {
    return `No ${scopeLabel}events found${college ? ` for ${college}` : ''}.`;
  }
  const suffix = events.length === 50 ? ' (showing latest 50)' : ` (${events.length} total)`;
  const heading = isUpcoming ? 'Upcoming Events' : isPast ? 'Past Events' : 'Events';
  let out = `**${heading}${college ? ` for ${college}` : ''}${suffix}:**\n\n`;
  events.forEach((e, i) => {
    out += `${i + 1}. **${e.title}** on ${new Date(e.event_datetime).toLocaleDateString()}${e.location ? ` at ${e.location}` : ''}\n`;
  });

  // A list of events has no single numeric field to chart on its own — but
  // grouped by month, "how many events happened when" is a real, meaningful
  // bar chart. Skipped for a single event (nothing to compare across
  // months) and only built when actually asked for, same on-request wiring
  // as every other VISUALIZATION_REQUEST_PATTERN check in this file.
  if (VISUALIZATION_REQUEST_PATTERN.test(question) && events.length > 1) {
    const monthCounts = {};
    events.forEach(e => {
      const key = new Date(e.event_datetime).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    });
    const rows = Object.entries(monthCounts)
      .map(([label, count]) => ({ label, count, _sortKey: new Date(label).getTime() }))
      .sort((a, b) => a._sortKey - b._sortKey);
    return withChart(out, { type: 'bars', title: `${heading}${college ? ` for ${college}` : ''} by Month`, rows });
  }
  return out;
}

// "attendance of the past events" / "attendance for all events" — no single
// event named at all, a genuinely different question ("how did attendance
// look across every event") from "how many attended EVENT X". Without this
// check, extractEventName()/resolveEvent() tried to resolve the plural
// phrase itself as if it were one literal event title and failed with a
// confusing "No event matching 'attendance of the past events' found."
// Tagalog added — "lahat ng (mga) event/kaganapan" (all), "nakaraan(g)/
// nakalipas na (mga) event/kaganapan" (past), "susunod/paparating na (mga)
// event/kaganapan" (upcoming).
const GENERIC_EVENTS_PATTERN = /\b(all|past|upcoming|previous|every)\s+events?\b|\bevents?\s+(overall|in\s+general)\b|\blahat\s+ng\s+(?:mga\s+)?(?:events?|kaganapan)\b|\b(?:nakaraan|nakalipas)g?\s+(?:mga\s+)?(?:events?|kaganapan)\b|\b(?:susunod|paparating)\s+na\s+(?:mga\s+)?(?:events?|kaganapan)\b/i;

async function queryEventAttendanceOverview(question) {
  const scopedCollege = getCollegeScope();
  const requestedCollege = extractRequestedCollege(question);
  if (scopedCollege && requestedCollege && requestedCollege !== scopedCollege) {
    return `As a ${scopedCollege} coordinator, you may only access ${scopedCollege}'s events — access to ${requestedCollege} or other colleges' events is not available.`;
  }
  if (!scopedCollege && !requestedCollege && !ALL_COLLEGES_PATTERN.test(question)) {
    return CLARIFY_COLLEGE_QUESTION;
  }
  const college = scopedCollege || requestedCollege;
  const isUpcoming = /\b(upcoming|forthcoming|future|next)\b/i.test(question);
  const isPast     = /\b(past|previous|completed|already\s+(held|happened|occurred)|finished)\b/i.test(question);
  const dateFilter = isUpcoming ? { event_datetime: { $gte: new Date() } }
                    : isPast    ? { event_datetime: { $lt: new Date() } }
                    : {};
  const events = await Event.find({ ...(college ? { college } : {}), ...dateFilter })
    .select('title event_datetime')
    .sort({ event_datetime: -1 })
    .limit(15)
    .lean();
  const scopeLabel = isUpcoming ? 'upcoming ' : isPast ? 'past ' : '';
  if (!events.length) return `No ${scopeLabel}events found${college ? ` for ${college}` : ''}.`;

  const counts = await Promise.all(events.map(e =>
    AttendanceLog.countDocuments({ event_id: e._id, status: { $in: ATTENDED_STATUSES } })
  ));
  const heading = `${isUpcoming ? 'Upcoming' : isPast ? 'Past' : ''} Event Attendance${college ? ` for ${college}` : ''}`.replace(/\s+/g, ' ').trim();
  let out = `**${heading}${events.length === 15 ? ' (latest 15)' : ''}:**\n\n`;
  events.forEach((e, i) => { out += `${i + 1}. **${e.title}**: ${counts[i]} attended\n`; });

  if (VISUALIZATION_REQUEST_PATTERN.test(question)) {
    // "gender breakdown of attendance graph for all CCS past events" — a
    // chart across every event in scope, same EVENT_GENDER_BREAKDOWN_HINT
    // used by eventVizResult() for a single named event. Without this, the
    // question fell to the plain per-event COUNT bars below (the same chart
    // a bare "attendance graph for all CCS past events", no gender
    // mentioned at all, already produces) — "gender" was correctly noticed
    // nowhere at all once the question named a group of events instead of
    // one.
    if (EVENT_GENDER_BREAKDOWN_HINT.test(question)) {
      // One donut PER event, not a single combined breakdown — a merged
      // total across every event obscures which event actually skewed one
      // way or another (and double-counts anyone who attended more than
      // one), so a separate, clearly-titled chart per event is more useful
      // here than it would be for the single-number bars branch below.
      const rowsByEvent = await Promise.all(events.map(e => genderBreakdownRows([e._id])));
      const charts = events
        .map((e, i) => rowsByEvent[i].length ? { type: 'donut', title: `Gender Breakdown — ${e.title}`, rows: rowsByEvent[i] } : null)
        .filter(Boolean);
      if (charts.length) return { text: out, charts };
    } else if (events.length > 1) {
      return withChart(out, {
        type: 'bars', title: heading,
        rows: events.map((e, i) => ({ label: e.title, count: counts[i] })),
      });
    }
  }
  return out;
}

// Shared by queryEventAttendanceCount()/queryEventAttendees() — a plain
// "graph/chart" request for one event's attendance defaults to the Present/
// Late/Excused/Absent STATUS breakdown, but naming "gender" (or a bare
// male/female/LGBTQIA+ mention) alongside it means the chart should break
// attendees down by GENDER instead. Added after a live bug: "show me the
// gender breakdown of attendance graph for Annual Career Fair 2026" ignored
// "gender" entirely and returned the exact same status donut a plain
// "attendance graph for X" (no gender mentioned at all) already produces —
// the word was correctly stripped out during event-name extraction (see
// EVENT_NAME_TRIGGER's own connector-skip list) but nothing downstream ever
// looked at what it actually asked FOR. Gender lives on Graduate (linked to
// a User via Graduate.user_id), not on AttendanceLog or User themselves —
// neither of which carries a gender field at all.
const EVENT_GENDER_BREAKDOWN_HINT = /\bgenders?\b|\bmales?\b|\bfemales?\b|\bsex\b|\blgbt\w*\b/i;

// Shared by eventVizResult() (one event) and queryEventAttendanceOverview()
// (every event currently in scope, e.g. "all CCS past events") — aggregates
// attendees' GENDER across however many event ids are passed in. Gender
// lives on Graduate (linked to a User via Graduate.user_id), not on
// AttendanceLog/User themselves.
async function genderBreakdownRows(eventIds) {
  const logs = await AttendanceLog.find({ event_id: { $in: eventIds }, status: { $in: ATTENDED_STATUSES } }).select('alumni_id').lean();
  if (!logs.length) return [];
  const grads = await Graduate.find({ user_id: { $in: logs.map(l => l.alumni_id) } }).select('user_id gender').lean();
  const genderById = {};
  grads.forEach(g => { if (g.user_id) genderById[String(g.user_id)] = g.gender || 'Unspecified'; });
  const counts = {};
  logs.forEach(l => {
    const g = genderById[String(l.alumni_id)] || 'Unspecified';
    counts[g] = (counts[g] || 0) + 1;
  });
  return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

async function eventVizResult(question, eventId, eventTitle, text) {
  if (!VISUALIZATION_REQUEST_PATTERN.test(question)) return { text, eventTitle };

  let rows;
  let title;
  if (EVENT_GENDER_BREAKDOWN_HINT.test(question)) {
    rows = await genderBreakdownRows([eventId]);
    title = `Gender Breakdown — ${eventTitle}`;
  } else {
    // A bare attendance count has nothing of its own to chart — but the
    // full Present/Late/Excused/Absent status breakdown behind it does, and
    // is exactly what "show me a visualization" for this question
    // reasonably means by default. Same on-request wiring as
    // queryCount()/queryRate() elsewhere in this file: only computed when
    // actually asked for, since it's an extra query most attendance-count
    // questions never need.
    rows = await AttendanceLog.aggregate([
      { $match: { event_id: eventId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    title = `Attendance — ${eventTitle}`;
  }
  if (!rows.length) return { text, eventTitle };

  const charted = withChart(text, { type: 'donut', title, rows });
  return typeof charted === 'string'
    ? { text: charted, eventTitle }
    : { text: charted.text, chart: charted.chart, eventTitle };
}

async function queryEventAttendanceCount(question) {
  if (GENERIC_EVENTS_PATTERN.test(question)) return queryEventAttendanceOverview(question);
  const resolved = await resolveEvent(question);
  if (resolved.none) return queryEventOverview(question);
  if (resolved.error) return resolved.error;

  const count = await AttendanceLog.countDocuments({
    event_id: resolved.event._id,
    status: { $in: ATTENDED_STATUSES },
  });
  // eventTitle rides along so suggestFollowUps() can offer contextual
  // "Who attended X?" / "What's the feedback for X?" chips instead of the
  // generic tracer-study defaults or no chips at all.
  const text = `**${count}** alumni attended **${resolved.event.title}**.`;
  return eventVizResult(question, resolved.event._id, resolved.event.title, text);
}

// "list the participants who attended each of the events" — a genuinely
// answerable request (every event just listed), unlike a bare "who
// attended?" with no name at all. Dumping every name from every matching
// event unconditionally risks a wall-of-text reply for a college with many
// events/attendees, so past MAX_GROUP_ATTENDEES total this offers the
// per-event COUNTS instead (same shape queryEventAttendanceOverview()
// already shows) and asks the user to pick one event — the same
// "clarify/guide rather than overload" principle CLARIFY_COLLEGE_QUESTION
// and the multi-match list in resolveEvent() already follow elsewhere in
// this file.
const MAX_GROUP_ATTENDEES = 30;

async function queryEventAttendeesGroup(question) {
  const scopedCollege = getCollegeScope();
  const requestedCollege = extractRequestedCollege(question);
  if (scopedCollege && requestedCollege && requestedCollege !== scopedCollege) {
    return `As a ${scopedCollege} coordinator, you may only access ${scopedCollege}'s events — access to ${requestedCollege} or other colleges' events is not available.`;
  }
  if (!scopedCollege && !requestedCollege && !ALL_COLLEGES_PATTERN.test(question)) {
    return CLARIFY_COLLEGE_QUESTION;
  }
  const college = scopedCollege || requestedCollege;
  const isUpcoming = /\b(upcoming|forthcoming|future|next)\b/i.test(question);
  const isPast     = /\b(past|previous|completed|already\s+(held|happened|occurred)|finished)\b/i.test(question);
  const dateFilter = isUpcoming ? { event_datetime: { $gte: new Date() } }
                    : isPast    ? { event_datetime: { $lt: new Date() } }
                    : {};
  const events = await Event.find({ ...(college ? { college } : {}), ...dateFilter })
    .select('title event_datetime')
    .sort({ event_datetime: -1 })
    .limit(15)
    .lean();
  const scopeLabel = isUpcoming ? 'upcoming ' : isPast ? 'past ' : '';
  if (!events.length) return `No ${scopeLabel}events found${college ? ` for ${college}` : ''}.`;

  const logsByEvent = await Promise.all(events.map(e =>
    AttendanceLog.find({ event_id: e._id, status: { $in: ATTENDED_STATUSES } }).select('alumni_id').lean()
  ));
  const totalAttendees = logsByEvent.reduce((sum, logs) => sum + logs.length, 0);

  if (totalAttendees > MAX_GROUP_ATTENDEES) {
    let out = `There are **${totalAttendees}** participants across these **${events.length}** ${scopeLabel}events${college ? ` for ${college}` : ''} — too many to list all at once. Please ask about one event at a time instead, for example: "Who attended ${events[0].title}?"\n\n`;
    events.forEach((e, i) => { out += `${i + 1}. **${e.title}**: ${logsByEvent[i].length} attended\n`; });
    return out;
  }

  // Small enough to actually name everyone — one alumni lookup across every
  // event combined (not per event) since the same alumnus can legitimately
  // attend more than one event and IDs may repeat across logsByEvent.
  const allAlumniIds = [...new Set(logsByEvent.flat().map(l => String(l.alumni_id)))];
  const users = await User.find({ _id: { $in: allAlumniIds } }).select('firstName lastName').lean();
  const nameById = {};
  users.forEach(u => { nameById[String(u._id)] = `${u.firstName} ${u.lastName}`; });

  let out = `**Participants — ${events.length} ${scopeLabel}events${college ? ` for ${college}` : ''}:**\n\n`;
  events.forEach((e, i) => {
    out += `**${e.title}** (${logsByEvent[i].length} total):\n`;
    if (!logsByEvent[i].length) {
      out += `- No recorded attendees.\n`;
    } else {
      logsByEvent[i].forEach((l, j) => { out += `${j + 1}. ${nameById[String(l.alumni_id)] || 'Unknown Alumni'}\n`; });
    }
    out += '\n';
  });
  return out.trim();
}

// "who attended [training name]" — a natural follow-up right after
// queryTrainingTypes()'s own breakdown list (each bullet's exact text is a
// literal Graduate.trainingType value), but "attended" ALSO satisfies the
// events topic's own bare trigger word, so this question is always tried as
// a real calendar EVENT lookup first (see queryEventAttendees()'s own call
// site) — reached only once that genuinely finds no matching event, trying
// the SAME extracted name against trainingType instead.
async function queryTrainingAttendeesByName(name) {
  if (!name) return null;

  const rows = await Graduate.aggregate([
    ...stablePipeline({}),
    { $match: { trainingType: { $nin: [null, ''] } } },
    { $project: { name: 1, trainingType: 1 } },
  ]);
  if (!rows.length) return null;

  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const queryTokens = normalize(name).split(' ').filter(Boolean);
  // Whole-TOKEN contiguous-run containment, not a raw character substring —
  // a plain `.includes()` on the normalized strings false-positived live: a
  // junk placeholder entry "n/a" (normalizes to "n a") matched inside
  // "desig**n a**nd driving", part of "Visual graphics design and driving"
  // — a completely different, already-legitimately-matched training, purely
  // by character-sequence coincidence at a word boundary neither value
  // actually shares. Requiring the value's tokens to appear as consecutive
  // whole tokens (not mid-word) rules that out, the same word-boundary
  // reasoning skillMatching.js's matchesKeywordLiterally() already applies.
  function containsTokenRun(haystack, needle) {
    if (!needle.length) return false;
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      if (needle.every((t, j) => haystack[i + j] === t)) return true;
    }
    return false;
  }

  // "who attended X and Y" (two training names in one question) can't be
  // split apart by searching for " and " in the typed text — a real
  // training TITLE can itself contain "and" ("Basic and Advance Software
  // Testing Bootcamp"), so there's no reliable position to cut at. Matched
  // against the actual trainingType values ON FILE instead: whichever of
  // those known values' token sequences are themselves contained in the
  // typed text are the ones actually meant — correctly recovers however
  // many real trainings were named, regardless of how many "and"s sit
  // inside vs. between them. Longest-first so a short value can't
  // short-circuit before a longer one that contains it gets a chance.
  const distinctTypes = [...new Set(rows.map(r => r.trainingType.trim()))].sort((a, b) => b.length - a.length);
  const containedTypes = distinctTypes.filter(t => containsTokenRun(queryTokens, normalize(t).split(' ').filter(Boolean)));

  // Fallback for a single paraphrased/partial name that isn't an exact
  // substring of the query text — every word in the typed name must appear
  // somewhere in the value, in any order (mirrors resolveEvent()'s own
  // token-matching approach for event titles).
  let matchedTrainingSet;
  if (containedTypes.length) {
    matchedTrainingSet = new Set(containedTypes);
  } else {
    const tokens = name.split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    const tokenPatterns = tokens.map(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
    matchedTrainingSet = new Set(distinctTypes.filter(t => tokenPatterns.every(re => re.test(t))));
  }
  if (!matchedTrainingSet.size) return null;

  // Grouped by the exact trainingType text (several alumni can share the
  // same phrasing, and a multi-name query now legitimately spans several
  // DIFFERENT trainings) so the answer stays readable instead of one line
  // per person with the training name repeated next to it.
  const byTraining = new Map();
  rows.forEach(r => {
    const key = r.trainingType.trim();
    if (!matchedTrainingSet.has(key)) return;
    if (!byTraining.has(key)) byTraining.set(key, []);
    byTraining.get(key).push(r.name || 'Unknown Alumni');
  });

  let out = `**Alumni who attended training matching "${name}":**\n\n`;
  for (const [training, names] of byTraining) {
    out += `**${training}** (${names.length}):\n`;
    names.forEach((n, i) => { out += `${i + 1}. ${n}\n`; });
    out += '\n';
  }
  return out.trim();
}

async function queryEventAttendees(question) {
  if (isGenericMultiEventRequest(question)) return queryEventAttendeesGroup(question);
  const resolved = await resolveEvent(question);
  if (resolved.none) return queryEventOverview(question);
  if (resolved.error) {
    const trainingAnswer = await queryTrainingAttendeesByName(resolved.name);
    return trainingAnswer || resolved.error;
  }

  const logs = await AttendanceLog.find({
    event_id: resolved.event._id,
    status: { $in: ATTENDED_STATUSES },
  }).select('alumni_id status').lean();
  if (!logs.length) return { text: `No recorded attendees for **${resolved.event.title}**.`, eventTitle: resolved.event.title };

  const users = await User.find({ _id: { $in: logs.map(l => l.alumni_id) } })
    .select('firstName lastName').lean();
  const nameById = {};
  users.forEach(u => { nameById[String(u._id)] = `${u.firstName} ${u.lastName}`; });

  let out = `**Attendees of ${resolved.event.title} (${logs.length} total):**\n\n`;
  logs.forEach((l, i) => {
    out += `${i + 1}. **${nameById[String(l.alumni_id)] || 'Unknown Alumni'}** (${l.status})\n`;
  });

  // A name list has nothing to chart on its own — but the same status/
  // gender breakdown queryEventAttendanceCount() charts on request applies
  // here too, since both answer questions about the same event's
  // AttendanceLog rows.
  return eventVizResult(question, resolved.event._id, resolved.event.title, out);
}

// Same category set feedbackController.getEventFeedbackSummary() uses for the
// coordinator's "View Feedback" modal — kept identical here so the AI
// assistant's numbers never disagree with what the coordinator sees there.
const FEEDBACK_CATEGORY_KEYS = ['organization', 'content', 'venue', 'satisfaction'];

function feedbackAverage(nums) {
  const valid = nums.filter(n => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100;
}

// "which/what event has (the) most/highest feedback" — asking WHICH event,
// not for feedback about one already-named event (that's queryEventFeedback()
// above, via resolveEvent()). No dedicated aggregation existed for this shape
// at all: detectTopic() resolves this to the plain 'events' topic (TOPIC_
// PATTERNS.event_feedback requires "feedback for/on/about/regarding", which
// this phrasing doesn't have), and the events dispatch had no feedback-
// ranking branch either — every "most feedback" question fell all the way to
// queryEventOverview()'s plain event LIST (nothing about feedback counts at
// all), which then got sent to LLM narration anyway (classify() reads bare
// "feedback" as its own qualitative trigger — see EVENT_OR_FEEDBACK_HINT's
// own comment in ragService.js — forcing this through the aggregation hybrid
// path even though queryType itself isn't 'statistical', bypassing the
// raw-list-skips-narration guard there). The LLM was then asked to answer a
// feedback-count question using an event list with zero feedback data in it
// — pure improvisation, confirmed live to give a DIFFERENT hallucinated
// "winner" on separate identical requests to the same question.
// Shared vocabulary fragments for the three event-feedback question shapes
// below (ranking/submitters/count) — kept as raw strings, not full RegExp
// objects, so each pattern can interpolate the pieces it needs into its own
// larger expression instead of duplicating the same typo/Tagalog list three
// times over. "-?\s*" between "feed"/"back" tolerates a stray space/hyphen
// ("feed back", "feed-back"); "fedbacks?"/"feedbaks?"/"feedbcks?" are common
// misspellings observed live, the same casual-typing tolerance
// NAMED_LOOKUP_PATTERN's own comment already applies elsewhere in this file;
// "puna"/"komento" are the natural Tagalog words for written feedback/
// comments, not just a transliteration of "feedback" itself. "-?\s*marami/
// konti" plus the trailing "(?:ng)?" accounts for the Filipino linker
// ("pinakamarami" + noun almost always surfaces as "pinakamaraming X", not
// bare "pinakamarami X").
const FB_WORD     = '(?:feed\\s*-?\\s*backs?|fedbacks?|feedbaks?|feedbcks?|puna|komento)';
const EVT_WORD     = '(?:events?|kaganapan)';
const MOST_WORD    = '(?:most|highest|top|pinaka-?\\s*marami(?:ng)?)';
const LEAST_WORD   = '(?:least|lowest|fewest|pinaka-?\\s*konti(?:ng)?|kaunti(?:ng)?)';
const HOWMANY_WORD = '(?:how\\s+many|number\\s+of|count\\s+of|total(?:\\s+number\\s+of)?|ilan(?:g)?)';
const WHO_WORD     = '(?:who|sino)';
const SUBMIT_WORD  = '(?:submi\\w*|gave|left|wrote|provided|posted|nagbigay|nagpost|sumulat|nagsulat|nagsumite|nag-?sumite)';

// "which/what event has (the) most/highest feedback" — asking WHICH event,
// not for feedback about one already-named event (that's queryEventFeedback()
// above, via resolveEvent()). No dedicated aggregation existed for this shape
// at all: detectTopic() resolves this to the plain 'events' topic (TOPIC_
// PATTERNS.event_feedback requires "feedback for/on/about/regarding", which
// this phrasing doesn't have), and the events dispatch had no feedback-
// ranking branch either — every "most feedback" question fell all the way to
// queryEventOverview()'s plain event LIST (nothing about feedback counts at
// all), which then got sent to LLM narration anyway (classify() reads bare
// "feedback" as its own qualitative trigger — see EVENT_OR_FEEDBACK_HINT's
// own comment in ragService.js — forcing this through the aggregation hybrid
// path even though queryType itself isn't 'statistical', bypassing the
// raw-list-skips-narration guard there). The LLM was then asked to answer a
// feedback-count question using an event list with zero feedback data in it
// — pure improvisation, confirmed live to give a DIFFERENT hallucinated
// "winner" on separate identical requests to the same question.
// ".{0,15}" between the question word and EVT_WORD tolerates a Tagalog
// filler ("alin SA MGA event", not just adjacent "alin event").
const EVENT_FEEDBACK_RANKING_PATTERN = new RegExp(
  `\\b(?:which|what|alin|anong|aling)\\b.{0,15}\\b${EVT_WORD}\\b.{0,40}\\b(?:${MOST_WORD}|${LEAST_WORD})\\b.{0,20}\\b${FB_WORD}\\b` +
  `|\\b${FB_WORD}\\b.{0,20}\\b(?:${MOST_WORD}|${LEAST_WORD})\\b` +
  `|\\brank(?:ing)?\\s+(?:of\\s+)?${EVT_WORD}\\s+by\\s+${FB_WORD}\\b`,
  'i'
);

async function queryEventFeedbackRanking(question) {
  const scopedCollege = getCollegeScope();
  const requestedCollege = extractRequestedCollege(question);
  if (scopedCollege && requestedCollege && requestedCollege !== scopedCollege) {
    return `As a ${scopedCollege} coordinator, you may only access ${scopedCollege}'s events — access to ${requestedCollege} or other colleges' events is not available.`;
  }
  if (!scopedCollege && !requestedCollege && !ALL_COLLEGES_PATTERN.test(question)) {
    return CLARIFY_COLLEGE_QUESTION;
  }
  const college = scopedCollege || requestedCollege;
  // Same isUpcoming/isPast narrowing queryEventOverview()/queryEventAttendance
  // Overview() already support — "how many feedback did the PAST events
  // receive" (a MANY-events subset, not literally every event on file)
  // needs the same date scoping those two already apply, not just an
  // unscoped ALL-events ranking every time.
  const isUpcoming = /\b(upcoming|forthcoming|future|next|susunod|paparating)\b/i.test(question);
  const isPast     = /\b(past|previous|completed|already\s+(held|happened|occurred)|finished|nakaraan|nakalipas)\b/i.test(question);
  const dateFilter = isUpcoming ? { event_datetime: { $gte: new Date() } }
                    : isPast    ? { event_datetime: { $lt: new Date() } }
                    : {};
  const scopeLabel = isUpcoming ? 'upcoming ' : isPast ? 'past ' : '';
  const events = await Event.find({ ...(college ? { college } : {}), ...dateFilter }).select('title').lean();
  if (!events.length) return `No ${scopeLabel}events found${college ? ` for ${college}` : ''}.`;

  const feedbackCounts = await EventFeedback.aggregate([
    { $match: { event_id: { $in: events.map(e => e._id) } } },
    { $group: { _id: '$event_id', count: { $sum: 1 } } },
  ]);
  const countByEventId = {};
  feedbackCounts.forEach(f => { countByEventId[String(f._id)] = f.count; });
  const rows = events.map(e => ({ label: e.title, count: countByEventId[String(e._id)] || 0 }));
  const totalFeedback = rows.reduce((s, r) => s + r.count, 0);
  if (totalFeedback === 0) return `No feedback has been submitted for any ${scopeLabel}event${college ? ` for ${college}` : ''} yet.`;

  const wantsLeast = new RegExp(`\\b${LEAST_WORD}\\b`, 'i').test(question);
  const sorted = [...rows].sort((a, b) => wantsLeast ? a.count - b.count : b.count - a.count);
  const top = sorted[0];
  // A bare "how many feedback did the past events receive" (no most/least
  // superlative — that's queryEventFeedbackCount()'s own GENERIC_EVENTS_
  // PATTERN fallback into this function) reads oddly with a "received the
  // most/least" headline for what's really just a per-event total request —
  // only the genuine ranking questions (this function's own dispatch
  // trigger, EVENT_FEEDBACK_RANKING_PATTERN) get that framing; a plain
  // count-style entry point states the combined total instead.
  const isRankingQuestion = EVENT_FEEDBACK_RANKING_PATTERN.test(question);
  let out = isRankingQuestion
    ? `**${top.label}** received the ${wantsLeast ? 'least' : 'most'} feedback${college ? ` among ${college}'s events` : ''}, with **${top.count}** feedback response${top.count !== 1 ? 's' : ''}.\n\n`
    : `**${totalFeedback}** feedback response${totalFeedback !== 1 ? 's' : ''} ${totalFeedback === 1 ? 'has' : 'have'} been received across **${events.length}** ${scopeLabel}event${events.length !== 1 ? 's' : ''}${college ? ` for ${college}` : ''}:\n\n`;
  sorted.forEach((r, i) => { out += `${i + 1}. **${r.label}**: ${r.count} response${r.count !== 1 ? 's' : ''}\n`; });

  if (VISUALIZATION_REQUEST_PATTERN.test(question) && sorted.length > 1) {
    return withChart(out, { type: 'bars', title: `Event Feedback${college ? ` for ${college}` : ''}`, rows: sorted });
  }
  return out;
}

// "who submitted feedback in that event?" / "who gave feedback for X?" — WHO
// left feedback, not the feedback CONTENT itself (queryEventFeedback() above
// answers ratings/comments for a named event, but never names who submitted
// them). No dedicated lookup existed for this at all before, so it fell to
// the same queryEventOverview() plain-event-list fallback every other
// unmatched event question does, and the LLM was asked to name a specific
// person from a list that names no people — confirmed live fabricating a
// made-up "John Doe, Software Engineer at Google" out of nothing.
//
// ragService.js's resolveEventReferent() already substitutes a bare "that
// event"/"this event" reference with the real title text (read from the
// assistant's own previous reply) before this ever runs, so the real title
// is normally already sitting in `question` literally. Matched by direct
// substring/token search against every real event title instead of going
// through extractEventName()/resolveEvent() first — this function's own
// trigger (EVENT_FEEDBACK_SUBMITTERS_PATTERN below) doesn't share
// EVENT_NAME_TRIGGER's "attend*/about/for/of" lead-in requirement at all
// ("who submitted feedback IN X" has none of those), so that extraction
// would simply fail to find a name even once the real title is present.
// SUBMIT_WORD's "submi\w*" (not the literal word "submitted") tolerates
// typos like "submiited" (a real live miss: "who submiited feedback in the
// event..." didn't match the literal spelling at all and fell through to
// the plain event-list fallback instead of this function), same casual-
// typing tolerance NAMED_LOOKUP_PATTERN's own comment already applies
// elsewhere in this file. WHO_WORD ("who"/"sino") plus SUBMIT_WORD's own
// Tagalog verbs (nagbigay/nagpost/sumulat/nagsulat) already cover "sino ang
// nagbigay ng feedback/puna" without a separate Tagalog-only branch.
const EVENT_FEEDBACK_SUBMITTERS_PATTERN = new RegExp(
  `\\b${WHO_WORD}\\b.{0,25}\\b${SUBMIT_WORD}\\b.{0,15}\\b${FB_WORD}\\b` +
  `|\\b${FB_WORD}\\b.{0,15}\\b(?:submi\\w*|given|left|posted|nabigay|naisumite)\\b.{0,10}\\b(?:by|ni|nina)\\b`,
  'i'
);

async function feedbackSubmittersForEvent(event) {
  const responses = await EventFeedback.find({ event_id: event._id }).select('alumni_id').lean();
  if (!responses.length) return { text: `No feedback has been submitted yet for **${event.title}**.`, eventTitle: event.title };

  const users = await User.find({ _id: { $in: responses.map(r => r.alumni_id) } }).select('firstName lastName').lean();
  const nameById = {};
  users.forEach(u => { nameById[String(u._id)] = `${u.firstName} ${u.lastName}`; });

  const who = responses.length === 1 ? 'alumnus' : 'alumni';
  let out = `**Feedback for ${event.title}** was submitted by **${responses.length}** ${who}:\n\n`;
  responses.forEach((r, i) => { out += `${i + 1}. ${nameById[String(r.alumni_id)] || 'Unknown Alumni'}\n`; });
  return { text: out, eventTitle: event.title };
}

async function queryEventFeedbackSubmitters(question) {
  const college = getCollegeScope();
  const events = await Event.find(college ? { college } : {}).select('title').lean();
  const named = events.find(e => question.toLowerCase().includes(e.title.toLowerCase()));
  if (named) return feedbackSubmittersForEvent(named);

  // Fall back to the normal trigger-word extraction path in case the
  // question DID use a recognized lead-in ("feedback FOR X") the direct
  // substring search above missed (e.g. a partial or misspelled title).
  const resolved = await resolveEvent(question);
  if (resolved.none) return queryEventOverview(question);
  if (resolved.error) return resolved.error;
  return feedbackSubmittersForEvent(resolved.event);
}

// "how many feedback that the event has received?" — a COUNT for one
// (named or referred) event, distinct from queryEventFeedback() above (full
// ratings/comments detail) and queryEventFeedbackRanking() (compares across
// every event). HOWMANY_WORD's "ilan(g)" covers the same lead-in queryCount()
// elsewhere in this file already recognizes for other subjects, in Tagalog.
const EVENT_FEEDBACK_COUNT_PATTERN = new RegExp(
  `\\b${HOWMANY_WORD}\\b.{0,25}\\b${FB_WORD}\\b` +
  `|\\b${FB_WORD}\\b.{0,25}\\b(?:received|submitted|count|total|natanggap|nabigay|naisumite)\\b`,
  'i'
);

async function queryEventFeedbackCount(question) {
  // "how many feedback did all/past/upcoming events receive" — a MANY-events
  // subset, not one specific event at all. Checked BEFORE the single-event
  // resolution below (same order queryEventAttendanceCount() already uses
  // for the equivalent attendance question) — without this, "past events"
  // got handed to resolveEvent() as if it were one literal (if unmatchable)
  // event title.
  if (GENERIC_EVENTS_PATTERN.test(question)) return queryEventFeedbackRanking(question);

  const college = getCollegeScope();
  const events = await Event.find(college ? { college } : {}).select('title').lean();
  let event = events.find(e => question.toLowerCase().includes(e.title.toLowerCase()));
  if (!event) {
    const resolved = await resolveEvent(question);
    if (resolved.error) return resolved.error;
    event = resolved.event || null;
  }
  // No specific event named or resolvable from context ("how many feedback
  // is there?" with nothing else to go on) — a full per-event ranking
  // breakdown answers this more usefully than the generic plain event list
  // every other unmatched event question falls back to.
  if (!event) return queryEventFeedbackRanking(question);

  const count = await EventFeedback.countDocuments({ event_id: event._id });
  return {
    text: `**${count}** feedback response${count !== 1 ? 's' : ''} ${count === 1 ? 'has' : 'have'} been received for **${event.title}**.`,
    eventTitle: event.title,
  };
}

async function queryEventFeedback(question) {
  const resolved = await resolveEvent(question);
  if (resolved.none) return queryEventOverview(question);
  if (resolved.error) return resolved.error;

  const [totalAttendees, responses] = await Promise.all([
    AttendanceLog.countDocuments({ event_id: resolved.event._id }),
    EventFeedback.find({ event_id: resolved.event._id }).lean(),
  ]);
  if (!responses.length) return { text: `No feedback has been submitted yet for **${resolved.event.title}**.`, eventTitle: resolved.event.title };

  const avgRating = feedbackAverage(responses.map(r => r.rating));
  let out = `**Feedback for ${resolved.event.title}:**\n\n`;
  out += `- **Average rating:** ${avgRating}/5\n`;
  out += `- **Responses:** ${responses.length} of ${totalAttendees} attendees (${pct(responses.length, totalAttendees)})\n`;

  const categoryAverages = FEEDBACK_CATEGORY_KEYS
    .map(key => ({ _id: toTitleCase(key), count: feedbackAverage(responses.map(r => r.ratings?.[key])) }))
    .filter(r => r.count !== null);
  if (categoryAverages.length) {
    out += `\n**Category averages:**\n${categoryAverages.map(r => `- ${r._id}: ${r.count}/5`).join('\n')}\n`;
  }

  const comments = responses.filter(r => r.feedback && r.feedback.trim()).slice(0, 5);
  if (comments.length) {
    out += `\n**Sample comments:**\n`;
    comments.forEach((c, i) => { out += `${i + 1}. "${cleanText(c.feedback)}"\n`; });
  }
  // 2+ categories with data reads as a genuine comparison worth charting —
  // a single category (or none) is either just the overall average already
  // stated above, or nothing to compare at all.
  const charted = categoryAverages.length > 1
    ? withChart(out, { type: 'bars', title: 'Feedback Category Averages (out of 5)', rows: categoryAverages })
    : out;
  const { text, chart } = typeof charted === 'string' ? { text: charted, chart: null } : charted;
  return { text, eventTitle: resolved.event.title, chart };
}

// chartTitle: set by the 'rate' dispatcher (see its own VISUALIZATION_REQUEST_
// PATTERN check) when the question explicitly asks for a visualization —
// null/omitted otherwise, since this is normally a single derived percentage
// with no chart of its own. Same on-request wiring as queryRate()'s own
// wantsChart param just above; every querySimpleRate() call site answers a
// yes/no-shaped question (took the exam, pursued further studies, works
// locally, etc.), so a plain matched/unmatched donut fits every caller alike
// without needing a caller-specific chart shape.
// Years-in-current-job tenure brackets, ordered lowest to highest, each with
// its own MINIMUM threshold in years — Graduate.yearsInJob stores one of
// these six exact string labels (confirmed live against the real database),
// never a raw number, so a threshold question ("2 years or longer," "less
// than 1 year") has to resolve against this ordered list, not a numeric
// comparison.
const YEARS_IN_JOB_BRACKETS = [
  { label: 'Less than 6 months', min: 0 },
  { label: '6 months to 1 year', min: 0.5 },
  { label: '1 to 2 years',       min: 1 },
  { label: '2 to 3 years',       min: 2 },
  { label: '3 to 5 years',       min: 3 },
  { label: 'More than 5 years',  min: 5 },
];

// "...in their current job for 2 to 3 years or longer" / "at least 2 years"
// / "2+ years" / "less than 1 year" — resolves a stated threshold to the SET
// of real stored brackets that qualify, since the field is bracketed text,
// not a number ("2 to 3 years or longer" means the "2 to 3 years" bracket
// AND every bracket above it). Deliberately conservative: only recognizes
// these specific phrasings — an unrecognized/ambiguous threshold returns
// null rather than guessing which brackets were meant.
function extractYearsInJobThreshold(question) {
  const atLeastMatch = question.match(/\b(\d+)\s*(?:to\s*\d+\s*)?years?\s+or\s+(?:longer|more)\b|\bat\s+least\s+(\d+)\s+years?\b|\b(\d+)\+\s*years?\b/i);
  if (atLeastMatch) {
    const years = parseInt(atLeastMatch[1] || atLeastMatch[2] || atLeastMatch[3], 10);
    return { direction: 'atLeast', years, brackets: YEARS_IN_JOB_BRACKETS.filter(b => b.min >= years) };
  }
  const lessThanMatch = question.match(/\bless\s+than\s+(\d+)\s+years?\b/i);
  if (lessThanMatch) {
    const years = parseInt(lessThanMatch[1], 10);
    return { direction: 'lessThan', years, brackets: YEARS_IN_JOB_BRACKETS.filter(b => b.min < years) };
  }
  // A SINGLE bracket named directly, with no "or longer"/"at least"/"+"
  // open-ended qualifier at all ("...for 3 to 5 years?", "6 months to 1
  // year in their current job") — the simplest, most literal tenure
  // question shape, and genuinely common (most people naming one exact
  // bracket aren't also implying "and everything above it"). Reuses
  // extractMentionedYearsInJobBrackets() (see its own comment) — when it
  // finds exactly one real bracket label, that IS the whole answer; 2+ is
  // a comparison instead (handled separately, before this function is ever
  // called — see queryInner()'s own mentionedTenureBrackets check).
  const singleBracket = extractMentionedYearsInJobBrackets(question);
  if (singleBracket.length === 1) {
    return { direction: 'exact', years: null, brackets: singleBracket };
  }
  return null;
}

// "years in (their/current) job" / "job tenure" — explicit vocabulary for
// HOW LONG someone has been in their CURRENT role, a completely different
// metric from employment rate. TOPIC_PATTERNS.rate's own bare "percentage"+
// "employed" words matched this question first (same first-match-wins
// collision class documented throughout this file — "Show me the percentage
// of Computer Science graduates who are currently employed..." was the
// identical shape, just for a different metric). Checked explicitly in the
// 'rate' dispatch arm (queryInner(), below) before any of the generic
// employment-rate branches, same fix shape as that earlier case.
// "role(s)"/"position(s)" added alongside "job(s)" — "stayed in their
// current ROLE for 1 to 2 years" is just as natural a way to ask this as
// "...current JOB...", and the original job-only wording missed it entirely.
// "stayed/remained/been (in)" added alongside the bare "years in" framing —
// "how long have alumni STAYED in their current role" is a common phrasing
// this pattern didn't cover.
// "been WITH their COMPANY for 3 to 5 years" added — a different, equally
// natural way to ask about tenure (describing the EMPLOYER relationship
// rather than the job/role itself), not covered by any of the "in their
// (current) job/role/position" phrasings above. Caught live: "How many
// Regular/Permanent employees have been with their company for 3 to 5
// years?" matched none of the existing alternatives, so the tenure half of
// the question was silently dropped and it answered the unrelated overall
// Employed/Unemployed breakdown instead.
const YEARS_IN_JOB_CONTEXT_PATTERN = /\byears?\s+in\s+(?:their|his|her|the|current|present)?\s*(?:current\s+)?(?:jobs?|roles?|positions?)\b|\b(?:in|stayed?|remain(?:ed)?)\s+(?:their|his|her|the)\s+(?:current|present)\s+(?:jobs?|roles?|positions?)\s+for\b|\b(?:job|role|position)\s+tenure\b|\btenure\s+(?:in|at)\s+(?:their|his|her|the|current)\s+(?:jobs?|roles?|positions?)\b|\bbeen\s+with\s+(?:their|his|her|the)\s+(?:company|employer|organization)\s+for\b/i;

// "...for less than 6 months compared to those with 3 to 5 years OR more
// than 5 years of tenure" — names 2+ DISTINCT tenure brackets explicitly by
// their own real stored label, a side-by-side comparison rather than a
// single "X years or longer/less than Y" threshold (extractYearsInJobThreshold()
// above only ever resolves ONE side of a question like that). Matches each
// bracket's own literal, distinctive phrase directly against the question
// text — deliberately NOT grouped into "the 3+ years side" vs "the under-6-
// months side" the way the question's own "compared to" framing implies,
// since guessing how the user meant to GROUP multiple named brackets
// together is exactly the kind of invented structure this app's "don't
// guess" principle exists to avoid; showing every individually-named
// bracket's own real count side by side answers the same underlying
// question honestly without assuming a specific grouping.
function extractMentionedYearsInJobBrackets(question) {
  return YEARS_IN_JOB_BRACKETS.filter((b) => {
    const pat = new RegExp('\\b' + b.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '\\b', 'i');
    return pat.test(question);
  });
}

// Shared "respondents" denominator shape with countYearsInJobMatches() below
// — a bracket-vs-bracket comparison still needs the SAME "employed alumni
// who reported a tenure bracket at all" population as the single-threshold
// case, not stablePipeline()'s whole cohort.
async function queryYearsInJobBracketsCompare(filters, brackets) {
  const base = stablePipeline(filters);
  const respondentMatch = { employmentStatus: { $regex: '^(?:yes|self.?employed)', $options: 'i' }, yearsInJob: { $nin: [null, ''] } };
  const [totalRows, ...bracketRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: respondentMatch }, { $count: 'total' }]),
    ...brackets.map((b) => Graduate.aggregate([...base, { $match: { ...respondentMatch, yearsInJob: b.label } }, { $count: 'total' }])),
  ]);
  const total = totalRows[0]?.total ?? 0;
  if (total === 0) return null;
  const lbl = filterLabel(filters);
  let out = `**Job tenure comparison${lbl}:**\n\n`;
  const chartRows = [];
  brackets.forEach((b, i) => {
    const count = bracketRows[i][0]?.total ?? 0;
    out += `- **${b.label}**: ${count} (${pct(count, total)})\n`;
    chartRows.push({ _id: b.label, count });
  });
  out += `\nOut of **${total}** respondents who reported their job tenure.`;
  return withChart(out, { type: 'bars', title: 'Job Tenure Comparison', rows: chartRows });
}

// Shared by queryYearsInJobRate() (a percentage) and queryYearsInJobCount()
// (a raw headcount, "how many..." phrasing) just below — same underlying
// question, two different answer shapes, same denominator/numerator query.
async function countYearsInJobMatches(filters, threshold) {
  const base = stablePipeline(filters);
  // Respondents = employed alumni who actually reported a tenure bracket —
  // not stablePipeline()'s whole cohort, which would otherwise dilute the
  // percentage against unemployed alumni who structurally have no "current
  // job" tenure to report at all (same "respondents, not everyone"
  // denominator queryJobRelevance()/queryEmploymentStatusRate() already use,
  // see their own comments just below).
  const respondentMatch = { employmentStatus: { $regex: '^(?:yes|self.?employed)', $options: 'i' }, yearsInJob: { $nin: [null, ''] } };
  const [totalRows, matchRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: respondentMatch }, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: { ...respondentMatch, yearsInJob: { $in: threshold.brackets.map(b => b.label) } } }, { $count: 'total' }]),
  ]);
  return { total: totalRows[0]?.total ?? 0, matched: matchRows[0]?.total ?? 0 };
}

function yearsInJobThresholdDesc(threshold) {
  if (threshold.direction === 'exact') return threshold.brackets[0].label.toLowerCase();
  const yearWord = threshold.years === 1 ? 'year' : 'years';
  return threshold.direction === 'atLeast' ? `${threshold.years}+ ${yearWord}` : `less than ${threshold.years} ${yearWord}`;
}

async function queryYearsInJobRate(filters, threshold) {
  const { total, matched } = await countYearsInJobMatches(filters, threshold);
  if (total === 0) return null;
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const desc = yearsInJobThresholdDesc(threshold);
  const text = `**${pct(matched, total)}** of ${gPrefix}employed graduates${lbl} have been in their current job for **${desc}** (${matched} out of ${total} respondents).`;
  const chartRows = [
    { _id: desc, count: matched },
    { _id: 'Less time', count: total - matched },
  ].filter(r => r.count > 0);
  return withChart(text, { type: 'donut', title: 'Tenure in Current Job', rows: chartRows });
}

// "How many employed graduates have been in their current job for 2 to 3
// years or longer?" — the exact same tenure question as queryYearsInJobRate()
// just above, just asked as a headcount instead of a percentage. Without
// this, "how many" phrasing fell through to 'count' topic's own dispatch,
// which has no concept of yearsInJob at all, and silently answered the bare
// employed-alumni total (184) instead — caught live right after the
// "percentage" phrasing of the identical question was fixed, confirming the
// gap was topic-specific (queryInner()'s 'rate' dispatch arm had the check,
// 'count' did not).
async function queryYearsInJobCount(filters, threshold) {
  const { total, matched } = await countYearsInJobMatches(filters, threshold);
  if (total === 0) return null;
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const desc = yearsInJobThresholdDesc(threshold);
  return `There are **${matched}** ${gPrefix}employed graduates${lbl} who have been in their current job for **${desc}** (out of ${total} respondents who reported their job tenure).`;
}

// "What is the AVERAGE job tenure for BSIT - Web and Mobile Application
// graduates?" — Graduate.yearsInJob is a bracketed RANGE string (confirmed
// live — see YEARS_IN_JOB_BRACKETS' own comment), not a number, so there is
// no literal numeric average to compute. Answers honestly with the MOST
// COMMON bracket (the closest real meaning of "average"/"typical" this
// categorical data actually supports) plus the full breakdown, rather than
// fabricating a number or declining outright — same "closest available,
// clearly labeled" philosophy this file uses elsewhere (e.g. the "full-time"
// -> Regular/Permanent substitution).
async function queryYearsInJobDistribution(filters) {
  const base = stablePipeline(filters);
  const respondentMatch = { employmentStatus: { $regex: '^(?:yes|self.?employed)', $options: 'i' }, yearsInJob: { $nin: [null, ''] } };
  const rows = await Graduate.aggregate([...base, { $match: respondentMatch }, { $group: { _id: '$yearsInJob', count: { $sum: 1 } } }]);
  if (!rows.length) return null;
  const byLabel = new Map(rows.map((r) => [r._id, r.count]));
  const ordered = YEARS_IN_JOB_BRACKETS.map((b) => ({ label: b.label, count: byLabel.get(b.label) || 0 }));
  const total = ordered.reduce((s, r) => s + r.count, 0);
  const top = [...ordered].sort((a, b) => b.count - a.count)[0];
  const lbl = filterLabel(filters);
  let out = `There is no single numeric "average" for job tenure — the tracer study records it as a range, not a number. The most common tenure bracket${lbl} is **${top.label}**, reported by **${top.count}** out of ${total} respondents (${pct(top.count, total)}).\n\n**Job tenure breakdown${lbl}:**\n\n`;
  ordered.forEach((r) => { out += `- **${r.label}**: ${r.count} (${pct(r.count, total)})\n`; });
  const chartRows = ordered.filter((r) => r.count > 0).map((r) => ({ _id: r.label, count: r.count }));
  return withChart(out, { type: 'bars', title: 'Job Tenure Distribution', rows: chartRows });
}

async function querySimpleRate(filters, matchStage, label, chartTitle = null) {
  const base = stablePipeline(filters);
  const [totalRows, matchRows] = await Promise.all([
    Graduate.aggregate([...base, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: matchStage }, { $count: 'total' }]),
  ]);
  const total   = totalRows[0]?.total ?? 0;
  const matched = matchRows[0]?.total ?? 0;
  if (total === 0) return null;
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const text = `**${pct(matched, total)}** of ${gPrefix}graduates ${label}${lbl} (${matched} out of ${total}).`;
  if (!chartTitle) return text;
  const chartRows = [
    { _id: 'Yes', count: matched },
    { _id: 'No', count: total - matched },
  ].filter(r => r.count > 0);
  return withChart(text, { type: 'donut', title: chartTitle, rows: chartRows });
}

// "What percentage of alumni have jobs related to their degree" needs the
// SAME "respondents" denominator queryJobRelevance()'s own breakdown already
// uses (jobRelated actually recorded — 216, not all 702 graduates). Job-
// relatedness only makes sense for someone WITH a job, so most of the gap
// between 216 and 702 is unemployed alumni the question was never
// applicable to in the first place, not people who said "unrelated." Reusing
// the generic querySimpleRate() here (like queryExamPassRate() above
// correctly avoids for board-exam pass rate) would divide by the full
// population instead, silently deflating the answer — caught live: "25.6%
// (180 out of 702)" when the real figure against actual respondents is
// "83.3% (180 out of 216)".
async function queryJobRelatedRate(filters, matchStage, label, chartTitle = null) {
  const base = stablePipeline(filters);
  const [totalRows, matchRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: { jobRelated: { $nin: [null, ''] } } }, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: matchStage }, { $count: 'total' }]),
  ]);
  const total   = totalRows[0]?.total ?? 0;
  const matched = matchRows[0]?.total ?? 0;
  if (total === 0) return null;
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const text = `**${pct(matched, total)}** of ${gPrefix}graduates ${label}${lbl} (${matched} out of ${total} respondents).`;
  if (!chartTitle) return text;
  const chartRows = [
    { _id: 'Yes', count: matched },
    { _id: 'No', count: total - matched },
  ].filter(r => r.count > 0);
  return withChart(text, { type: 'donut', title: chartTitle, rows: chartRows });
}

// Every job-relatedness level actually mentioned, for "directly related
// VERSUS somewhat related"-style comparisons — the single-level
// filters.jobRelated extraction elsewhere in this file only ever keeps the
// first/dominant one, same shape as extractAllRatingLevels() above for
// competency ratings.
function extractAllJobRelatedLevels(text) {
  const found = [];
  if (/\bdirectly\s+related\b/i.test(text)) found.push('directly');
  if (/\bsomewhat\s+related\b/i.test(text)) found.push('somewhat');
  if (/\b(?:not\s+related|unrelated)\b/i.test(text)) found.push('no');
  return found;
}
const JOB_RELATED_LABEL = { directly: 'Directly Related', somewhat: 'Somewhat Related', no: 'Not Related' };
function jobRelatedMatchStage(level) {
  if (level === 'directly') return { $and: [{ jobRelated: { $regex: '^yes', $options: 'i' } }, { jobRelated: { $not: { $regex: 'somewhat', $options: 'i' } } }] };
  if (level === 'somewhat') return { jobRelated: { $regex: 'somewhat', $options: 'i' } };
  return { jobRelated: { $regex: '^no', $options: 'i' } };
}

// "...reported that their job is 'directly related' versus 'somewhat
// related' to their degree" — 2+ job-relatedness levels named for
// comparison, same shape/reasoning as queryCompetencyRatingCompare() and
// queryYearsInJobBracketsCompare() above. Checked as an early bypass in
// queryInner() (alongside queryCompare()'s own "compare/vs/versus" trigger)
// rather than wired into each topic's own dispatch arm individually — this
// question's own topic can land on 'count'/'names'/'job_relevance'
// depending on exactly what else it names, and re-duplicating the same
// check into every one of those arms (the way the tenure/competency
// comparisons above had to be, since they were built before this pattern
// was established) doesn't scale cleanly to a 4th+ comparable field.
async function queryJobRelatedCompare(filters, levels) {
  const base = stablePipeline({ ...filters, jobRelated: undefined });
  const [totalRows, ...levelRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: { jobRelated: { $nin: [null, ''] } } }, { $count: 'total' }]),
    ...levels.map((lvl) => Graduate.aggregate([...base, { $match: jobRelatedMatchStage(lvl) }, { $count: 'total' }])),
  ]);
  const total = totalRows[0]?.total ?? 0;
  if (total === 0) return null;
  const lbl = filterLabel({ ...filters, jobRelated: undefined });
  let out = `**Job relevance comparison${lbl}:**\n\n`;
  const chartRows = [];
  levels.forEach((lvl, i) => {
    const count = levelRows[i][0]?.total ?? 0;
    out += `- **${JOB_RELATED_LABEL[lvl]}**: ${count} (${pct(count, total)})\n`;
    chartRows.push({ _id: JOB_RELATED_LABEL[lvl], count });
  });
  return withChart(out, { type: 'bars', title: 'Job Relevance Comparison', rows: chartRows });
}

// Percentage of exam-takers who passed or failed (denominator = those who took the exam, not all graduates)
// wantsChart: same on-request wiring as queryRate()/querySimpleRate() above.
async function queryExamPassRate(filters, resultType, wantsChart = false) {
  const base = stablePipeline(filters);
  const [tookRows, resultRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: { tookExam: { $regex: '^yes', $options: 'i' } } }, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: tookExamMatch(resultType) }, { $count: 'total' }]),
  ]);
  const took   = tookRows[0]?.total ?? 0;
  const result = resultRows[0]?.total ?? 0;
  if (took === 0) return null;
  const lbl    = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const verb   = resultType === 'passed' ? 'passed' : 'failed';
  const text = `**${pct(result, took)}** of ${gPrefix}exam takers ${verb} the board/licensure exam${lbl} (${result} out of ${took} who took the exam).`;
  if (!wantsChart) return text;
  const passed = resultType === 'passed' ? result : took - result;
  const chartRows = [
    { _id: 'Passed', count: passed },
    { _id: 'Failed', count: took - passed },
  ].filter(r => r.count > 0);
  return withChart(text, { type: 'donut', title: 'Board/Licensure Exam Results', rows: chartRows });
}

// Raw numbers behind the employment rate, shared by queryRate() (single-
// cohort prose below) and queryCompare() (two-cohort side-by-side, further
// down this file) — factored out so the comparison path reuses the exact
// same aggregate/math instead of a 3rd hand-copy of it.
async function computeEmploymentRate(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _status: { $trim: { input: '$employmentStatus' } } } },
    { $group: { _id: '$_status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;

  const total   = rows.reduce((s, r) => s + r.count, 0);
  const formal  = rows.filter(r => YES_RE.test(r._id) || /^employed$/i.test(r._id))
                      .reduce((s, r) => s + r.count, 0);
  const selfEmp = rows.filter(r => /^self.?employed$/i.test(r._id))
                      .reduce((s, r) => s + r.count, 0);
  const employed = filters.excludeSelfEmployed ? formal : formal + selfEmp;
  return { total, formal, selfEmp, employed };
}

// A single-status percentage ("what percentage are self-employed") needs the
// SAME denominator queryRate()/computeEmploymentRate() use above —
// "respondents" meaning graduates with an employmentStatus actually
// recorded, not every graduate matching filters. Reusing the generic
// querySimpleRate() here would silently swap in a bigger denominator (every
// filtered graduate, including those with no tracer submission at all yet),
// making this percentage's "out of N" visibly disagree with the overall
// employment rate's "out of N respondents" for the exact same cohort.
async function queryEmploymentStatusRate(filters, statusRegex, label, chartTitle = null) {
  const base = stablePipeline(filters);
  const [totalRows, matchRows] = await Promise.all([
    Graduate.aggregate([...base, { $match: { employmentStatus: { $nin: [null, ''] } } }, { $count: 'total' }]),
    Graduate.aggregate([...base, { $match: { employmentStatus: { $regex: statusRegex, $options: 'i' } } }, { $count: 'total' }]),
  ]);
  const total   = totalRows[0]?.total ?? 0;
  const matched = matchRows[0]?.total ?? 0;
  if (total === 0) return null;
  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  const text = `**${pct(matched, total)}** of ${gPrefix}graduates ${label}${lbl} (${matched} out of ${total} respondents).`;
  if (!chartTitle) return text;
  const chartRows = [
    { _id: 'Yes', count: matched },
    { _id: 'No', count: total - matched },
  ].filter(r => r.count > 0);
  return withChart(text, { type: 'donut', title: chartTitle, rows: chartRows });
}

// asUnemployment: the question asked for the UNemployment rate specifically
// ("unemployment rate of alumni") — set by the 'rate' dispatcher checking
// for "unemploy(ed/ment)" in the raw question text. Without this, every
// call here answered with employment-rate phrasing regardless of which one
// was actually asked; worse, before the 'rate' TOPIC_PATTERNS fix (see its
// own comment), "unemployment rate" didn't even reach this function at all
// — the \b word-boundary before "employment rate" can't match mid-word, so
// it silently fell through detectTopic() with no topic and surfaced the
// generic "I don't have enough data" refusal instead of an answer.
// wantsChart: set by the 'rate' dispatcher when the question explicitly
// asks for a visualization/chart/graph (VISUALIZATION_REQUEST_PATTERN) —
// this is otherwise a single derived percentage with no natural chart of
// its own, so "show me the visualization of alumni employment rate" used
// to answer with plain text and no chart at all, ignoring half the request.
async function queryRate(filters, asUnemployment = false, wantsChart = false) {
  const stats = await computeEmploymentRate(filters);
  if (!stats) return null;
  const { total, formal, selfEmp, employed } = stats;
  const unemployed = total - employed;

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);

  if (asUnemployment) {
    const text = `The unemployment rate of ${gPrefix}graduates${lbl} is **${pct(unemployed, total)}** (${unemployed} out of ${total} respondents not currently employed or self-employed).`;
    if (!wantsChart) return text;
    const chartRows = [
      { _id: 'Employed', count: employed },
      { _id: 'Unemployed', count: unemployed },
    ].filter(r => r.count > 0);
    return withChart(text, { type: 'donut', title: 'Employment Status', rows: chartRows });
  }

  const breakdown = filters.excludeSelfEmployed
    ? `${formal} formally employed, self-employed not counted`
    : `${employed}, made up of ${formal} formally employed + ${selfEmp} self-employed`;
  const text = `The employment rate of ${gPrefix}graduates${lbl} is **${pct(employed, total)}** (${breakdown} out of ${total} respondents).`;

  // A question that explicitly pairs "employed" with "self-employed" routes
  // here (see isCombinedEmployedQuery in the topic dispatcher) — still a
  // 2-category comparison, so it charts the same as any other named-status
  // compound, unlike the general "what is the employment rate" ask (a single
  // derived percentage, not a comparison).
  const isCombinedEmployedQuery = filters.employmentStatuses?.length === 2
    && filters.employmentStatuses.includes('Yes')
    && filters.employmentStatuses.includes('Self-Employed');
  if (isCombinedEmployedQuery) {
    const chartRows = [
      { _id: 'Formally Employed', count: formal },
      { _id: 'Self-Employed', count: selfEmp },
    ].filter(r => r.count > 0);
    return withChart(text, { type: 'donut', title: 'Employed + Self-Employed', rows: chartRows });
  }

  if (wantsChart) {
    const chartRows = (filters.excludeSelfEmployed
      ? [
          { _id: 'Formally Employed', count: formal },
          { _id: 'Not Employed', count: total - formal },
        ]
      : [
          { _id: 'Formally Employed', count: formal },
          { _id: 'Self-Employed', count: selfEmp },
          { _id: 'Not Employed', count: unemployed },
        ]).filter(r => r.count > 0);
    return withChart(text, { type: 'donut', title: 'Employment Status', rows: chartRows });
  }

  return text;
}

// Splits "compare X and Y" / "X vs Y" / "difference between X and Y" into
// two independently-parsed halves and, if both sides resolve a DIFFERENT
// value of the SAME single dimension (program-vs-program OR gender-vs-
// gender — the only two supported today), runs computeEmploymentRate() for
// each side and formats a side-by-side comparison. Returns null (safe
// fallthrough to normal single-topic dispatch) for anything that doesn't
// cleanly resolve — a conversational "vs" with no real 2-value split, an
// unsupported dimension (employment-status-vs-status), or a degenerate
// "compare X and X".
// "at" (Tagalog "and") added despite also being a common English
// preposition — safe here because this only ever splits text that already
// matched a comparison TRIGGER word first (see the caller's own
// /compare|vs|versus|.../ check), never arbitrary free text.
//
// Split into exactly ONE left/right pair at a SINGLE delimiter occurrence,
// never a blind multi-way .split() — a real stored specialization name is
// literally "Web and Mobile Application" (see PROGRAM_SPECIALIZATIONS
// above), and a global split on every "and" in the question sliced that
// name into "Web" / "Mobile Application" fragments, silently dropping the
// word "and" itself when the fragments were later rejoined with a plain
// space. The re-joined "BSIT - Web Mobile Application" then no longer
// matched the real specialization text at all, rightFilters.program came
// back empty, and the whole comparison silently fell through to a generic,
// unscoped "Information Technology" answer for a question that explicitly
// named two different specializations. Caught live: "employment rate for
// BSIT - Network Administration versus BSIT - Web and Mobile Application."
// STRONG (vs/versus) is tried first and preferred whenever present — it's
// never part of a real stored value in this dataset, unlike "and"/"at"
// (WEAK), which doubles as ordinary English/Tagalog filler AND as literal
// text inside real values; WEAK is only used as a fallback for the no-"vs"
// phrasing ("compare X and Y").
const STRONG_COMPARE_SPLIT = /\s+(?:vs\.?|versus)\s+/i;
const WEAK_COMPARE_SPLIT   = /\s+(?:and|at)\s+/i;
function splitCompareQuestion(stripped) {
  const strong = STRONG_COMPARE_SPLIT.exec(stripped);
  if (strong) return [stripped.slice(0, strong.index), stripped.slice(strong.index + strong[0].length)];
  const weak = WEAK_COMPARE_SPLIT.exec(stripped);
  if (weak) return [stripped.slice(0, weak.index), stripped.slice(weak.index + weak[0].length)];
  return [stripped];
}
// Which single dimension two sides are being compared ON — program-vs-program,
// gender-vs-gender, batch-year-vs-year ("compare batch 2022 versus batch
// 2024"), or industry-vs-industry (headcount only — see COMPARE_METRICS'
// own comment on why industry never drives a RATE comparison). Checked in
// this order so existing program/gender comparisons keep resolving exactly
// as before even if a question's split halves happen to ALSO carry a shared
// year, and industry (the newest, narrowest addition) never steals a
// comparison that's really about one of the other three.
const COMPARE_DIMENSIONS = ['program', 'gender', 'yearGraduated', 'industry'];
function compareValuesDiffer(dim, a, b) {
  return (dim === 'gender' || dim === 'industry') ? a.toLowerCase() !== b.toLowerCase() : a !== b;
}
function compareDimensionLabel(dim, filters) {
  if (dim === 'program') return filters.programLabel || filters.program;
  if (dim === 'yearGraduated') return `Batch ${filters.yearGraduated}`;
  if (dim === 'industry') return `${filters.industry} industry`;
  return filters.gender;
}
const WANTS_HEADCOUNT_PATTERN = /\bhow\s+many\b|\bnumber\s+of\b|\bheadcount\b|\bcount\s+of\b/i;

// Maps a comparison question's own metric wording to the SAME computation
// every matching single-topic query function (queryLicensure/
// queryFurtherStudies/queryPromotion/queryFurtherTraining/queryRate) already
// uses for that metric. Before this existed, queryCompare() ALWAYS ran
// computeEmploymentRate() no matter which metric the question actually
// named — "compare the licensure PASS RATE of batch 2022 vs batch 2023"
// silently came back as an EMPLOYMENT rate comparison instead, under
// correct-looking batch labels but the wrong real-world numbers entirely.
// Checked in this order (first match wins); 'employment' is the deliberate
// last-resort default so every comparison that worked before this fix
// (plain "employment rate of X vs Y", no metric word at all) keeps resolving
// exactly the same way.
const COMPARE_METRICS = [
  {
    key: 'licensure',
    trigger: /\b(?:licensure|board)\b|\bpass(?:ed|ing)?\s+(?:the\s+)?(?:exam|board)\b/i,
    label: 'Licensure exam pass rate',
    async stats(filters) {
      const base = stablePipeline(filters);
      const [totalRows, passedRows] = await Promise.all([
        Graduate.aggregate([...base, { $count: 'total' }]),
        Graduate.aggregate([...base, { $match: { tookExam: { $regex: 'passed', $options: 'i' } } }, { $count: 'total' }]),
      ]);
      return { total: totalRows[0]?.total ?? 0, matched: passedRows[0]?.total ?? 0 };
    },
  },
  {
    key: 'furtherStudies',
    trigger: /\bfurther\s+(?:studies|education)\b|\bpursu(?:e|ed|ing)\s+(?:a\s+)?(?:masters?|doctorate|phd|graduate\s+school)\b/i,
    label: 'Further studies rate',
    async stats(filters) {
      const base = stablePipeline(filters);
      const [totalRows, pursuedRows] = await Promise.all([
        Graduate.aggregate([...base, { $count: 'total' }]),
        Graduate.aggregate([...base, { $match: { furtherEducation: { $regex: '^yes', $options: 'i' } } }, { $count: 'total' }]),
      ]);
      return { total: totalRows[0]?.total ?? 0, matched: pursuedRows[0]?.total ?? 0 };
    },
  },
  {
    key: 'promotion',
    trigger: /\bpromot(?:ed|ion)\b/i,
    label: 'Promotion rate',
    async stats(filters) {
      const base = stablePipeline(filters);
      const [totalRows, promotedRows] = await Promise.all([
        Graduate.aggregate([...base, { $match: { hasPromotion: { $nin: [null, ''] } } }, { $count: 'total' }]),
        Graduate.aggregate([...base, { $match: { hasPromotion: { $regex: '^yes', $options: 'i' } } }, { $count: 'total' }]),
      ]);
      return { total: totalRows[0]?.total ?? 0, matched: promotedRows[0]?.total ?? 0 };
    },
  },
  {
    key: 'furtherTraining',
    trigger: /\btrain(?:ing|ed)s?\b|\bseminars?\b|\bworkshops?\b/i,
    label: 'Further training attendance rate',
    async stats(filters) {
      const base = stablePipeline(filters);
      const [totalRows, trainedRows] = await Promise.all([
        Graduate.aggregate([...base, { $count: 'total' }]),
        Graduate.aggregate([...base, { $match: { furtherTraining: { $regex: '^yes', $options: 'i' } } }, { $count: 'total' }]),
      ]);
      return { total: totalRows[0]?.total ?? 0, matched: trainedRows[0]?.total ?? 0 };
    },
  },
  {
    key: 'unemployment',
    trigger: /\bunemploy(?:ed|ment)\b/i,
    label: 'Unemployment rate',
    async stats(filters) {
      const s = await computeEmploymentRate(filters);
      return s ? { total: s.total, matched: s.total - s.employed } : null;
    },
  },
  {
    key: 'employment',
    trigger: /./, // always matches — the default when no other metric word is present
    label: 'Employment rate',
    async stats(filters) {
      const s = await computeEmploymentRate(filters);
      return s ? { total: s.total, matched: s.employed } : null;
    },
  },
];

async function queryCompare(question) {
  // "ihambing"/"ikumpara"/"paghambingin" (compare) / "pagkakaiba ng" (the
  // difference between) — same Tagalog gap as elsewhere in this file:
  // TOPIC_PATTERNS-style trigger words need a bilingual pair, not just an
  // English one.
  const stripped = question.replace(/\b(compare|difference\s+between|ihambing|ikumpara|paghambingin|pagkakaiba\s+ng)\b/i, '').trim();
  const parts = splitCompareQuestion(stripped);
  if (parts.length < 2) return null;

  const leftFilters  = extractFilters(parts[0]);
  const rightFilters = extractFilters(parts.slice(1).join(' '));

  const dim = COMPARE_DIMENSIONS.find(d =>
    leftFilters[d] && rightFilters[d] && compareValuesDiffer(d, leftFilters[d], rightFilters[d]));
  if (!dim) return null;

  const leftLabel  = compareDimensionLabel(dim, leftFilters);
  const rightLabel = compareDimensionLabel(dim, rightFilters);

  // A qualifier named only ONCE in the question ("...versus batch 2024 for
  // Web and Mobile Application majors") lands on whichever split half
  // contains that text — e.g. the program only resolves on the RIGHT side
  // here, never the left. Without carrying it to BOTH sides, the left side's
  // rate silently came back unscoped (every program, not just Web and Mobile
  // Application) while the right side was correctly scoped, comparing two
  // different cohorts under the same two labels. Caught live: "compare the
  // employment rates of batch 2022 versus batch 2024 for Web and Mobile
  // Application majors" never even reached this far (no yearGraduated
  // dimension existed yet), but the same one-sided-qualifier gap already
  // existed for program/gender comparisons too.
  // Broadened beyond just the other COMPARE_DIMENSIONS keys — ANY recognized
  // scope-narrowing filter named once anywhere in the question needs to
  // apply to BOTH sides, not just the dimension-specific ones (program/
  // gender/year/industry). Caught live: "How many respondents who PASSED
  // PROFESSIONAL EXAMINATIONS are currently in Regular/Permanent GOVERNMENT
  // positions versus PRIVATE SECTOR roles?" — tookExam='passed' is stated
  // once, outside either split half's own industry mention, and without
  // this would only ever apply to whichever side's extractFilters() call
  // happened to also pick it up (neither, here — it sits before "government
  // positions" even appears).
  const SHARED_FILTER_KEYS = [...COMPARE_DIMENSIONS, 'tookExam', 'employmentType', 'workLocation', 'negateWorkLocation', 'jobRelated', 'furtherEducation', 'employmentStatus'];
  const sharedFilters = {};
  for (const key of SHARED_FILTER_KEYS) {
    if (key === dim) continue;
    const shared = leftFilters[key] || rightFilters[key];
    if (shared) sharedFilters[key] = shared;
  }
  const leftDimFilters  = { ...sharedFilters, [dim]: leftFilters[dim] };
  const rightDimFilters = { ...sharedFilters, [dim]: rightFilters[dim] };

  const requestedChartType = extractFilters(question).requestedChartType;

  // Graduate.industry is only ever populated for alumni who reported being
  // employed — an "employment RATE in industry X vs Y" would trivially read
  // ~100% vs ~100% on both sides no matter what, so industry never drives a
  // rate comparison; it only ever answers the headcount question a bare
  // "compare industry X vs Y" (no "rate" word) actually means. Any OTHER
  // dimension still honors an explicit headcount phrasing too ("compare how
  // many BSIT vs BSCS alumni there are" — a real, different question from
  // "compare the employment rate of BSIT vs BSCS").
  const wantsHeadcount = dim === 'industry' || WANTS_HEADCOUNT_PATTERN.test(question);

  if (wantsHeadcount) {
    // "private sector" has no single real stored INDUSTRY value of its own
    // to positively match (confirmed against Graduate.industry's actual
    // distinct values — "Government and Public Administration" is real,
    // nothing is ever literally stored as "Private") — unlike "government,"
    // which genuinely is one real, named industry. Resolves to "has a real
    // industry recorded AND it's not government" instead of a doomed
    // positive match against a value that will never exist, which would
    // otherwise confidently report "0" as if literally no alumni work in
    // the private sector. $nin (not stablePipeline()'s own excludeIndustry
    // path, which has no such guard) explicitly excludes null/blank
    // industry too — someone with NO industry on file (unemployed, or
    // simply never reported one) is not evidence of "private sector"
    // either, same reasoning CLAUDE.md documents for every other $not/
    // $regex-on-a-possibly-null-field case in this file.
    const headcountPipeline = (dimFilters) => dimFilters.industry === 'private'
      ? [...stablePipeline({ ...dimFilters, industry: undefined }), { $match: { industry: { $nin: [null, ''], $not: { $regex: 'Government', $options: 'i' } } } }]
      : stablePipeline(dimFilters);
    const [leftRows, rightRows] = await Promise.all([
      Graduate.aggregate([...headcountPipeline(leftDimFilters), { $count: 'total' }]),
      Graduate.aggregate([...headcountPipeline(rightDimFilters), { $count: 'total' }]),
    ]);
    const leftCount  = leftRows[0]?.total  ?? 0;
    const rightCount = rightRows[0]?.total ?? 0;
    if (leftCount === 0 && rightCount === 0) return null;
    const higher = leftCount === rightCount ? null : (leftCount > rightCount ? leftLabel : rightLabel);

    let out = `**Headcount comparison:**\n\n`;
    out += `- **${leftLabel}**: ${leftCount}\n`;
    out += `- **${rightLabel}**: ${rightCount}\n\n`;
    out += higher ? `**${higher}** has more alumni.` : `Both have the same number of alumni.`;

    const charted = withChart(out, {
      type: requestedChartType || 'bars',
      title: 'Headcount Comparison',
      rows: [
        { _id: leftLabel,  count: leftCount },
        { _id: rightLabel, count: rightCount },
      ],
    });
    const { text, chart } = typeof charted === 'string' ? { text: charted, chart: null } : charted;
    return { text, direct: true, topic: 'comparison', filters: requestedChartType ? { requestedChartType } : {}, chart: chart || null };
  }

  const metric = COMPARE_METRICS.find(m => m.trigger.test(question));
  const [leftStats, rightStats] = await Promise.all([metric.stats(leftDimFilters), metric.stats(rightDimFilters)]);
  if (!leftStats || !rightStats) return null;

  const leftRate  = leftStats.total  ? leftStats.matched / leftStats.total  : 0;
  const rightRate = rightStats.total ? rightStats.matched / rightStats.total : 0;
  const higher = leftRate === rightRate ? null : (leftRate > rightRate ? leftLabel : rightLabel);

  let out = `**${metric.label} comparison:**\n\n`;
  out += `- **${leftLabel}**: ${pct(leftStats.matched, leftStats.total)} (${leftStats.matched}/${leftStats.total})\n`;
  out += `- **${rightLabel}**: ${pct(rightStats.matched, rightStats.total)} (${rightStats.matched}/${rightStats.total})\n\n`;
  out += higher ? `**${higher}** has the higher ${metric.label.toLowerCase()}.` : `Both have the same ${metric.label.toLowerCase()}.`;

  // "make it a pie chart" right after a comparison answer re-merges onto the
  // ORIGINAL question text (see ragService.js's isChartTypeOnlyContinuation())
  // and re-enters this SAME function (the compare trigger still matches
  // "versus" in the merged text) — but this early return skips queryInner()'s
  // generic filters.requestedChartType override entirely (that override only
  // ever runs on the fn()-dispatch path further down, never on a `direct:
  // true` bypass like this one returns). Hardcoding type: 'bars' meant the
  // request was silently ignored and the exact same bar chart came back with
  // no indication anything had changed. Resolving it here directly, off the
  // full original `question` text (not the split left/right halves — the
  // chart-type phrase could land on either side depending on where "make it
  // a pie chart" got appended).
  const charted = withChart(out, {
    type: requestedChartType || 'bars',
    title: `${metric.label} Comparison (%)`,
    rows: [
      { _id: leftLabel,  count: Math.round(100 * leftRate) },
      { _id: rightLabel, count: Math.round(100 * rightRate) },
    ],
  });
  const { text, chart } = typeof charted === 'string' ? { text: charted, chart: null } : charted;
  return { text, direct: true, topic: 'comparison', filters: requestedChartType ? { requestedChartType } : {}, chart: chart || null };
}

// "Who works at Starlink?" / "which alumni are employed at IT Solutions" /
// "sino ang nagtatrabaho sa Starlink" — a REVERSE lookup (by employer, not
// by name), structurally different from queryPersonLookup() above.
// Deliberately permissive on capitalization ("IT solutions" is a
// real stored value, lowercase) — same reasoning WHO_IS_PATTERN/NAMED_
// LOOKUP_PATTERN already use for person names.
// (?:(?:is|are)\s+)? is OPTIONAL — "who works at X" (bare present tense, no
// auxiliary verb) is at least as natural a phrasing as "who is working at
// X", and the first version of this pattern required "is"/"are" and missed
// it entirely, silently falling through to the generic "list all alumni"
// names query instead (dumping the full 256-person roster for a completely
// unrelated company question).
//
// "how many (alumni )work at X" added alongside "who works at X" — a
// natural, common way to ask the SAME question (just wanting the count, not
// necessarily every name) that this pattern originally missed entirely:
// "how many work at Sutherland" fell through with no company extracted at
// all and silently answered with the unrelated total headcount instead of
// the real, company-filtered one.
//
// Tagalog "ilan ang nagtatrabaho/nagwowork sa X" is the same "how many"
// case; "kompanyang X"/"kumpanyang X"/"company na X" (an explicit "the
// company [called] X" framing, common in Taglish) is an optional filler
// before the name in both the sino and ilan forms. "k[ou]mpanyang?" covers
// both real-world spellings ("kompanya" and "kumpanya" — the latter is the
// one actually listed in the project's own Tagalog-vocabulary reference
// table; the pattern previously only matched "kompanya").
// "ilan(?:g)?\s+(?:mga\s+)?(?:alumni\s+)?ang" — natural Filipino word order
// often puts the subject noun BETWEEN "ilan(g)"/"sino(-sino)" and "ang"
// ("Ilang ALUMNI ang nagtatrabaho sa Sutherland?"), which the original
// "ilan(g)? ang"/"sino(-sino)? ang" (requiring them adjacent) rejected
// outright — caught live via a multi-turn conversation-memory test where
// this exact phrasing extracted no company at all.
// Third branch: "ilan nasa X" / "sino nasa X" — no verb at all ("nagtatrabaho"
// omitted entirely, "nasa" ("at/in") doing all the work on its own). Caught
// live: "ilan nsa sutherland???" (typo'd "nasa", corrected upstream by
// typoCorrect.js before this ever runs) — a genuinely common short way to
// ask this, distinct enough from the verb-based Tagalog branch above that
// it needs its own alternative rather than making "nagta+trabaho|nagwowork"
// optional there (which would make THAT branch dangerously permissive for
// unrelated "nasa" phrasings that have nothing to do with a company).
const COMPANY_LOOKUP_PATTERN = /\b(?:who|which\s+alumni|what\s+alumni|how\s+many(?:\s+alumni)?)\s+(?:(?:is|are)\s+)?(?:currently\s+)?work(?:ing|s)?\s+(?:for|at|in)\s+(?:(?:the\s+)?company\s+(?:named|called)\s+)?([A-Za-z0-9][A-Za-z0-9\s.,&'-]{1,60}?)(?:[?!.]|\s*$)|\b(?:sino(?:-sino)?\s+(?:mga\s+)?(?:alumni\s+)?ang|ilan(?:g)?\s+(?:mga\s+)?(?:alumni\s+)?ang)\s+(?:nagta+trabaho|nagwowork)\s+sa\s+(?:k[ou]mpanyang?\s+|company\s+na\s+)?([A-Za-z0-9][A-Za-z0-9\s.,&'-]{1,60}?)(?:[?!.]|\s*$)|\b(?:ilan(?:g)?|sino(?:-sino)?)\b.{0,15}\bnasa\s+([A-Za-z0-9][A-Za-z0-9\s.,&'-]{1,60}?)(?:[?!.]|\s*$)/i;

function extractCompanyName(question) {
  const m = question.match(COMPANY_LOOKUP_PATTERN);
  if (!m) return null;
  return (m[1] || m[2] || m[3] || '').trim();
}

// wantsChart: set by the 'count' dispatcher when the question explicitly
// asks for a visualization/chart/graph (VISUALIZATION_REQUEST_PATTERN) — a
// plain count has no breakdown of its own to chart, but "how many are
// employed? show me a visualization" reasonably means "chart that count
// against the rest of the cohort" (e.g. Employed vs. everyone else), same
// on-request wiring as queryRate()/queryEmployment() above.
async function queryCount(filters, wantsChart = false) {
  const stable = stablePipeline(filters);

  // Variable filters applied after dedup
  const postDedup = {};
  if (filters.employmentStatus) postDedup.employmentStatus = { $regex: employedStatusPattern(filters.employmentStatus), $options: 'i' };
  // $not/$regex never matches a null/missing field, which would otherwise
  // make "not self-employed" silently include people with no status
  // recorded at all — $nin excludes those explicitly so the count only
  // reflects people who reported a status other than the excluded one.
  if (filters.excludeEmploymentStatus) {
    postDedup.employmentStatus = {
      $nin: [null, ''],
      $not: { $regex: employedStatusPattern(filters.excludeEmploymentStatus), $options: 'i' },
    };
  }
  if (filters.jobTitleRegex)    postDedup.jobTitle         = { $regex: filters.jobTitleRegex, $options: 'i' };
  if (filters.companyRegex)     postDedup.companyName      = { $regex: filters.companyRegex, $options: 'i' };
  if (filters.employmentType)   postDedup.employmentType   = { $regex: escapeRegex(filters.employmentType), $options: 'i' };
  if (filters.industry)         postDedup.industry         = { $regex: filters.industry, $options: 'i' };
  if (filters.excludeIndustry) {
    postDedup.industry = {
      $nin: [null, ''],
      $not: { $regex: filters.excludeIndustry, $options: 'i' },
    };
  }
  if (filters.furtherEducation === 'No') {
    postDedup.$or = [
      { furtherEducation: { $in: [null, ''] } },
      { furtherEducation: { $regex: '^No', $options: 'i' } },
    ];
  } else if (filters.furtherEducation) {
    postDedup.furtherEducation = { $regex: `^${filters.furtherEducation}`, $options: 'i' };
  }
  if (filters.workLocation) {
    postDedup.workLocation = workLocationCondition(filters.workLocation, filters.negateWorkLocation);
  }
  if (filters.jobRelated === 'directly') {
    // "Yes, it is directly related" or plain "Yes" — exclude anything with "somewhat"
    postDedup.$and = [
      { jobRelated: { $regex: '^yes', $options: 'i' } },
      { jobRelated: { $not: { $regex: 'somewhat', $options: 'i' } } },
    ];
  } else if (filters.jobRelated === 'somewhat') {
    // "Somewhat" (File 2) or "Yes, it is somewhat related" (File 1)
    postDedup.jobRelated = { $regex: 'somewhat', $options: 'i' };
  } else if (filters.jobRelated) {
    postDedup.jobRelated = { $regex: `^${filters.jobRelated}`, $options: 'i' };
  }
  if (filters.tookExam) Object.assign(postDedup, tookExamMatch(filters.tookExam));
  // filters.competency was previously ONLY ever used to redirect straight to
  // queryCompetencies() (the full rating-distribution display) — never
  // applied as an actual filter condition here, so a question combining a
  // SPECIFIC competency rating with ANOTHER filter (job title, program,
  // etc.) had nowhere to go: queryCompetencies() has no idea what
  // jobTitleRegex even is, and queryCount() had no idea competency existed.
  // Caught live: "How many graduates who rated their Critical Thinking as
  // 'High Competent' are currently working in managerial or supervisor
  // roles?" silently dropped the competency half entirely. Only applied
  // when filters.competencyRating is ALSO set (a specific level was named)
  // — a bare filters.competency with no level still means "show the full
  // distribution," which stays queryCompetencies()'s job (see queryInner()'s
  // own dispatch condition for the companion half of this fix).
  if (filters.competency && filters.competencyRating) {
    postDedup[`competencies.${filters.competency}`] = { $regex: `^${escapeRegex(filters.competencyRating)}`, $options: 'i' };
  }

  const pipeline = [...stable];
  if (Object.keys(postDedup).length) pipeline.push({ $match: postDedup });
  pipeline.push({ $count: 'total' });

  // Also count the STABLE cohort alone (program/year/gender, no
  // employmentStatus/industry/etc.) so a zero result can be told apart from
  // two very different situations: "this batch/program has data but none of
  // it matches the extra filter" (a real, confident answer worth stating) vs
  // "this batch/program has no data in the system at all" (e.g. batch 2026,
  // which hasn't graduated yet) — the latter should defer to RAG so the LLM
  // can explain the absence in its own words instead of the aggregation
  // layer asserting a specific "0 employed" breakdown for a cohort it has
  // zero information about.
  const [rows, stableRows] = await Promise.all([
    Graduate.aggregate(pipeline),
    Graduate.aggregate([...stable, { $count: 'total' }]),
  ]);
  const total       = rows[0]?.total ?? 0;
  const stableTotal = stableRows[0]?.total ?? 0;

  // This function already builds its own industryLabel/jobTitleLabel below
  // (folded into `desc`) — filterLabel() now also mentions
  // filters.industry/excludeIndustry/jobTitle itself (see its own
  // comments), so `lbl` here strips both to avoid saying either twice.
  // Caught live: "...working locally as Front-end Developer" read "working
  // as Front-end Developer ... (Information Technology, working as
  // Front-end Developer, Batch 2024)" — the same phrase stated twice.
  const lbl = filterLabel({ ...filters, industry: undefined, excludeIndustry: undefined, jobTitle: undefined });

  if (stableTotal === 0) {
    // A completely unrecognized/misspelled program name has nothing real to
    // defer to RAG for — unlike a genuine but not-yet-graduated batch year
    // (the scenario this null-then-RAG-fallback was built for, see the
    // comment above stableRows), there's no real cohort for the LLM to
    // explain the absence of. Left as a bare null here, this question falls
    // through to ragService's general vector-search/LLM fallback, which has
    // no grounding for a program that doesn't exist and will happily
    // fabricate a specific, plausible-sounding, completely wrong number
    // instead — caught live: "how many CSS alumni are employed" (a typo for
    // "CCS", but extractFilters() only recognizes it as an unverified
    // program guess, not a college) got answered "17 CSS (Computer Science)
    // alumni are already promoted" by the RAG/LLM path, a fully invented
    // figure. Declining explicitly here whenever filters.program is what's
    // driving the emptiness keeps this a real, deterministic "no data"
    // answer instead. Genuine batch-year-only emptiness (no program named)
    // still returns null/defers to RAG, unchanged.
    if (filters.program) {
      return `No records found for **${filters.programLabel || filters.program}** in the tracer study database. Please check the program name or abbreviation.`;
    }
    return null;
  }

  const significantKeys = Object.keys(filters).filter(k => k !== 'programLabel');
  if (total === 0) {
    if (significantKeys.length === 0) return null;
    if (significantKeys.length === 1 && filters.program) {
      return `No records found for **${filters.programLabel || filters.program}** in the tracer study database. Please check the program name or abbreviation.`;
    }
  }
  const statusLabel = filters.employmentStatus === 'Yes'            ? 'employed'
                    : filters.employmentStatus === 'No'             ? 'unemployed'
                    : filters.employmentStatus === 'Self-Employed'  ? 'self-employed'
                    : filters.employmentStatus === 'Never Employed' ? 'never employed'
                    : filters.excludeEmploymentStatus === 'Yes'            ? 'not employed'
                    : filters.excludeEmploymentStatus === 'No'             ? 'not unemployed'
                    : filters.excludeEmploymentStatus === 'Self-Employed'  ? 'not self-employed'
                    : filters.excludeEmploymentStatus === 'Never Employed' ? 'not "never employed"'
                    : null;
  const industryLabel  = filters.industry       ? ` in ${filters.industry}`
                       : filters.excludeIndustry ? ` NOT in ${filters.excludeIndustry}`
                       : '';
  const jobTitleLabel  = filters.jobTitle ? ` working as ${filters.jobTitle}` : '';
  const workTypeLabel  = filters.employmentType ? ` with a ${filters.employmentType} position` : '';
  const companyLabel   = filters.company  ? ` at ${filters.company}` : '';
  // 'local' read as "working local" (ungrammatical) — "locally" is the real
  // adverb; 'abroad' already reads fine as-is ("working abroad"), same
  // distinction queryWorkLocation() itself already makes for its own
  // equivalent sentence.
  const locationWord = filters.workLocation === 'local' ? 'locally' : filters.workLocation;
  const locationLabel  = filters.workLocation
    ? (filters.negateWorkLocation ? ` NOT working ${locationWord}` : ` working ${locationWord}`)
    : '';
  const examLabel      = filters.tookExam === 'passed' ? ' who passed a board/licensure exam'
                       : filters.tookExam === 'failed' ? ' who failed a board/licensure exam'
                       : filters.tookExam === 'yes'    ? ' who took a board/licensure exam'
                       : filters.tookExam === 'no'     ? ' who did NOT take a board/licensure exam'
                       : '';
  const jobRelLabel    = filters.jobRelated === 'yes'      ? ' with jobs related to their course'
                       : filters.jobRelated === 'directly' ? ' with jobs directly related to their course'
                       : filters.jobRelated === 'no'       ? ' with jobs NOT related to their course'
                       : filters.jobRelated === 'somewhat' ? ' with jobs somewhat related to their course'
                       : '';
  // Was missing before: the query already filters by furtherEducation (see
  // postDedup above), but the label never said so — the count was correct,
  // but the sentence made it look like an unfiltered total.
  const eduLabel        = filters.furtherEducation === 'Yes' ? ' who pursued further education'
                       : filters.furtherEducation === 'No'  ? ' who did not pursue further education'
                       : '';
  // Was missing before: filters.gender is applied to the query (via
  // stablePipeline) but never shown in the sentence, so a gender-filtered
  // count read identically to an unfiltered one — making the two answers
  // look inconsistent even when both were correct.
  const genderLabel = filters.gender ? `${filters.gender.toLowerCase()} ` : '';
  const desc = statusLabel
    ? `${genderLabel}**${statusLabel}** alumni${jobTitleLabel}${workTypeLabel}${companyLabel}${industryLabel}${locationLabel}${examLabel}${jobRelLabel}${eduLabel}`
    : `${genderLabel}graduate${total !== 1 ? 's' : ''}${jobTitleLabel}${workTypeLabel}${companyLabel}${industryLabel}${locationLabel}${examLabel}${jobRelLabel}${eduLabel}`;
  // filters.mentionsRecordsAndResponses (see extractFilters()'s own comment)
  // only changes the WORDING for the plain, fully-unfiltered bare-total
  // case — `desc` already carries real content (statusLabel, industryLabel,
  // etc.) for any FILTERED count, and this phrasing would misleadingly
  // claim those filtered rows are "tracer survey responses" rather than,
  // say, "employed alumni in the IT industry." The number itself needs no
  // change either way — Graduate's own row count already answers both
  // "records" and "responses" identically (see that comment for why).
  const out0 = filters.mentionsRecordsAndResponses && !statusLabel && !jobTitleLabel && !workTypeLabel && !companyLabel && !industryLabel && !locationLabel && !examLabel && !jobRelLabel && !eduLabel
    ? `There are **${total}** total alumni records in the tracer study database${lbl}, representing **${total}** tracer survey responses on file.`
    : `There are **${total}** ${desc} in the tracer study database${lbl}.`;
  let out = out0;

  // For general "related" queries, add directly/somewhat sub-breakdown.
  // Was using bare stablePipeline(filters) (program/year/gender ONLY) as the
  // base — silently dropping every other filter the headline `total` above
  // WAS built with (employmentStatus, industry, jobTitle, company, etc).
  // Caught live: "How many alumni are working in IT-related jobs?" (which
  // also resolved employmentStatus='Yes' from "working") answered "There
  // are 0 employed alumni..." as the headline, immediately followed by
  // "Directly related: 40 / Somewhat related: 48" — the breakdown counted
  // ALL 88 job-related graduates regardless of employment status, flatly
  // contradicting the "0" the sentence right above it just asserted. Reusing
  // the SAME postDedup filters (minus jobRelated itself, which this block
  // re-splits into its own directly/somewhat buckets) keeps the breakdown
  // numbers consistent with whatever cohort the headline total describes.
  if (filters.jobRelated === 'yes') {
    const postDedupNoJobRelated = { ...postDedup };
    delete postDedupNoJobRelated.jobRelated;
    const base = [...stable];
    if (Object.keys(postDedupNoJobRelated).length) base.push({ $match: postDedupNoJobRelated });
    const [dirRows, somRows] = await Promise.all([
      Graduate.aggregate([...base, { $match: { $and: [
        { jobRelated: { $regex: '^yes', $options: 'i' } },
        { jobRelated: { $not: { $regex: 'somewhat', $options: 'i' } } },
      ]}}, { $count: 'total' }]),
      Graduate.aggregate([...base, { $match: { jobRelated: { $regex: 'somewhat', $options: 'i' } } }, { $count: 'total' }]),
    ]);
    const directly = dirRows[0]?.total ?? 0;
    const somewhat = somRows[0]?.total ?? 0;
    out += `\n- Directly related: **${directly}**\n- Somewhat related: **${somewhat}**`;
  }

  // Only charts a single named status/filter against "the rest of the same
  // cohort" — statusLabel is null for a plain unfiltered count (nothing
  // meaningful to contrast against), and the jobRelated directly/somewhat
  // breakdown just above already has its own two numbers better suited to a
  // chart than a generic "matches vs. rest" split would be.
  if (wantsChart && statusLabel && total > 0 && stableTotal > total) {
    // Was bare statusLabel alone ("Employed") regardless of any OTHER
    // qualifier the question actually named — jobRelLabel/industryLabel/
    // jobTitleLabel/etc. are already woven into `desc`/`out` above (the TEXT
    // answer correctly says "...with jobs SOMEWHAT related to their
    // course..."), but the chart's own legend ignored all of them, always
    // showing the same generic "Employed" slice no matter which specific
    // qualifier was asked about. Caught live: "How many ... graduates are
    // working in roles SOMEWHAT related to their degree?" followed by "show
    // me the pie chart" rendered a chart labeled just "Employed vs. Rest,"
    // identical to what a plain unqualified employment question would show —
    // giving no indication the chart was scoped to "somewhat related" at
    // all. Reusing the EXACT same qualifier variables `desc` already
    // combines keeps the chart and the text consistent with each other,
    // whichever qualifier (or combination) was actually named.
    const chartStatusLabel = `${statusLabel}${jobTitleLabel}${workTypeLabel}${companyLabel}${industryLabel}${locationLabel}${examLabel}${jobRelLabel}${eduLabel}`;
    const label = chartStatusLabel.charAt(0).toUpperCase() + chartStatusLabel.slice(1);
    return withChart(out, {
      type: 'donut',
      title: `${label} vs. Rest${lbl}`,
      rows: [
        { label, count: total },
        { label: 'Rest', count: stableTotal - total },
      ],
    });
  }

  return out;
}

async function queryOverview(filters) {
  const base = stablePipeline(filters);

  const countRows = await Graduate.aggregate([...base, { $count: 'total' }]);
  const total = countRows[0]?.total ?? 0;
  if (total === 0) return null;

  // Grouped case-insensitively (same fix as queryEmployment()) so data-entry
  // variants like "yes" vs "Yes" merge into one row instead of splitting the
  // same status across two separate breakdown lines.
  const empRows = toDisplayRows(await Graduate.aggregate([
    ...base,
    { $match: { employmentStatus: { $nin: [null, ''] } } },
    ...caseMergeGroup('$employmentStatus'),
    { $sort: { count: -1 } },
  ]));
  // Denominator matches queryEmployment()/queryRate()'s own denominator (only
  // respondents with a non-null employmentStatus) — using the all-respondents
  // `total` here instead would silently disagree with those functions whenever
  // some records have no employmentStatus recorded.
  const empTotal = empRows.reduce((s, r) => s + r.count, 0);
  const formal   = empRows.filter(r => YES_RE.test(r._id) || /^employed$/i.test(r._id)).reduce((s, r) => s + r.count, 0);
  const selfEmp  = empRows.filter(r => /^self.?employed$/i.test(r._id)).reduce((s, r) => s + r.count, 0);
  const employed = formal + selfEmp;

  const indRows = toDisplayRows(await Graduate.aggregate([
    ...base,
    { $match: { industry: { $nin: [null, ''] } } },
    ...caseMergeGroup('$industry'),
    { $sort: { count: -1 } }, { $limit: 3 },
  ]));

  const locRows = await Graduate.aggregate([
    ...base,
    { $match: { workLocation: { $nin: [null, ''] } } },
    { $group: { _id: { $cond: [{ $regexMatch: { input: '$workLocation', regex: ABROAD_REGEX } }, 'Abroad (outside your home country)', 'Local (within your home country)'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  // Denominator matches queryWorkLocation()'s own denominator (only
  // respondents with a non-null workLocation).
  const locTotal = locRows.reduce((s, r) => s + r.count, 0);

  const eduRows = await Graduate.aggregate([
    ...base,
    { $match: { furtherEducation: { $nin: [null, ''] } } },
    { $group: { _id: '$furtherEducation', count: { $sum: 1 } } },
  ]);
  const pursuedEdu = eduRows.filter(r => YES_RE.test(r._id)).reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Tracer Study Overview${lbl} with ${total} ${gPrefix}respondents**\n\n`;

  out += `**Employment Status:**\n`;
  empRows.forEach(r => { out += `- ${r._id}: **${r.count}** (${pct(r.count, empTotal)})\n`; });
  out += `→ Overall employment rate: **${pct(employed, empTotal)}** (including self-employed)\n\n`;
  // {{chart:N}} is a placement anchor the frontend's block parser recognizes
  // and swaps for the Nth entry of `charts` below, right where it appears in
  // the text — so the Employment Status donut renders directly under the
  // Employment Status section instead of every chart being dumped together
  // after all the text, which read as disconnected from what it illustrated.
  out += `{{chart:0}}\n\n`;

  if (indRows.length) {
    out += `**Top Industries:**\n`;
    indRows.forEach((r, i) => { out += `${i + 1}. ${r._id}: ${r.count}\n`; });
    out += '\n';
    out += `{{chart:1}}\n\n`;
  }

  if (locRows.length) {
    out += `**Work Location:**\n`;
    locRows.forEach(r => { out += `- ${r._id}: ${r.count} (${pct(r.count, locTotal)})\n`; });
    out += '\n';
  }

  // Denominator matches queryFurtherStudies()'s own denominator (ALL
  // respondents in this cohort — a missing answer is treated as "did not
  // pursue," not excluded from the count). Using `eduTotal` (only-answered)
  // here instead used to make this line disagree with a direct "how many
  // pursued further studies?" question asked about the exact same cohort.
  out += `**Further Education:** ${pursuedEdu} pursued further studies (${pct(pursuedEdu, total)})`;

  // Two charts, not one — Employment Status is a part-of-whole breakdown
  // (donut/pie reads naturally), Top Industries is a ranked comparison
  // across different categories (bars read naturally); forcing both into a
  // single chart type would misrepresent whichever one didn't fit. Callers
  // that only handle a single `chart` field still get the first one via the
  // `charts` -> `chart` fallback in queryInner's normalization.
  const charts = [
    { type: 'donut', title: 'Employment Status', rows: empRows.map(r => ({ label: r._id, count: r.count })) },
    indRows.length ? { type: 'bars', title: 'Top Industries', rows: indRows.map(r => ({ label: r._id, count: r.count })) } : null,
  ].filter(Boolean);

  return { text: out, charts };
}

// TracerStudyResponse.submittedAt is stamped to `new Date()` on EVERY save,
// including the very first submission (saveTracerAnswers() upserts) — so a
// first-timer's createdAt and submittedAt land within milliseconds of each
// other, while a genuine re-submission (someone editing already-saved tracer
// answers) leaves submittedAt clearly later than createdAt. This grace
// window is what separates "just submitted for the first time" from "went
// back and updated it" without a dedicated "was this a resubmission" flag.
const TRACER_UPDATE_GRACE_MS = 60 * 1000;

// Resolves an explicit time window out of a question's own text — "today",
// "this week"/"this month", "recently", or an exact "last N days/weeks/
// months/years" (any N, not just the fixed buckets above it). Returns null
// when the question states NO time phrase at all (the caller then means
// "ever" for a fresh question, or "ambiguous — ask" for a continuation that
// only carried over an action with no window of its own — see
// queryTracerActivity's UNRESOLVED_WINDOW handling below).
function parseTracerWindowDays(question) {
  if (/\btoday\b/i.test(question)) return 1;
  const numeric = question.match(/\blast\s+(\d+)\s+(day|week|month|year)s?\b/i);
  if (numeric) {
    const n = parseInt(numeric[1], 10);
    const unit = numeric[2].toLowerCase();
    return unit === 'day' ? n : unit === 'week' ? n * 7 : unit === 'month' ? n * 30 : n * 365;
  }
  if (/\bthis\s+week\b|\bpast\s+week\b/i.test(question)) return 7;
  if (/\bthis\s+month\b|\bpast\s+month\b/i.test(question)) return 30;
  if (/\bthis\s+year\b|\bpast\s+year\b/i.test(question)) return 365;
  if (/\brecently\b/i.test(question)) return 30;
  return null;
}

// A sentinel distinct from "no window given" (which means "ever", a
// perfectly good answer for a FRESH question) — used only for a follow-up
// that inherited its action from a prior turn but stated no time phrase of
// its own either, which is genuinely ambiguous rather than a request for
// the all-time total. See the queryInner call site.
const UNRESOLVED_WINDOW = Symbol('unresolved_window');

// Answers "how many alumni have/haven't updated their tracer information",
// "...recently updated...", and "how many alumni records were added this
// month/week" — all genuine tracer-study activity questions (unlike the
// portal-account OUT_OF_SCOPE_TOPICS above), answered from
// TracerStudyResponse directly rather than Graduate: Graduate rows for the
// bulk-migrated alumni were created at migration time, long before those
// alumni ever touched the tracer form, so Graduate.createdAt can't tell
// "never submitted" apart from "submitted a while ago" the way
// TracerStudyResponse.createdAt (only ever created BY a submission) can.
//
// TracerStudyResponse has no `college` field of its own (see
// utils/collegeScope.js) — scoped manually here via User.college, the same
// source of truth Graduate's own email-based scope hook resolves from.
//
// `inheritedAction` (set by queryInner for a continuation whose own text has
// no "updated"/"added" word — e.g. "how about in the last 5 days?") pins
// down WHICH question is being re-asked with a new window; the question's
// own text still wins for the window itself so the new number is never
// ignored the way "how about in the last 5 days?" used to be (it silently
// repeated the prior turn's "last 30 days" answer, unchanged).
async function queryTracerActivity(question, inheritedAction = null) {
  let alumniScope = null;
  const scopedCollege = getCollegeScope();
  if (scopedCollege) {
    const scopedUsers = await User.find({ role: 'alumni', college: scopedCollege }).select('_id').lean();
    alumniScope = { alumni_id: { $in: scopedUsers.map(u => u._id) } };
  }

  const ownAction = /\badded\b/i.test(question) && !/\b(?:updat|submitt|resubmitt|edit|modif|chang)\w*\b/i.test(question)
    ? 'added'
    : /\b(?:not|haven'?t|hasn'?t|never)\b/i.test(question)
    ? 'not_updated'
    : /\b(?:updat|submitt|resubmitt|edit|modif|chang)\w*\b/i.test(question)
    ? 'updated'
    : null;
  const action = ownAction || inheritedAction || 'updated';
  const isAddedQuestion = action === 'added';
  const negated = action === 'not_updated';

  const windowDays = parseTracerWindowDays(question);
  // A continuation that inherited its action but named no window either
  // ("how about that?" with nothing else to go on) can't be resolved either
  // way — the caller (queryInner) checks for this sentinel and asks the
  // admin to name a specific window instead of silently defaulting to
  // "ever" for a question that clearly meant to narrow the prior answer.
  if (!ownAction && inheritedAction && windowDays === null) return UNRESOLVED_WINDOW;
  const windowStart = windowDays ? new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000) : null;

  if (isAddedQuestion) {
    const match = { ...(alumniScope || {}) };
    if (windowStart) match.createdAt = { $gte: windowStart };
    const total = await TracerStudyResponse.countDocuments(match);
    const windowLabel = windowDays ? ` in the last ${windowDays === 1 ? 'day' : `${windowDays} days`}` : '';
    const text = `${total} tracer study record${total === 1 ? '' : 's'} ${total === 1 ? 'was' : 'were'} added${windowLabel}.`;
    // Only meaningful against the rest of the same scoped record set, and
    // only when there's a real window narrowing it down — an unfiltered
    // "how many were added" has no "rest" to contrast against (every record
    // was, by definition, added at some point).
    if (VISUALIZATION_REQUEST_PATTERN.test(question) && windowStart) {
      const allTotal = await TracerStudyResponse.countDocuments(alumniScope || {});
      if (allTotal > total) {
        return withChart(text, {
          type: 'donut', title: 'Tracer Records Added',
          rows: [{ label: `Added${windowLabel}`, count: total }, { label: 'Older', count: allTotal - total }],
        });
      }
    }
    return text;
  }

  // A real update/resubmission: submittedAt (last save) sits clearly after
  // createdAt (first save) — see TRACER_UPDATE_GRACE_MS above.
  const wasUpdatedExpr = { $expr: { $gt: [{ $subtract: ['$submittedAt', '$createdAt'] }, TRACER_UPDATE_GRACE_MS] } };

  let match;
  if (windowStart) {
    match = { $and: [wasUpdatedExpr, { submittedAt: { $gte: windowStart } }, ...(alumniScope ? [alumniScope] : [])] };
  } else if (negated) {
    match = { $and: [{ $nor: [wasUpdatedExpr] }, ...(alumniScope ? [alumniScope] : [])] };
  } else {
    match = { $and: [wasUpdatedExpr, ...(alumniScope ? [alumniScope] : [])] };
  }

  const [total, allTotal] = await Promise.all([
    TracerStudyResponse.countDocuments(match),
    TracerStudyResponse.countDocuments(alumniScope || {}),
  ]);
  const verb = negated ? 'have not updated' : 'have updated';
  const windowLabel = windowDays ? ` in the last ${windowDays === 1 ? 'day' : `${windowDays} days`}` : '';
  const text = `${total} out of ${allTotal} alumni who submitted the tracer study ${verb} their answers since their first submission${windowLabel}.`;
  if (VISUALIZATION_REQUEST_PATTERN.test(question) && allTotal > total) {
    return withChart(text, {
      type: 'donut', title: 'Tracer Record Updates',
      rows: [{ label: negated ? 'Not Updated' : 'Updated', count: total }, { label: 'Rest', count: allTotal - total }],
    });
  }
  return text;
}

// Answers "who is the most recent/latest/newest graduate added to the
// tracer database?" (limit=1) AND "show the 3 most recent graduates
// added..." (limit=N) — a single-PERSON (or top-N) lookup, genuinely
// different from queryTracerActivity() just above (which only ever answers
// a COUNT: "how many were added"). Sorted by TracerStudyResponse.createdAt,
// not Graduate.createdAt — same reasoning queryTracerActivity() already
// documents: Graduate rows for bulk-migrated alumni were created at
// migration time, long before those alumni ever actually submitted
// anything, so Graduate.createdAt can't tell "genuinely just added" apart
// from "migrated a while ago." Previously unrecognized by any topic
// pattern at all — a bare "who is X" satisfies TOPIC_PATTERNS.names' broad
// "who" trigger and answered with the generic alphabetical 264-alumni
// roster, completely ignoring the "most recent...added" superlative the
// question actually asked. Caught live: "I was only asking the sino
// [who] but it gave everyone." The plural N-count shape ("show the 3 most
// recent graduates added") was caught live right after — it satisfied
// queryNames()'s own showLimit handling instead, which lists names
// ALPHABETICALLY within whatever batch/program filter got resolved, not
// actually sorted by when each record was added at all.
async function queryMostRecentlyAdded(limit = 1) {
  let alumniScope = null;
  const scopedCollege = getCollegeScope();
  if (scopedCollege) {
    const scopedUsers = await User.find({ role: 'alumni', college: scopedCollege }).select('_id').lean();
    alumniScope = { alumni_id: { $in: scopedUsers.map(u => u._id) } };
  }

  const latestRows = await TracerStudyResponse.find(alumniScope || {})
    .sort({ createdAt: -1 }).limit(limit).select('alumni_id createdAt').lean();
  if (!latestRows.length) return null;

  const grads = await Graduate.find({ user_id: { $in: latestRows.map(r => r.alumni_id) } })
    .select('user_id name program yearGraduated').lean();
  const gradByUser = new Map(grads.map(g => [String(g.user_id), g]));

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null;
  const fmtDetails = (g) => [g.yearGraduated ? `Batch ${g.yearGraduated}` : null, g.program || null].filter(Boolean).join(', ');

  const people = latestRows
    .map(r => {
      const g = gradByUser.get(String(r.alumni_id));
      if (!g?.name) return null;
      return { name: g.name, dateStr: fmtDate(r.createdAt), details: fmtDetails(g) };
    })
    .filter(Boolean);
  if (!people.length) return null;

  if (people.length === 1) {
    const p = people[0];
    return `**${p.name}** is the most recently added graduate in the tracer study database${p.dateStr ? `, added on ${p.dateStr}` : ''}${p.details ? ` (${p.details})` : ''}.`;
  }

  let out = `**${people.length} most recently added graduates in the tracer study database:**\n\n`;
  people.forEach((p, i) => {
    out += `${i + 1}. **${p.name}**${p.dateStr ? ` — added ${p.dateStr}` : ''}${p.details ? ` (${p.details})` : ''}\n`;
  });
  return out;
}

// Last-resort fallback for a question no hardcoded TOPIC_PATTERNS/contextual
// rule recognized (topic === null) — tries to match it against the asker's
// college's CUSTOM tracer questions (admin-added via TracerFormEditorView,
// never covered by any hardcoded pattern since there's no way to write one
// per-question) via semantic similarity, then answers with a REAL
// aggregation over TracerStudyResponse — never an LLM-generated number. See
// services/tracerQuestionCatalogService.js for the embedding/matching step.
// Deliberately does not attempt this for the ~16 fixed tracer fields — those
// already have extensive, well-tested hardcoded coverage; a low-confidence
// embedding match should never get a chance to shadow an already-correct
// regex match for them.
async function queryCustomQuestionByEmbedding(question, explicitCollege = null) {
  const { matchCustomQuestion, matchCustomQuestionAcrossColleges } = require('./tracerQuestionCatalogService');
  const { buildCustomQuestionFacetPipeline } = require('../utils/customQuestionAggregation');
  const TracerFormConfig = require('../models/TracerFormConfig');

  const college = explicitCollege || getCollegeScope();
  if (!college) {
    // No college context at all (unscoped admin question, no college named)
    // — there's no single catalog to search, but that doesn't mean this
    // isn't about a custom question; it could belong to any college. Check
    // across every college's catalog instead of silently giving up, so a
    // genuine custom-question match still gets a real, helpful answer (or a
    // precise "which college?" question) instead of falling through to an
    // unrelated generic fallback — caught live: "how many alumni work
    // remotely?" with no college named returned a bare, unrelated total.
    const crossMatches = await matchCustomQuestionAcrossColleges(question);
    if (!crossMatches.length) return null;
    if (crossMatches.length > 1) {
      const collegeList = crossMatches.map((m) => m.college).join(', ');
      return `"${crossMatches[0].label}" is a custom tracer-study question tracked separately by more than one college (${collegeList}). Could you specify which college you mean?`;
    }
    // Exactly one college has anything matching this — unambiguous, so
    // answer it directly for that one college rather than asking a
    // needless clarifying question.
    return queryCustomQuestionByEmbedding(question, crossMatches[0].college);
  }

  const match = await matchCustomQuestion(question, college);
  if (!match) return null;

  // Re-derive the live question definition (type/options/rows) from the
  // current TracerFormConfig rather than trusting the embedding record,
  // which could be stale if the catalog rebuild hasn't caught up yet — the
  // AGGREGATION must always reflect the form as it is right now.
  const cfg = await TracerFormConfig.findOne({ college }).lean();
  const liveQuestion = (cfg?.config?.pages || [])
    .flatMap((p) => p.questions || [])
    .find((q) => q.id === match.questionId);
  if (!liveQuestion) return null; // question was deleted since the catalog was built

  const scopedUsers = await User.find({ role: 'alumni', college }).select('_id').lean();
  const matchStage = scopedUsers.length ? [{ $match: { alumni_id: { $in: scopedUsers.map((u) => u._id) } } }] : [];
  const pipeline = buildCustomQuestionFacetPipeline(liveQuestion.id, liveQuestion.type, matchStage);
  const rows = await TracerStudyResponse.aggregate(pipeline);
  if (!rows.length) return null;

  if (liveQuestion.type === 'rating_table') {
    const bySkill = new Map();
    rows.forEach((r) => {
      if (!bySkill.has(r._id.skill)) bySkill.set(r._id.skill, []);
      bySkill.get(r._id.skill).push(`${r._id.rating}: ${r.count}`);
    });
    const rowLabel = (key) => (liveQuestion.rows || []).find((row) => row.key === key)?.label || key;
    const lines = [...bySkill.entries()].map(([key, parts]) => `${rowLabel(key)} — ${parts.join(', ')}`);
    return `**${liveQuestion.label}** (based on tracer study responses):\n${lines.map((l) => `- ${l}`).join('\n')}`;
  }

  const total = rows.reduce((s, r) => s + r.count, 0);
  const parts = rows.map((r) => `${r.label || r._id} — ${r.count} (${Math.round((r.count / total) * 100)}%)`);
  return `**${liveQuestion.label}**: based on ${total} tracer study respondent${total === 1 ? '' : 's'}, ${parts.join(', ')}.`;
}

// Final-last-resort clarification: a question that matched no hardcoded
// TOPIC_PATTERNS and no confident custom-question embedding might still
// share real keywords with something this system actually tracks — rather
// than silently answering a different, unrelated question (the root cause
// of this session's "civil status" → wrong Employment Breakdown bug and
// others like it) or flatly giving up, offer the plausible candidates and
// let the user pick. English stopwords plus domain words that appear in
// nearly every topic's phrasing ("alumni," "tracer," "breakdown"...) are
// excluded so overlap only fires on words that actually distinguish one
// topic/question from another — a bare "alumni" match would otherwise make
// every single topic "match" every single question.
const CLARIFY_STOPWORDS = new Set([
  'what', 'who', 'whom', 'which', 'how', 'many', 'much', 'does', 'do', 'did',
  'show', 'tell', 'give', 'list', 'about', 'current', 'currently', 'please',
  'could', 'would', 'their', 'them', 'they', 'your', 'have', 'has', 'with',
  'alumni', 'alumnus', 'alumna', 'graduate', 'graduates', 'tracer', 'study',
  'breakdown', 'data', 'information', 'details', 'records', 'database',
  'there', 'that', 'this', 'these', 'those', 'from', 'into', 'over',
]);

// The general length >= 4 filter below exists to drop short filler words
// ("the," "for," "are"...), but it also silently drops genuinely meaningful
// 3-letter domain words — caught live: "What job do alumni currently hold?"
// kept only "hold" as a token ("job" dropped for being 3 letters, "alumni"/
// "currently" dropped as stopwords), found zero candidates, and fell
// through to the wrong Employed/Unemployed breakdown. Explicitly allowed
// through regardless of length.
const CLARIFY_SHORT_ALLOWLIST = new Set(['job', 'sex']);

// Strips a bare trailing plural "s" ("positions" -> "position") so the
// overlap check isn't defeated by the question using the singular form of a
// word a topic's canonical phrasing happens to use the plural of, or vice
// versa — caught live: "tell me about alumni positions held" shares no
// token with job_positions' "What are the most common job positions..."
// under plain exact-string matching, because "position" (singular, in the
// question) and "positions" (plural, in the canonical phrase) are two
// different strings. Deliberately simple (not real stemming) — skips words
// ending in "ss" (e.g. "process") so it doesn't mangle those.
//
// "-ies" -> "-y" handled as its own case (checked first) — caught live:
// "Tell me about company information for alumni" shares no token with
// top_companies' "Which companies employ..." either, because the bare "-s"
// rule above turns "companies" into "companie" (one letter short of
// "company," the question's own singular form), not a real word. Same
// mismatch would hit "industry"/"industries", "category"/"categories," any
// consonant+y plural.
function singularize(word) {
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

// A handful of confirmed word-family mismatches that plain singularize()
// can't fix because they're not simple plurals — "locally"/"local"/"abroad"
// are different WORDS for the same "work location" concept, not inflections
// of one word. Caught live: "Tell me about alumni location details" shares
// no token with work_location's "How many alumni work locally vs. abroad?"
// (the question says "location," the canonical phrase says "locally"/
// "abroad" — three different strings for one concept), so it fell through
// to the general RAG path instead, which narrated the real retrieved
// numbers into a confusing, internally-inconsistent sentence ("99%... with
// 95.19% being a specific count"). Deliberately a short, curated map (not a
// general stemmer/synonym library) — each entry here is a word-family
// collision this session actually found live, not a speculative guess.
// "occupation" added here for the same reason — caught live: "What
// occupation do alumni have?" shares no token with job_positions'
// "...common job positions among alumni?" (neither "job" nor "position(s)"
// literally appears in "occupation"), so it also fell through to the wrong
// Employed/Unemployed breakdown.
//
// sex/firm/ability/advancement added from the same live-testing pass —
// everyday synonyms a real admin would plausibly type for gender/
// top_companies/skills_list/promotion, none of which share a token with
// those topics' canonical FOLLOWUP_QUESTION phrasing otherwise.
const TOKEN_SYNONYMS = {
  locally: 'location', local: 'location', abroad: 'location',
  overseas: 'location', domestic: 'location', domestically: 'location',
  international: 'location', internationally: 'location',
  occupation: 'job', occupations: 'job', position: 'job', positions: 'job',
  sex: 'gender',
  firm: 'company', firms: 'company', employer: 'company', employers: 'company',
  ability: 'skill', abilities: 'skill', skills: 'skill',
  advancement: 'promotion', advancements: 'promotion', promoted: 'promotion',
};

function meaningfulTokens(text) {
  return (String(text).toLowerCase().match(/[a-z]+/g) || [])
    .filter((w) => (w.length >= 4 || CLARIFY_SHORT_ALLOWLIST.has(w)) && !CLARIFY_STOPWORDS.has(w))
    .map(singularize)
    .map((w) => TOKEN_SYNONYMS[w] || w);
}

// Checks the question against every hardcoded topic's own human-readable
// canonical phrasing (FOLLOWUP_QUESTION, declared further down this file —
// safe to reference here since this function only runs per-request, after
// the whole module has loaded, same reasoning as this file's COLLEGE_CODES
// comment elsewhere). Returns candidate label strings, most-overlap first.
function findHardcodedTopicCandidates(question) {
  const qTokens = new Set(meaningfulTokens(question));
  if (!qTokens.size) return [];
  const candidates = [];
  for (const buildText of Object.values(FOLLOWUP_QUESTION)) {
    const label = buildText('', {});
    if (!label) continue;
    const overlap = meaningfulTokens(label).filter((t) => qTokens.has(t)).length;
    if (overlap > 0) candidates.push({ label, overlap });
  }
  candidates.sort((a, b) => b.overlap - a.overlap);
  return candidates.slice(0, 5).map((c) => c.label);
}

// Same keyword-overlap idea, over custom tracer questions instead of
// hardcoded topics. When college is known, only that college's live
// questions are checked; when unknown (unscoped caller, no college named),
// every college's cached catalog label is checked instead — a deliberate,
// acceptable staleness trade-off since this only ever produces a SUGGESTION
// for the user to confirm, never the final answer itself.
async function findCustomQuestionCandidates(question, college) {
  const qTokens = new Set(meaningfulTokens(question));
  if (!qTokens.size) return [];
  const TracerQuestionEmbedding = require('../models/TracerQuestionEmbedding');
  const catalog = college
    ? await TracerQuestionEmbedding.find({ college }).select('label college').lean()
    : await TracerQuestionEmbedding.find({}).select('label college').lean();
  const candidates = [];
  for (const entry of catalog) {
    const overlap = meaningfulTokens(entry.label).filter((t) => qTokens.has(t)).length;
    if (overlap > 0) {
      candidates.push({ label: college ? entry.label : `${entry.label} (${entry.college})`, overlap });
    }
  }
  candidates.sort((a, b) => b.overlap - a.overlap);
  return candidates.slice(0, 5).map((c) => c.label);
}

// A question naming a real alumnus that still failed every topic-routing
// attempt above (e.g. an attribute phrasing none of extractPersonName()'s
// patterns happen to cover yet) deserves a suggestion scoped to THAT PERSON,
// not just generic cohort-wide topic labels — caught live: "what is the job
// of Liam Miranda" (the "ATTRIBUTE of NAME" word order, not yet covered by
// any pattern at the time) fell all the way through to this fallback and
// offered "most common job positions among alumni" / "promoted in their
// current job" — two population-level stats with no connection to the
// person actually named in the question at all. Verifies the name against a
// real Graduate record (not just extractPersonName()'s own regex match)
// before suggesting it, the same "don't suggest a phantom" caution
// queryPersonLookup() itself already applies — a garbled false-positive
// capture shouldn't produce a suggestion for a person who doesn't exist.
async function suggestPersonSpecificCandidate(question) {
  // extractPersonName() alone isn't enough here — it only recognizes a
  // specific set of QUESTION SHAPES ("who is X", "what is X's job", etc.),
  // not just any capitalized name sitting in otherwise-unrecognized free
  // text ("regarding Liam Miranda, how is the work situation" matches none
  // of those shapes, so extractPersonName() itself returns null even though
  // the name is right there). Falls back to a broader scan for ANY 2-4 word
  // capitalized span, then verifies each candidate against a REAL Graduate
  // record before ever suggesting it — a plain capitalized span ("What Is")
  // sitting at the start of a sentence just won't match any real name and
  // is silently skipped, so this never suggests a phantom person.
  const candidates = extractPersonName(question) ? [extractPersonName(question)] : [];
  const spanMatches = question.match(/\b[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*){1,3}\b/g) || [];
  for (const span of spanMatches) if (!candidates.includes(span)) candidates.push(span);
  if (!candidates.length) return null;

  for (const name of candidates) {
    const tokens = name.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const tokenPatterns = tokens.map(t => new RegExp(`\\b${escapeRegex(t)}\\b`, 'i'));
    const match = await Graduate.findOne({ $and: tokenPatterns.map(re => ({ name: re })) }).select('name').lean();
    if (match) return `What is ${toTitleCase(cleanText(match.name))}'s job title?`;
  }
  return null;
}

async function suggestPossibleMatches(question) {
  const college = getCollegeScope();
  const [hardcoded, custom, personCandidate] = await Promise.all([
    findHardcodedTopicCandidates(question),
    findCustomQuestionCandidates(question, college),
    suggestPersonSpecificCandidate(question),
  ]);
  const combined = [...new Set([...(personCandidate ? [personCandidate] : []), ...custom, ...hardcoded])].slice(0, 5);
  if (!combined.length) return null;
  // Always bulleted, even for a single candidate — this file's other
  // deterministic-instruction answers (person_lookup_ambiguous, the
  // cross-college custom-question ambiguity message above) rely on the same
  // "bulleted shape survives narration as raw text" behavior rather than a
  // topic-name special case, so this stays consistent with that pattern.
  return {
    text: `I'm not sure exactly what you're asking. Did you mean one of these?\n${combined.map((c) => `- ${c}`).join('\n')}`,
    direct: true,
    topic: 'clarify',
    filters: {},
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function hasData() {
  const count = await Graduate.countDocuments();
  return count > 0;
}

// "What is the purpose/objective of the tracer study/survey?" — a real,
// in-scope question about the survey ITSELF, not a request for any alumni
// DATA, so it has no Graduate/EmbeddingDocument row to retrieve at all.
// Previously fell through every aggregation topic (nothing matched "why do
// we run this survey") and every RAG chunk (the informed-consent text below
// was never ingested into EmbeddingDocument — it only ever lived in the
// tracer form's own UI), landing on the fully generic "I could not find
// relevant information" fallback for a question the system actually has a
// real, correct answer to. Answered directly and deterministically — this
// is the exact wording alumni themselves see on the Tracer Study form's own
// Electronic Informed Consent page (see
// tracerFormConfigController.js's DEFAULT_CONFIG, mirrored in
// TracerStudyForm.jsx), not a paraphrase, so it can never drift out of sync
// with what alumni actually agreed to.
const TRACER_PURPOSE_PATTERN = /\b(?:what|ano)\b.{0,15}\b(?:purpose|objectives?|goals?|layunin)\b.{0,20}\b(?:tracer\s+(?:study|survey)|survey|study)\b|\bwhy\b.{0,20}\b(?:do\s+we|does\s+tsu|conduct|run|have)\b.{0,20}\btracer\s+(?:study|survey)\b/i;
function tracerStudyPurposeAnswer(question) {
  if (!TRACER_PURPOSE_PATTERN.test(question)) return null;
  return {
    text: 'The Graduate Tracer Study is conducted to track the career progress and professional development of TSU graduates. It aims to gather feedback on how the university\'s educational programs have impacted alumni career paths and job satisfaction, so the institution can enhance its curriculum and better support future students. Participation is voluntary, and all responses are kept confidential, anonymized, and aggregated for research purposes.',
    direct: true, topic: 'about_tracer_study', filters: {},
  };
}

async function queryInner(question, seedFilters = {}) {
  const purposeAnswer = tracerStudyPurposeAnswer(question);
  if (purposeAnswer) return purposeAnswer;

  // Events/AttendanceLog/EventFeedback are separate collections with no
  // dependency on the Graduate collection at all — a college can have real,
  // upcoming events scheduled while having zero registered/graduated alumni
  // (a newly onboarded college, or one where nobody has submitted the
  // tracer study yet). Gating EVERY topic (events included) on Graduate
  // data existing meant a college-scoped coordinator with 0 alumni records
  // was locked out of events/attendance/feedback entirely too — even for
  // their own college's real events — which has nothing to do with why
  // hasData() exists (it's the legacy chunk-scanning fallback trigger
  // further below, a purely tracer-study concern).
  const isEventShaped = TOPIC_PATTERNS.events.test(question) || TOPIC_PATTERNS.event_feedback.test(question);
  if (!isEventShaped && !(await hasData())) return null;

  // "Who are the PROMINENT/notable/outstanding graduates?" matches the 'names'
  // topic pattern ("who are") and would otherwise return a plain alphabetical
  // roster of every graduate in the program, silently discarding the actual
  // qualifier — the Graduate schema has no "prominent" flag to filter on, so
  // this is a RAG question (achievement profiles), not an aggregation one.
  // Bail out here so the caller (ragService) falls through to vector search.
  if (/\b(prominent|notable|outstanding|distinguished|renowned|top[- ]?performing|most successful)\b/i.test(question)) {
    return null;
  }

  // Non-tracer PORTAL features — job postings, announcements, staff
  // directory, appointments, partnerships, office hours, profile/account
  // activity. Each of these used to have its own live-collection query
  // handler (removed — the AC assistant is scoped to tracer study data
  // only, not portal-wide). Several of these keywords ("how many job
  // openings", "how many appointments") still satisfy the generic
  // "how many X" STATISTICAL_PATTERNS trigger with no other filter set,
  // which — without an explicit bail-out — fell through to the unrelated
  // employment-rate/count default and confidently narrated the wrong metric
  // (e.g. "174 job openings, representing an employment rate of 68.5%",
  // where 174 is actually the EMPLOYED-alumni count). Answered directly and
  // explicitly here instead, each with a pointer to the right admin page.
  // Events is deliberately NOT in this list — unlike the others, it kept its
  // live-collection handler (see queryEventOverview()/queryEventAttendees()/
  // queryEventAttendanceCount() and the TOPIC_PATTERNS.events/fn.events wiring
  // below), so events questions are meant to reach that real query path
  // instead of being bailed out here.
  const OUT_OF_SCOPE_TOPICS = [
    { test: /\bjob\s+(openings?|listings?|vacancies|opportunities|postings?)\b|\bavailable\s+(jobs?|positions?|roles?)\b/i,
      hint: 'Check the Employment Details or Job Board pages for open job postings.' },
    { test: /\bannouncements?\b/i, exclude: /\bemployment\b/i,
      hint: 'Check the Post Announcements page.' },
    { test: /\b(updat|edit|chang|modif)\w*\s+(their|his|her|its|my|your)?\s*(profile|account|info|information|details|record)\b|\b(profile|account)\s+(updat|edit|chang)\w*\b/i,
      hint: 'Check the Manage Accounts page for account activity.' },
    // "How many alumni are registered/unregistered in the system?" — this is
    // an account-status question (User.status: active vs pending), not a
    // tracer-study question. Without this bail-out it fell through to
    // TOPIC_PATTERNS.count's generic "how many alumni are" match, which has
    // no concept of "registered" at all and just returned the total
    // Graduate/tracer-study count for BOTH "registered" and "unregistered" —
    // confidently giving the same number as the answer to two opposite
    // questions. Caught live: both returned "262" (the tracer study total).
    // "active"/"inactive"/"suspended" ADDED — same bug, same shape: "How many
    // alumni accounts are currently active/inactive/suspended?" (User.status,
    // not tracer data either) all answered the same wrong "262" until this
    // was broadened to catch those words too, not just "registered." Doesn't
    // require the literal word "account(s)" — "how many alumni are active"
    // (no "account" at all) still means the same User.status question and
    // still fell through to the same wrong "262" until "alumni" was added as
    // an equally-valid noun alongside "accounts?" here.
    { test: /\b(un)?registered\b|\bregistration\b|\bpending\s+accounts?\b|\bactivated?\s+accounts?\b|\b(?:active|inactive|suspended)\s+(?:accounts?|alumni)\b|\b(?:accounts?|alumni)\b.{0,20}\b(?:active|inactive|suspended)\b/i,
      hint: 'Check the Manage Accounts page for account status (active vs. pending vs. suspended).' },
    // "What is the average time it took alumni to find employment?" — the
    // tracer study never asked this question. Graduate/TracerStudyResponse
    // only records yearsInJob/yearsInCurrentJob (how long someone has been
    // in their CURRENT role), not how long it took them to land it after
    // graduating — a genuinely different, uncollected data point, not a
    // synonym. Without this bail-out it fell through to the generic
    // EMPLOYMENT_SIGNAL fallback ('employment' topic, bare "employment" word)
    // and confidently answered with the unrelated Yes/No status breakdown —
    // a real-looking chart and numbers for a question the data can't answer
    // at all. Genuine data gap, not a bug to route around — same category as
    // the specific-skills-list gap (see querySkillsList()'s own history).
    { test: /\b(?:time|months?|weeks?|how\s+long)\b.{0,30}\b(?:find|land|get|secure)\w*\s+(?:a\s+)?(?:job|employment|work)\b|\btime\s+to\s+(?:find|get|land)\s+(?:a\s+)?(?:job|employment)\b/i,
      hint: 'The survey only records how long alumni have been in their CURRENT job, not how long it took them to find it after graduating.' },
    { test: /\bstaff\b/i,
      hint: 'Check the Appointments page\'s Staff Management section.' },
    { test: /\bappointments?\b/i, exclude: /\bstaff\b/i,
      hint: 'Check the Appointments page.' },
    // Bare "partners"/"partner" alone (not just "partnerships"/"partner
    // company") — "who are the partners of TSU" used to slip past this
    // check entirely (matched neither alternative) and fall through to the
    // 'names' topic instead, which searched Graduate records for a company
    // literally named "partners of TSU" and confidently reported "No alumni
    // found working as partners of TSU" — a nonsense answer to a question
    // that was never about alumni at all. Graduate has no "partner" concept
    // of its own, so a bare word match here carries no collision risk.
    { test: /\bpartnerships?\b|\bpartners?\b/i,
      hint: 'Check the Partnerships page.' },
    { test: /\boffice\s+(status|hours|open|closed|schedule)\b|\bis\s+the\s+office\s+(open|closed)\b/i,
      hint: 'Check the Appointments page\'s office settings.' },
    // Personal-demographic fields the tracer form never collects at all
    // (Graduate/TracerStudyResponse have no civilStatus/age/birthdate/
    // address/religion/nationality field whatsoever — not even an untracked
    // placeholder) — caught live via systematic testing: "How many alumni
    // are married?" matched count's bare "how many...alumni" pattern with no
    // filter extractFilters() knows how to set for "married," so it silently
    // fell to the zero-filter bare path and answered with the UNRELATED
    // whole-database total (702) as if that number meant anything about
    // marital status. Same shape as the age/address/religion/nationality
    // variants — none of these share a token with any real topic's
    // canonical phrasing either, so suggestPossibleMatches() also found
    // nothing and the bare-count fallback was the only thing left to
    // silently answer wrong. Explicit decline instead, matching how
    // UNTRACKED_EMPLOYMENT_CONCEPTS already handles salary/satisfaction.
    // "may asawa" (has a spouse/married), "walang asawa" (unmarried), "balo"
    // (widowed) — Tagalog equivalents, missed live: "Ilan ang mga alumning
    // may asawa?" shares none of the English trigger words above, fell
    // through to the bare-count path, and answered with the unfiltered
    // whole-database total (702) as if that number meant anything about
    // civil status — same bug shape the English phrasing was already fixed
    // for, just not caught in this language too the first time.
    { test: /\b(?:civil|marital)\s+status\b|\b(?:are|is)\b.{0,15}\b(?:married|single|widow(?:ed)?|separated|divorced)\b|\bmarried\s+or\s+single\b|\b(?:may|walang)\s+asawa\b|\bbalo\b/i,
      hint: 'The tracer study does not collect civil/marital status.' },
    // "average"/"mean" + "age" in EITHER order ("average age" and "age of
    // alumni on average" are both natural phrasings) — caught live: "What is
    // the age of alumni on average?" didn't satisfy the original
    // adjacent-only "average age" alternative at all and fell through to a
    // vague generic RAG refusal instead of this clear, specific decline.
    { test: /\bage\b.{0,20}\baverage\b|\baverage\b.{0,20}\bage\b|\bhow\s+old\b|\bbirth\s?date\b|\bdate\s+of\s+birth\b/i,
      hint: 'The tracer study does not collect alumni age or birthdate.' },
    { test: /\b(?:home\s+)?address\b|\bwhere\s+(?:do|does)\b.{0,20}\blive\b|\bresidence\b/i,
      hint: 'The tracer study does not collect alumni home address.' },
    { test: /\breligion\b|\bnationality\b|\bcitizenship\b/i,
      hint: 'The tracer study does not collect alumni religion or nationality.' },
    // Future-tense predictions — the tracer study is a SNAPSHOT of
    // self-reported status at response time, not a forecasting model.
    // Caught live: "How many alumni will be employed next year?" silently
    // dropped the future-tense framing entirely and answered with the
    // CURRENT employed count (219) presented as if it were a prediction.
    // "magiging empleyado"/"magiging trabahante" (Tagalog "will become
    // employed") + "sa susunod na taon" (next year) — missed live: "Ilan ang
    // magiging empleyado sa susunod na taon?" shares no English trigger word
    // with the alternatives above, so it fell through to the bare CURRENT
    // employed count (219) presented as if it answered a future-tense
    // question, same bug the English phrasing was already fixed for.
    // "magiging employed" (Taglish — Tagalog future-tense auxiliary "magiging"
    // fused directly onto the ENGLISH word "employed", a very common
    // code-switch, not the pure-Tagalog "magiging empleyado" already
    // covered) and "susunod na taon" paired with English "employ*" (not just
    // the Tagalog "empleyado"/"trabaho" nouns) — caught live: "Ilan ang
    // magiging employed sa susunod na taon?" shares the Taglish word
    // "employed" with the English alternatives above, but none of THOSE
    // require it to immediately follow "magiging," so this specific mixed
    // phrasing still fell through to the bare current employed count.
    // exclude: a "which/what program...predict/most likely" framing is NOT
    // asking this system to genuinely forecast a future value — it already
    // has a real, honest way to answer that exact shape: rank programs by
    // their CURRENT employment rate (queryEmploymentRateByProgram(), via
    // BY_PROGRAM_QUESTION_PATTERN below) and let ragService.js's own
    // PREDICTION_LEAD_IN_PROMPT add a "most likely" framing sentence on top
    // of that real, grounded ranking — never an actual extrapolated
    // trend-line value. Caught live: "Can you predict which program will
    // have more employed next year" combines this excludable shape with the
    // literal future-tense wording ("next year") the test pattern below
    // exists to catch, so it got the flat decline instead of the real
    // ranked-by-current-data answer this system already builds for the
    // "most likely" phrasing alone. A genuinely ungrounded forecast request
    // with no program/course ranking framing at all ("will the employment
    // rate be higher next year") still correctly declines — this exclusion
    // only fires when a real per-program ranking is the actual answer shape.
    { test: /\bwill\s+(?:\w+\s+){0,3}be\s+employed\b|\bnext\s+year\b.{0,30}\bemploy|\bemploy\w*\b.{0,30}\bnext\s+year\b|\bin\s+the\s+future\b.{0,30}\bemploy|\bgoing\s+to\s+(?:be\s+)?(?:employed|find\s+(?:a\s+)?job)\b|\bfuture\s+employment\b|\bmagiging\s+(?:empleyado|trabahante|employed)\b|\bsusunod\s+na\s+taon\b.{0,30}\b(?:empleyado|trabaho|employ\w*)\b|\bemploy\w*\b.{0,30}\bsusunod\s+na\s+taon\b/i,
      exclude: /\bwhich\s+(?:program|course|degree|specialization|track)\b.{0,40}\b(?:predict|prediction|forecast|projection|most\s+likely|least\s+likely|would\s+likely)\b|\b(?:predict|prediction|forecast|projection|most\s+likely|least\s+likely|would\s+likely)\b.{0,40}\bwhich\s+(?:program|course|degree|specialization|track)\b/i,
      hint: 'The tracer study only records employment status at the time alumni responded — it cannot predict future employment outcomes.' },
  ];
  for (const t of OUT_OF_SCOPE_TOPICS) {
    if (t.test.test(question) && !(t.exclude && t.exclude.test(question))) {
      return {
        text: `That's not part of the Graduate Tracer Study data — I can only answer questions about tracer study records (employment status, industries, board exam results, competencies, program breakdowns, etc.). ${t.hint}`,
        direct: true, topic: 'out_of_scope', filters: {},
      };
    }
  }

  // "Who has the best jobs?" / "who is the most successful alumnus?" / "who
  // are the happiest alumni?" / "what's the best company to work for?" — a
  // subjective superlative ("best"/"top"/"good(est)"/"most successful/
  // impressive/outstanding"/"happiest") describing a JOB, a PERSON, or an
  // EMPLOYER has no objective score anywhere in this dataset — there's no
  // composite quality/success/happiness metric to rank by — yet
  // TOPIC_PATTERNS.names' own broad "who (has|is|does|...)" alternative
  // (built to catch "who HAS passed the board exam," "who HAS a masters
  // degree," etc.) matches the SENTENCE STRUCTURE regardless, extracting
  // zero real filters and silently handing back the entire unfiltered
  // 269-person alphabetical roster — a real answer to a completely
  // different, much broader question ("who are all the alumni") than the
  // one actually asked. Checked here, before topic detection/dispatch ever
  // gets a turn, same "ask instead of guess" shape as
  // CLARIFY_CURRICULUM_RELEVANCE just below.
  //
  // One flat, data-driven array (not a single hardcoded "jobs" check) so a
  // newly-caught subjective shape is a one-entry addition, same reasoning
  // PROGRAM_SPECIALIZATIONS/UNTRACKED_EMPLOYMENT_CONCEPTS above already use
  // instead of a parallel regex rewrite each time. Each entry's own
  // `exclude` (when present) protects a DIFFERENT dimension this app
  // already answers for real — "best PROGRAM/COURSE" resolves to a genuine
  // employment-rate ranking (BY_PROGRAM_QUESTION_PATTERN, further below),
  // and "top/most COMPANIES" is a genuine headcount ranking
  // (TOPIC_PATTERNS.top_companies) — the company entry's own pattern is
  // deliberately narrowed to "best" only (never "top"/"most") so it can
  // never collide with that real feature in the first place.
  const SUBJECTIVE_SUPERLATIVE_TOPICS = [
    {
      // "best/top/good(est)/greatest jobs", "jobs that are the best"
      pattern: /\b(?:best|top|good(?:est)?|greatest|most\s+(?:prestigious|impressive))\s+jobs?\b|\bjobs?\s+(?:that\s+(?:are|is)\s+)?(?:the\s+)?best\b|\bsino\s+ang\s+may\s+(?:pinaka)?magandang\s+trabaho\b/i,
      exclude: /\b(?:program|course|degree|specialization|track|college)\b.{0,40}\bbest\b|\bbest\b.{0,40}\b(?:program|course|degree|specialization|track|college)\b/i,
      // Bulleted (not a run-on comma sentence) — bulletLineCount>=2 also
      // makes ragService.js's isBulletedOrList skip LLM narration entirely
      // for this answer, the same protection isListTopic/isDeterministicDecline
      // give every other verified deterministic message, so these exact
      // three lines are guaranteed to reach the user unparaphrased.
      message: `"Best" job isn't something the tracer study can objectively rank — there's no single job-quality score in the data. The closest real, trackable measures are:\n\n- Whether a job is directly related to the alumnus's course of study\n- Employment type (Regular/Permanent vs. Contractual/Part-time/Project-based)\n- Self-reported salary range (only a few alumni have shared this on their own profile)\n\nWhich of these would you like to see?`,
    },
    {
      // "best/happiest/most impressive alumnus/alumna/alumni/graduate(s)" —
      // deliberately does NOT include "most successful"/bare "outstanding"/
      // "prominent"/"notable"/"distinguished"/"renowned"/"top-performing":
      // those are already caught by an EARLIER, more specific bail-out
      // (queryInner()'s own `/\b(prominent|notable|outstanding|
      // distinguished|renowned|top[- ]?performing|most successful)\b/i`
      // check, a few lines above this whole function) that deliberately
      // falls through to RAG instead — the tracer study DOES have a real
      // free-text "accomplishments" field (TOPIC_PATTERNS.accomplishments)
      // vector search can actually find substance in for those specific
      // words, so declining outright there would throw away a genuinely
      // answerable case. "best"/"happiest"/"most impressive" have no such
      // substitute (no quality OR accomplishment field those words map to),
      // so they still get a direct, honest clarify here rather than a RAG
      // attempt likely to find nothing or improvise. "most satisfied" also
      // included — job satisfaction isn't tracked at all (see
      // UNTRACKED_EMPLOYMENT_CONCEPTS's own job-satisfaction entry), so a
      // PER-PERSON satisfaction question has the same "no real data to rank
      // by" gap, just phrased as "who" instead of "what percentage."
      pattern: /\b(?:best|top|good(?:est)?|greatest|happ(?:y|iest)|most\s+(?:impressive|satisfied))\s+(?:alumnus|alumna|alumni|graduates?)\b|\bpinaka[\s-]?(?:magaling|mahusay|matagumpay)\s+(?:na\s+)?(?:alumni|guraduwado)\b/i,
      message: `There's no composite "best"/"happiest" score for an individual alumnus in the tracer study — it isn't something the data can objectively rank. Real, trackable measures about a specific person include:\n\n- Employment status\n- Job title and company\n- Whether their job relates to their course\n- Promotion history (for those who've reported it)\n- Self-reported salary range (for the few who've shared it on their own profile)\n\nAsk about one of those, or name a specific alumnus to see their full profile.`,
    },
    {
      // "best company to work for" / "best employer" — deliberately "best"
      // ONLY (never "top"/"most"), so this can never collide with the real
      // "which companies employ the most alumni" headcount ranking.
      pattern: /\bbest\s+company\s+to\s+work\s+for\b|\bbest\s+employer\b|\bwhich\s+company\s+is\s+(?:the\s+)?best\b/i,
      message: `"Best" employer isn't something the tracer study tracks or can rank — there's no employer-quality or satisfaction score in the data. The closest real, trackable measure is which companies employ the MOST alumni (a headcount ranking) — ask "which companies hire the most alumni?" for that instead.`,
    },
  ];
  for (const t of SUBJECTIVE_SUPERLATIVE_TOPICS) {
    if (t.pattern.test(question) && !(t.exclude && t.exclude.test(question))) {
      return { text: t.message, direct: true, topic: 'clarify', filters: {} };
    }
  }

  // "College of X" / "Department of X" naming an academic unit by its FULL
  // name — extractRequestedCollege() (used further below to set
  // filters.college) only ever recognizes the short CODE (CCS, CBA, ...),
  // never a full name, so EVERY full-name college mention — a real college's
  // actual full name just as much as a made-up one — previously fell
  // through with no college filter set at all, silently answering with the
  // unfiltered WHOLE-DATABASE total as if it had correctly scoped to that
  // one college. Caught live: "How many alumni are from the College of
  // Underwater Basket Weaving?" (not a real TSU college) answered "There are
  // 702 graduates" — the exact same number a genuine college's full name
  // would ALSO have silently gotten, since neither ever resolved to an
  // actual filter. Declining and pointing to the known short codes is a
  // strict improvement either way: a bogus name no longer masquerades as a
  // real answer, and a genuine full name no longer silently loses its scope
  // and gets answered as if unscoped.
  if (/\b(?:college|department)\s+of\s+[a-z]/i.test(question) && !extractRequestedCollege(question)) {
    return {
      text: `I don't recognize a college by that name in the tracer study database. Known colleges (by abbreviation): CPAG, CCS, COS, CIT, COE, CBA, COED, CASS, CCJE, CAFA — please ask again using one of these.`,
      direct: true, topic: 'out_of_scope', filters: {},
    };
  }

  // "Compare the employment rate of CCS vs CBA" — every query function here
  // is scoped to exactly ONE college at a time (extractRequestedCollege()
  // below only ever returns the FIRST matching code it finds in the
  // question), so a second named college is always silently DROPPED, and
  // the single-college answer that comes back reads as if it had actually
  // compared the two. Caught live: "Compare the employment rate of CCS vs
  // CBA" kept only CCS and answered with CCS's rate alone, no indication CBA
  // was ever dropped from the question. Scoped to 2+ DISTINCT college codes
  // actually present (not just any comparative word) so an ordinary
  // single-college superlative question ("which program has the highest
  // employment rate in CCS?") is never affected — that's a real, already-
  // supported ranking question, not a dropped-entity comparison.
  const mentionedCollegeCodes = COLLEGE_CODES.filter(c => new RegExp(`\\b${c}\\b`, 'i').test(question));
  if (mentionedCollegeCodes.length >= 2) {
    return {
      text: `I can't directly compare multiple colleges in a single answer — each answer here is scoped to one college at a time. Please ask about them separately instead, e.g. "What is the employment rate for ${mentionedCollegeCodes[0]}?" and then "...for ${mentionedCollegeCodes[1]}?".`,
      direct: true, topic: 'out_of_scope', filters: {},
    };
  }

  // "How many alumni graduated in 2099?" — extractFilters()'s own year regex
  // deliberately caps at 1990-2039 (see its own comment) so an unrelated
  // 4-digit number elsewhere in a question is never mistaken for a batch
  // year. That's the right call for numbers with no year-context at all, but
  // "graduated in 2099"/"batch 2099"/"class of 2099" IS unambiguous year
  // context — it just names a year outside the plausible range, which
  // extractFilters() then treats as if no year had been mentioned at all,
  // silently falling through to the unfiltered whole-database total (262)
  // instead of ever acknowledging "2099" was typed. Caught live: asked for
  // no real reason other than robustness-testing, and got back the exact
  // same "262 graduates" a completely unqualified question would.
  // "grads/alumni/graduates FROM 2050" is just as unambiguous a year-context
  // phrasing as "batch 2050"/"class of 2050" above but was missing from this
  // list — caught live: "How many BSIT grads from 2050 are employed?" fell
  // through this whole check silently (no alternative here matched "from"),
  // then extractFilters()'s own capped year regex also didn't match 2050, so
  // the question answered with the unfiltered all-years BSIT/IT employed
  // count as if "2050" had never been typed, instead of the honest "no batch
  // 2050 on file" this exact function already gives for the other phrasings.
  // \d+ (not \d{4}) — a garbled year typo doesn't always land on exactly 4
  // digits ("graduated in 20232", a fumbled extra digit). \d{4}\b required an
  // exact 4-digit run terminated by a boundary, which a 5-digit (or longer)
  // run can never satisfy (the digit immediately after the first 4 is itself
  // a word character, so \b never fires there) — the whole match silently
  // failed and this block never ran at all, falling through to the
  // unfiltered whole-database total as if no year had been typed. Caught
  // live: "How many alumni graduated in 20232?" answered "264 graduates" (no
  // mention of the clearly-attempted year) the same as a completely
  // unqualified question would. The validity check below is now an anchored
  // exact match (`^...$`, not a `\b`-wrapped substring test) so a too-long
  // digit run is correctly rejected as invalid rather than accidentally
  // accepted via a valid 4-digit substring sitting inside it.
  const outOfRangeYearMatch = question.match(/\b(?:batch|class\s+of|graduated?\s+in)\s+(\d+)\b/i)
    || question.match(/\b(\d+)\s+batch\b/i)
    || question.match(/\b(?:grads?|alumni|graduates?)\s+from\s+(\d+)\b/i);
  if (outOfRangeYearMatch && !/^(199\d|20[0-3]\d)$/.test(outOfRangeYearMatch[1])) {
    // Bounded to the same plausible 1990-2039 range extractFilters()'s own
    // year regex enforces (not just $ne: null) — a bad ingested value (e.g.
    // a truncated "2004" stored as "4") would otherwise leak straight into
    // this user-facing message as if it were a real batch, answering "records
    // span batch 4 to 2026" instead of the actual real range. This computes
    // the honest bounds of ACTUAL plausible years on file; it does not fix
    // the underlying bad record itself.
    const bounds = await Graduate.aggregate([
      { $match: { yearGraduated: { $gte: 1990, $lte: 2039 } } },
      { $group: { _id: null, min: { $min: '$yearGraduated' }, max: { $max: '$yearGraduated' } } },
    ]);
    const range = bounds[0];
    return {
      text: range
        ? `There is no batch **${outOfRangeYearMatch[1]}** in the tracer study database — records on file span batch **${range.min}** to **${range.max}**.`
        : `There is no batch **${outOfRangeYearMatch[1]}** in the tracer study database.`,
      direct: true, topic: 'out_of_scope', filters: {},
    };
  }

  // "How many alumni are neither employed nor unemployed?" — a genuine
  // exclusion question (NOT status='Yes' AND NOT status='No') that none of
  // the single-value employmentStatus/excludeEmploymentStatus filters below
  // can express (they only ever exclude/match ONE status at a time). Without
  // this it fell through to the generic count topic with no filter at all,
  // showing the full unfiltered Yes/No breakdown — never actually answering
  // "neither" with a number. In this schema the two statuses that are
  // literally neither 'Yes' nor 'No' are Self-Employed and Never Employed —
  // answered as their own breakdown (not just a combined total) so the
  // reasoning behind the number is visible, not asserted as a black box.
  if (/\bneither\s+employed\s+nor\s+unemployed\b/i.test(question)) {
    const rows = await Graduate.aggregate([
      ...LIVE_SUBMISSION_ONLY,
      ...DEDUP,
      { $match: { employmentStatus: { $regex: '^(self.?employed|never employed)', $options: 'i' } } },
      { $group: { _id: '$employmentStatus', count: { $sum: 1 } } },
    ]);
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `There are **${total}** graduates who are neither employed nor unemployed (Self-Employed or Never Employed) in the tracer study database.\n\n`;
    rows.forEach(r => { out += `- **${r._id}**: ${r.count}\n`; });
    return { text: out, direct: true, topic: 'count', filters: {} };
  }

  // "How many alumni are neither male nor female?" — same "genuine exclusion
  // question" shape as "neither employed nor unemployed" just above, and the
  // SAME underlying bug it was written to fix: extractFilters()'s gender
  // regex below just looks for the literal word "female" ANYWHERE in the
  // question (see its own comment — "\bmale\b never matches inside
  // 'female'") with zero awareness of "neither...nor" negating it. Caught
  // live: this question's own text contains the literal word "female" (in
  // "nor female"), so filters.gender silently got set to 'Female' — the
  // exact OPPOSITE of what was asked — and confidently answered "216 female
  // graduates" as if it had correctly answered a question that wasn't about
  // female alumni at all. The survey's gender field has two values that are
  // genuinely neither Male nor Female: 'Other' and 'LGBTQIA+'.
  if (/\bneither\s+male\s+nor\s+female\b/i.test(question)) {
    const rows = await Graduate.aggregate([
      ...LIVE_SUBMISSION_ONLY,
      ...DEDUP,
      { $match: { gender: { $regex: '^(other|lgbtqia\\+?)$', $options: 'i' } } },
      { $group: { _id: '$gender', count: { $sum: 1 } } },
    ]);
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `There are **${total}** graduates who are neither male nor female (Other or LGBTQIA+) in the tracer study database.\n\n`;
    rows.forEach(r => { out += `- **${r._id}**: ${r.count}\n`; });
    return { text: out, direct: true, topic: 'count', filters: {} };
  }

  // "Who are Liam Miranda and Vincent De Jesus?" — 2+ named people at once.
  // Checked before the single-name branch below (extractPersonNames() itself
  // falls back to the single-name extractor when its own narrower pattern
  // doesn't match, so a plain single-person question never reaches this
  // branch at all — only genuinely 2+-name questions do).
  const personNames = extractPersonNames(question);
  if (personNames.length >= 2) {
    const results = await Promise.all(personNames.map(n => queryPersonLookup(n)));

    // extractPersonNames() no longer requires its candidates to look like
    // real (capitalized) names — a lowercase-typed name is just as valid —
    // so an ordinary lowercase phrase that happens to match the trigger
    // wording ("give information about the skills and companies...", or
    // "...graduates WHO ARE currently employed full-time AND work locally" —
    // "who are" plus an "and"-joined descriptive clause, not a list of
    // people at all) can still produce 2+ "candidates" here. If literally
    // NONE of them resolved to a real record, this was never a genuine
    // multi-person question — fall through to normal topic detection
    // further below instead of confidently reporting "no record found" for
    // phantom people. This used to be a bare `if (!results.some(Boolean))
    // return null;` — despite this very comment already saying "fall
    // through to normal topic detection," that `return null` actually
    // exited queryInner() ENTIRELY (the caller then treats a null result as
    // "no deterministic answer, try RAG"), never truly reaching this
    // function's own topic detection a few hundred lines below. Caught
    // live: "Show me the percentage of Computer Science graduates who are
    // currently employed full-time and work locally" — a completely
    // answerable program + employmentType + workLocation rate question —
    // matched "who are" and split "currently employed full-time and work
    // locally" on "and" into two phantom name candidates; neither resolved
    // to a real person, and the WHOLE question was abandoned to a generic
    // RAG refusal instead of ever reaching topic detection. Wrapping the
    // rest of this block in `if (results.some(Boolean))` (instead of an
    // early return on the inverse) makes the actual control flow match what
    // the comment already promised — at least one real match is still
    // enough to commit to the multi-person path below (the rest may still
    // legitimately be misses, per the existing per-person "no record found"
    // note further down).
    if (results.some(Boolean)) {
      // Any ambiguous match among the batch — show that disambiguation
      // verbatim (deterministic, never sent to the LLM), with a one-line
      // note for each other name so the user isn't left wondering what
      // happened to the rest of the batch.
      const ambiguousIdx = results.findIndex(r => r && r.ambiguous);
      if (ambiguousIdx !== -1) {
        const lines = [results[ambiguousIdx].text];
        results.forEach((r, i) => {
          if (i === ambiguousIdx) return;
          if (!r) lines.push(`\n*No record found for ${personNames[i]}.*`);
          else if (!r.ambiguous) lines.push(`\n*${personNames[i]} was also found — ask about them separately for details.*`);
        });
        return { text: lines.join('\n'), direct: true, topic: 'person_lookup_ambiguous', filters: {} };
      }

      // No ambiguity — combine each found person's facts block, and note any
      // name that had no match at all so the LLM narration (forced for
      // 'person_lookup' in ragService.js) has an explicit "don't invent this
      // person" signal instead of silence.
      const combined = results
        .map((r, i) => (r ? r.text : `_No record found for ${personNames[i]}._`))
        .join('\n\n---\n\n');
      // Empty filters — deriving shared follow-up suggestions across several
      // people's potentially different industries/programs isn't well-defined;
      // suggestFollowUps('person_lookup', {}) still yields the safe generic
      // chips from the single-person case above.
      return { text: combined, direct: true, topic: 'person_lookup', filters: {} };
    }
  }

  // "Compare BSIT and BSCS employment rates" / "employment rate of male vs
  // female" — checked before topic/filter detection below, same reasoning as
  // the person-lookup branches above: extractFilters() only ever resolves a
  // SINGLE value per filter type (program/gender/etc — last-match-wins), so
  // running it on the whole question would silently keep only ONE of the two
  // named cohorts and answer as if this were an ordinary single-cohort rate
  // question. queryCompare() itself extracts each side independently and
  // returns null (safe fallthrough to normal topic dispatch below) whenever
  // it can't cleanly resolve two DIFFERENT values of the SAME dimension —
  // e.g. "employed vs unemployed" resolves neither program nor gender on
  // both sides, so it correctly falls through to queryEmployment()'s
  // existing Yes/No breakdown instead of a broken comparison.
  if (/\b(compare|\bvs\.?\b|\bversus\b|difference\s+between|ihambing|ikumpara|paghambingin|pagkakaiba\s+ng)\b/i.test(question)) {
    const compareResult = await queryCompare(question);
    if (compareResult) return compareResult;
    // "...reported that their job is 'directly related' versus 'somewhat
    // related' to their degree" — queryCompare() only knows the program/
    // gender/year/industry/workLocation dimensions, so it correctly returns
    // null for this one; see queryJobRelatedCompare()'s own comment for why
    // this is checked here instead of duplicated into every topic's own
    // dispatch arm.
    const jobRelatedLevels = extractAllJobRelatedLevels(question);
    if (jobRelatedLevels.length >= 2) {
      // This whole "compare/vs" bypass runs BEFORE the shared `filters`
      // (extractFilters(question)) is computed further below — queryCompare()
      // itself doesn't need it (it extracts its own filters per split half),
      // and this needs its own early, local extraction for the same reason.
      const earlyFilters = extractFilters(question);
      const jobRelatedCompareResult = await queryJobRelatedCompare(earlyFilters, jobRelatedLevels);
      if (jobRelatedCompareResult) {
        const { text, chart } = typeof jobRelatedCompareResult === 'string' ? { text: jobRelatedCompareResult, chart: null } : jobRelatedCompareResult;
        return { text, direct: true, topic: 'comparison', filters: earlyFilters, chart: chart || null };
      }
    }
  }

  // "...graduates in the Customer Service and Support industry who have
  // participated in professional development activities (e.g., workshops,
  // seminars) OR earned awards" — an OR of two separate Yes/No fields, no
  // "compare/vs" trigger word at all (so the block just above never gets a
  // turn), scoped by whatever else resolves (here, industry). See
  // WANTS_TRAINING_OR_AWARDS_PATTERN's own comment. Checked early, same
  // reasoning as the jobRelated comparison above — this combined shape
  // isn't tied to any one specific topic's own dispatch arm.
  if (WANTS_TRAINING_OR_AWARDS_PATTERN.test(question)) {
    const earlyFilters = extractFilters(question);
    const trainingOrAwardsResult = await queryTrainingOrAwards(earlyFilters);
    if (trainingOrAwardsResult) {
      return { text: trainingOrAwardsResult, direct: true, topic: 'count', filters: earlyFilters };
    }
  }

  // Company/employer lookups ("Who works at Sutherland?", "how many work at
  // Sutherland?") used to be intercepted HERE as an isolated bypass
  // (queryByCompany(), checked before topic/filter detection) that ignored
  // every other filter and returned `filters: {}` — meaning a follow-up like
  // "Ilan sa kanila ang BSIT?" (how many of THEM are BSIT) had no company
  // filter to build on, and "who are they?" after it couldn't resolve either.
  // filters.company/filters.companyRegex (extracted above, in extractFilters())
  // now flow through the SAME topic dispatch as job title/industry below, so
  // company-shaped questions can combine with other filters and be reused by
  // query()'s multi-turn context accumulation (buildSeedFilters(), further
  // below) — see queryCount()/queryNames()'s own filters.companyRegex handling.

  // "Is Joseph Tolentino an alumnus?" — a database-membership question (see
  // IS_ALUMNI_PATTERN's own comment for the pattern itself). A CONFIRMED
  // match is safe to assert positively right here (Graduate IS the
  // authoritative source for "yes, this person has a tracer-study record").
  // A miss is deliberately NOT asserted as "no" here, though — this looked
  // like a clean case for a direct negative until it wasn't: verified live
  // that someone genuinely mentioned as a real MIT alumnus in the ingested
  // accreditation PDF (RAG content, not a Graduate row — he never submitted
  // the tracer study) got wrongly told "No, I don't have a record of him"
  // by an earlier version of this fix that skipped RAG entirely on a
  // Graduate miss. The original "vector search may still have relevant
  // unstructured mentions" reasoning (see the personName branch below)
  // applies here too — RAG still gets its turn on a miss; see
  // ragService.js's own post-RAG fallback for the "genuinely not found
  // anywhere" case (the actual "is Joseph Tolentino alumni?" bug this was
  // meant to fix).
  const isAlumniMatch = question.match(IS_ALUMNI_PATTERN);
  if (isAlumniMatch) {
    const candidateName = isAlumniMatch[1].trim() || null;
    if (candidateName) {
      const lookup = await queryPersonLookup(candidateName);
      if (lookup && !lookup.ambiguous) {
        return { text: `Yes — ${lookup.text}`, direct: true, topic: 'person_lookup', filters: lookup.personFilters || {} };
      }
      if (lookup && lookup.ambiguous) {
        return { text: lookup.text, direct: true, topic: 'person_lookup_ambiguous', filters: {} };
      }
      // Falls through to RAG (personName branch below, then ragService.js)
      // instead of returning here — see this block's own comment above.
    }
  }

  // "who is danicamanlapig@gmail.com?" / a bare email alone — the single
  // most unambiguous way to identify one specific person, and exactly what
  // the ambiguous-match disambiguation list itself shows for each entry (see
  // queryPersonLookup()'s own comment). Checked before every name-based
  // branch below so an email-only follow-up resolves directly without
  // needing a name at all.
  const emailMatch = question.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/);
  if (emailMatch) {
    const lookup = await queryPersonLookupByEmail(emailMatch[0]);
    if (lookup) {
      return { text: lookup.text, direct: true, topic: 'person_lookup', filters: lookup.personFilters || {} };
    }
  }

  // "Rain Thora from Batch 2025" / "Rain Thora from BSIT" — a bare name (no
  // "who is"/"sino"/etc. trigger word at all) followed by a batch-year or
  // program qualifier, the natural way to answer an ambiguous-match prompt
  // (which now shows each match's own batch year AND program — see
  // queryPersonLookup()'s disambiguation list). Without a dedicated pattern
  // for this shape, it fell through to a generic year-filtered NAMES LIST
  // instead of a real person lookup — caught live: 2 real "Rain Thora"
  // accounts exist (batch 2025 and 2026), and this answered with a bare
  // "Alumni Batch 2025 (1 total): 1. Rain Thora" list instead of that
  // person's actual details.
  const bareNameFromBatchMatch = question.match(/^\s*([a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*(?:\s+[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*){0,4})\s+from\s+batch\s+(\d{4})\b/i);
  if (bareNameFromBatchMatch) {
    const lookup = await queryPersonLookup(bareNameFromBatchMatch[1].trim(), { yearGraduated: parseInt(bareNameFromBatchMatch[2], 10) });
    if (lookup) {
      return {
        text: lookup.text,
        direct: true,
        topic: lookup.ambiguous ? 'person_lookup_ambiguous' : 'person_lookup',
        filters: lookup.personFilters || {},
      };
    }
  }

  // "Rain Thora from BSIT" — same idea as bareNameFromBatchMatch just above,
  // disambiguating by PROGRAM instead of batch year. Reuses extractFilters()'s
  // own course-abbreviation resolution rather than a second hand-rolled
  // course-name regex.
  const bareNameFromProgramMatch = !bareNameFromBatchMatch
    && question.match(/^\s*([a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*(?:\s+[a-zA-Z][a-zA-ZÀ-ÖØ-öø-ÿ.'-]*){0,4})\s+from\s+([a-zA-Z][a-zA-Z .'-]{1,40})\s*[?.!]?\s*$/i);
  if (bareNameFromProgramMatch) {
    const programGuess = extractFilters(`from ${bareNameFromProgramMatch[2]}`).program;
    if (programGuess) {
      const lookup = await queryPersonLookup(bareNameFromProgramMatch[1].trim(), { program: programGuess });
      if (lookup) {
        return {
          text: lookup.text,
          direct: true,
          topic: lookup.ambiguous ? 'person_lookup_ambiguous' : 'person_lookup',
          filters: lookup.personFilters || {},
        };
      }
    }
  }

  // "Where is Bryan Canlapan currently working?" — a lookup for ONE named
  // person, structurally different from every other question this file
  // answers (all of which aggregate across many respondents). Checked before
  // topic detection since a proper name doesn't match any TOPIC_PATTERNS
  // keyword and would otherwise fall through to a generic aggregate that has
  // nothing to do with the person asked about. If no matching person is
  // found, fall through to null (RAG) rather than assert person not found —
  // vector search may still have relevant unstructured mentions.
  const personName = extractPersonName(question);
  if (personName) {
    // The tracer study only ever asks for an alumnus's PRESENT occupation
    // (occupationTitle) — there is no separate "first job after graduating"
    // field anywhere in the data model. Answering with current-job data
    // under a "first job" label would be presenting real data under the
    // wrong fact (see SYSTEM_PROMPT rule 21's same current-vs-first-job
    // distinction) — decline honestly instead, checked before the lookup
    // even runs since this is true regardless of who the named person is.
    if (/\bfirst\s+(?:job|position|occupation|employer|company)\b/i.test(question)) {
      return {
        text: `The tracer study only tracks each alumnus's current/present occupation — it does not record what their first job after graduating was, so this cannot be answered from the available data.`,
        direct: true,
        topic: 'person_lookup_untracked',
        filters: {},
      };
    }
    // "who is Rain Thora from Batch 2025" — WHO_IS_PATTERN's own lookahead
    // fix stops the NAME capture cleanly before "from Batch 2025", but that
    // trailing text is still real disambiguating info sitting right there in
    // the question — extracted here so a same-named ambiguous match can
    // resolve to the one actual person meant, instead of just re-showing the
    // identical list a second time with no progress made. Program disambig
    // reuses extractFilters()'s own course-abbreviation resolution ("BSIT"
    // -> "Information Technology") so "who is Rain Thora from BSIT" works
    // the same way the batch-year form does.
    const yearDisambigMatch = question.match(/\bfrom\s+(?:batch|year)\s+(\d{4})\b/i) || question.match(/\bbatch\s+(\d{4})\b/i);
    const disambiguators = {
      ...(yearDisambigMatch ? { yearGraduated: parseInt(yearDisambigMatch[1], 10) } : {}),
      ...(extractFilters(question).program ? { program: extractFilters(question).program } : {}),
    };
    const requestedAttribute = extractRequestedPersonAttribute(question);
    const lookup = await queryPersonLookup(personName, disambiguators, requestedAttribute);
    if (lookup) {
      // The ambiguous (multiple-match) case is a deterministic instruction
      // to the user, not narratable data — a distinct topic so ragService.js
      // never routes it through LLM narration the way 'person_lookup' is.
      return {
        text: lookup.text,
        direct: true,
        topic: lookup.ambiguous ? 'person_lookup_ambiguous' : 'person_lookup',
        filters: lookup.personFilters || {},
      };
    }
    return null;
  }

  let topic     = detectTopic(question);
  // seedFilters (from ragService.js's conversation-context accumulation)
  // fill in whatever this question's OWN text doesn't mention — spread order
  // means a key extractFilters(question) actually resolves always wins over
  // the seeded value, so "who are they?" (resolves nothing itself) inherits
  // the seed entirely, while "how many are from BSIT?" (resolves its own
  // program) keeps BSIT even if an older, different program was seeded.
  const ownFilters = extractFilters(question);
  const filters = { ...seedFilters, ...ownFilters };

  // ownFilters.showAllPrograms ("across all/every programs/specializations/
  // courses/tracks" — see extractFilters()'s own comment) is an explicit
  // instruction that THIS comparison must span everything, which directly
  // contradicts any single program/batch/status scope a PRIOR, unrelated
  // turn left behind in seedFilters (this turn's own text never repeats
  // that old scope, so the merge above silently kept it). Cleared here,
  // before topic dispatch and before the mostRecentBatch resolution just
  // below — otherwise an inherited filters.mostRecentBatch would still
  // resolve to a real yearGraduated and re-narrow the "all" comparison right
  // back down. Caught live: "...comparing employment rates across all
  // specializations" right after "...from the most recent batch are still
  // seeking employment" inherited BOTH that batch year AND employmentStatus
  // 'No', collapsing an "across all specializations" request down to a
  // single specialization's UNEMPLOYMENT rate for one batch — the opposite
  // of the employment-rate comparison across every specialization actually
  // asked for.
  if (ownFilters.showAllPrograms) {
    delete filters.program;
    delete filters.programLabel;
    delete filters.yearGraduated;
    delete filters.yearsGraduated;
    delete filters.yearFrom;
    delete filters.yearTo;
    delete filters.mostRecentBatch;
    delete filters.employmentStatus;
    delete filters.excludeEmploymentStatus;
    delete filters.employmentStatuses;
  }

  // An ADMIN (no college tied to their account at all — a coordinator
  // always has one, enforced via AsyncLocalStorage/getCollegeScope()) asking
  // a by-program/specialization COMPARISON question with no college named
  // anywhere (not in this question, not in an earlier turn, not "all
  // colleges" explicitly) pools every college's programs into one ranking
  // with no indication that's what happened — today that's silently just
  // CCS's own programs (the only college with real tracer data on file),
  // but as other colleges get their own tracer forms/specializations, the
  // SAME program-breakdown chart would start conflating two colleges'
  // unrelated programs into one misleading comparison with no way to tell.
  // Same "ask first, resolve on the next turn" clarify queryEventOverview()/
  // queryEventAttendees()/etc. already use for the identical college-
  // ambiguity shape (see CLARIFY_COLLEGE_QUESTION's own definition) —
  // reused here rather than inventing a second wording for the same ask.
  // !filters.program — a question that already names ONE specific program
  // isn't asking for a cross-college comparison in the first place, so it's
  // exempted the same way a named college would be.
  if (BY_PROGRAM_QUESTION_PATTERN.test(question) && !filters.program) {
    const scopedCollege    = getCollegeScope();
    const requestedCollege = extractRequestedCollege(question);
    if (!scopedCollege && !requestedCollege && !filters.college && !ALL_COLLEGES_PATTERN.test(question)) {
      return { text: CLARIFY_COLLEGE_QUESTION, direct: true, topic: 'clarify_college', filters: {} };
    }
  }

  // Resolves the filters.mostRecentBatch sentinel (set by extractFilters()
  // for "the most recent/latest/newest batch" — see its own comment there)
  // into a concrete filters.yearGraduated, the one DB round-trip this whole
  // function needs for that. Done here, before topic dispatch, so every
  // downstream function sees an ordinary yearGraduated filter and needs no
  // special-casing of its own — same scoping (LIVE_SUBMISSION_ONLY, college
  // AsyncLocalStorage) every other Graduate query in this file already gets.
  if (filters.mostRecentBatch && !filters.yearGraduated) {
    const [latest] = await Graduate.aggregate([
      ...LIVE_SUBMISSION_ONLY,
      { $match: { yearGraduated: { $ne: null } } },
      { $group: { _id: null, max: { $max: '$yearGraduated' } } },
    ]);
    if (latest) filters.yearGraduated = latest.max;
  }

  // "make it a line graph" (filters.requestedChartType) carries NO topic
  // content of its own at all — unlike every other bare continuation this
  // function guesses a topic for below (show all/how many/batch 2020/...,
  // which all still contain SOME topic-relevant word), detectTopic()
  // correctly finds nothing here, and none of the topic-guessing heuristics
  // further down (bare industry-noun-phrase, names-vs-count fallback) are
  // meaningful for it either — caught live: "make it a line graph" (with
  // seedFilters={} from a content-only prior turn like "What trainings did
  // alumni attend?", which sets no filter of its own) got guessed as the
  // 'names' topic and confidently answered with an unrelated alumni roster.
  // Returning null here — same "give up, let the caller retry" contract the
  // PERSON_LOOKUP block above already uses — lets ragService.js's own
  // fallback chain retry with the PREVIOUS real question's full text
  // appended (see its isChartTypeOnlyContinuation() question-rewrite),
  // which is what actually resolves the real topic.
  // filters.wantsChart (the type-less "show me a graph/chart" cousin of
  // requestedChartType — see its own comment in extractFilters()) carries
  // exactly the same "no topic content of its own" shape, so it gets the
  // identical retry treatment.
  //
  // Checked against ownFilters (THIS turn's own text), not the merged
  // filters — a chart request arriving right after a context-seeded filter
  // ("Can you show me the employment rate of bsit?" -> "can you present it
  // in a graph...") otherwise never reached this guard at all: `filters`
  // then also carries seedFilters.program='Information Technology', which
  // fails the old "every key is chart-related" check, falling through to
  // the broader null-topic fallback a few lines below — that fallback saw
  // 'program' as "real content present" and defaulted topic to 'names'
  // (no "how many" in the bare chart-request text), returning a full BSIT
  // alumni ROSTER instead of ever reaching the retry that resolves the real
  // 'rate' topic. Asking for a chart is categorically incompatible with a
  // names-list answer regardless of what else got inherited — any turn
  // whose OWN text asked for one should always retry with the real prior
  // question's full text, never guess 'names' out of unrelated seeded filters.
  // Excludes a question whose own text already matches one of the dedicated
  // "topic stays null but is actually answered by its own early bypass"
  // shapes further below (the batch/year superlative ranking, or a
  // trend/year-over-year question) — those bypasses run independently of
  // detectTopic()/topic entirely, so a fully self-contained, answerable
  // question in either shape still has topic===null here and would
  // otherwise be wrongly bailed out as if it were a bare, content-free
  // chart-only continuation. See BATCH_YEAR_SUPERLATIVE_PATTERN's own
  // comment for the exact live failure this fixes.
  const isHandledByLaterBypass = (BATCH_YEAR_SUPERLATIVE_PATTERN.test(question) && SUPERLATIVE_DIRECTION_WORD_PATTERN.test(question))
    || TREND_PATTERN.test(question);
  if (topic === null && (ownFilters.requestedChartType || ownFilters.wantsChart) && !isHandledByLaterBypass) {
    return null;
  }
  // showAll/showLimit are mutually exclusive "how much of a names list to
  // show" signals — whichever one THIS turn's own text set (if either)
  // must replace, not combine with, whichever the OTHER one seedFilters
  // carried in from an earlier turn's answer. Without this: "show 50" right
  // after an earlier "show all" stayed unbounded (inherited showAll never
  // got cleared), and "show more" right after an earlier "show 50" stayed
  // capped at that old fixed number (inherited showLimit outranked the
  // fresh showAll in queryNames()'s own `filters.showLimit || ...` check)
  // instead of actually expanding — caught live on a 3-hop chain: "who is
  // working?" -> "show 50" -> "show more" silently kept re-showing 50.
  if ('showLimit' in ownFilters) delete filters.showAll;
  if ('showAll' in ownFilters) delete filters.showLimit;

  // "Who are Software Engineers?" / "who is a Nurse?" — extractFilters()
  // above already parses a job title out of the bare "who is/are X" fallback
  // (its own comment explains why: no "working as"/"that are" anchor
  // needed), but detectTopic() has no matching entry AT ALL for this shape —
  // TOPIC_PATTERNS.names' own "who is/are" alternative requires an
  // alumni-referring noun nearby ("who are the alumni..."), and
  // EMPLOYMENT_SIGNAL needs a literal employ/job/work/status root word,
  // neither of which "Software Engineers" contains. Topic detection failed
  // silently while filter extraction succeeded, so the question fell all the
  // way through to RAG (which has no names/titles to search) and refused.
  // A resolved jobTitleRegex is itself strong enough evidence this was a
  // real names-by-title query to route it as 'names' even with no other
  // topic keyword present. Same reasoning extends to ANY resolved filter —
  // not just jobTitleRegex/companyRegex/industry/program: a bare
  // group-referent follow-up ("who are they?", "sino sino sila?") that
  // resolved NO topic keyword of its own (it's just "who/sino"+a pronoun)
  // but DID inherit filters from conversation-context accumulation (see
  // ragService.js's buildSeedFilters/contextQuestions) is exactly as strong
  // evidence of a names request, even when the inherited filter is
  // gender/employmentStatus alone (no job title, company, industry, or
  // program) — caught live TWICE: once for a companyRegex-only case ("who
  // are they?" after a Sutherland count), again for a gender+status-only
  // case ("sino sino sila?" after "ilan ang babaeng may trabaho?" — female +
  // employed, neither a job title nor a company). Both fell through to an
  // unhelpful "not sure which group" clarify instead of listing the matching
  // alumni. `programLabel` excluded — a display-only companion to `program`,
  // never itself a real filter.
  //
  // Defaults to 'count' instead when the question itself asks "how many"/
  // "ilan"/"number of"/"total"/"count" — "how many are from BSCS?"
  // (elliptical, no "alumni" noun for TOPIC_PATTERNS.count to key off) and
  // "number of batch 2022" (no "alumni/records/graduates" noun right after
  // "number of" for TOPIC_PATTERNS.count's own regex to match) both need to
  // answer with a NUMBER, not silently switch into a names list just because
  // a strong filter (here, yearGraduated) happens to be present. Previously
  // only recognized literal "how many"/"ilan", so "number of batch 2022"
  // fell through to 'names' and printed a 50-alumni roster instead of a count.
  // A bare "yung batch 2020?"-style continuation (see BARE_BATCH_MENTION_PATTERN
  // in ragService.js's isEllipticalContinuation()) correctly inherits real
  // context via seedFilters now, but the question's OWN text says nothing
  // about what it actually wants to know about that batch (a count? the
  // names? the rate?) — silently guessing between 'count'/'names' below used
  // to answer with a full, possibly-unwanted name dump. Ask instead of
  // guessing, same "clarify, don't guess" convention as the ambiguous-
  // person-lookup and "not sure which group" messages elsewhere. Only fires
  // when BOTH (a) real context was actually inherited from a prior turn
  // (seedFilters non-empty — a standalone "batch 2020?" with nothing
  // established yet has nothing to clarify against and still needs a normal
  // answer, not a clarify loop) AND (b) this turn's OWN extraction resolved
  // NOTHING but the bare year itself (a question that also names its own
  // real content, e.g. "who is from batch 2020?", already has a topic or a
  // real filter of its own and never reaches this branch).
  if (topic === null && Object.keys(seedFilters).length > 0) {
    const ownKeys = Object.keys(ownFilters);
    const isBareYearNarrowing = ownKeys.length > 0
      && ownKeys.every(k => k === 'yearGraduated' || k === 'yearsGraduated' || k === 'yearFrom' || k === 'yearTo');
    if (isBareYearNarrowing) {
      const yearLabel = filters.yearsGraduated ? `Batches ${filters.yearsGraduated.slice().sort((a, b) => a - b).join(', ')}`
        : filters.yearGraduated ? `Batch ${filters.yearGraduated}`
        : (filters.yearFrom && filters.yearTo) ? `Batch ${filters.yearFrom} to ${filters.yearTo}`
        : filters.yearFrom ? `${filters.yearFrom} onward`
        : 'that batch';
      const statusWord = filters.employmentStatus === 'Yes'            ? 'employed'
                        : filters.employmentStatus === 'No'             ? 'unemployed'
                        : filters.employmentStatus === 'Self-Employed'  ? 'self-employed'
                        : filters.employmentStatus === 'Never Employed' ? 'never-employed'
                        : '';
      const subject = statusWord ? `${statusWord} alumni in ${yearLabel}` : `alumni in ${yearLabel}`;
      return {
        text: `What would you like to know about ${subject}? For example, how many there are, the full list of names, or the employment rate.`,
        direct: true,
        topic: 'clarify',
        filters,
        chart: null,
        suggestions: [
          `How many ${subject} are there?`,
          `Show me the list of ${subject}.`,
          `What is the employment rate for ${yearLabel}?`,
        ],
      };
    }
  }

  // "how about in the last 5 days?" — a continuation of a tracer-activity
  // question whose own text has no "updated"/"added" word for
  // TOPIC_PATTERNS.tracer_activity to key off (topic detection resolves
  // null), but DID inherit filters.tracerActivityAction from the prior
  // turn via seedFilters. Without this branch it fell into the generic
  // count/names fallback just below, which has no idea what
  // tracerActivityAction means and silently answered with the total
  // Graduate count instead — worse, it read as though the new "5 days"
  // window had been understood when it had actually been ignored
  // entirely (caught live: identical text to the PRIOR turn's "last 30
  // days" answer). The window is genuinely new information here, unlike a
  // "yung batch 2020?"-style narrowing where the question restates
  // nothing — so this re-runs the query with a real new number instead of
  // clarifying, UNLESS even the window can't be resolved from this
  // question's own text either (queryTracerActivity's UNRESOLVED_WINDOW),
  // in which case guessing "ever" for what was clearly meant to narrow the
  // prior answer would be worse than asking.
  if (topic === null && filters.tracerActivityAction && !ownFilters.tracerActivityAction) {
    const action = filters.tracerActivityAction;
    const result = await queryTracerActivity(question, action);
    if (result === UNRESOLVED_WINDOW) {
      const actionLabel = action === 'not_updated' ? 'not updated' : action === 'added' ? 'been added' : 'updated';
      return {
        text: `Which time window did you mean — today, the last 7 days, the last 30 days, or all-time?`,
        direct: true,
        topic: 'clarify',
        filters,
        chart: null,
        suggestions: [
          `How many alumni have ${actionLabel} in the last 7 days?`,
          `How many alumni have ${actionLabel} in the last 30 days?`,
        ],
      };
    }
    return { text: result, direct: true, topic: 'tracer_activity', filters };
  }

  // 'showAll'/'showLimit'/'rankDirection'/'showAllIndustries'/'answerShape'/
  // 'requestedChartType' excluded from the "do we have enough to guess a
  // topic" check — same "carries no topic content of its own" principle as
  // ragService.js's isShowMoreOnlyContinuation() (see NAMES_PREVIEW_LIMIT's
  // own comment above). All six only ever MODIFY an already-established
  // ranked/list/chart topic (how much to show, which direction to sort,
  // count-vs-names shape, which chart type to render) — none of them imply
  // "this is a names question" on their own. Without this exclusion, a bare
  // "show all" continuing a topic that itself named no other filter (e.g. an
  // open "least common INDUSTRIES" breakdown — no specific industry named,
  // so seedFilters contributes only rankDirection) left `filters` holding
  // just {rankDirection:'least', showAll:true}, which this fallback wrongly
  // read as "real content is present" and defaulted to a full unfiltered
  // ALUMNI NAMES dump — completely dropping the industries topic the "show
  // all" was actually asking to expand. Caught live repeatedly: a bare
  // {showAll:true} (before rankDirection existed), rankDirection itself
  // right after being added for a different bug (see wantsRankHighest()
  // above), answerShape right after being added for the count-vs-names bug
  // below, and now requestedChartType — same fallback, same fix shape, one
  // more key to exclude each time a new turn-carrying filter with no real
  // topic content of its own gets introduced.
  if (topic === null && Object.keys(filters).some(k => !['programLabel', 'showAll', 'showLimit', 'rankDirection', 'showAllIndustries', 'answerShape', 'requestedChartType', 'wantsChart'].includes(k))) {
    // filters.answerShape (extractFilters() above) wins over re-scanning
    // `question` here — it carries which SHAPE of answer (a count vs. a
    // names list) was actually established across a bare narrowing
    // continuation ("how about last month") that repeats neither "how many"
    // nor "who"/"list" itself. See answerShape's own comment for the live
    // failure this fixes: that follow-up silently turned an established
    // 49-graduate COUNT into an unrelated full NAMES dump.
    topic = filters.answerShape || (/\b(?:how\s+many|ilan(?:g)?|number\s+of|total|count)\b/i.test(question) ? 'count' : 'names');
  }

  // Detect government/private SECTOR questions (no dedicated field in data)
  const isSectorQuestion = /\b(government|private)\s*sector\b|\bsector\b.{0,20}\b(government|private)\b/i.test(question);

  // "Which program has the highest job alignment?" — bare "job alignment"
  // doesn't satisfy TOPIC_PATTERNS.job_relevance (which requires
  // "align...with/to...course/study/etc" specifically), so this question's
  // topic falls through to the generic 'employment'/'rate' default — where
  // the "which program" branches used to route unconditionally to
  // queryEmploymentRateByProgram(), silently answering with the WRONG
  // metric (employment rate instead of job-course alignment rate).
  const isJobAlignmentQuestion = /\b(job.?course|job.?related|job.?relevance|job.?align\w*|related\s+to\s+(?:their|his|her|its)?\s*(course|degree|program|study))\b/i.test(question);

  // "Which skill/competency do alumni rate themselves lowest/highest in?" —
  // a cross-category comparison (which ONE of the 8 competencies is
  // strongest/weakest), genuinely different from queryCompetencies()'s
  // default behavior (comparing RATING LEVELS within each category
  // separately — see queryCompetencyRanking()'s own comment for the live bug
  // this fixes). Gated on no specific competency already resolved — "which
  // skill" bare phrasing never sets filters.competency (COMP_MAP only
  // matches specific named skills like "technical skills"/"problem
  // solving"), so this never collides with a genuine single-competency
  // question.
  const isCompetencyRankingQuestion = !filters.competency && /\bwhich\s+(?:skill|competency|competencies|area)\b|\b(?:anong|aling)\s+(?:kasanayan|skill)\b/i.test(question);

  // "Which course produces the most unemployed graduates?" — filters.employmentStatus
  // is already correctly extracted as 'No' by this point, but the "which
  // program/course" dispatch branches used to route unconditionally to
  // queryEmploymentRateByProgram() (always highest EMPLOYMENT rate, no
  // "unemployed"/"lowest" option at all), silently answering the opposite
  // metric from what was asked.
  // filters.employmentStatus alone misses "unemployment rate" (a noun
  // phrase) — only the adjective "unemployed" sets that filter, so a direct
  // substring check is needed too (matches "unemployed" AND "unemployment"
  // alike), same approach already used by the equivalent by-year bypass.
  // Checked against ownFilters (THIS turn's own text), not the merged
  // filters — an employmentStatus='No' INHERITED from an earlier, unrelated
  // "still seeking employment" turn otherwise silently flips a later,
  // unrelated by-program EMPLOYMENT-rate question into an UNEMPLOYMENT-rate
  // one it never asked for. Same "ownFilters, not merged filters" guard
  // showAllPrograms's own clearing above already needs for the identical
  // reason. A question that explicitly asks about unemployment itself still
  // sets this correctly either way, since THAT question's own ownFilters
  // carries employmentStatus='No' (or matches /\bunemploy/) regardless.
  const wantsUnemploymentByProgram = ownFilters.employmentStatus === 'No' || /\bunemploy/i.test(question);
  const programSuperlativeDirection = wantsHighestDirection(question) ? 'highest' : 'lowest';

  // "How many alumni work locally vs. abroad?" — a COMPOUND location
  // comparison deliberately leaves filters.workLocation unset (see
  // extractFilters()) so queryWorkLocation() returns the full local+abroad
  // breakdown instead of just one side. But "how many alumni" also matches
  // the 'count' TOPIC_PATTERN, which is checked before 'work_location' and
  // wins topic detection outright — so the 'count'/'rate' dispatch branches
  // below need their own explicit check for this case, or they silently
  // fall through to a generic, location-blind answer (this exact phrase is
  // also one of the system's own suggested follow-up questions for the
  // work_location topic, so the bug was one click away from every user).
  const isCompoundLocationQuestion = !filters.workLocation && TOPIC_PATTERNS.work_location.test(question);

  // "What percentage of employed graduates have been in their current job
  // for 2 to 3 years or longer?" — checked before isCompoundLocationQuestion
  // and every other 'rate' branch below; see YEARS_IN_JOB_CONTEXT_PATTERN's
  // own comment for why this needs its own explicit, early check (same
  // first-match-wins collision class as the other overrides in this file).
  // Both the context AND a recognized threshold must be present — tenure
  // wording alone, with no parseable "X years or longer"/"at least X"/"less
  // than X" threshold, falls through to the normal dispatch below rather
  // than guessing which brackets were meant.
  const yearsInJobThreshold = YEARS_IN_JOB_CONTEXT_PATTERN.test(question) ? extractYearsInJobThreshold(question) : null;
  // "...less than 6 months compared to those with 3 to 5 years or more than
  // 5 years of tenure" — 2+ DISTINCT brackets named explicitly, a
  // comparison rather than a single threshold (see
  // extractMentionedYearsInJobBrackets()'s own comment). Checked ahead of
  // yearsInJobThreshold at every dispatch site below — a question naming
  // actual bracket labels is a stronger, more specific signal than a single
  // parsed threshold, and the two are mutually exclusive in practice anyway
  // (a "3 to 5 years" bracket mention would itself satisfy neither
  // threshold regex above).
  const mentionedTenureBrackets = YEARS_IN_JOB_CONTEXT_PATTERN.test(question) ? extractMentionedYearsInJobBrackets(question) : [];
  // "What is the AVERAGE job tenure for BSIT - Web and Mobile Application
  // graduates?" — tenure context present, but no specific threshold or
  // bracket named at all (yearsInJobThreshold/mentionedTenureBrackets both
  // empty) — this asks for the typical/central value instead. Graduate.
  // yearsInJob is a bracketed RANGE, not a number, so there's no literal
  // numeric average to compute — queryYearsInJobDistribution() answers
  // honestly with the MOST COMMON bracket (the closest real meaning of
  // "average" this categorical data actually supports) plus the full
  // breakdown, rather than fabricating a number or declining outright.
  const wantsAverageTenure = YEARS_IN_JOB_CONTEXT_PATTERN.test(question) && !yearsInJobThreshold && mentionedTenureBrackets.length < 2
    && /\baverage\b|\btypical(?:ly)?\b|\busual(?:ly)?\b|\bmost\s+common\b/i.test(question);

  // "rated Technical Skills as Excellent vs Competent" — 2+ rating LEVELS
  // named for the same skill, a side-by-side comparison rather than the
  // single-level filters.competencyRating extractFilters() already resolved
  // (see extractAllRatingLevels()'s own comment).
  const competencyRatingLevels = filters.competency ? extractAllRatingLevels(question) : [];

  // Explicit ask for a visualization on a single-percentage 'rate' answer
  // (queryRate()/querySimpleRate()/queryExamPassRate() below) — every one of
  // these is otherwise plain text with no chart of its own, unlike a
  // by-program/by-year breakdown which always charts regardless of whether a
  // visualization was asked for.
  const wantsRateChart = VISUALIZATION_REQUEST_PATTERN.test(question);

  // "What is the employment trend for BSIT graduates over the past three
  // years?" / "Is employment improving or declining for BSCS graduates?" —
  // both imply a BY-YEAR breakdown showing DIRECTION OF CHANGE, not one
  // aggregate snapshot. "improving/declining" is just as much a trend
  // question as literal "trend" wording, but a single aggregate overview
  // (queryOverview()) can't answer either — it has no year-over-year shape
  // at all, so it silently presented one static snapshot as if it answered
  // whether things are getting better or worse, which it structurally
  // cannot do.
  // filters.yearFrom && !filters.yearTo (not a bare filters.yearFrom check) —
  // an open-ended lower bound only ever comes from "past N years" phrasing,
  // which really does imply a by-year trend view. A CLOSED range ("batch 2020
  // to 2022") sets both yearFrom and yearTo and is just a filter for whatever
  // was actually asked (e.g. a single total count) — forcing it through the
  // by-year breakdown here would silently replace a plain "number of alumni
  // batch 2020 to 2022" count answer with an unrelated per-year chart.
  // "grow(?:ing|th)?" (meant for "is employment GROWING", "job GROWTH over
  // time") also matched "personal GROWTH"/"professional GROWTH" — the exact
  // section names the tracer form itself uses for its competency/personal-
  // development ratings (see TracerStudyResponse.js's own "Personal Growth
  // (C)"/"Professional Growth (D)" comments) — hijacking a genuine
  // competencies question into an unrelated "Employment by graduation year"
  // breakdown before topic detection ever got a turn. Caught live: "show
  // personal growth of alumni after graduation" answered with employment-by-
  // batch percentages instead of the real technical/communication/work-life-
  // balance/etc. ratings queryCompetencies() already has real data for.
  const isPersonalOrProfessionalGrowth = PERSONAL_GROWTH_PATTERN.test(question);
  if (!isPersonalOrProfessionalGrowth && (TREND_PATTERN.test(question) || (filters.yearFrom && !filters.yearTo))) {
    // queryByYear() may return { text, chart } now — normalize the same way
    // the generic dispatch wrapper below does, since this early-return
    // bypasses that wrapper entirely.
    const result = await queryByYear(filters);
    if (result) {
      const { text, chart } = typeof result === 'string' ? { text: result, chart: null } : result;
      if (text) {
        // "make it a pie chart" right after a trend/year-over-year answer —
        // this whole block is a `direct: true` early return, which the
        // generic dispatch wrapper's own chart-type override never reaches
        // (see applyRequestedChartType()'s own comment).
        applyRequestedChartType(chart, filters.requestedChartType);
        return { text, direct: true, topic: 'by_year', filters, chart: chart || null };
      }
    }
  }

  // "Who is the most recent/latest/newest graduate added to the tracer
  // database?" / "Show the 3 most recent graduates added..." — a single-
  // person (or top-N) superlative lookup by RECORD CREATION TIME, not
  // graduation year (that's filters.mostRecentBatch, a completely different
  // concept — see its own comment above). No TOPIC_PATTERNS entry captures
  // this shape at all (a bare "who is X" only ever satisfies the generic
  // 'names' pattern), so without this bypass it fell straight through to
  // queryNames()'s default ALPHABETICAL roster (optionally batch/program-
  // filtered via a misread "most recent" as filters.mostRecentBatch), never
  // actually sorted by when each record was added at all — caught live
  // twice: once for the singular "who is" phrasing, then again for "show
  // the N most recent" right after. The optional leading digit (group 1)
  // is what distinguishes the two — omitted entirely means "just the one."
  // Capped at 50 so a typo'd huge number ("show the 9999999 most recent")
  // can't force an unbounded query, same ceiling spirit as this file's
  // other list-size caps.
  const mostRecentAddedMatch = question.match(/\b(?:who\s+(?:is|was)\s+the|show(?:\s+me)?|list|give\s+me)\s+(?:the\s+)?(\d+)?\s*(?:most\s+recent|latest|newest)\s+(?:graduate|alumnus|alumna|alumni)s?\b/i);
  if (mostRecentAddedMatch) {
    const limit = mostRecentAddedMatch[1] ? Math.min(parseInt(mostRecentAddedMatch[1], 10), 50) : 1;
    const result = await queryMostRecentlyAdded(limit);
    if (result) return { text: result, direct: true, topic: 'names', filters: {} };
  }

  // "Which batch year had the most graduates?" / "Which year had the
  // highest unemployment rate?" / "Which batch has the highest unemployment
  // rate?" — superlative ranking BY YEAR. "batch" and "year" are used
  // interchangeably in this domain (both tie to yearGraduated) — the pattern
  // must match EITHER word alone, not just "year" with "batch" as an
  // optional prefix, or "which batch has..." (no "year" at all) falls
  // through this bypass entirely. "(?:graduation\s+)?" added — "Which
  // GRADUATION year has the highest number of self-employed respondents?"
  // has "graduation" sitting directly between "which" and "year," so the
  // original pattern (requiring them adjacent) never matched this extremely
  // natural phrasing AT ALL, and the whole question fell through this bypass
  // entirely before any of the metric branches below ever got a turn —
  // caught live. None of the TOPIC_PATTERNS entries capture this shape
  // (by_year only matches literal "by year"/"per year" phrasing), so without
  // this bypass these questions either fell through to RAG entirely (no
  // "employ" keyword to trigger the default 'employment' fallback) or,
  // worse, silently answered with queryEmployment()'s single overall Yes/No
  // breakdown — a confident answer that completely ignores the "which
  // batch/year" ranking that was actually asked.
  if (BATCH_YEAR_SUPERLATIVE_PATTERN.test(question) && SUPERLATIVE_DIRECTION_WORD_PATTERN.test(question)) {
    const direction = wantsHighestDirection(question) ? 'highest' : 'lowest';
    // "Which batch has the lowest job-course relevance rate?" — mentions
    // neither "employ" nor "unemploy", so without this check it silently
    // fell through to the plain graduate-headcount ranking instead, a
    // totally different metric than the one actually asked about.
    // /\bself[- ]?employ/i checked BEFORE the generic /\bemploy/i branch —
    // "self-employed" contains "employ" as a literal substring, so without
    // this it always won the generic 'employment' branch first (combining
    // employed+self-employed together), and "which year has the highest
    // number of SELF-EMPLOYED respondents" could never isolate self-
    // employment as its own metric at all. Caught live.
    // "which year has the highest NUMBER of self-employed respondents" and
    // "which year has the highest RATE of self-employed respondents" are
    // two genuinely different questions with two genuinely different correct
    // answers (a raw headcount winner vs. a per-batch-normalized winner can
    // easily be different batches, as they are here: Batch 2022 has the most
    // self-employed in absolute terms, Batch 2021 has the highest RATE).
    // Caught live: both phrasings were answering with the SAME (raw-count)
    // result regardless of which was actually asked, after an earlier fix
    // made self-employed always a raw count — that fix was only half right,
    // since "rate"/"percentage" wording explicitly asks for the OTHER
    // framing. Defaults to raw count when neither word is present ("which
    // year has the MOST self-employed respondents" has no "rate"/
    // "percentage" of its own and reads as a plain headcount request, same
    // as queryYearWithMostGraduates()'s own bare "most graduates" case).
    const selfEmployedAsRate = /\brate\b|\bpercent(?:age)?\b/i.test(question);
    // "abroad versus local EMPLOYMENT" / "ratio of overseas to local
    // workers" — checked BEFORE the generic /\bemploy/i branch below, which
    // would otherwise always win first (both "abroad" and "local" phrasings
    // naturally mention "employment/employed" too) and silently compute the
    // unrelated overall employment RATE instead of the work-location ratio
    // actually asked about. "local" alone (no "abroad"/"overseas" anywhere)
    // means the question is specifically about the LOCAL share; any
    // "abroad"/"overseas" mention — alone or paired with "local" the way
    // "abroad versus local" is — defaults to ranking by the abroad share,
    // which ranks batches in the exact same order a true abroad:local RATIO
    // would (they're complements of each other out of the same total).
    const wantsWorkLocationRanking = /\babroad\b|\boverseas\b|\blocal(?:ly)?\b|\bwork\s+location\b/i.test(question);
    const workLocationRankingTarget = /\babroad\b|\boverseas\b/i.test(question) ? 'abroad' : 'local';
    const result = isJobAlignmentQuestion
      ? await queryYearJobAlignment(filters, direction, wantsRateChart)
      : /\bunemploy/i.test(question)
      ? await queryYearRateExtreme(filters, direction, 'unemployment', false, wantsRateChart)
      : /\bself[- ]?employ/i.test(question)
      ? await queryYearRateExtreme(filters, direction, 'self-employed', selfEmployedAsRate, wantsRateChart)
      : wantsWorkLocationRanking
      ? await queryWorkLocationByYear(filters, workLocationRankingTarget, direction)
      : /\bemploy/i.test(question)
      ? await queryYearRateExtreme(filters, direction, 'employment', false, wantsRateChart)
      : await queryYearWithMostGraduates(filters, direction, wantsRateChart);
    // queryYearRateExtreme()/queryYearWithMostGraduates()/
    // queryWorkLocationByYear() may return { text, chart } now — normalize
    // the same way the generic dispatch wrapper below does, since this
    // early-return bypasses that wrapper.
    if (result) {
      const { text, chart } = typeof result === 'string' ? { text: result, chart: null } : result;
      if (text) {
        // "make it a pie chart" right after any "which batch/year has the
        // highest/lowest X" ranking above (job alignment, unemployment,
        // self-employment, work location, employment rate, or plain
        // headcount) — this whole block is a `direct: true` early return,
        // which the generic dispatch wrapper's own chart-type override
        // never reaches (see applyRequestedChartType()'s own comment).
        applyRequestedChartType(chart, filters.requestedChartType);
        return { text, direct: true, topic: 'by_year', filters, chart: chart || null };
      }
    }
  }

  // A bare program mention — "BSIT", "BSIT graduates", "IT graduates" —
  // already has filters.program correctly set by extractFilters() above, but
  // with no topic-specific keyword anywhere else in the question,
  // detectTopic() found nothing and topic stayed null. Without this check,
  // that fell straight into the bare-industry-noun-phrase heuristic just
  // below, which (having no idea a program was already identified) treated
  // the WHOLE phrase — literally including the word "graduates" — as an
  // INDUSTRY name to search for, always matched zero rows, and silently
  // deferred to a RAG refusal for what is actually the single most natural
  // way to ask "how many graduates does this program have." Checked BEFORE
  // the industry heuristic so a recognized program short-circuits it
  // entirely rather than the two guesses fighting over the same phrase.
  if (topic === null && filters.program &&
      !filters.industry && !filters.excludeIndustry && !filters.employmentStatus && !filters.excludeEmploymentStatus
      && !filters.workLocation && !filters.furtherEducation && !filters.employmentStatuses && !filters.jobTitle) {
    topic = 'count';
  }

  // See if this question is just a NEW phrasing of one of the ~23 BUILT-IN
  // topics above (see builtinCapabilityCatalog.js) — embedding similarity
  // against a fixed catalog of topic exemplars, same proven "match by
  // meaning, decline below a calibrated confidence threshold" shape
  // queryCustomQuestionByEmbedding() below already uses for admin-added
  // custom questions, just covering the HARDCODED topics instead. A
  // confident match only ever sets `topic` and falls through into the exact
  // same dispatch map every regex-matched topic already uses below — the
  // real answer always still comes from that deterministic function, never
  // from the embedding match itself.
  //
  // Checked BEFORE the bare-industry-noun-phrase heuristic just below, not
  // after — caught live: that heuristic requires no WH-word anywhere in the
  // question, which a declarative/imperative rephrasing like "Compare
  // outcomes between the different courses offered" satisfies just as
  // easily as a genuine bare industry name like "Engineering" does. Checked
  // after this heuristic, it swallowed the WHOLE sentence as a bogus
  // industry-name candidate before the semantic match (which correctly
  // identifies this as by_program) ever got a turn, searched Graduate.industry
  // for that literal 7-word string, found nothing, and declined outright.
  if (topic === null) {
    const { matchBuiltinTopic } = require('./builtinCapabilityCatalog');
    const builtinMatch = await matchBuiltinTopic(question).catch(() => null);
    if (builtinMatch) topic = builtinMatch.topic;
  }

  // If the question looks like a bare noun phrase (no WH-words, no verbs — e.g.
  // "Engineering", "IT"), treat it as an industry name to look up. This applies
  // whether detectTopic() found an employment signal or no topic at all, since a
  // bare term is its own distinct signal for "look this up as an industry."
  // Excludes a question that already resolved to a recognized program (see
  // above) — that phrase's "industry" candidate would just be the program
  // name plus filler words like "graduates," which never matches anything.
  if ((topic === 'employment' || topic === null) && !filters.program &&
      !filters.industry && !filters.excludeIndustry && !filters.employmentStatus && !filters.excludeEmploymentStatus
      && !filters.furtherEducation && !filters.employmentStatuses) {
    if (!/\b(how|what|who|which|when|where|why|is|are|do|does|show|list|give|tell|would|could|should|can|have|has|explain|describe|summarize|summarise|discuss|elaborate|outline)\b/i.test(question)) {
      const candidate = question.trim().replace(/[?!.,]+$/, '').trim();
      if (candidate.length > 2 && candidate.length < 60) {
        filters.industry = candidate;
        topic = 'employment';
      }
    }
  }

  // No specific topic matched and this isn't a bare industry lookup. Last
  // resort before declining: see if this college has a custom tracer
  // question whose wording semantically matches (see
  // queryCustomQuestionByEmbedding above) — covers admin-added questions no
  // hardcoded pattern could ever have anticipated. Only ever reached after
  // every hardcoded pattern above already had first crack, so it can never
  // shadow an existing, working answer.
  if (topic === null) {
    const customAnswer = await queryCustomQuestionByEmbedding(question);
    if (customAnswer) {
      return { text: customAnswer, direct: true, topic: 'custom_question', filters: {} };
    }
    // Still nothing confident — try keyword-overlap candidates (see
    // suggestPossibleMatches above) before giving up entirely, so a
    // question that's CLOSE to something real but doesn't exactly match
    // gets a helpful "did you mean" instead of silently falling through to
    // a generic refusal with no direction at all.
    const suggestion = await suggestPossibleMatches(question);
    if (suggestion) return suggestion;
  }

  // Decline rather than silently answering with an unrelated employment
  // breakdown. The caller (ragService) falls through to RAG / vector search
  // from here.
  if (topic === null) return null;

  // Shared by industry/competencies/job_positions/top_companies/skills_list
  // below — all five default to "most/highest" unless "least/lowest/fewest"
  // is stated. filters.rankDirection (extractFilters() above) wins when
  // present so a bare follow-up that inherited the direction via seedFilters,
  // but doesn't repeat the word itself in ITS OWN text, keeps the direction
  // the group was actually established with instead of silently flipping
  // back to the "most common" default.
  const wantsRankHighest = () => filters.rankDirection ? filters.rankDirection !== 'least' : !/\b(least|lowest|fewest)\b/i.test(question);

  // "list all unemployed and their contact information" — several dispatch
  // arms below (count/employment/gender) resolve a real status/filter but
  // then unconditionally default to queryCount() (a bare number), with no
  // check for whether the question actually asked for the LIST of people
  // behind that number. TOPIC_PATTERNS.names' own "list...alumni/graduates"
  // alternative requires one of those exact nouns nearby — "list all
  // UNEMPLOYED and their contact information" never says "alumni" or
  // "graduates" at all, so topic detection never even reaches 'names' and
  // this question lands in 'employment' instead, where the unconditional
  // queryCount() fallback silently answered "79 unemployed" instead of the
  // actual roster + contact numbers asked for. Caught live, reported in
  // exactly those words: "the chatbot should really analyze the question,
  // not rely on topic detection." Checked wherever queryCount() is about to
  // be returned as a same-information-different-shape fallback — "list
  // all"/"show (me) all"/"give me the list"/"who are" are strong, narrow
  // signals that the question wants the group itself, not just its size;
  // deliberately doesn't match a bare "show me the employment rate" (no
  // "all", no "list", no "who").
  // "who is"/"who was" (singular) added alongside "who are" (plural) — a
  // follow-up like "who is that?" condenses (see ragService.js's
  // WHO_IS_DEMONSTRATIVE_PATTERN/condenseQuestion()) into a fully
  // self-contained singular question ("Who is the BS Information Technology
  // graduate from Batch 2023 working locally as Front-end Developer?") when
  // the prior answer's criteria narrowed the group down to exactly one
  // alumnus — without this, that resolved question still landed in the
  // 'count' arm below and silently answered "There is 1 ..." a second time
  // instead of the actual name asked for. Safe to broaden here specifically
  // (unlike a module-wide "who" trigger) because extractPersonName() already
  // intercepts any question naming an ACTUAL person earlier in queryInner()
  // — by the time dispatch reaches this point, "who is X" never named a real
  // person, so it can only be asking to identify someone by criteria.
  const wantsNamesList = /\blist\b|\bshow\s+(?:me\s+)?all\b|\bgive\s+me\s+(?:the\s+)?(?:list|names)\b|\bwho\s+(?:is|are|was)\b/i.test(question);

  let fn = {
    // "who gave feedback for X?" matches TOPIC_PATTERNS.event_feedback's own
    // "feedback for/on/about" trigger too — routed to the submitters lookup
    // instead of queryEventFeedback() (ratings/comments CONTENT for X, never
    // names who left them) whenever the question is asking WHO, not WHAT.
    event_feedback:  () => EVENT_FEEDBACK_SUBMITTERS_PATTERN.test(question) ? queryEventFeedbackSubmitters(question)
      : EVENT_FEEDBACK_COUNT_PATTERN.test(question) ? queryEventFeedbackCount(question)
      : queryEventFeedback(question),
    // "participants" added alongside "attendees"/"who attended" — "list the
    // participants who attended each of the events" used to miss this
    // branch entirely (no literal "attendees" or "who attended"), fell to
    // the plain attend*/dumalo test below, and got a bare COUNT instead of
    // the names the question actually asked for. Excluded whenever a "how
    // many"/"ilan" counting word is also present — "how many participants
    // attended X" genuinely wants the count path below, not a name dump.
    events:          () => EVENT_FEEDBACK_SUBMITTERS_PATTERN.test(question)
      ? queryEventFeedbackSubmitters(question)
      : EVENT_FEEDBACK_RANKING_PATTERN.test(question)
      ? queryEventFeedbackRanking(question)
      : EVENT_FEEDBACK_COUNT_PATTERN.test(question)
      ? queryEventFeedbackCount(question)
      : (/who\s+attended|attendees?|participants?|sino.{0,15}dumalo/i.test(question) && !/\b(?:how\s+many|ilan(?:g)?)\b/i.test(question))
      ? queryEventAttendees(question)
      // Only route into the attendance-count path (which extracts an event
      // NAME out of the question — see EVENT_NAME_TRIGGER) when the question
      // actually mentions attendance at all. A bare "events" mention with no
      // attend*/dumalo/pagdalo root ("list of events for CCS") isn't naming
      // a specific event — EVENT_NAME_TRIGGER's generic "for"/"of" triggers
      // used to swallow phrases like "for CCS" as if it were an event title
      // and report a false "no event matching" error instead of listing
      // events. Straight to the overview (which itself now recognizes a
      // named college — see extractRequestedCollege above) for that shape.
      : /attend(?:ed|ance)?\b|dumalo|pagdalo/i.test(question)
      ? queryEventAttendanceCount(question)
      : queryEventOverview(question),
    names:           () => queryNames(filters, question),
    // (filters.industry || filters.excludeIndustry) && !filters.company —
    // queryIndustry() answers a DIFFERENT question ("what industries do
    // alumni work in", a top-N breakdown across the whole cohort); once a
    // company is ALSO part of the filters (a follow-up already scoped to a
    // specific employer's alumni), the real question is a plain scoped
    // COUNT ("how many of THEM are in industry X"), which queryCount()
    // already answers correctly (it applies filters.industry the same way
    // as any other postDedup filter). Caught live: "Ilan sa kanila ang nasa
    // IT?" (how many of them are in IT?) right after establishing a
    // Sutherland-scoped group answered with an unrelated, confusingly
    // worded industry-wide breakdown instead of the Sutherland+IT count.
    // !filters.jobRelated added — queryIndustry() has no idea what
    // filters.jobRelated even is (it never applies it), so any question that
    // resolved BOTH an industry AND a jobRelated filter together ("IT jobs
    // directly related to their course") silently lost the jobRelated half
    // the moment it got routed here, collapsing back to the plain
    // industry-wide "49" total regardless of directly/somewhat/not related.
    // queryCount() already applies both filters correctly together.
    count:           async () => {
      // "How many employed graduates have been in their current job for 2 to
      // 3 years or longer?" — same explicit tenure vocabulary as the 'rate'
      // dispatch arm's own check (see YEARS_IN_JOB_CONTEXT_PATTERN's
      // comment); checked first here too so the "how many" phrasing of the
      // identical question gets the real tenure-scoped count instead of
      // 'count' topic's own unrelated bare employed-alumni total.
      if (mentionedTenureBrackets.length >= 2) {
        const tenureCompare = await queryYearsInJobBracketsCompare(filters, mentionedTenureBrackets);
        if (tenureCompare) return tenureCompare;
      }
      if (yearsInJobThreshold) {
        const tenureCount = await queryYearsInJobCount(filters, yearsInJobThreshold);
        if (tenureCount) return tenureCount;
      }
      if (wantsAverageTenure) {
        const tenureDist = await queryYearsInJobDistribution(filters);
        if (tenureDist) return tenureDist;
      }
      // "How many rated Technical Skills as Excellent vs Competent?" — same
      // rating-vs-rating comparison the 'rate' dispatch arm handles (see
      // queryCompetencyRatingCompare()'s own comment), just as a headcount
      // framing. The function itself already reports both the count AND the
      // percentage per level, so it's reused directly rather than needing a
      // separate count-only variant.
      if (competencyRatingLevels.length >= 2) {
        const ratingCompare = await queryCompetencyRatingCompare(filters, competencyRatingLevels);
        if (ratingCompare) return ratingCompare;
      }
      if (isSectorQuestion) return querySector(filters);
      // "list all alumni who passed the board exam" — checked before every
      // other filter-specific branch below, not just the final fallback, so
      // an explicit list request wins regardless of WHICH filter resolved
      // (see wantsNamesList's own comment above).
      if (wantsNamesList) {
        const names = await queryNames(filters, question);
        if (names) return names;
      }
      if (filters.employmentStatuses) return queryEmployment(filters);
      // queryWorkLocation() only ever applies stablePipeline (program/year/
      // gender) plus the location condition itself — it has no idea what
      // jobTitleRegex/employmentStatus/companyRegex/industry/furtherEducation/
      // tookExam/jobRelated even are, so a workLocation question that ALSO
      // resolved one of those silently lost that half the moment it got
      // routed here. Caught live: "how many BS Information Technology
      // graduates from Batch 2024 are working locally as Front-end
      // Developer" returned the SAME count (26) regardless of which job
      // title was asked about — the location half worked, the job-title
      // half was silently dropped, same "correct-looking but silently
      // wrong number" failure class as the industry/jobRelated gaps fixed
      // elsewhere in this dispatch. queryCount() already combines
      // workLocation with every one of these other filters correctly (see
      // its own locationLabel/jobTitleLabel building) — only route to
      // queryWorkLocation() when nothing else queryCount() would need to
      // combine it with is actually present. isCompoundLocationQuestion
      // (bare "local vs abroad" with no specific direction) still always
      // goes to queryWorkLocation() regardless — queryCount() has no
      // equivalent "break down both sides" mode to fall back to.
      const hasFilterWorkLocationCantCombine = filters.jobTitleRegex || filters.employmentStatus
        || filters.excludeEmploymentStatus || filters.companyRegex || filters.industry
        || filters.excludeIndustry || filters.furtherEducation || filters.tookExam || filters.jobRelated;
      if (isCompoundLocationQuestion) return queryWorkLocation(filters);
      if (filters.workLocation && !hasFilterWorkLocationCantCombine) return queryWorkLocation(filters);
      // Same gap as the company/jobRelated exclusions above (added earlier
      // for the same reason) — queryIndustry() also has no idea what
      // furtherEducation/tookExam/hasPromotion/employmentType even are, so
      // any question resolving one of THOSE together with an industry
      // silently lost that half too. Caught live: "How many alumni in the
      // IT industry pursued further education?" answered the plain
      // industry-wide headcount (51), completely ignoring "pursued further
      // education" (real answer: a small subset of that 51). queryCount()
      // below already applies every one of these filters together with
      // industry correctly (see its own postDedup block).
      if ((filters.industry || filters.excludeIndustry) && !filters.company && !filters.jobRelated
        && !filters.furtherEducation && !filters.tookExam && !filters.hasPromotion && !filters.employmentType) return queryIndustry(filters);
      // A bare "how many" shape ("how many alumni mentioned work-life
      // balance as a challenge?") can still resolve filters.competency (see
      // the SPEC_ABBR competency loop above) — when no SPECIFIC rating level
      // was also named, this means "show the full distribution," which
      // stays queryCompetencies()'s job (it already builds the correct
      // rating-distribution answer for exactly this filter; caught live:
      // "702 graduates," completely unrelated to work-life balance, was the
      // old fallback before this redirect existed at all). But when a
      // specific level WAS also named (filters.competencyRating — "rated
      // Critical Thinking as High Competent"), the question wants a SCOPED
      // COUNT for that one tier, not the whole distribution — queryCount()
      // now applies competency+competencyRating as a real filter condition
      // (see its own comment) and can combine it with jobTitleRegex/program/
      // every other filter the same way any other condition already does,
      // so this must fall through to queryCount() instead of redirecting
      // away from it. Caught live: "How many graduates who rated their
      // Critical Thinking as 'High Competent' are currently working in
      // managerial or supervisor roles?" needs BOTH filters combined in one
      // answer, which an unconditional redirect to queryCompetencies() could
      // never do (it has no concept of jobTitleRegex at all).
      if (filters.competency && !filters.competencyRating) return queryCompetencies(filters, wantsRankHighest());
      // Bare "how many alumni are X" where X matched no recognized filter at
      // all (e.g. "how many alumni are married") falls all the way through
      // to here — before defaulting to a technically-true-but-useless
      // unfiltered total, see if X is actually one of this college's custom
      // tracer questions (see queryCustomQuestionByEmbedding above). Only
      // attempted when truly no filter was extracted, so a real "how many
      // alumni are there in total" question is unaffected.
      if (!Object.keys(filters).some((k) => k !== 'answerShape')) {
        const customAnswer = await queryCustomQuestionByEmbedding(question);
        if (customAnswer) return customAnswer;
        // Still nothing — try keyword-overlap candidates too (see
        // suggestPossibleMatches above) before defaulting to the bare
        // whole-cohort total. Safe to try unconditionally here: a question
        // with no real content word left after stopword-filtering (a truly
        // bare "how many alumni are there?") naturally finds zero
        // candidates and suggestPossibleMatches returns null on its own —
        // caught live: "how many alumni in a specific job category" / "by
        // role type" / "have a certain occupation" all fell through to a
        // bare, unhelpful "702 graduates" (or worse, a confused LLM
        // narration of that bare number) instead of being offered the real
        // job_positions topic.
        const suggestion = await suggestPossibleMatches(question);
        if (suggestion) return suggestion;
      }
      return queryCount(filters, wantsRateChart);
    },
    rate:            () => mentionedTenureBrackets.length >= 2
      ? queryYearsInJobBracketsCompare(filters, mentionedTenureBrackets)
      : yearsInJobThreshold
      ? queryYearsInJobRate(filters, yearsInJobThreshold)
      : wantsAverageTenure
      ? queryYearsInJobDistribution(filters)
      : competencyRatingLevels.length >= 2
      ? queryCompetencyRatingCompare(filters, competencyRatingLevels)
      // filters.competency+competencyRating was previously ONLY ever applied
      // by queryCount()/queryNames() (see queryCount()'s own comment) — a
      // "what PERCENTAGE rated X as Y" question has identical filters but
      // fell all the way through this entire chain to the generic overall
      // employment rate, since no branch here knew competency existed at
      // all. competency/competencyRating stripped from the filters object
      // passed in (same reasoning as the industry stripping just below) —
      // querySimpleRate()'s own `label` argument already names the skill+
      // level, and filterLabel() would otherwise double-mention it.
      : filters.competency && filters.competencyRating
      ? querySimpleRate(
          { ...filters, competency: undefined, competencyRating: undefined },
          { [`competencies.${filters.competency}`]: { $regex: `^${escapeRegex(filters.competencyRating)}`, $options: 'i' } },
          `rated ${COMP_LABEL[filters.competency] || filters.competency} as ${filters.competencyRating}`,
          wantsRateChart && `${COMP_LABEL[filters.competency] || filters.competency} Rating`,
        )
      : isCompoundLocationQuestion
      ? queryWorkLocation(filters)
      : BY_PROGRAM_QUESTION_PATTERN.test(question)
      ? (isJobAlignmentQuestion ? queryJobAlignmentByProgram(filters)
        : wantsUnemploymentByProgram ? queryProgramRateExtreme(filters, programSuperlativeDirection, 'unemployment')
        : filters.workLocation ? queryWorkLocationByProgram(filters, filters.workLocation)
        : queryEmploymentRateByProgram(filters, programSuperlativeDirection))
      : filters.tookExam === 'passed'
      ? queryExamPassRate(filters, 'passed', wantsRateChart)
      : filters.tookExam === 'failed'
      ? queryExamPassRate(filters, 'failed', wantsRateChart)
      : filters.tookExam === 'yes'
      ? querySimpleRate(filters, tookExamMatch('yes'), 'took a board/licensure exam', wantsRateChart && 'Took Board/Licensure Exam')
      : filters.tookExam === 'no'
      ? querySimpleRate(filters, tookExamMatch('no'), 'did NOT take a board/licensure exam', wantsRateChart && 'Took Board/Licensure Exam')
      : filters.furtherEducation === 'Yes'
      ? querySimpleRate(filters, { furtherEducation: { $regex: '^yes', $options: 'i' } }, 'pursued further education', wantsRateChart && 'Pursued Further Education')
      : filters.furtherEducation === 'No'
      ? querySimpleRate(filters, { $or: [{ furtherEducation: { $in: [null, ''] } }, { furtherEducation: { $regex: '^no', $options: 'i' } }] }, 'did not pursue further education', wantsRateChart && 'Pursued Further Education')
      // Further TRAINING (seminars/workshops, Graduate.furtherTraining) is a
      // completely separate field from further EDUCATION (masters/grad
      // school, Graduate.furtherEducation) just above — no filters.* flag
      // exists for it (extractFilters() only ever sets furtherEducation), so
      // with no branch here a "what percentage ... further training"
      // question fell all the way through this chain to the generic overall
      // employment rate (31.6%) — a completely different topic's number for
      // a question that never mentioned employment at all. Caught live:
      // "What percentage of alumni pursued further training?" (real answer:
      // 9.8%, 69/702) answered with the unrelated 31.6% employment rate.
      // queryFurtherTraining() already returns the Yes/No breakdown WITH its
      // own percentages built in, so it's reused directly rather than
      // needing a separate querySimpleRate() call.
      : /\btrainings?\b|\bseminars?\b|\bworkshops?\b/i.test(question)
      ? queryFurtherTraining(filters)
      // filters.jobRelated can be 'directly'/'somewhat'/'no'/'yes' (see
      // extractFilters() above) — this used to always query '^yes' and
      // always label it "have jobs related", regardless of which one was
      // actually asked, so "what percentage do NOT have jobs related to
      // their degree" silently answered the opposite question.
      : filters.jobRelated === 'directly'
      ? queryJobRelatedRate(filters, { $and: [{ jobRelated: { $regex: '^yes', $options: 'i' } }, { jobRelated: { $not: { $regex: 'somewhat', $options: 'i' } } }] }, 'have jobs directly related to their course', wantsRateChart && 'Job Directly Related to Course')
      : filters.jobRelated === 'somewhat'
      ? queryJobRelatedRate(filters, { jobRelated: { $regex: 'somewhat', $options: 'i' } }, 'have jobs somewhat related to their course', wantsRateChart && 'Job Somewhat Related to Course')
      : filters.jobRelated === 'no'
      ? queryJobRelatedRate(filters, { jobRelated: { $regex: '^no', $options: 'i' } }, 'do NOT have jobs related to their course', wantsRateChart && 'Job Related to Course')
      : filters.jobRelated
      ? queryJobRelatedRate(filters, { jobRelated: { $regex: '^yes', $options: 'i' } }, 'have jobs related to their course', wantsRateChart && 'Job Related to Course')
      // Was missing entirely: filters.workLocation IS correctly extracted for
      // "what percentage work abroad/locally" questions, but with no branch
      // checking for it here, execution fell all the way through to the
      // generic queryRate() (overall employment rate) — silently dropping
      // the location filter and answering a different question.
      : filters.workLocation
      ? querySimpleRate(filters, { workLocation: workLocationCondition(filters.workLocation, false) }, `work ${filters.workLocation === 'local' ? 'locally' : filters.workLocation}`, wantsRateChart && 'Work Location')
      // Same gap as workLocation above: filters.industry IS correctly
      // extracted for "what percentage work in the IT industry" questions,
      // but with no branch here, execution fell through to the generic
      // queryRate() (overall employment rate) — silently dropping the
      // industry filter and answering a completely different question.
      // filters stripped of industry/excludeIndustry before calling — the
      // `label` text here already names the industry itself ("work in X"),
      // and filterLabel() (called inside querySimpleRate) now ALSO mentions
      // filters.industry/excludeIndustry (see its own comment), so passing
      // the untouched filters would say the same industry twice in one
      // sentence. The query itself still correctly scopes to it via the
      // explicit matchStage below, independent of what's in filters.
      : filters.industry
      ? querySimpleRate({ ...filters, industry: undefined }, { industry: { $regex: filters.industry, $options: 'i' } }, `work in ${filters.industry}`, wantsRateChart && `Working in ${filters.industry}`)
      : filters.excludeIndustry
      ? querySimpleRate({ ...filters, excludeIndustry: undefined }, { industry: { $nin: [null, ''], $not: { $regex: filters.excludeIndustry, $options: 'i' } } }, `do NOT work in ${filters.excludeIndustry}`, wantsRateChart && `Not Working in ${filters.excludeIndustry}`)
      // Same gap as workLocation/industry above: "what percentage are
      // self-employed" extracts filters.employmentStatus === 'Self-Employed'
      // correctly, but with no branch here fell through to the generic
      // queryRate() (OVERALL employment rate, formally employed + self-
      // employed combined) — silently answering a different, broader
      // question than the specific status asked about. 'Yes'/'No' aren't
      // routed here: plain "employed" already matches queryRate()'s own
      // default (combined rate), and "unemployed" is already handled by the
      // asUnemployment check on the final fallback below.
      : filters.employmentStatus === 'Self-Employed'
      ? queryEmploymentStatusRate(filters, '^self.?employed$', 'are self-employed', wantsRateChart && 'Self-Employed')
      : filters.employmentStatus === 'Never Employed'
      ? queryEmploymentStatusRate(filters, '^never\\s*employed$', 'have never been employed', wantsRateChart && 'Never Employed')
      : queryRate(filters, /\bunemploy(ed|ment)?\b/i.test(question), wantsRateChart),
    overview:        () => /\bby\s+(program|course)\b/i.test(question) ? queryByProgram(filters)
      : /\bby\s+(batch|year|graduation)\b/i.test(question) ? queryByYear(filters)
      : /\bemployment\s+(breakdown|data|statistic)/i.test(question) ? queryEmployment(filters)
      : queryOverview(filters),
    industry:        () => {
      // "least common industries" used to get the EXACT same descending
      // top-10 list as "most common industries" — queryIndustry() had no
      // direction parameter at all and always sorted highest-first. Same
      // fix shape as job_positions/top_companies: default to highest unless
      // "least/lowest/fewest" is explicitly stated (see wantsRankHighest()
      // above for why filters.rankDirection takes precedence).
      const wantsHighest = wantsRankHighest();
      // "Which industry employs the most/fewest alumni?" — without asking
      // queryIndustry() for the summary sentence too, the response was just
      // a ranked list with no sentence directly naming the most/fewest
      // industry, leaving the actual question technically unanswered in
      // words. Gated to questions that actually ask for a superlative — a
      // plain "what industries do alumni work in?" (no most/least/top word
      // at all) should stay a plain ranked list, not gain an unsolicited
      // "X employs the most" sentence it never asked for. queryIndustry()
      // itself handles tie detection (see its own comment) since only it
      // has the pipeline context to check ties beyond the display $limit.
      const isSuperlativeQuestion = !!filters.rankDirection || /\b(most|least|highest|lowest|fewest|top)\b/i.test(question);
      return queryIndustry(filters, wantsHighest, isSuperlativeQuestion && !filters.industry && !filters.excludeIndustry);
    },
    // "gobyerno"/"pribado" alone (no other Tagalog verb cue) match this
    // topic via TOPIC_PATTERNS.work_type's own bare word list, but that's a
    // real ambiguity in Tagalog, not just a routing quirk: "nagtatrabaho sa
    // gobyerno" (working IN the government — an industry/sector) reads
    // completely differently from a genuine work_type question ("regular ba
    // o job order ang trabaho niya" — contract type). extractFilters()
    // above already resolves the industry-shaped case to filters.industry
    // ('government'/'private') when the Tagalog verb phrase is present —
    // checked first here, same priority order the 'count' topic's own
    // dispatch already gives filters.industry over its own default.
    work_type:       () => isSectorQuestion ? querySector(filters) : (filters.industry || filters.excludeIndustry) ? queryIndustry(filters) : queryWorkType(filters),
    // "curriculum relevance" isn't tracked at all — ASK before showing the
    // closest real proxy (job_relevance data) instead of showing it right
    // away with a disclaimer attached (see CLARIFY_CURRICULUM_RELEVANCE's
    // own comment for why: answering before being asked still read as
    // guessing to a real user, even with the caveat included). No data
    // lookup happens on this turn at all — cheaper, and mirrors
    // CLARIFY_COLLEGE_QUESTION's own "ask first, resolve on the next turn"
    // shape exactly.
    job_relevance:   () => /\bcurriculum\b|\bkurikulum\b/i.test(question) ? CLARIFY_CURRICULUM_RELEVANCE
      : BY_PROGRAM_QUESTION_PATTERN.test(question) ? queryJobAlignmentByProgram(filters)
      : filters.jobRelated ? queryCount(filters, wantsRateChart) : queryJobRelevance(filters),
    // filters.furtherEducation checked first — same reasoning as
    // licensure's own filters.tookExam check just below: an English "how
    // many did NOT pursue further studies" happens to also match the
    // 'count' topic pattern (bare "did") and route through queryCount()
    // for a single-number answer, but the equivalent Tagalog phrasing
    // ("ilan ang hindi nagpatuloy ng pag-aaral") only ever matches THIS
    // topic — without this check it always got the full breakdown instead
    // of the same single-count shape the English phrasing got.
    further_studies: () => /\bwho\b/i.test(question) ? queryNames(filters) : filters.furtherEducation ? queryCount(filters, wantsRateChart) : queryFurtherStudies(filters, /\bmasters?\b|\bmasteral\b|\bdoctorate\b|\bphd\b|\bpost.?grad\w*\b/i.test(question)),
    // filters.tookExam === 'passed'/'failed' routes to queryExamPassRate()
    // (a real PERCENTAGE, scoped to exam-takers: "83.3% of exam takers
    // passed... (X out of Y who took the exam)") instead of queryCount()
    // (a bare headcount with no rate at all) — queryCount() was the only
    // path here before, so "What is the licensure PASS RATE?" (which
    // extractFilters() correctly resolves to tookExam='passed') answered
    // with "There are 13 graduates who passed..." and no rate whatsoever,
    // even though the question's own word "rate" asked for exactly that.
    // 'yes'/'no' (took the exam at all, regardless of outcome — a
    // different question from pass/fail) still uses queryCount(), which has
    // no equivalent gap for that case.
    licensure:       () => /\bwho\b/i.test(question) ? queryNames(filters)
      : filters.tookExam === 'passed' ? queryExamPassRate(filters, 'passed', wantsRateChart)
      : filters.tookExam === 'failed' ? queryExamPassRate(filters, 'failed', wantsRateChart)
      : filters.tookExam ? queryCount(filters, wantsRateChart)
      : queryLicensure(filters),
    promotion:        () => /\bwho\b/i.test(question) ? queryNames(filters, question) : queryPromotion(filters),
    accomplishments: () => queryAccomplishments(filters),
    // "what/which trainings" asks for the actual names attended
    // (queryTrainingTypes) — a bare "how many pursued trainings" asks for
    // the yes/no breakdown (queryFurtherTraining), same what/how-many split
    // further_studies/licensure already use for their own "who" case above.
    further_training: () => /\b(?:what|which)\b/i.test(question) ? queryTrainingTypes(filters) : queryFurtherTraining(filters),
    competencies:    () => isCompetencyRankingQuestion
      ? queryCompetencyRanking(filters, wantsRankHighest())
      : queryCompetencies(filters, wantsRankHighest()),
    work_location:   () => BY_PROGRAM_QUESTION_PATTERN.test(question)
      ? queryWorkLocationByProgram(filters, filters.workLocation || 'abroad')
      : /\bwho\b/i.test(question) ? queryNames(filters) : queryWorkLocation(filters),
    by_program:      () => queryByProgram(filters),
    by_year:         () => queryByYear(filters),
    gender:          async () => {
      // "how many female are self-employed?" — gender matches the 'gender'
      // topic first and would otherwise win routing outright, silently
      // dropping the employmentStatus/industry/etc. filter that
      // extractFilters() DID correctly extract alongside it. queryCount()
      // already combines gender + every other filter correctly (and labels
      // them together), so defer to it whenever another specific filter is
      // also present; queryGender() stays the default for gender-only asks.
      const hasOtherFilter = filters.employmentStatus || filters.employmentStatuses || filters.excludeEmploymentStatus
        || filters.industry || filters.excludeIndustry || filters.furtherEducation || filters.tookExam
        || filters.jobRelated || filters.workLocation;
      if (filters.employmentStatuses) return queryEmployment(filters);
      if (hasOtherFilter) {
        // "list all unemployed female alumni and their contact information"
        // — same wantsNamesList check as the 'count'/'employment' arms (see
        // its own comment above); this arm resolves gender + another filter
        // together and defaults to queryCount(), the exact same "real
        // number, wrong shape" gap for a question that named a group AND
        // asked to see it.
        if (wantsNamesList) {
          const names = await queryNames(filters, question);
          if (names) return names;
        }
        return queryCount(filters, wantsRateChart);
      }
      return queryGender(filters);
    },
    employment:      async () => {
      // "How many Regular/Permanent employees have been with their company
      // for 3 to 5 years?" — a question combining employmentType (and
      // often program/workLocation) with job tenure satisfies bare
      // EMPLOYMENT_SIGNAL ("employees"/"employed") and lands on THIS topic,
      // not 'rate'/'count' — same explicit tenure vocabulary check as those
      // two arms (see YEARS_IN_JOB_CONTEXT_PATTERN's own comment), just
      // needed a third copy here since this arm has its own entirely
      // separate dispatch chain. Checked first, before even
      // untrackedEmploymentConceptMessage() below, so it never gets
      // mistaken for an unrelated employment-status question.
      if (mentionedTenureBrackets.length >= 2) {
        const tenureCompare = await queryYearsInJobBracketsCompare(filters, mentionedTenureBrackets);
        if (tenureCompare) return tenureCompare;
      }
      if (yearsInJobThreshold) {
        const tenureAnswer = filters.answerShape === 'count'
          ? await queryYearsInJobCount(filters, yearsInJobThreshold)
          : await queryYearsInJobRate(filters, yearsInJobThreshold);
        if (tenureAnswer) return tenureAnswer;
      }
      if (wantsAverageTenure) {
        const tenureDist = await queryYearsInJobDistribution(filters);
        if (tenureDist) return tenureDist;
      }
      // Checked FIRST — job satisfaction/work-life balance/time-to-first-job
      // all satisfy bare EMPLOYMENT_SIGNAL ("job"/"work") the same way a
      // real employment-status question does, but answering any of them
      // with the Employed/Unemployed/Self-Employed breakdown below is a
      // confidently wrong answer to a different question. See
      // UNTRACKED_EMPLOYMENT_CONCEPTS's own comment for why these decline
      // plainly instead of offering a closest-available substitute.
      // Checked before untrackedEmploymentConceptMessage() below — this USED
      // to be one of that list's own entries (see queryUnemploymentReasons()'s
      // own comment for why it was wrong to decline this at all).
      if (isUnemploymentReasonQuestion(question)) {
        const reasons = await queryUnemploymentReasons(filters, matchedUnemploymentReason(question));
        if (reasons) return reasons;
      }
      const untracked = untrackedEmploymentConceptMessage(question);
      if (untracked) return untracked;
      // "employed including self-employed" / "employed and self-employed" —
      // this combo already has an established combined meaning everywhere
      // else in the app (getDonutStats, the dashboard tile, queryRate's own
      // "including self-employed" line), so answer with that single combined
      // total instead of the generic two-row breakdown other compound
      // questions get.
      const isCombinedEmployedQuery = filters.employmentStatuses?.length === 2
        && filters.employmentStatuses.includes('Yes')
        && filters.employmentStatuses.includes('Self-Employed');
      if (BY_PROGRAM_QUESTION_PATTERN.test(question)) {
        if (isJobAlignmentQuestion) return queryJobAlignmentByProgram(filters);
        if (wantsUnemploymentByProgram) return queryProgramRateExtreme(filters, programSuperlativeDirection, 'unemployment');
        return filters.workLocation
          ? queryWorkLocationByProgram(filters, filters.workLocation)
          : queryEmploymentRateByProgram(filters, programSuperlativeDirection);
      }
      if (isCombinedEmployedQuery) return queryRate(filters, false, wantsRateChart);
      if (filters.industry || filters.excludeIndustry) return queryIndustry(filters);
      if (filters.employmentStatus || filters.excludeEmploymentStatus) {
        // "list all unemployed and their contact information" — see
        // wantsNamesList's own comment above. This is the exact arm/filter
        // combination the question was caught live on: TOPIC_PATTERNS.names
        // never matches (no "alumni"/"graduates" word anywhere in it), so
        // topic falls through to 'employment' via the bare EMPLOYMENT_SIGNAL
        // fallback, and this branch used to unconditionally hand back a bare
        // "79 unemployed" count — a real number, but not what was asked for.
        if (wantsNamesList) {
          const names = await queryNames(filters, question);
          if (names) return names;
        }
        return queryCount(filters, wantsRateChart);
      }
      // A bare "[attribute] of CCS alumni"-shaped question lands here once
      // every specific employment filter above has failed to match — before
      // defaulting to the generic Employed/Unemployed/Self-Employed
      // breakdown (unrelated to whatever [attribute] actually was — caught
      // live: "What is the civil status of CCS alumni?" silently answered
      // with the employment status breakdown instead), see if this college
      // has a custom tracer question matching what was actually asked. Same
      // reasoning as the identical check in the 'count' dispatch above.
      const customAnswer = await queryCustomQuestionByEmbedding(question);
      if (customAnswer) return customAnswer;
      // "employ" (covers employed/employment/unemployed/employer) is the one
      // EMPLOYMENT_SIGNAL word that genuinely means this bare default is the
      // right answer. A question that only reached 'employment' topic via a
      // WEAKER word (bare "job"/"work"/"occupation") is less certain to
      // actually be asking about employment status specifically — caught
      // live: "What company do alumni work for?" matched via "work" alone
      // and silently got the unrelated Employed/Unemployed breakdown (no
      // company info in it at all). Try the keyword-overlap suggestion
      // first for those; a real employment-status question ("how many
      // alumni are employed") always contains "employ" itself and is
      // unaffected.
      if (!/\bemploy/i.test(question)) {
        const suggestion = await suggestPossibleMatches(question);
        if (suggestion) return suggestion;
      }
      return queryEmployment(filters);
    },
    tracer_activity: () => queryTracerActivity(question),
    // Not wantsHighestDirection() — that helper defaults to false (lowest)
    // when neither "most/highest" NOR "least/lowest" appears, which is right
    // for superlative-rate questions but wrong here: a bare "top job titles"
    // or "common job positions" (no explicit qualifier at all) should still
    // default to MOST common, only flipping to ascending when "least/
    // lowest/fewest" is explicitly stated (see wantsRankHighest() above).
    job_positions:   () => queryJobPositions(filters, wantsRankHighest()),
    top_companies:   () => queryTopCompanies(filters, wantsRankHighest()),
    skills_list:     () => querySkillsList(filters, wantsRankHighest()),
  }[topic] ?? (() => queryEmployment(filters));

  // Universal "by program" override for Yes/No fields that had no
  // per-program counterpart wired into their own topic's dispatch branch
  // above (tookExam/licensure, furtherEducation/further-studies,
  // hasPromotion) — checked once here, after topic/filters are both already
  // resolved, rather than duplicating the same BY_PROGRAM_QUESTION_PATTERN
  // check inside count/rate/promotion/further_studies individually. Caught
  // live: "What is the licensure exam pass rate by program?" / "How many
  // alumni per program pursued further studies?" / "Which program has the
  // most promoted alumni?" each silently dropped the by-program half and
  // answered with the unrelated OVERALL figure instead (e.g. the bare
  // 19-passed licensure count for a question that specifically asked for a
  // per-program breakdown). restrictRegex on the licensure branch narrows
  // the denominator to actual EXAM TAKERS (passed or failed) — most alumni
  // never took the exam at all, so the pass RATE must be computed among
  // takers only, not the whole cohort.
  if (BY_PROGRAM_QUESTION_PATTERN.test(question)) {
    if (filters.tookExam) {
      fn = () => queryYesNoFieldByProgram(filters, {
        field: 'tookExam', yesRegex: /passed/i, restrictRegex: /passed|failed/i,
        label: 'Licensure exam pass rate', chartTitle: 'Licensure Pass Rate by Program',
        direction: programSuperlativeDirection,
      });
    } else if (filters.furtherEducation && !isJobAlignmentQuestion) {
      fn = () => queryYesNoFieldByProgram(filters, {
        field: 'furtherEducation', yesRegex: /^yes/i,
        label: 'Further education rate', chartTitle: 'Further Education Rate by Program',
        direction: programSuperlativeDirection,
      });
    // filters.hasPromotion (not `topic === 'promotion'`) — same reasoning as
    // the tookExam/furtherEducation branches above: a bare "show all the
    // programs" continuation right after a promotion-by-program breakdown
    // never re-states "promotion" in its own text, so topic itself may have
    // fallen back to something else entirely (see BY_PROGRAM_QUESTION_PATTERN's
    // own comment) even though the inherited filter makes the real intent
    // unambiguous.
    } else if (filters.hasPromotion) {
      fn = () => queryYesNoFieldByProgram(filters, {
        field: 'hasPromotion', yesRegex: /^yes/i,
        label: 'Promotion rate', chartTitle: 'Promotion Rate by Program',
        direction: programSuperlativeDirection,
      });
    }
  }

  // Same override as BY_PROGRAM_QUESTION_PATTERN just above, for "which
  // industry" instead of "which program" — only when no SPECIFIC industry
  // was already named (filters.industry/excludeIndustry set means the
  // question narrowed to one industry's own rate, e.g. "promotion rate in
  // the IT industry," not a ranking across all of them).
  if (BY_INDUSTRY_QUESTION_PATTERN.test(question) && !filters.industry && !filters.excludeIndustry) {
    if (filters.tookExam) {
      fn = () => queryYesNoFieldByIndustry(filters, {
        field: 'tookExam', yesRegex: /passed/i, restrictRegex: /passed|failed/i,
        label: 'Licensure exam pass rate', chartTitle: 'Licensure Pass Rate by Industry',
        direction: programSuperlativeDirection,
      });
    } else if (filters.furtherEducation) {
      fn = () => queryYesNoFieldByIndustry(filters, {
        field: 'furtherEducation', yesRegex: /^yes/i,
        label: 'Further education rate', chartTitle: 'Further Education Rate by Industry',
        direction: programSuperlativeDirection,
      });
    } else if (filters.hasPromotion || topic === 'promotion') {
      fn = () => queryYesNoFieldByIndustry(filters, {
        field: 'hasPromotion', yesRegex: /^yes/i,
        label: 'Promotion rate', chartTitle: 'Promotion Rate by Industry',
        direction: programSuperlativeDirection,
      });
    }
  }

  // Overrides `fn` regardless of whatever topic got guessed above — same
  // reasoning as the BY_PROGRAM_QUESTION_PATTERN override just above it.
  // Needed because a specific reason mentioned in the question text can
  // itself satisfy an UNRELATED topic's own trigger word first: "What
  // reasons did alumni give about skills not matching job market demands?"
  // contains the literal word "skills," which TOPIC_PATTERNS.skills_list
  // matches on its own, routing to querySkillsList() (the alumni-profile
  // skills ranking — a completely different field) before this question's
  // actual subject (reasonsNotEmployed) ever got a chance to be considered.
  // Checked last, after every other topic-specific routing above, so it
  // never overrides a genuinely different, already-correct answer for a
  // question that merely happens to share a word with one of the canonical
  // reason phrases.
  if (isUnemploymentReasonQuestion(question)) {
    // Captured BEFORE reassigning `fn` — an arrow function closes over the
    // VARIABLE, not its value at this point, so referencing `fn` directly
    // inside the new function body (instead of this captured copy) would
    // infinitely recurse into itself once called, not the original topic
    // function.
    const previousFn = fn;
    fn = async () => (await queryUnemploymentReasons(filters, matchedUnemploymentReason(question))) ?? (await previousFn());
  }

  // Same "checked via the dispatch table's own topic guess, which can be
  // wrong" shape as the overrides above — untrackedEmploymentConceptMessage()
  // was only ever wired into the 'employment' topic's own dispatch branch,
  // but a question phrased with "percentage"/"rate" (e.g. "What PERCENTAGE
  // of graduates found a job within 6 months of graduation?") resolves topic
  // = 'rate', not 'employment', via TOPIC_PATTERNS.rate's own "what
  // percentage" trigger — so it never reached that check at all and fell
  // straight through to queryRate(), silently answering the bare overall
  // employment rate (68.6%) as if it had addressed the "within 6 months"
  // timing. Checked here instead, after dispatch, so it fires regardless of
  // which topic the question happened to match. Only the ONE untracked
  // concept with a genuinely useful closest-available substitute
  // (time-to-employment -> the overall employment rate) gets the enriched
  // "decline, then offer the closest stat" treatment — every other untracked
  // concept (job satisfaction, salary) still falls through to the plain
  // decline inside the 'employment' branch, unaffected. Offers rather than
  // shows the substitute outright (no chart/number included here) — unlike
  // queryWorkType()'s "full-time" redirect, there's no genuinely-answered
  // PART of this question to show alongside the decline; showing the rate
  // unprompted would just be a differently-shaped version of the exact
  // "confidently wrong number for a different question" bug this redirect
  // exists to avoid. "Would you like to see X instead?" is parsed back out
  // by ragService.js's resolveClosestCategorySuggestion() on a plain "yes"
  // reply, the same mechanism queryWorkType()'s own redirect already uses.
  const untrackedRateMatch = matchUntrackedEmploymentConcept(question);
  if (untrackedRateMatch?.hasRateAlternative) {
    fn = () => {
      const declineText = `The tracer study does not track ${untrackedRateMatch.label} as its own question. What is available:${AVAILABLE_EMPLOYMENT_MEASURES_LIST}Please ask about one of those instead.`;
      const inlineAsk = 'Would you like to see how many graduates are employed overall instead?';
      const chipSuggestion = 'How many graduates are employed overall?';
      return { text: `${declineText}\n\n${inlineAsk}`, suggestions: [chipSuggestion] };
    };
  }

  // Same "a word belonging to a DIFFERENT topic's own trigger sits right in
  // this question too" collision as isUnemploymentReasonQuestion() above,
  // one more shape of it: TOPIC_PATTERNS.industry (`/\bindustr.../`) is
  // declared BEFORE TOPIC_PATTERNS.licensure in that object, so "What is the
  // licensure pass rate for alumni in the IT INDUSTRY?" — unambiguously a
  // licensure question that merely NAMES an industry as its scope, the same
  // way "...by program" names a program — matched 'industry' first and
  // silently dropped "licensure pass rate" entirely, answering with the bare
  // employed-in-IT headcount instead. filters.tookExam already correctly
  // resolved ('passed', from extractFilters()'s own licensure vocabulary) —
  // this just needs topic ROUTING to respect that resolved filter the same
  // way the dispatch table's own 'licensure' entry already would, had topic
  // actually landed there. Mirrors that exact entry's own who/tookExam
  // branching so behavior is identical to the case where routing worked.
  if (filters.tookExam && topic !== 'licensure' && TOPIC_PATTERNS.licensure.test(question)) {
    // Mirrors the 'licensure' dispatch entry's own passed/failed ->
    // queryExamPassRate() branching above — this override exists so a
    // question like "licensure pass RATE for alumni in the IT industry"
    // gets routed here at all (see its own comment further up), but it
    // still needs to show an actual rate once it arrives, not just a count.
    fn = () => /\bwho\b/i.test(question) ? queryNames(filters)
      : filters.tookExam === 'passed' ? queryExamPassRate(filters, 'passed', wantsRateChart)
      : filters.tookExam === 'failed' ? queryExamPassRate(filters, 'failed', wantsRateChart)
      : queryCount(filters, wantsRateChart);
  }

  // Most query functions still return a plain string; a growing set (starting
  // with queryGender) return { text, chart } instead so the AC chatbot can
  // render an inline graph alongside the answer — handle both shapes here
  // rather than converting all ~30 functions at once. queryOverview() is the
  // first to return { text, charts } (plural, multiple distinct visuals for
  // one answer) — `chart` still gets the first one so every existing
  // single-chart consumer keeps working untouched.
  const result = await fn();
  if (!result) return null;
  const { text, chart, charts, eventTitle, suggestions: ownSuggestions, rephraseNotice } = typeof result === 'string' ? { text: result, chart: null, charts: null, eventTitle: null, suggestions: null, rephraseNotice: null } : result;
  const resolvedCharts = charts?.length ? charts : (chart ? [chart] : null);

  // filters.requestedChartType ("make it a line graph" — see extractFilters()'s
  // own comment) overrides whatever chart type the resolved topic function
  // would normally produce, reusing the exact same rows/title/text — no need
  // to touch each of the ~30 query functions above individually. Recomputes
  // unit/max from the actual row values when switching TO 'line' and the
  // source chart isn't already percentage-scaled (unit === '%') — left at
  // the frontend's hardcoded 0-100% default otherwise, a raw-count chart
  // (e.g. 21 distinct training types) would silently mis-scale/clip.
  // Some answers (queryTrainingTypes() — see its own comment on why) have no
  // chart at all by design (e.g. trainingType is free text an alumnus typed
  // in their own words — almost every row is a unique one-off phrase, so a
  // chart of 20+ near-identical slivers would convey nothing real).
  let chartUnavailableNote = '';
  if (filters.requestedChartType && resolvedCharts?.length) {
    for (const c of resolvedCharts) {
      if (c.type === filters.requestedChartType) continue;
      c.type = filters.requestedChartType;
      if (filters.requestedChartType === 'line' && c.unit !== '%') {
        c.unit = '';
        c.max = Math.ceil(Math.max(...c.rows.map(r => r.count || 0), 1) * 1.1);
      }
    }
  } else if (filters.requestedChartType && text) {
    // A chart was explicitly asked for but this particular answer has none
    // to re-render — previously this silently re-showed the plain answer
    // with zero acknowledgment of the request, reading as if "make it a bar
    // graph" had simply been ignored or failed for no reason. Caught live:
    // asked right after a trainings/seminars breakdown, which deliberately
    // never produces a chart (see queryTrainingTypes()'s own comment) — the
    // user had no way to tell "no chart exists for this" apart from "the
    // chart request broke." An honest one-line note instead of silence,
    // matching this codebase's standing "decline plainly, don't guess or go
    // silent" convention used everywhere else.
    chartUnavailableNote = `\n\n*A chart isn't available for this particular breakdown — its values are mostly unique, one-off responses rather than a small set of real categories, so a chart wouldn't convey anything meaningful.*`;
  }

  // eventTitle (set by queryEventAttendanceCount/Attendees/Feedback when they
  // resolved one specific event) rides into filters purely so
  // suggestFollowUps() can build contextual event follow-up chips — it's
  // never used as an actual query filter anywhere else.
  //
  // ownSuggestions — a query function's OWN tailored "you might also ask"
  // chip(s) (e.g. queryWorkType()'s "closest real category" redirect),
  // which ragService.js's `aggResult.suggestions || suggestFollowUps(...)`
  // check already prefers over the generic topic-based ones whenever
  // present — this is just what threads it from the function's own return
  // value through to that check at all. Before this, a function returning
  // `suggestions` alongside {text, chart} had it silently dropped right
  // here: this destructuring only ever pulled out text/chart/charts/
  // eventTitle, so even a function that already built the right suggestion
  // never actually reached the chip row shown to the user.
  return text ? {
    text: text + chartUnavailableNote, direct: true, topic, filters: eventTitle ? { ...filters, eventTitle } : filters,
    chart: resolvedCharts?.[0] || null,
    charts: resolvedCharts,
    ...(ownSuggestions ? { suggestions: ownSuggestions } : {}),
    ...(rephraseNotice ? { rephraseNotice } : {}),
  } : null;
}

// A college coordinator must only ever see their own college's tracer study
// data through the AC assistant — but Graduate has no `college` field (only
// free-text `program`), so the restriction is enforced by resolving the
// coordinator's college to the set of alumni emails belonging to it (via
// User.college, the same source of truth EmploymentView already scopes by)
// and running the entire query through that scope — see
// utils/collegeScope.js for why AsyncLocalStorage instead of threading a
// filter through every one of the ~40 functions above individually.
// contextQuestions (see ragService.js's isEllipticalContinuation()/
// buildContextQuestions()): recent prior USER turns, oldest-first, whose
// filters (job title, company, industry, program, gender, employment status,
// etc.) seed this question's own — merged so each later turn's value wins
// over an earlier turn's for the same key, and this question's OWN
// extraction (in queryInner) wins over all of them. This is what lets "who
// are they?"/"how many are employed?"/"ilan sa kanila ang may trabaho?"
// resolve using a group defined 1-3 turns ago instead of only the immediately
// previous one — deterministic (no LLM call, no dependence on
// condenseQuestion() correctly re-deriving the same filters from raw
// chat-history text every time).
function buildSeedFilters(contextQuestions) {
  if (!contextQuestions || !contextQuestions.length) return {};
  let merged = {};
  for (const q of contextQuestions) merged = { ...merged, ...extractFilters(q) };
  return merged;
}

async function query(question, options = {}) {
  const { contextQuestions } = options;
  let { college } = options;
  const seedFilters = buildSeedFilters(contextQuestions);

  // An admin's `college` option is null by design (unrestricted — see
  // aiController.js) — but the admin can still name a specific college
  // directly in the QUESTION itself ("employment breakdown by program on
  // CASS"). Previously that mention was only ever recognized by the events/
  // attendance-overview functions (extractRequestedCollege() above); every
  // other question type — employment, program breakdown, industry, etc. —
  // silently ignored it and answered across every college's alumni combined,
  // which for a program breakdown reads as one college's real numbers
  // (whichever college happens to dominate the unfiltered dataset) presented
  // as if they were specific to the college the admin actually asked about.
  // A coordinator's own account-level scope is set directly by the caller
  // and always wins — this only ever fires when `college` arrives unset.
  const collegeFromAccount = !!college;
  // Falls back to seedFilters.college (a college named in an EARLIER turn,
  // carried via extractFilters()/buildSeedFilters() above) when this
  // question's own text doesn't repeat it — see extractFilters()'s own
  // comment on filters.college for the live failure this fixes (a follow-up
  // like "list the participants who attended each of the events?" re-asking
  // the college-picker clarify question even though the college was already
  // named the very previous turn).
  // "How many alumni are NOT from CCS?" — extractRequestedCollege() below
  // has no concept of negation at all, so this matched "CCS" and scoped the
  // ENTIRE query to CCS alumni ONLY (the exact opposite of what was asked),
  // then answered with the bare CCS total (267) as if it had correctly
  // excluded CCS. The system has no "exclude this college" scoping mechanism
  // at all (runWithCollegeScope below only ever narrows to an ALLOW-list of
  // emails, never an exclude-list), so rather than silently mis-scope to the
  // named college in the wrong direction, decline honestly — caught live:
  // the deterministic "267 (CCS)" answer then fed a follow-on narration pass
  // that hallucinated an even more confidently wrong conclusion on top of
  // it ("zero, all alumni are from CCS"), when a CBA alumnus genuinely
  // exists in the same database.
  if (!college && !collegeFromAccount) {
    // "hindi"/"di" (Tagalog "not") + the college code, optionally with the
    // "taga-" ("from") prefix fused onto the code itself ("hindi taga-CCS")
    // — added alongside the English negation words above. Caught live:
    // "Ilan ang mga alumning hindi taga-CCS?" matched none of the English
    // alternatives (a completely different literal string, not a
    // translation sharing any substring with "not"/"except"/etc.), so this
    // check never fired and the question fell through to
    // extractRequestedCollege() matching "CCS" as a POSITIVE scope — the
    // exact opposite of what was asked — then answered "264 graduates...
    // FROM CCS" as if it had correctly excluded CCS.
    const negatedCollegeMatch = question.match(
      /\b(?:not|except|excluding|other\s+than|besides|aside\s+from|outside\s+of?)\b.{0,20}\b(CPAG|CCS|COS|CIT|COE|CBA|COED|CASS|CCJE|CAFA)\b|\b(?:hindi|di)\b.{0,20}\btaga-?\s*(CPAG|CCS|COS|CIT|COE|CBA|COED|CASS|CCJE|CAFA)\b/i
    );
    if (negatedCollegeMatch) {
      negatedCollegeMatch[1] = negatedCollegeMatch[1] || negatedCollegeMatch[2];
      return {
        text: `I can only answer questions scoped to ONE specific college at a time, not "everyone except ${negatedCollegeMatch[1].toUpperCase()}" — please ask about a specific college instead (e.g. "How many alumni are from CBA?").`,
        direct: true, topic: 'out_of_scope', filters: {},
      };
    }
  }

  if (!college) college = extractRequestedCollege(question) || seedFilters.college;

  if (!college) return queryInner(question, seedFilters);

  const alumni = await User.find({ role: 'alumni', college }).select('email').lean();
  const emails = alumni.map(u => (u.email || '').toLowerCase()).filter(Boolean);
  // A coordinator's college resolving to ZERO alumni is different from "this
  // one question found no match" — it means EVERY question this coordinator
  // ever asks will fail identically, because the scope itself (not the
  // question) has nothing to search. Left unchecked, that surfaced as the
  // exact same generic "I can't answer unrelated questions" refusal a truly
  // out-of-scope question gets — reading as if the QUESTION were the
  // problem, when the real cause is almost always a misconfigured account
  // (a college value that doesn't match how any real alumni are labeled,
  // e.g. a typo like "COS" when every alumnus is actually under "CCS").
  // Caught live: a coordinator scoped to "COS" (0 real matches, the only
  // real college in the system is "CCS") got refused as "unrelated" for
  // "who is Liam Miranda" — a real, correctly-answerable person lookup for
  // every OTHER account, just not this one.
  if (!emails.length) {
    return {
      // Two different real causes, so two different messages: a
      // coordinator's own account scope being wrong is an account
      // misconfiguration (every future question fails identically); an
      // admin naming a college in their own question just means that
      // specific college has no alumni records on file yet — a normal,
      // one-off answer, not something to report to another admin.
      text: collegeFromAccount
        ? `Your coordinator account is scoped to college "${college}", but there are no alumni records under that college in the system. Every question will come up empty until this is fixed — please ask an admin to check that your account's college matches how alumni records are actually labeled.`
        : `There are no alumni records under college "${college}" in the system.`,
      direct: true,
      topic: 'scope_misconfigured',
      filters: {},
    };
  }
  const result = await runWithCollegeScope(emails, college, () => queryInner(question, seedFilters));
  // Only for a college the ADMIN named in their own question (not a
  // coordinator's account-level scope, whose null-result handling is
  // unchanged) — queryInner() returning null here doesn't mean "off-topic,"
  // it means this SPECIFIC college has no data for whatever the question
  // asked (e.g. no completed tracer records with both program and
  // employment status filled in for that college). Left as null, this used
  // to fall through to the qualitative RAG path next, which also finds
  // nothing (EmbeddingDocument has no per-college tag to search by), and the
  // message that actually reached the user was the fully generic,
  // doesn't-mention-any-college fallback ("ask about the system's features,
  // alumni data, or employment trends") — reading as if the question weren't
  // understood at all, when college AND topic were both recognized
  // correctly and simply have no matching data on file yet.
  if (!result && !collegeFromAccount) {
    return {
      text: `No matching tracer study data was found for college "${college}" for that question.`,
      direct: true,
      topic: 'scope_no_data',
      filters: {},
    };
  }
  return result;
}

// ─── Follow-up suggestions ──────────────────────────────────────────────────
// Built directly from the same topics query() actually dispatches to above —
// not a separately-maintained list — so a suggestion can never point at a
// topic the aggregation layer doesn't support. Program filter (if any) is
// carried over so suggestions drill into the same cohort just answered.
const RELATED_TOPICS = {
  // Not the tracer-study default ['rate','industry','by_program'] — those
  // make no sense stapled onto an events/feedback answer. suggestFollowUps()
  // below only falls back to that default when a topic key is entirely
  // ABSENT from this map, not when its value is a (possibly short) array —
  // this keeps events/event_feedback chips scoped to event-shaped questions
  // only. event_attendance/event_attendees/event_feedback_q below resolve to
  // null (dropped) unless filters.eventTitle is set — i.e. unless THIS
  // answer was already about one specific event — so a plain "What events do
  // we have?" overview doesn't suggest attendance/feedback questions with no
  // event to anchor them to; it falls back to events_upcoming/events_past.
  events:          ['event_attendance', 'event_feedback_q', 'events_upcoming', 'events_past'],
  event_feedback:  ['event_attendance', 'event_attendees', 'events_upcoming'],
  employment:      ['industry', 'by_program', 'job_positions'],
  count:           ['rate', 'industry', 'by_program'],
  rate:            ['industry', 'by_program', 'top_companies'],
  overview:        ['industry', 'licensure', 'further_studies'],
  industry:        ['top_companies', 'job_positions', 'by_program'],
  work_type:       ['rate', 'industry', 'work_location'],
  job_relevance:   ['skills_list', 'industry', 'by_program'],
  further_studies: ['rate', 'licensure', 'industry'],
  licensure:       ['rate', 'further_studies', 'by_program'],
  competencies:    ['skills_list', 'by_program', 'industry'],
  work_location:   ['top_companies', 'industry', 'by_program'],
  by_program:      ['rate', 'job_positions', 'by_year'],
  by_year:         ['rate', 'industry', 'by_program'],
  names:           ['rate', 'industry', 'by_program'],
  gender:          ['rate', 'by_program', 'job_positions'],
  // Not the generic tracer-study default — "who else works in X" and "what's
  // the breakdown for THIS person's program" are directly related to the
  // person just looked up, unlike a blanket employment-rate suggestion.
  person_lookup:   ['same_industry', 'by_program', 'gender'],
  comparison:      ['by_program', 'industry'],
  // New topics get their own onward suggestions too, not just inbound links
  // from the topics above — otherwise clicking into one of these dead-ends
  // with no further chips at all.
  job_positions:   ['top_companies', 'skills_list', 'industry'],
  top_companies:   ['job_positions', 'industry', 'rate'],
  skills_list:     ['competencies', 'job_positions', 'rate'],
  promotion:        ['rate', 'further_training', 'by_program'],
  further_training: ['promotion', 'competencies', 'by_program'],
};

const FOLLOWUP_QUESTION = {
  rate:            (pw) => `What is the employment rate of ${pw}alumni?`,
  industry:        (pw) => `What industries do ${pw}alumni work in?`,
  by_program:      ()   => `Show employment breakdown by program`,
  by_year:         (pw) => `Show ${pw}employment by graduation year`,
  work_location:   (pw) => `How many ${pw}alumni work locally vs. abroad?`,
  licensure:       (pw) => `How many ${pw}alumni passed the board exam?`,
  further_studies: (pw) => `How many ${pw}alumni pursued further studies?`,
  competencies:    (pw) => `How do ${pw}alumni rate their technical skills?`,
  count:           (pw) => `How many ${pw}alumni are there?`,
  employment:      (pw) => `What is the employment breakdown of ${pw}alumni?`,
  work_type:       (pw) => `What is the employment type breakdown of ${pw}alumni?`,
  job_relevance:   (pw) => `How many ${pw}alumni have jobs related to their course?`,
  names:           (pw) => `Who are the employed ${pw}alumni?`,
  gender:          (pw) => `What is the gender breakdown of ${pw}alumni?`,
  job_positions:   (pw) => `What are the most common job positions among ${pw}alumni?`,
  top_companies:   (pw) => `Which companies employ the most ${pw}alumni?`,
  skills_list:     (pw) => `What skills do ${pw}alumni have?`,
  promotion:        (pw) => `How many ${pw}alumni were promoted in their current job?`,
  further_training: (pw) => `How many ${pw}alumni pursued trainings or seminars after graduating?`,
  // Event-context follow-ups — the 3 below only fire when the answer just
  // given already resolved one specific event (filters.eventTitle set by the
  // aggregationService wrapper); otherwise they return null and
  // suggestFollowUps() drops them, since "Who attended the event?" with no
  // event named would just re-trigger the "which event?" overview fallback.
  event_attendance: (pw, filters) => filters.eventTitle ? `How many alumni attended ${filters.eventTitle}?` : null,
  event_attendees:  (pw, filters) => filters.eventTitle ? `Who attended ${filters.eventTitle}?` : null,
  event_feedback_q: (pw, filters) => filters.eventTitle ? `What's the feedback for ${filters.eventTitle}?` : null,
  events_upcoming:  ()             => `List upcoming events`,
  events_past:      ()             => `List past events`,
  // Only fires when the person just looked up has a recognized industry on
  // file. Deliberately phrased to literally contain "industry" so clicking
  // it round-trips through TOPIC_PATTERNS.industry — a phrasing like "who
  // else works in X" contains no industry-topic trigger word at all and
  // would silently fall through to a generic answer instead.
  same_industry:    (pw, filters) => filters.industry ? `What other alumni work in the ${filters.industry} industry?` : null,
};

function suggestFollowUps(topic, filters = {}) {
  const progWord = filters.program ? `${filters.programLabel || filters.program} ` : '';
  // Gender folded into the same prefix as program ("female BSIT ") — was
  // dropped from every suggested chip entirely before this. A question like
  // "how many male BSIT alumni are employed?" suggested generic,
  // gender-blind follow-ups ("What are the most common job positions among
  // BSIT alumni?") that silently lost half of what was actually asked.
  const pw = `${genderPrefix(filters)}${progWord}`;
  // Batch/year — same gap as gender, just for graduation year. Reuses
  // filterLabel()'s own "(Batch 2024)"/"(2020 to 2023)" formatting, but only
  // fed the year-related keys (not filters.program) so program isn't
  // mentioned a second time here on top of already being in `pw` above.
  const yearSuffix = filterLabel({
    yearGraduated: filters.yearGraduated, yearsGraduated: filters.yearsGraduated,
    yearFrom: filters.yearFrom, yearTo: filters.yearTo,
  });
  const related   = (RELATED_TOPICS[topic] || ['rate', 'industry', 'by_program'])
    .filter(t => t !== topic && FOLLOWUP_QUESTION[t]);
  return related
    .map(t => FOLLOWUP_QUESTION[t](pw, filters))
    .filter(Boolean)
    .map(q => `${q}${yearSuffix}`)
    .slice(0, 3);
}

// detectTopic/extractFilters/extractPersonNames are exported in addition to
// the original set above purely for automated testing (see
// tests/tagalog-support.test.js) — they let the intent/entity-extraction
// layer be verified directly, without needing a live MongoDB connection the
// way calling query() end-to-end would. Not used by any other module; the
// real request path still only ever calls query() from ragService.js.
module.exports = { query, hasData, suggestFollowUps, extractPersonName, extractPersonNames, detectTopic, extractFilters, CLARIFY_COLLEGE_QUESTION, CLARIFY_CURRICULUM_RELEVANCE, extractEventName, VISUALIZATION_REQUEST_PATTERN, isUnemploymentReasonQuestion, matchedUnemploymentReason };
