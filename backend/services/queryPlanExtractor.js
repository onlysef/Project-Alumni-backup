// LLM-driven structured query-plan extraction for the ATREIA chatbot's
// numeric/data questions (count, percentage, ranking, names, summary).
//
// This REPLACES the hand-written regex filter-matching that used to live in
// utils/verifiedCount.js (findCourseMatch, findCollegeMatch,
// findEmploymentStatusMatch, findBestMatch, SCOPE_INTENT_PATTERN, and each
// COUNT/PERCENTAGE/RANKING/SUMMARY_QUESTION_PATTERN intent trigger) — one
// call here returns BOTH the intent and every filter in a single JSON
// object, instead of a growing pile of separate regexes that each needed a
// new hand-coded pattern for every new phrasing or filter combination.
//
// IMPORTANT — this module only EXTRACTS CANDIDATE values. It never decides
// the final answer and the extracted JSON is never trusted as-is: every
// field is re-checked against the real catalog/DB by
// utils/queryPlanValidator.js before it is used to build a query, and the
// actual count/percentage/ranking number always comes from a real MongoDB
// query, never from the LLM. This preserves the project's core, hard-learned
// rule (see utils/verifiedCount.js's own top comment and CLAUDE.md): an LLM
// cannot reliably count, divide, or rank rows on its own, so a real query is
// the only trustworthy source for a number. A malformed or unparseable
// response from this module is treated as "no plan" by every caller, never
// half-trusted.
//
// The "filters": {...} JSON shape below and each field's own one-line
// extraction rule are GENERATED from utils/fieldRegistry.js's
// FIELD_REGISTRY — adding a new filterable field means adding one entry
// there, not hand-editing this prompt string. The intent-classification
// rule, ranking rules, and worked examples below stay hand-authored (they
// describe the overall QUESTION shape, not any one field, so there's
// nothing in the registry to generate them from) — see fieldRegistry.js's
// own top comment for the full rationale.
const { HfInference } = require('@huggingface/inference');
const { COLLEGE_CODES, ALL_COURSES } = require('../utils/collegesCourses');
const { FIELD_REGISTRY } = require('../utils/fieldRegistry');
const logger = require('../utils/logger');

const hf = new HfInference(process.env.HF_API_KEY);
// Deliberately a SEPARATE env var from ragService.js's own HF_CHAT_MODEL
// (narration) — extraction is a structured JSON task, not open-ended
// reasoning, so it doesn't need the same model narration was upgraded to
// (Llama-3.1-8B -> 3.3-70B, see that file's own model comment) just to
// control HF API credit usage. IMPORTANT — this is a real, measured
// tradeoff, not a free win: this session's own registry/backstop hardening
// (fieldRegistry.js's deterministic backstops, queryPlanValidator.js's
// unsupportedConditions merge, etc.) exists SPECIFICALLY because smaller
// models were repeatedly observed to extract filters unreliably — dropping
// to a smaller/cheaper model to save credits risks reintroducing some of
// those same failure modes, just now partially masked (not eliminated) by
// the backstops added since. Must be re-verified against real questions
// after any model change here, not assumed safe from cost savings alone.
// Currently configured (.env, explicit user choice) to Llama-3.2-3B-Instruct
// — the cheapest option, with the known tradeoff that it has only ONE live
// HF provider (featherless-ai) vs 3.1-8B's four, so it's more exposed to
// that single provider's rate limits/downtime with no fallback route.
const CHAT_MODEL = process.env.HF_EXTRACTION_MODEL || process.env.HF_CHAT_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

// Generated "filters": {...} block — one line per registry entry, in
// registry order, using each entry's own `jsonHint` for the value shape.
const FILTERS_SCHEMA_BLOCK = FIELD_REGISTRY
  .map((entry) => `    "${entry.key}": ${entry.jsonHint}`)
  .join(',\n');

// Generated per-field rule bullets — one per entry that has a `description`
// (several registry entries share ONE combined rule, e.g. the three
// boolean "professional development" fields, or course/college; only the
// FIRST entry in such a group carries the text, the rest have
// `description: null` to avoid repeating the same bullet three times).
const FIELD_RULES_BLOCK = FIELD_REGISTRY
  .filter((entry) => entry.description)
  .map((entry) => `- ${entry.description}`)
  .join('\n');

const PLAN_SYSTEM_PROMPT = `You are a query-plan extractor for a university alumni tracer study chatbot. Your ONLY job is to read a question and output ONE JSON object describing what data it is asking for. You never answer the question yourself and you never invent, guess, or compute a number.

Output EXACTLY one JSON object, nothing else — no markdown fences, no explanation, no preamble. The object must have this exact shape:
{
  "intent": "count" | "percentage" | "ranking" | "names" | "summary" | "none",
  "filters": {
${FILTERS_SCHEMA_BLOCK}
  },
  "rankingField": "industry" | "company" | "jobTitle" | "course" | "college" | "specialization" | "graduationYear" | "skill" or null,
  "rankingDirection": "highest" | "lowest" or null,
  "rankingScope": string or null,
  "rankingMode": "count" | "rate" or null,
  "compareScope": [string, string] or null,
  "summaryTopics": [zero or more of "employment", "furtherEducation", "other"],
  "unsupportedConditions": [string]
}

RULE 1 — INTENT: "intent" is "count" for "how many"/"ilan"/"total number of" questions; "percentage" for "percentage"/"percent"/"rate"/"%" questions; "ranking" for "highest"/"lowest"/"most"/"least"/"top" questions; "names" ONLY when the question is specifically asking to see a list of PEOPLE/ALUMNI — "who are they", "list them", "show their names", "sino sila" — the thing being asked for must be people's names themselves; "summary" for a broad "give me a summary/overview/activity/tracer survey activity/how's the survey going" request with no single specific metric — this includes phrasing like "show me tracer survey activity" or "show me the activity report", which name NO specific person and are NOT a "names" request even though they start with "show me" (the word "show" alone never decides intent — what follows it does: "show me THEIR NAMES"/"show me WHO" is names, "show me THE ACTIVITY"/"show me A SUMMARY" is summary); "none" if the question is not asking for alumni tracer data at all.

FIELD-SPECIFIC RULES (one bullet per "filters" entry above):
${FIELD_RULES_BLOCK}

RULE 2 — RANKING: "rankingField"/"rankingDirection" are only set when intent is "ranking". Choose "course" whenever the question's grouping word is "program"/"course"/"degree" ACROSS THE WHOLE SYSTEM (what alumni STUDIED, comparing different programs against each other) — e.g. "which program has the most employed graduates" is rankingField "course", NEVER "industry", even though the question also mentions employment. Choose "college" instead whenever the grouping word is "college" itself (e.g. "CCS", "CBA" — the broader unit a program belongs to, NOT a specific program) — e.g. "which college has the highest employment rate?" is rankingField "college", comparing colleges against each other, a coarser grouping than "course" (which compares individual PROGRAMS, several of which belong to the same college). Never confuse the two just because both are academic-unit words — "program"/"course"/"degree" always means "course", "college" always means "college". Choose "specialization" instead whenever the question asks about "specialization"/"major"/"track" — this is a DIFFERENT, narrower dimension than "course": it compares one program's own internal tracks/majors against each other (not different programs against each other), e.g. "which specialization has the most employed graduates", "which major in BSIT has the most employed graduates", "which BSBA major has the most employed graduates". A question naming "program(s) IN/WITHIN X" or "majors in X" means specialization, NOT course — course ranking would wrongly compare whole unrelated programs against each other, which is not what was asked when the question already named one specific program and wants its internal breakdown. Choose "industry" only when the grouping word is "industry"/"sector"/"field" (what business sector alumni WORK IN) — e.g. "which industry employs the most alumni" is rankingField "industry". These are easy to conflate when a question mentions both a program and employment in the same sentence — the GROUPING word (what the ranking is actually counted per) decides the field, not every topic word present in the sentence. A condition like "employed" that isn't the grouping word is a filter (employmentStatus), not the rankingField.

RULE 2a2 — TREND OVER TIME: choose rankingField "graduationYear" for a question asking how a metric has changed "over the years"/"per batch"/"by batch year"/"over time"/"year on year" — e.g. "how has the employment rate changed per batch year?", "show the trend of employed graduates over the years". This is always a full chronological breakdown across every batch year that has data (oldest to newest), never just two specific years — "rankingDirection" is ignored for this field (the result is always ordered chronologically, not by count). RULE 2b (rate vs count) applies here exactly the same as any other rankingField: a trend question using "rate"/"percentage"/"%" wording ("employment RATE changed per batch year") still needs "rankingMode":"rate" set — each batch year is then shown as what FRACTION of that year's own respondents are employed, not a raw headcount. A raw per-year headcount is actively misleading for a trend (an old batch of 2 people showing "1 employed" looks negligible next to a huge recent batch's "47 employed" even though the small batch's real RATE is 50% and the large batch's might be lower) — treat "rate"/"percentage"/"%" wording on a trend question exactly as seriously as on a top-N ranking question, never only the latter.

RULE 2a — RANKING SCOPE: "rankingScope" is ONLY set when rankingField is "specialization" AND the question names which parent program's specializations/majors to rank (e.g. "BSIT" from "which specialization has the most employed graduates" if context implies BSIT, "BSBA" from "which BSBA major has the most employed graduates", "BSEd" from "top education majors"). Copy the parent program's name verbatim — do not guess one if the question doesn't actually name or clearly imply a specific program. If the question just says "specialization"/"major" with no parent program named or implied at all, leave "rankingScope" null (the downstream system defaults it).

RULE 2b — RANKING MODE (count vs rate): "rankingMode" is "rate" ONLY when the question explicitly asks to rank by a RATE/PERCENTAGE of something WITHIN each group (e.g. "top 3 programs by employment RATE", "which college has the highest employment PERCENTAGE") — this ranks groups by what fraction of EACH group's own respondents match a status (set via the normal "employmentStatus" filter, which becomes the rate's numerator), not by raw headcount. Leave "rankingMode" null (defaults to "count", the far more common case) for a bare "most"/"highest number of" question with no "rate"/"percentage"/"%" wording — "which program has the most employed graduates" is rankingMode null (count), NOT rate, even though it also mentions employment. "rankingMode":"rate" requires "employmentStatus" to also be set in filters (the rate has no meaning without knowing what it's a rate OF); if the question asks for a rate of something this schema has no status field for, leave "rankingMode" null instead of guessing.

RULE 2c — RANKING BY SKILL: choose rankingField "skill" for a question asking which SKILL (not program/industry) alumni rate themselves highest/lowest in — e.g. "which skill do alumni rate themselves highest in?", "what is the weakest self-rated competency?". This ranks the 8 personal-growth skill categories themselves against each other (by how many respondents rated each "Excellent", or a different level named in "rankingScope" — e.g. "Beginner" if the question asks which skill most alumni rate as a weakness) — a completely different dimension than "skillRating" in filters (which narrows a COUNT/PERCENTAGE question to one already-named skill, not a ranking across all of them). If the question names a specific rating level to rank by (e.g. "rated Excellent", "rated themselves Beginner in"), copy it into "rankingScope" exactly as one of "Excellent"/"Competent"/"Satisfactory"/"Beginner"/"Non-Acceptable"; otherwise leave "rankingScope" null (defaults to "Excellent").

RULE 2d — DIRECT TWO-WAY COMPARISON: "compareScope" is set (as a 2-element array, e.g. ["BSIT","BSCS"] or ["CCS","CBA"]) ONLY when the question explicitly names exactly two specific PROGRAMS (course codes like "BSIT") OR two specific COLLEGES (college codes like "CCS") and asks to compare them directly against each other (e.g. "BSIT vs BSCS employment rate", "compare CCS and CBA's employment rates") — this is different from "rankingField":"course"/"college", which compares ALL programs/colleges in the system, not just two named ones. CRITICAL — "compareScope" is ONLY for programs/colleges, NEVER for any other kind of "X vs Y" pairing: a question comparing two SKILLS ("technical skills vs problem solving"), two RATING LEVELS ("Excellent vs Satisfactory"), two EMPLOYMENT STATUSES, two GENDERS, or any other non-program/non-college pair must leave "compareScope" null — those are handled entirely by their own filters/rankingField, never by this field. When "compareScope" is set, do not also set "rankingField"/"rankingDirection"/"rankingMode" — intent stays "ranking" but these two fields answer the whole question on their own. Copy each name verbatim, do not guess one if only one was actually named (that is a plain "course"/"college" filter instead, not a two-way comparison).

RULE 3 — SUMMARY TOPICS: "summaryTopics" only applies when intent is "summary". Leave it an EMPTY array for a bare, general "give me a summary/overview" with no single named topic — this means show the full overview. Only add "employment" when the question specifically names employment/job/work/industry as the topic, "furtherEducation" when it specifically names further education/graduate studies, "other" when it specifically names professional development/awards/recognition. A question can name more than one.

RULE 4 — UNSUPPORTED CONDITIONS: "unsupportedConditions" lists, in plain English, any condition the question clearly asks for that does NOT map to any field above and this schema cannot filter on — specifically: salary or income amounts, an exact/specific year count that is neither a closed range nor an open-ended "more than/at least N years" (which always goes to "yearsInJobMoreThan" instead, never here — see the yearsInJob field rule above), a SPECIFIC named city/province/region (e.g. "Quezon City", "Cebu", "Pampanga" — this schema only tracks the coarse "Local" (within the Philippines) vs "Abroad" distinction via "workLocation", never a specific place; copy the named place here VERBATIM and do NOT also set "workLocation" to "Local" just because the named place happens to be within the Philippines — that silently broadens the question to every city in the country instead of the one actually asked about), class rank/honors/GPA, or any other numeric or categorical comparison this schema has no comparable field for. Do NOT put a condition here when it DID resolve to a real filter value above — that goes in "filters", not here. Only genuinely unsupported conditions belong in this list. This is ONLY for a condition that names something this schema structurally cannot filter on at all. A named course, college, job title, industry, company, or any other catalog-matched value is ALWAYS copied into its matching filter field verbatim, NEVER an unsupportedConditions entry — this is true even if the name looks unfamiliar, made-up, or like it might not be real (e.g. "Call of Duty", "Underwater Basket Weaving"). You are not the one who checks whether it's real; just copy what was asked for into the matching filter field and let the system check it. Do not change "intent" to "none" just because a named value looks unfamiliar or invalid — classify intent normally from the question's own structure regardless of whether the named filter values look real.

RULE 5 — NEVER GUESS: Never set a filter to a value that paraphrases, corrects, or invents — only copy what the question itself actually says. If uncertain whether something is named, leave it null rather than guessing.

RULE 6 — OFF TOPIC: If the question is not about alumni/tracer data at all (e.g. general knowledge, small talk), return intent "none" with all filters null and an empty unsupportedConditions array.

RULE 7 — EMPLOYMENT RATE PHRASING: A phrase like "employment rate" or "unemployment rate" by itself already sets "employmentStatus" (see the employmentStatus field rule above) — it is NEVER an unsupportedConditions entry, and a scope word immediately after it ("for CCS", "for BSIT") is always the "college"/"course" filter, never unsupportedConditions either.

## Examples

Q: "What is the employment rate for CCS?"
{"intent":"percentage","filters":{"course":null,"college":"CCS","employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}

Q: "give me the employment summary of Call of Duty"
{"intent":"summary","filters":{"course":null,"college":null,"employmentStatus":null,"jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":["employment"],"unsupportedConditions":[]}
(Note: "Call of Duty" is clearly meant as a college/course name here, but it doesn't cleanly fit either "course" or "college" wording conventions (it's not a short code) — when genuinely unsure which of the two fields a named scope belongs in, prefer "college". The downstream system will reject it if it isn't real; your job is only to pass it along.)

Q: "What is the employment rate for BSBA alumni who live in Quezon City?"
{"intent":"percentage","filters":{"course":"BSBA","college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":["Quezon City"]}
(Note: "Quezon City" is a specific city, not the same thing as "locally" — it goes in unsupportedConditions verbatim, and "workLocation" stays null, NOT "Local". "BSBA" is still copied into "course" verbatim exactly as named, even though it will turn out not to be a real course code on its own (the real ones are "BSBA-FM"/"BSBA-MM"/"BSBA-BE") — that check happens downstream, not here.)

Q: "How many BSIT alumni are employed as Software Engineer and work locally?"
{"intent":"count","filters":{"course":"BSIT","college":null,"employmentStatus":"Employed","jobTitle":"Software Engineer","industryField":null,"companyName":null,"workLocation":"Local","furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}

Q: "How many BSIT alumni have a job that is not related to their degree?"
{"intent":"count","filters":{"course":"BSIT","college":null,"employmentStatus":null,"jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"gender":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"yearsInJob":null,"yearsInJobMoreThan":null,"jobRelatedToDegree":"Not Related","employmentType":null,"professionalExamResult":null,"promotedInJob":null,"professionalCertifications":null,"pursuedTrainings":null,"furtherEducationType":null,"trainingType":null,"reasonNotEmployed":null,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}

Q: "How many BSIT alumni have worked in their job for more than 5 years?"
{"intent":"count","filters":{"course":"BSIT","college":null,"employmentStatus":null,"jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"yearsInJob":null,"yearsInJobMoreThan":5,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: open-ended "more than N years" phrasing always uses yearsInJobMoreThan with the raw number, never yearsInJob directly — the downstream system decides how to resolve it.)

Q: "How many BSIT alumni have worked in their job for more than 7 years?"
{"intent":"count","filters":{"course":"BSIT","college":null,"employmentStatus":null,"jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"yearsInJob":null,"yearsInJobMoreThan":7,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: same as above — just extract the raw number 7, do not decide yourself whether this is answerable.)

Q: "Which program has the most employed graduates?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"course","rankingDirection":"highest","summaryTopics":[],"unsupportedConditions":[]}
(Note: the grouping word is "program" — rankingField is "course", NOT "industry", even though "employed" is also in the sentence. "employed" becomes the employmentStatus filter that scopes the ranking, it does not change what is being ranked.)

Q: "Which college has the highest employment rate?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"college","rankingDirection":"highest","rankingMode":"rate","rankingScope":null,"compareScope":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: the grouping word is "college" itself, not "program"/"course" — rankingField is "college", comparing whole colleges (CCS, CBA, ...) against each other, not individual programs within one. "by employment RATE" also sets rankingMode "rate", same as any other rankingField — each college is ranked by what fraction of its OWN respondents are employed, not raw headcount.)

Q: "Which program in BSIT has the most employed graduates?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"specialization","rankingDirection":"highest","rankingScope":"BSIT","summaryTopics":[],"unsupportedConditions":[]}
(Note: "program IN BSIT" names ONE program (BSIT) and asks for its own internal breakdown — this is "specialization", NOT "course", with "BSIT" copied into rankingScope (not filters.course — filters.course is for scoping a COUNT/PERCENTAGE/NAMES query to one program, a different purpose than naming which program's majors a ranking should compare).)

Q: "Which BSBA major has the most employed graduates?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"specialization","rankingDirection":"highest","rankingScope":"BSBA","summaryTopics":[],"unsupportedConditions":[]}
(Note: same pattern for a different parent program — BSBA's own majors (Financial Management, Marketing Management, etc., each its own real course code like "BSBA-FM") are compared against each other, not against unrelated programs.)

Q: "show a visualization of which BSIS specialization has the most employed graduates?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"specialization","rankingDirection":"highest","rankingScope":"BSIS","summaryTopics":[],"unsupportedConditions":[]}
(Note: same pattern again — BSIS has exactly one tracked specialization, "Business Analytics", but it is still named via rankingScope "BSIS" like BSIT/BSBA, not hardcoded as a filter value here.)

Q: "How has the employment rate changed per batch year?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"graduationYear","rankingDirection":null,"rankingMode":"rate","rankingScope":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: "per batch year"/"over the years" is a trend, not a top-N ranking — rankingField "graduationYear", rankingDirection left null since the result is always full chronological order, never sorted by count. The question says "employment RATE", not just "employment" — per RULE 2b, that means "rankingMode":"rate" still has to be set even though this is a trend, not a top-N ranking; otherwise each batch year would be shown as a raw headcount instead of its own employment rate.)

Q: "Show the trend of employed graduates over the years"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"graduationYear","rankingDirection":null,"rankingMode":null,"rankingScope":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: contrast with the previous example — this one says "employed graduates" (a plain headcount), not "employment rate"/"percentage"/"%" anywhere, so "rankingMode" stays null (defaults to count) here. Same rankingField, same trend shape — only the rate-vs-count wording differs.)

Q: "Which batch year had the highest number of employed graduates?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"graduationYear","rankingDirection":"highest","rankingScope":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: unlike the trend example above, this NAMES a direction ("highest") — it wants the SINGLE best/worst batch year, not the full chronological history, so rankingDirection is set this time.)

Q: "What are the top 3 programs by employment rate?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"course","rankingDirection":"highest","rankingMode":"rate","rankingScope":null,"compareScope":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: "by employment RATE" means rankingMode "rate" — each program is ranked by what FRACTION of its own respondents are employed, not by raw headcount. "employmentStatus":"Employed" is still set — it names what the rate is a rate OF.)

Q: "Which skill do alumni rate themselves highest in?"
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":null,"jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":"skill","rankingDirection":"highest","rankingScope":null,"rankingMode":null,"compareScope":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: this ranks the 8 skill CATEGORIES against each other, not rating levels within one skill — "rankingScope" stays null since no specific rating level was named, defaulting to "Excellent".)

Q: "Compare BSIT and BSCS employment rates."
{"intent":"ranking","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":null,"rankingDirection":null,"rankingMode":null,"rankingScope":null,"compareScope":["BSIT","BSCS"],"summaryTopics":[],"unsupportedConditions":[]}
(Note: exactly two specific programs named and compared directly — "compareScope" instead of "rankingField":"course", which would wrongly compare EVERY program in the system instead of just these two.)

Q: "How many female BSIT alumni are employed?"
{"intent":"count","filters":{"course":"BSIT","college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"gender":"Female","furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"yearsInJob":null,"yearsInJobMoreThan":null,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}

Q: "How many TSM students are employed?"
{"intent":"count","filters":{"course":null,"college":null,"employmentStatus":"Employed","jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"gender":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"yearsInJob":null,"yearsInJobMoreThan":null,"specialization":"TSM","customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: "TSM" is a specialization/track code, not a course code — it goes in "specialization", with "course" left null. The downstream system already knows TSM belongs to BSIT; you don't need to also set course "BSIT" yourself.)

Q: "How many Network Administration students are there?"
{"intent":"count","filters":{"course":null,"college":null,"employmentStatus":null,"jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"gender":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"yearsInJob":null,"yearsInJobMoreThan":null,"specialization":"NA","customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: "Network Administration" is the spoken-out name for the "NA" track code — map it to specialization "NA", a real answer, never treat "Network Administration" as if nothing was named.)

Q: "Show me tracer survey activity for CASS"
{"intent":"summary","filters":{"course":null,"college":"CASS","employmentStatus":null,"jobTitle":null,"industryField":null,"companyName":null,"workLocation":null,"furtherEducation":null,"professionalDevelopmentActivities":null,"awardsOrRecognition":null,"customQuestion":null},"rankingField":null,"rankingDirection":null,"summaryTopics":[],"unsupportedConditions":[]}
(Note: "Show me" here is followed by "tracer survey activity", not by any mention of people/names — this is "summary" intent, not "names", despite starting with "show me".)

Known official course codes (for your reference only — still copy the question's own wording verbatim, do not substitute from this list): ${ALL_COURSES.join(', ')}
Known official college codes (for your reference only — still copy the question's own wording verbatim, do not substitute from this list): ${COLLEGE_CODES.join(', ')}`;

function stripFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Returns the raw, UNVALIDATED parsed plan object, or null if the LLM call
 * failed or its response wasn't parseable JSON shaped like a plan. Callers
 * must run this through queryPlanValidator before using any field — see
 * this file's own top comment.
 */
async function extractQueryPlan(question) {
  // Retries on rate-limit/overload errors, same pattern as ragService.js's
  // own streamHF — without this, a transient HF 429/503 (more likely under
  // this project's own heavy test traffic) silently produced a "no plan"
  // result with ZERO trace in the logs (the catch block below used to just
  // `return null`), making a purely transient failure look identical to a
  // genuine extraction miss. Caught live: "okay naman kanina, bakit ayaw
  // na ngayon" for the exact same question that had just been verified
  // working moments earlier in isolated testing — this retry+logging is
  // the fix for exactly that class of report.
  let raw;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const completion = await hf.chatCompletion({
        model: CHAT_MODEL,
        provider: process.env.HF_PROVIDER || undefined,
        messages: [
          { role: 'system', content: PLAN_SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        max_tokens: 300,
        temperature: 0,
      });
      raw = completion.choices[0]?.message?.content;
      break;
    } catch (err) {
      const isRateLimit = err?.statusCode === 429 || err?.statusCode === 503 || /rate|limit|overload/i.test(err?.message || '');
      if (isRateLimit && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 800));
        continue;
      }
      logger.error('query_plan_extraction_failed', { question, attempt, error: err });
      return null;
    }
  }
  if (!raw) {
    logger.error('query_plan_extraction_empty', { question });
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (err) {
    logger.error('query_plan_parse_failed', { question, raw, error: err });
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.error('query_plan_shape_invalid', { question, parsed });
    return null;
  }
  if (typeof parsed.intent !== 'string') {
    logger.error('query_plan_intent_missing', { question, parsed });
    return null;
  }

  return {
    intent: parsed.intent,
    filters: (parsed.filters && typeof parsed.filters === 'object') ? parsed.filters : {},
    rankingField: parsed.rankingField ?? null,
    rankingDirection: parsed.rankingDirection ?? null,
    rankingScope: parsed.rankingScope ?? null,
    rankingMode: parsed.rankingMode ?? null,
    compareScope: Array.isArray(parsed.compareScope) && parsed.compareScope.length === 2 ? parsed.compareScope : null,
    summaryTopics: Array.isArray(parsed.summaryTopics) ? parsed.summaryTopics.filter((t) => typeof t === 'string') : [],
    unsupportedConditions: Array.isArray(parsed.unsupportedConditions) ? parsed.unsupportedConditions.filter((c) => typeof c === 'string') : [],
  };
}

module.exports = { extractQueryPlan };
