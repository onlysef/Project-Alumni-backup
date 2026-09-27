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
  event_feedback:  /\bfeedback\s+(?:for|on|about|regarding)\b|\b(?:rated|rating)\b.{0,25}\bevent\b|\bevent\b.{0,25}\b(?:rated|rating)\b|\bpuna\s+(?:para\s+sa|tungkol\s+sa|sa)\b|\bkomento\s+(?:para\s+sa|tungkol\s+sa|sa)\b|\brating\s+(?:ng|para\s+sa)\b/i,
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
  events:          /\bevents?\b|\battend(?:ed|ees|ance)?\b|\bdumalo\b|\bpagdalo\b/i,
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
  names:           /\b(who\s+(?:are|is)\s+(?:the\s+|those\s+|these\s+)?(?:\w+\s+){0,4}(?:alumni|alumnus|alumna|graduates?|respondents?)|who (did|do|does|didn'?t|don'?t|doesn'?t|have|has|haven'?t|hasn'?t|were|was|weren'?t|wasn'?t|passed|failed|took|pursued|works?|worked)|who\s+(?:is|are)\s+(?:currently\s+|now\s+|still\s+)?(?:working|employed|unemployed|self-employed)\b|names?\s+of\s+(?:the\s+)?(?:\w+\s+){0,3}(?:alumni|graduates?|respondents?)|list.{0,20}(names?|alumni|graduates?)|show.{0,20}(names?|alumni|graduates?)|which alumni|which graduates?|name.{0,30}alumni|alumni.{0,30}name|graduates?.{0,30}name|name.{0,30}graduates?)\b|\bsino[\s-]*sino\s+ang\b|\bsino\s+ang\s+mga\b|\bsaan\s+(?:sila|sina|nila|silang)\b.{0,20}\b(?:nagtatrabaho|nagwowork|naninirahan|nakatira)\b|\bwhere\s+(?:do|does)\s+they\s+work\b|\bano\s+ang\s+(?:trabaho|posisyon|position)\s+(?:nila|niya)\b|\bwhat\s+(?:is|are)\s+their\s+(?:job\s+title|position|occupation)s?\b|\bkailan\s+(?:sila|silang)\b.{0,15}\b(?:nagtapos|natapos|nag-?graduate|nagsi-?graduate)\b|\bwhen\s+did\s+they\s+graduate\b|\bsino\b.{0,15}\b(?:nagtatrabaho|nagwowork|empleyado)\s+sa\b/i,
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
  count:           /\b(how many (?:\w+\s+){0,4}(alumni|records?|graduates?|respondents?|people)|how many (passed|failed|took|pursued|work\w*|did)|total (alumni|records?|graduates?|respondents?)|number of (alumni|records?|graduates?|respondents?)|count\s+of\s+(?:\w+\s+){0,4}(alumni|records?|graduates?|respondents?)|how many are there|how many alumni are|ilang?\b.{0,20}\b(alumni|guraduwado|nagtapos|respondents?))\b/i,
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
  rate:            /\b(what\s+(percentage|percent|rate)|how\s+many\s+percent|(un)?employment\s+rate|percentage\s+of\s+(?:\w+\s+){0,3}(graduates?|alumni)|found\s+a\s+job|got\s+a\s+job|porsyento|porsiyento)\b/i,
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
  top_companies:   /\b(?:what|which)\s+compan(?:y|ies)\b.{0,25}\b(?:employ|hire|hiring)\w*\b|\b(?:top|most|least)\s+compan(?:y|ies)\b|\bcompan(?:y|ies)\b.{0,20}\b(?:hire|hiring|employ)\w*\b.{0,15}\balumni\b|\bcompan(?:y|ies)\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:most|least|highest|top)\b/i,
  industry:        /\bindustr|industriya/i,
  work_type:       /\b(government|private|sector|work type|type of (employment|work)|employment type|gobyerno|pribado)\b/i,
  job_relevance:   /\b(related|relevance|relevant\s+to\s+(?:the(?:ir)?\s+)?(?:course|study|program|degree|field)|align(?:s|ed|ment)?\s+(?:with|to)\b.{0,20}\b(?:course|study|studied|program|degree|field))\b|\bkaugnay\s+(?:ng|sa)\s+(?:kurso|propesyon|larangan|programa)\b|\bmay\s+kinalaman\s+sa\s+(?:kurso|propesyon|larangan|programa)\b/i,
  further_studies: /\b(further studies?|graduate studies?|masters?|phd|post.?grad|further education|nagpatuloy.{0,15}pag-?aaral|magpapatuloy.{0,15}pag-?aaral)\b/i,
  licensure:       /\blicens\w*\b|\b(board\s+exam|professional\s+exam|prc|lisensya)\b|\b(tak\w*|pass\w*|fail\w*).{0,20}\bexam\b/i,
  // New topic — Graduate.hasPromotion had a real, normalized, populated
  // field (see queryPromotion()'s own comment) but no TOPIC_PATTERNS entry
  // to ever route a question to it at all.
  promotion:       /\bpromot(?:ed|ion|ions)?\b|\bna-?promote\b|\bpinromote\b|\bnapromote\b/i,
  // New topic — same gap as promotion above, for Graduate.furtherTraining.
  // Distinct from further_studies (graduate school) — trainings/seminars/
  // workshops are a completely different tracer-form question with no
  // overlap in wording, so this can't collide with that pattern.
  further_training: /\btrainings?\b|\bseminars?\b|\bworkshops?\b|\bsumali\s+sa\s+training\b|\bnag-?training\b/i,
  // Bare "rating(s)" ADDED — the only thing "rating" ever refers to in this
  // dataset is the competency self-assessment scores (Excellent/Competent/
  // .../Non-Acceptable per category); there's no other "rating" concept for
  // it to collide with. Without this, "What is the average rating of
  // alumni?" matched no TOPIC_PATTERNS entry and no EMPLOYMENT_SIGNAL word
  // either, so it fell through the whole aggregation layer to RAG — which
  // had nothing relevant either — and refused with the generic "I don't
  // have enough data" sentence for a question the competency data could
  // answer perfectly well.
  competencies:    /\b(competenc\w*|skill\s+ratings?|ratings?|self.?assess|performance|technical\s+skills?|communication\s+skills?|problem.?solving|critical\s+thinking|teamwork|adaptability|project\s+management|kasanayan|kakayahan)\b/i,
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
  by_program:      /\b(by program|by course|per program|per course|each program|program breakdown|bawat\s+(kurso|programa)|per\s+(kurso|programa))\b|\b(?:program|course|degree)\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:most|least|highest|top|more|fewer)\b/i,
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
  gender:          /\b(gender|\bmale\b|\bfemale\b|\bmen\b|\bwomen\b|\bqueer\b|\bgay\b|\blesbian\b|transgender|non.?binary|lalaki(?:ng)?|babae(?:ng)?)\b|lgbt\w*/i,
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
const EMPLOYMENT_SIGNAL = /employ|\bjob|\bwork|\bstatus\b|\boccupation\b|\bposition\b|trabaho|empleyado|negosyo/i;

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
function wantsHighestDirection(question) {
  if (/\b(lowest|least|fewest)\b/i.test(question)) return false;
  return /\b(most|highest)\b/i.test(question);
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

  // Combined program+track shorthand: "BSIT-TSM", "BSIT/WMA", "BSIT NA".
  // Must run BEFORE the generic BS-prefix match below, which stops at the
  // hyphen/slash and would otherwise truncate this to plain "BSIT" — silently
  // dropping the track and matching the whole Information Technology program
  // instead of the specific specialization asked about. filters.program is
  // used as a MongoDB regex, so "X.*Y" requires both substrings present in
  // order, matching the real stored format ("...Information Technology -
  // Specialized in Technical Service Management").
  const TRACK_MAP = { TSM: 'Technical Service Management', WMA: 'Web and Mobile Application', NA: 'Network Administration' };
  const trackMatch = question.match(/\bBS[- ]?IT\s*[-\/]\s*(TSM|WMA|NA)\b/i);
  if (trackMatch) {
    const track = TRACK_MAP[trackMatch[1].toUpperCase()];
    filters.program = `Information Technology.*${track}`;
    // filterLabel() prefers this for display so the answer reads naturally
    // instead of showing the raw ".*" regex used for matching.
    filters.programLabel = `Information Technology - ${track}`;
  }

  // Program name: "BSCS graduates", "BSIT students", etc.
  const courseMatch = !filters.program && question.match(/\b(BS[A-Z]{1,8}|B\.?S\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?|Bachelor(?:\s+of\s+[A-Za-z]+)+)\b/i);
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
    if (expanded) filters.program = expanded;
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
    const NEGATED_FIELD_JOB_ABBR = [
      [/\b(?:non|not)\s+IT\s+jobs?\b/, 'Information Technology'],
      [/\b(?:non|not)\s+CS\s+jobs?\b/, 'Computer Science'],
      [/\b(?:non|not)\s+IS\s+jobs?\b/, 'Information Systems'],
      [/\b(?:non|not)\s+IM\s+jobs?\b/, 'Information Management'],
    ];
    for (const [pat, expansion] of NEGATED_FIELD_JOB_ABBR) {
      if (pat.test(question)) { filters.excludeIndustry = expansion; break; }
    }
  }

  if (!filters.industry && !filters.excludeIndustry) {
    const NEGATED_FIELD_RELATED_ABBR = [
      [/\b(?:non|not)\s+IT[- ]related\b/, 'Information Technology'],
      [/\b(?:non|not)\s+CS[- ]related\b/, 'Computer Science'],
      [/\b(?:non|not)\s+IS[- ]related\b/, 'Information Systems'],
      [/\b(?:non|not)\s+IM[- ]related\b/, 'Information Management'],
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
      [/\bNet(?:work)?\s*Admin\w*\b/i,          'Network Administration'],
      [/\bNA\b/,                                'Network Administration'],   // case-sensitive: avoids Filipino "na"
      [/\bBusiness\s*Analytics?\b/i,            'Business Analytics'],
      // (?<!nasa\s)...(?![- ]related|\s+jobs?\b) — see the NASA_INDUSTRY_ABBR/
      // FIELD_RELATED_ABBR blocks above: "nasa IT", "IT-related", and bare
      // "IT jobs" all mean workplace/field, already claimed as an industry
      // filter there, not a program to also (redundantly, and wrongly)
      // claim here. Caught live: "IT jobs directly related to their course"
      // resolved filters.program='Information Technology' (BSIT alumni)
      // instead of filters.industry — a completely different cohort (BSIT
      // graduates whose job matches THEIR course, vs. anyone working an IT
      // job that matches THEIR OWN course, whatever it was).
      [/\b(?<!nasa\s)IS(?![- ]related|\s+jobs?\b)\b/,                     'Information Systems'],      // case-sensitive: avoids "is"
      [/\b(?<!nasa\s)IT(?![- ]related|\s+jobs?\b)\b/,                     'Information Technology'],   // case-sensitive: avoids "it"
      [/\b(?<!nasa\s)CS(?![- ]related|\s+jobs?\b)\b/,                     'Computer Science'],         // case-sensitive: avoids "cs"
      [/\b(?<!nasa\s)IM(?![- ]related|\s+jobs?\b)\b/,                     'Information Management'],   // case-sensitive: avoids "im"
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
      if (!new RegExp(`\\b${k}\\b(?!\\s+industry\\b)`, 'i').test(question)) return false;
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

  // Industry — path 1: explicit "industry/sector/field" keyword
  // Note: no \b after "industr" — "industry"/"industries" don't have boundary after "industr"
  let industryMatchIndex = null;
  if (/\bindustr|\bsector\b|\bfield\b/i.test(question)) {
    const indMatch = question.match(/\b(?:works?\s+in|working\s+in|employed\s+in|in)\s+(?:the\s+)?([a-zA-Z](?:[a-zA-Z ]){1,49}?)(?=\s+(?:industr|sector|field))/i);
    if (indMatch) { filters.industry = indMatch[1].trim(); industryMatchIndex = indMatch.index; }
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
      if (!isJobRelevancePhrase && !/^(the|a|an|this|that|those|our|their|its|any|all|database|system|table|records?|fields?)$/i.test(candidate)) {
        filters.industry = candidate;
        industryMatchIndex = verbMatch.index;
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
  const jobTitleMatch = question.match(/\b(?:working|works?|employed)\s+as\s+(?:an?\s+)?([a-zA-Z][a-zA-Z\s-]{1,49}?)(?=[?,!.]|$)/i)
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
  const neverEmployedCount = (question.match(/\bnever\s*employed\b/gi) || []).length;
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
    const phrase = filters.workLocation === 'local' ? 'local(?:ly)?' : 'abroad|overseas';
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
  } else if (/\b(pursu\w*\s+further|further\s+(education|studi)|graduate\s+studi|masters?|phd|post.?grad)\b/i.test(question)
    || /\bnagpatuloy.{0,15}pag-?aaral\b|\bmagpapatuloy.{0,15}pag-?aaral\b/i.test(question)) {
    filters.furtherEducation = 'Yes';
  }

  // Specific employment TYPE (not status) — "regular/permanent jobs",
  // "contractual", "job order", "casual", "temporary", "probationary",
  // "project-based", "trainee", "on training", "GIP" — a real Graduate field
  // (employmentType) with no filter extraction of its own until now. Gated
  // on a "job(s)/employment/employee(s)/position/work" word nearby so a bare
  // "regular"/"permanent"/"casual" elsewhere in an unrelated sentence is
  // never mistaken for this filter. Without this, "How many alumni have
  // regular or permanent jobs?" matched no filter at all and silently
  // answered with the unfiltered whole-database total (262) instead of the
  // ~98 alumni actually in a Regular/Permanent position. "employee(s)"
  // added after the fix's own first pass missed "How many alumni are
  // casual employees?" — "employees" isn't a substring of "employment", so
  // the original guard word list didn't catch it either.
  if (/\b(?:jobs?|employment|employees?|position|work)\b/i.test(question)) {
    const WORK_TYPE_MAP = [
      [/\b(?:regular|permanent)\b/i, 'Regular/Permanent'],
      [/\bjob\s*order\b/i,           'Job Order'],
      [/\bcontractual\b/i,           'Contractual'],
      [/\btemporary\b/i,             'Temporary'],
      [/\bprobationary\b/i,          'Probationary'],
      [/\bcasual\b/i,                'Casual'],
      [/\bproject-?based\b/i,        'Project-based'],
      [/\btrainee\b/i,               'Trainee'],
      [/\bon\s+training\b/i,         'On Training'],
      [/\b(?:gip|government\s+internship)\b/i, 'GIP'],
    ];
    for (const [pat, value] of WORK_TYPE_MAP) {
      if (pat.test(question)) { filters.employmentType = value; break; }
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
    [/\bwork.?life\s+balance\b/i,       'workLifeBalance'],
    [/\bteamwork\b/i,                   'teamwork'],
    [/\badaptability\b/i,               'adaptability'],
    [/\bcommunication\s+skills?\b|\bcommunication\b/i, 'communication'],
  ];
  for (const [pat, key] of COMP_MAP) {
    if (pat.test(question)) { filters.competency = key; break; }
  }

  // Board / licensure exam filter — negation must bind to the RIGHT verb.
  // "did not pass" means failed (or at least not-passed), NOT "never took
  // the exam" — a single generic "did not/didn't/never" check used to
  // collapse both into tookExam='no', silently mislabeling "did not pass the
  // board exam" as "never took it." Check take/pass/fail negation separately.
  if (/\blicens\w*\b|\b(board\s+exam|professional\s+exam|prc|tak\w*.{0,20}\bexam\b|pass\w*.{0,20}\bexam\b|fail\w*.{0,20}\bexam\b|pumasa|pumapasa|nakapasa|bumagsak|nabagsak|pumalya)\b/i.test(question)) {
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
    const unknownProgramMatch = question.match(/\b([A-Z]{2,8})\s+(?:graduates?|alumni|alumnus|alumna|students?)\b/);
    if (unknownProgramMatch) {
      filters.program = unknownProgramMatch[1];
      filters.programLabel = unknownProgramMatch[1];
    }
  }

  return filters;
}

function filterLabel(filters) {
  const parts = [];
  if (filters.programLabel)  parts.push(filters.programLabel);
  else if (filters.program)  parts.push(filters.program);
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
function withChart(text, { type = 'donut', title, rows, labelField = '_id', limit } = {}) {
  if (!text || !rows?.length) return text;
  const chartRows = (limit ? rows.slice(0, limit) : rows)
    .map(r => ({ label: String(r[labelField] ?? r._id ?? r.label ?? ''), count: r.count }))
    .filter(r => r.label);
  if (!chartRows.length) return text;
  return { text, chart: { type, title, rows: chartRows } };
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
const BY_PROGRAM_QUESTION_PATTERN = /\b(?:which|what)\s+(?:program|course|degree)\b|\branking\s+of\s+(?:programs?|courses?)\b|\b(?:programs?|courses?)\s+(?:ranking|ranked)\b|\brank(?:ed)?\s+(?:the\s+)?(?:programs?|courses?)\b|\b(?:program|course|degree)\b.{0,20}\b(?:that\s+has|has|with)\b.{0,20}\b(?:highest|lowest|best|worst)\b/i;

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

// Returns a pipeline prefix: filter by stable fields (program, year) then DEDUP.
// Variable fields (employmentStatus, industry, etc.) must be applied AFTER this
// so deduplication uses each person's newest record value.
function stablePipeline(filters) {
  const match = {};
  if (filters.program) match.program = { $regex: filters.program, $options: 'i' };
  const yearCond = yearMatchCondition(filters);
  if (yearCond !== null) match.yearGraduated = yearCond;
  // Was missing: filters.gender was extracted by extractFilters() but never
  // applied anywhere except queryGender() itself — every other function
  // (queryCount, queryEmployment, queryIndustry, etc.) silently ignored a
  // "male"/"female" qualifier and answered for everyone instead, with no
  // indication anything was dropped. Adding it here as a stable pre-filter
  // fixes every function that uses stablePipeline() in one place.
  if (filters.gender)        match.gender        = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };
  return [{ $match: match }, ...DEDUP];
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
  const groupedPipeline = [...pipeline, { $group: { _id: '$industry', count: { $sum: 1 } } }];
  pipeline.push(
    { $group: { _id: '$industry', count: { $sum: 1 } } },
    { $sort: { count: wantsHighest ? -1 : 1 } },
  );
  if (!filters.industry && !filters.excludeIndustry && !filters.showAllIndustries) pipeline.push({ $limit: 10 });

  const rows = await Graduate.aggregate(pipeline);
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

  if (filters.industry) {
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `**${subjectCap} working in ${filters.industry} industry${locLabel}${lbl}:**\n\n`;
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
    let out = `**${subjectCap} NOT working in ${filters.excludeIndustry} industry${locLabel}${lbl}:**\n\n`;
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
    tiedRows = await Graduate.aggregate([...groupedPipeline, { $match: { count: extremeCount } }]);
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

  pipeline.push(
    { $group: { _id: '$jobTitle', count: { $sum: 1 } } },
    { $sort: { count: wantsHighest ? -1 : 1 } },
    { $limit: 10 },
  );

  const rows = await Graduate.aggregate(pipeline);
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

  pipeline.push(
    { $group: { _id: '$companyName', count: { $sum: 1 } } },
    { $sort: { count: wantsHighest ? -1 : 1 } },
    { $limit: 10 },
  );

  const rows = await Graduate.aggregate(pipeline);
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
  if (filters.program) stableMatch.program = { $regex: filters.program, $options: 'i' };
  const genderYearCond = yearMatchCondition(filters);
  if (genderYearCond !== null) stableMatch.yearGraduated = genderYearCond;

  const rows = await Graduate.aggregate([
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
  return withChart(out, { type: 'donut', title: 'Gender Breakdown', rows, labelField: 'display' });
}

async function queryWorkType(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentType: { $nin: [null, ''] } } },
    { $group: { _id: '$employmentType', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);

  const lbl = filterLabel(filters);
  const gPrefix = genderPrefix(filters);
  let out = `**Employment type breakdown${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
  rows.forEach(r => { out += `- **${r._id}**: ${r.count} (${pct(r.count, total)})\n`; });
  return withChart(out, { type: 'donut', title: 'Employment Type', rows });
}

async function querySector(filters) {
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { employmentType: { $nin: [null, ''] } } },
    { $group: { _id: '$employmentType', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
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
  const rows = await Graduate.aggregate([
    ...stablePipeline(filters),
    { $match: { jobRelated: { $nin: [null, ''] } } },
    { $group: { _id: '$jobRelated', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
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
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, jobRelated: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
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
  const chartRows = ranked.map(r => ({ _id: r._id, count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: 'Job Alignment Rate by Program (%)', rows: chartRows });
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

async function queryFurtherStudies(filters) {
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
  let out = `**Further education after graduation${gPrefix ? ` for ${gPrefix}alumni` : ''}${lbl}:**\n\n`;
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
    Graduate.aggregate([...base, { $count: 'total' }]),
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
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
    // Some alumni listed multiple programs separated by ";". Take only the first one.
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
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
  const chartRows = rows.map(r => ({ _id: r._id, count: r.total }));
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
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
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
  const chartRows = ranked.map(r => ({ _id: r._id, count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: 'Employment Rate by Program (%)', rows: chartRows });
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
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
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
  const chartRows = ranked.map(r => ({ _id: r._id, count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: `${label} Rate by Program (%)`, rows: chartRows });
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
    { $match: stableMatch },
    ...DEDUP,
    { $match: { program: { $nin: [null, ''] }, workLocation: { $nin: [null, ''] } } },
    { $addFields: { _prog: { $trim: { input: { $arrayElemAt: [{ $split: ['$program', ';'] }, 0] } } } } },
    { $match: { _prog: { $gt: '' } } },
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
  const chartRows = rows.map(r => ({ _id: r._id, count: Math.round((r.matched / r.total) * 100) }));
  return withChart(out, { type: 'bars', title: `Alumni ${toTitleCase(label)} Rate by Program (%)`, rows: chartRows });
}

async function queryByYear(filters) {
  // Group BY year — only pre-filter by program/gender/yearFrom (stable), not
  // a single exact year (that would collapse the grouping to one row).
  const stableMatch = {};
  if (filters.program)  stableMatch.program       = { $regex: filters.program, $options: 'i' };
  if (filters.gender)   stableMatch.gender         = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };
  const yearRange = yearRangeCondition(filters);
  if (yearRange) stableMatch.yearGraduated = yearRange;

  const rows = await Graduate.aggregate([
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
  return withChart(out, { type: 'line', title: 'Employment Rate by Batch Year (%)', rows: chartRows });
}

// Answers "which batch/year had the most/fewest graduates?" — raw headcount
// per year, computed directly from MongoDB. Unlike the rate-ranking function
// below, no minimum-sample threshold applies here: a year with few graduates
// is itself a real, meaningful answer to a headcount question, not noise.
async function queryYearWithMostGraduates(filters, direction) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: filters.program, $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
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
  const chartRows = [...rows].reverse().map(r => ({ _id: `Batch ${r._id}`, count: r.total }));
  return withChart(out, { type: 'bars', title: 'Graduates by Batch Year', rows: chartRows });
}

// Answers "which year had the highest/lowest employment/unemployment rate?"
// — same per-year grouping shape as queryByYear(), computed directly from
// MongoDB, but ranked by rate and calling out the extreme year instead of
// just listing all of them. Years with fewer than 3 respondents are excluded
// so a single lucky/unlucky record can't swing the "highest/lowest" result —
// same threshold used by queryEmploymentRateByProgram() for the same reason.
async function queryYearRateExtreme(filters, direction, metric) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: filters.program, $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
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

  let out = `**${label} rate by batch year${lbl}:**\n\n`;
  withRate.forEach(r => {
    const shown = metric === 'unemployment' ? r.notEmp : r.emp;
    out += `- **Batch ${r._id}**: ${pct(shown, r.total)} (${shown}/${r.total})\n`;
  });
  const topShown = metric === 'unemployment' ? top.notEmp : top.emp;
  out += `\n**Batch ${top._id}** had the ${direction} ${metric} rate, at **${pct(topShown, top.total)}** (${topShown} out of ${top.total}).`;
  const chartRows = [...ranked].reverse().map(r => ({ _id: `Batch ${r._id}`, count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: `${label} Rate by Batch Year (%)`, rows: chartRows });
}

// Answers "which batch has the highest/lowest job-course relevance rate?" —
// same shape as queryJobAlignmentByProgram() but grouped by yearGraduated
// instead of program, and parameterized by direction so it can also answer
// "lowest" (queryJobAlignmentByProgram() only ever surfaces the highest).
// Years with fewer than 3 respondents are excluded for the same small-sample
// reason used everywhere else in this file.
async function queryYearJobAlignment(filters, direction) {
  const stableMatch = {};
  if (filters.program) stableMatch.program = { $regex: filters.program, $options: 'i' };
  if (filters.gender)  stableMatch.gender  = { $regex: `^${escapeRegex(filters.gender)}$`, $options: 'i' };

  const rows = await Graduate.aggregate([
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
  const chartRows = [...ranked].reverse().map(r => ({ _id: `Batch ${r._id}`, count: Math.round(r.rate * 100) }));
  return withChart(out, { type: 'bars', title: 'Job-Course Relevance Rate by Batch Year (%)', rows: chartRows });
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
  /\bwhere\s+is\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\s+(?:currently\s+)?working\b/i,
  // "where does X work" — simple present tense, distinct regex shape from
  // "where IS X working" above (progressive tense); a real, common phrasing
  // that fell all the way through to the generic employment breakdown with
  // no match at all before this.
  /\bwhere\s+does\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\s+(?:currently\s+)?work\b/i,
  /\bwhat\s+(?:is|does)\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})(?:'s)?\s+(?:job|occupation|position|current\s+job|current\s+role|working\s+as|company|employer|(?:contact|phone|cell(?:phone)?|mobile)\s+number|number|contact\s+(?:info|information|details)|email(?:\s+address)?)\b/i,
  /\bis\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\s+(?:currently\s+)?employed\b/i,
  /\bwhat\s+company\s+does\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\s+work\s+(?:for|at)\b/i,
  // "who is X working for/with/at" is now handled by WHO_IS_PATTERN below
  // (it's a strict superset — bare "who is X" AND this trailing-clause form).
  // Trailing "of X" form ("contact number of X", "phone number of X") —
  // requires the captured span to start with a capital letter (same as
  // every pattern above), so this never collides with the existing
  // "number of" STATISTICAL_PATTERNS trigger ("number of graduates" has no
  // capitalized name to capture, so it just never matches here).
  /\b(?:contact|phone|cell(?:phone)?|mobile)?\s*number\s+of\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\b/i,
  /\bhow\s+(?:can|do)\s+i\s+(?:contact|reach)\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\b/i,
  // "email of X" / "email address of X" — same trailing-of-X shape as the
  // number pattern above.
  /\bemail(?:\s+address)?\s+of\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\b/i,
  // Broadest, most generic phrasing — "give me info about X" / "tell me
  // about X" / "details on X" carries no specific attribute at all (unlike
  // every pattern above, which names a job/number/status), so it has to be
  // last and is deliberately the widest net: any capitalized 1-5 word span
  // right after one of these trigger phrases.
  /\b(?:give\s+me|show\s+me|what\s+is)?\s*(?:the\s+)?(?:info(?:rmation)?|details?)\s+(?:about|on|for|of)\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\b/i,
  /\btell\s+me\s+about\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,4})\b/i,
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
const NAMED_LOOKUP_PATTERN = /\b(?:alumni|alumnus|alumna|graduates?)\s+(?:named|called)\s+([a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4})(?=[?,!.]|$)/i;

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
const IS_ALUMNI_PATTERN = /\bis\s+((?:(?!\b(?:an?|the)\b)[a-zA-Z][a-zA-Z.'-]*)(?:\s+(?:(?!\b(?:an?|the)\b)[a-zA-Z][a-zA-Z.'-]*)){0,3})\s+(?:an?\s+)?(?:alumni|alumnus|alumna|a\s+graduate|part\s+of\s+(?:the\s+)?(?:alumni|tracer\s+study))\b/i;

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
const WHO_IS_NAME_WORD = String.raw`(?!(?:${WHO_IS_EXCLUDE_WORDS})\b)[a-zA-Z][a-zA-Z.'-]*`;
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
const SINO_SI_PATTERN = /\bsino\s+si\s+([a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4}?)(?=\s+(?:ba|po)\b|[?,!.]|\s*$)/i;

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
const SAAN_NAGTATRABAHO_PATTERN = /\b(?:saan|san)\b.{0,20}trabaho.{0,10}\bsi\s+([a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4}?)(?=\s+(?:ba|po)\b|[?,!.]|\s*$)/i;

// "trabaho ni Liam Miranda" / "kamusta na ang tracer study ni Liam Miranda"
// — "ni" is the Filipino GENITIVE personal-name marker ("of"/possessive
// "X's"), the mirror-image case of "si"/"sina" above (subject-position
// name markers). Unlike those, "ni X" can land anywhere in the sentence,
// not just right after a fixed trigger phrase — checked LAST (after every
// other pattern in extractPersonName() below) precisely because it's this
// unanchored, so it only gets a chance once every more specific pattern has
// already failed to match. Same "ba"/"po" trailing-particle allowance as
// SINO_SI_PATTERN.
const NI_POSSESSIVE_PATTERN = /\bni\s+([a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4}?)(?=\s+(?:ba|po)\b|[?,!.]|\s*$)/i;

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
const STATUS_NAME_WORD = String.raw`(?!(?:${STATUS_EXCLUDE_WORDS})\b)[a-zA-Z][a-zA-Z.'-]*`;
const STATUS_LOOKUP_PATTERN = new RegExp(
  String.raw`\bwhat\s+(?:is\s+|does\s+)?(${STATUS_NAME_WORD}(?:\s+${STATUS_NAME_WORD}){1,3})(?:'s)?\s+(?:(?:employment|job|marital|civil|account|current)\s+)*status\b`,
  'i'
);

function extractPersonName(question) {
  const namedMatch = question.match(NAMED_LOOKUP_PATTERN);
  if (namedMatch) return namedMatch[1].trim();

  const isAlumniMatch = question.match(IS_ALUMNI_PATTERN);
  if (isAlumniMatch) return isAlumniMatch[1].trim();

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
      const nameMatch = m[1].match(/[A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*)*/);
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
async function queryPersonLookup(name, disambiguators = {}) {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const tokenPatterns = tokens.map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

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
    let narrowed = matches.filter(r => r.program && new RegExp(disambiguators.program, 'i').test(r.program));
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
  return buildPersonLookupResult(matches[0]);
}

// Shared by both name-based lookup (queryPersonLookup, above) and
// email-based lookup (queryPersonLookupByEmail, below) — an email uniquely
// identifies one Graduate row directly, with no name-matching/ambiguity
// step needed at all, but the actual fact-block text should read identically
// either way.
async function buildPersonLookupResult(match) {
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
  if (match.industry) facts.push(`- Industry: **${match.industry}**`);
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
  if (!facts.length) {
    facts.push('- (No further details on file — no job title, industry, location, employment status, contact number, or email recorded.)');
  }
  // Carried into suggestFollowUps() so post-lookup chips can be about THIS
  // person's own industry/program/gender instead of the generic tracer-study
  // default — see RELATED_TOPICS.person_lookup below.
  const programKeyword = programKeywordFrom(match.program);
  return {
    text: `**${displayName}**\n\n${facts.join('\n')}`,
    ambiguous: false,
    personFilters: {
      industry: match.industry || null,
      gender: match.gender || null,
      program: programKeyword,
      programLabel: programKeyword,
    },
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

  const suffix = docs.length < total ? ` (showing ${docs.length} of ${total} — say "show all" or "show 50" to see more)` : ` (${total} total)`;
  let out = `**Alumni${label ? ` ${label}` : ''}${suffix}:**\n\n`;
  docs.forEach((d, i) => {
    out += `${i + 1}. **${toTitleCase(cleanText(d.name))}**`;
    if (showJob && d.jobTitle) out += `, ${toTitleCase(cleanText(d.jobTitle))}`;
    if (showCompany && d.companyName) out += ` at ${toTitleCase(cleanText(d.companyName))}`;
    if (showLocation) out += d.workLocation ? ` — ${toTitleCase(cleanText(d.workLocation))}` : ` — location not on file`;
    if (showYear) out += d.yearGraduated ? ` — graduated ${d.yearGraduated}` : ` — graduation year not on file`;
    out += '\n';
  });
  return out;
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
const EVENT_NAME_TRIGGER = /(?:attend(?:ed|ees|ance)?|about|for|of|dumalo|pagdalo)\b(?:\s+(?:for|of|the|count|sa|ang))*\s+(.+?)(?:\s+event)?[?.!]*$/i;

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
  if (/^events?$/i.test(name)) return null;
  return name;
}

// Same token-matching approach queryPersonLookup() uses for alumni names
// (aggregationService.js above) — event titles get typed back inexactly
// ("job fair" vs "IT Job Fair 2026"), so every word in the extracted phrase
// must appear somewhere in the title, in any order, rather than requiring an
// exact substring match.
async function resolveEvent(question) {
  let name = extractEventName(question);
  if (!name) return { none: true };

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
  const tokenPatterns = tokens.map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

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
    return { error: `No event matching "${name}" found${college ? ` in ${college}'s events` : ''}.` };
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
  return out;
}

async function queryEventAttendanceCount(question) {
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
  return { text: `**${count}** alumni attended **${resolved.event.title}**.`, eventTitle: resolved.event.title };
}

async function queryEventAttendees(question) {
  const resolved = await resolveEvent(question);
  if (resolved.none) return queryEventOverview(question);
  if (resolved.error) return resolved.error;

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
  return { text: out, eventTitle: resolved.event.title };
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
const COMPARE_SPLIT = /\s+(?:and|at|vs\.?|versus)\s+/i;
async function queryCompare(question) {
  // "ihambing"/"ikumpara"/"paghambingin" (compare) / "pagkakaiba ng" (the
  // difference between) — same Tagalog gap as elsewhere in this file:
  // TOPIC_PATTERNS-style trigger words need a bilingual pair, not just an
  // English one.
  const stripped = question.replace(/\b(compare|difference\s+between|ihambing|ikumpara|paghambingin|pagkakaiba\s+ng)\b/i, '').trim();
  const parts = stripped.split(COMPARE_SPLIT);
  if (parts.length < 2) return null;

  const leftFilters  = extractFilters(parts[0]);
  const rightFilters = extractFilters(parts.slice(1).join(' '));

  let leftLabel, rightLabel, leftDimFilters, rightDimFilters;
  if (leftFilters.program && rightFilters.program && leftFilters.program !== rightFilters.program) {
    leftLabel       = leftFilters.programLabel  || leftFilters.program;
    rightLabel      = rightFilters.programLabel || rightFilters.program;
    leftDimFilters  = { program: leftFilters.program };
    rightDimFilters = { program: rightFilters.program };
  } else if (leftFilters.gender && rightFilters.gender && leftFilters.gender.toLowerCase() !== rightFilters.gender.toLowerCase()) {
    leftLabel       = leftFilters.gender;
    rightLabel      = rightFilters.gender;
    leftDimFilters  = { gender: leftFilters.gender };
    rightDimFilters = { gender: rightFilters.gender };
  } else {
    return null;
  }

  const [leftStats, rightStats] = await Promise.all([
    computeEmploymentRate(leftDimFilters),
    computeEmploymentRate(rightDimFilters),
  ]);
  if (!leftStats || !rightStats) return null;

  const leftRate  = leftStats.total  ? leftStats.employed  / leftStats.total  : 0;
  const rightRate = rightStats.total ? rightStats.employed / rightStats.total : 0;
  const higher = leftRate >= rightRate ? leftLabel : rightLabel;

  let out = `**Employment rate comparison:**\n\n`;
  out += `- **${leftLabel}**: ${pct(leftStats.employed, leftStats.total)} (${leftStats.employed}/${leftStats.total})\n`;
  out += `- **${rightLabel}**: ${pct(rightStats.employed, rightStats.total)} (${rightStats.employed}/${rightStats.total})\n\n`;
  out += `**${higher}** has the higher employment rate.`;

  // withChart() may return a plain string (if it can't build chart rows) or
  // { text, chart } — normalize the same way the other early-return bypasses
  // in queryInner (trend/"which batch") already do, since this result skips
  // the generic topic-dispatch wrapper entirely.
  const charted = withChart(out, {
    type: 'bars',
    title: 'Employment Rate Comparison (%)',
    rows: [
      { _id: leftLabel,  count: Math.round(100 * leftRate) },
      { _id: rightLabel, count: Math.round(100 * rightRate) },
    ],
  });
  const { text, chart } = typeof charted === 'string' ? { text: charted, chart: null } : charted;
  return { text, direct: true, topic: 'comparison', filters: {}, chart: chart || null };
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

async function queryCount(filters) {
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

  const lbl = filterLabel(filters);

  if (stableTotal === 0) return null;

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
  const locationLabel  = filters.workLocation
    ? (filters.negateWorkLocation ? ` NOT working ${filters.workLocation}` : ` working ${filters.workLocation}`)
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
  let out = `There are **${total}** ${desc} in the tracer study database${lbl}.`;

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

  return out;
}

async function queryOverview(filters) {
  const base = stablePipeline(filters);

  const countRows = await Graduate.aggregate([...base, { $count: 'total' }]);
  const total = countRows[0]?.total ?? 0;
  if (total === 0) return null;

  const empRows = await Graduate.aggregate([
    ...base,
    { $match: { employmentStatus: { $nin: [null, ''] } } },
    { $addFields: { _status: { $trim: { input: '$employmentStatus' } } } },
    { $group: { _id: '$_status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  // Denominator matches queryEmployment()/queryRate()'s own denominator (only
  // respondents with a non-null employmentStatus) — using the all-respondents
  // `total` here instead would silently disagree with those functions whenever
  // some records have no employmentStatus recorded.
  const empTotal = empRows.reduce((s, r) => s + r.count, 0);
  const formal   = empRows.filter(r => YES_RE.test(r._id) || /^employed$/i.test(r._id)).reduce((s, r) => s + r.count, 0);
  const selfEmp  = empRows.filter(r => /^self.?employed$/i.test(r._id)).reduce((s, r) => s + r.count, 0);
  const employed = formal + selfEmp;

  const indRows = await Graduate.aggregate([
    ...base,
    { $match: { industry: { $nin: [null, ''] } } },
    { $group: { _id: '$industry', count: { $sum: 1 } } },
    { $sort: { count: -1 } }, { $limit: 3 },
  ]);

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
    return `${total} tracer study record${total === 1 ? '' : 's'} ${total === 1 ? 'was' : 'were'} added${windowLabel}.`;
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
  return `${total} out of ${allTotal} alumni who submitted the tracer study ${verb} their answers since their first submission${windowLabel}.`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function hasData() {
  const count = await Graduate.countDocuments();
  return count > 0;
}

async function queryInner(question, seedFilters = {}) {
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
  ];
  for (const t of OUT_OF_SCOPE_TOPICS) {
    if (t.test.test(question) && !(t.exclude && t.exclude.test(question))) {
      return {
        text: `That's not part of the Graduate Tracer Study data — I can only answer questions about tracer study records (employment status, industries, board exam results, competencies, program breakdowns, etc.). ${t.hint}`,
        direct: true, topic: 'out_of_scope', filters: {},
      };
    }
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
  const outOfRangeYearMatch = question.match(/\b(?:batch|class\s+of|graduated?\s+in)\s+(\d{4})\b/i)
    || question.match(/\b(\d{4})\s+batch\b/i);
  if (outOfRangeYearMatch && !/\b(199\d|20[0-3]\d)\b/.test(outOfRangeYearMatch[1])) {
    const bounds = await Graduate.aggregate([
      { $match: { yearGraduated: { $ne: null } } },
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
      ...DEDUP,
      { $match: { employmentStatus: { $regex: '^(self.?employed|never employed)', $options: 'i' } } },
      { $group: { _id: '$employmentStatus', count: { $sum: 1 } } },
    ]);
    const total = rows.reduce((s, r) => s + r.count, 0);
    let out = `There are **${total}** graduates who are neither employed nor unemployed (Self-Employed or Never Employed) in the tracer study database.\n\n`;
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
    // wording ("give information about the skills and companies...") can
    // still produce 2+ "candidates" here. If literally NONE of them
    // resolved to a real record, this was never a genuine multi-person
    // question at all — fall through to normal topic detection below
    // instead of confidently reporting "no record found" for phantom
    // people. At least one real match is enough to commit to this path
    // (the rest may still legitimately be misses, per the existing
    // per-person "no record found" note below).
    if (!results.some(Boolean)) return null;

    // Any ambiguous match among the batch — show that disambiguation
    // verbatim (deterministic, never sent to the LLM), with a one-line note
    // for each other name so the user isn't left wondering what happened to
    // the rest of the batch.
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
  const bareNameFromBatchMatch = question.match(/^\s*([a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4})\s+from\s+batch\s+(\d{4})\b/i);
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
    && question.match(/^\s*([a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4})\s+from\s+([a-zA-Z][a-zA-Z .'-]{1,40})\s*[?.!]?\s*$/i);
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
    const lookup = await queryPersonLookup(personName, disambiguators);
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

  // 'showAll'/'showLimit'/'rankDirection'/'showAllIndustries'/'answerShape'
  // excluded from the "do we have enough to guess a topic" check — same
  // "carries no topic content of its own" principle as ragService.js's
  // isShowMoreOnlyContinuation() (see NAMES_PREVIEW_LIMIT's own comment
  // above). All five only ever MODIFY an already-established ranked/list
  // topic (how much to show, which direction to sort, count-vs-names shape)
  // — none of them imply "this is a names question" on their own. Without
  // this exclusion, a bare "show all" continuing a topic that itself named no
  // other filter (e.g. an open "least common INDUSTRIES" breakdown — no
  // specific industry named, so seedFilters contributes only rankDirection)
  // left `filters` holding just {rankDirection:'least', showAll:true}, which
  // this fallback wrongly read as "real content is present" and defaulted to
  // a full unfiltered ALUMNI NAMES dump — completely dropping the industries
  // topic the "show all" was actually asking to expand. Caught live
  // repeatedly: a bare {showAll:true} (before rankDirection existed),
  // rankDirection itself right after being added for a different bug (see
  // wantsRankHighest() above), and now answerShape right after being added
  // for the count-vs-names bug below — same fallback, same fix shape, one
  // more key to exclude each time a new turn-carrying filter with no real
  // topic content of its own gets introduced.
  if (topic === null && Object.keys(filters).some(k => !['programLabel', 'showAll', 'showLimit', 'rankDirection', 'showAllIndustries', 'answerShape'].includes(k))) {
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
  const wantsUnemploymentByProgram = filters.employmentStatus === 'No' || /\bunemploy/i.test(question);
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
  if (/\btrend\b|\byear[\s-]over[\s-]year\b|\bover\s+time\b|\b(improv|declin|increas|decreas|grow(?:ing|th)?|worsen|drop(?:ping|ped)?)\w*\b/i.test(question) || (filters.yearFrom && !filters.yearTo)) {
    // queryByYear() may return { text, chart } now — normalize the same way
    // the generic dispatch wrapper below does, since this early-return
    // bypasses that wrapper entirely.
    const result = await queryByYear(filters);
    if (result) {
      const { text, chart } = typeof result === 'string' ? { text: result, chart: null } : result;
      if (text) return { text, direct: true, topic: 'by_year', filters, chart: chart || null };
    }
  }

  // "Which batch year had the most graduates?" / "Which year had the
  // highest unemployment rate?" / "Which batch has the highest unemployment
  // rate?" — superlative ranking BY YEAR. "batch" and "year" are used
  // interchangeably in this domain (both tie to yearGraduated) — the pattern
  // must match EITHER word alone, not just "year" with "batch" as an
  // optional prefix, or "which batch has..." (no "year" at all) falls
  // through this bypass entirely. None of the TOPIC_PATTERNS entries capture
  // this shape (by_year only matches literal "by year"/"per year" phrasing),
  // so without this bypass these questions either fell through to RAG
  // entirely (no "employ" keyword to trigger the default 'employment'
  // fallback) or, worse, silently answered with queryEmployment()'s single
  // overall Yes/No breakdown — a confident answer that completely ignores
  // the "which batch/year" ranking that was actually asked.
  if (/\bwhich\s+(batch|year)\b/i.test(question) && /\b(most|highest|fewest|least|lowest)\b/i.test(question)) {
    const direction = wantsHighestDirection(question) ? 'highest' : 'lowest';
    // "Which batch has the lowest job-course relevance rate?" — mentions
    // neither "employ" nor "unemploy", so without this check it silently
    // fell through to the plain graduate-headcount ranking instead, a
    // totally different metric than the one actually asked about.
    const result = isJobAlignmentQuestion
      ? await queryYearJobAlignment(filters, direction)
      : /\bunemploy/i.test(question)
      ? await queryYearRateExtreme(filters, direction, 'unemployment')
      : /\bemploy/i.test(question)
      ? await queryYearRateExtreme(filters, direction, 'employment')
      : await queryYearWithMostGraduates(filters, direction);
    // queryYearRateExtreme()/queryYearWithMostGraduates() may return
    // { text, chart } now — normalize the same way the generic dispatch
    // wrapper below does, since this early-return bypasses that wrapper.
    if (result) {
      const { text, chart } = typeof result === 'string' ? { text: result, chart: null } : result;
      if (text) return { text, direct: true, topic: 'by_year', filters, chart: chart || null };
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

  // No specific topic matched and this isn't a bare industry lookup — decline
  // rather than silently answering with an unrelated employment breakdown.
  // The caller (ragService) falls through to RAG / vector search from here.
  if (topic === null) return null;

  // Shared by industry/competencies/job_positions/top_companies/skills_list
  // below — all five default to "most/highest" unless "least/lowest/fewest"
  // is stated. filters.rankDirection (extractFilters() above) wins when
  // present so a bare follow-up that inherited the direction via seedFilters,
  // but doesn't repeat the word itself in ITS OWN text, keeps the direction
  // the group was actually established with instead of silently flipping
  // back to the "most common" default.
  const wantsRankHighest = () => filters.rankDirection ? filters.rankDirection !== 'least' : !/\b(least|lowest|fewest)\b/i.test(question);

  const fn = {
    event_feedback:  () => queryEventFeedback(question),
    events:          () => /who\s+attended|attendees?|sino.{0,15}dumalo/i.test(question)
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
    count:           () => isSectorQuestion ? querySector(filters) : filters.employmentStatuses ? queryEmployment(filters) : (filters.workLocation || isCompoundLocationQuestion) ? queryWorkLocation(filters) : ((filters.industry || filters.excludeIndustry) && !filters.company && !filters.jobRelated) ? queryIndustry(filters) : queryCount(filters),
    rate:            () => isCompoundLocationQuestion
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
      : filters.jobRelated
      ? querySimpleRate(filters, { jobRelated: { $regex: '^yes', $options: 'i' } }, 'have jobs related to their course', wantsRateChart && 'Job Related to Course')
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
      : filters.industry
      ? querySimpleRate(filters, { industry: { $regex: filters.industry, $options: 'i' } }, `work in ${filters.industry}`, wantsRateChart && `Working in ${filters.industry}`)
      : filters.excludeIndustry
      ? querySimpleRate(filters, { industry: { $nin: [null, ''], $not: { $regex: filters.excludeIndustry, $options: 'i' } } }, `do NOT work in ${filters.excludeIndustry}`, wantsRateChart && `Not Working in ${filters.excludeIndustry}`)
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
    job_relevance:   () => BY_PROGRAM_QUESTION_PATTERN.test(question) ? queryJobAlignmentByProgram(filters)
      : filters.jobRelated ? queryCount(filters) : queryJobRelevance(filters),
    // filters.furtherEducation checked first — same reasoning as
    // licensure's own filters.tookExam check just below: an English "how
    // many did NOT pursue further studies" happens to also match the
    // 'count' topic pattern (bare "did") and route through queryCount()
    // for a single-number answer, but the equivalent Tagalog phrasing
    // ("ilan ang hindi nagpatuloy ng pag-aaral") only ever matches THIS
    // topic — without this check it always got the full breakdown instead
    // of the same single-count shape the English phrasing got.
    further_studies: () => /\bwho\b/i.test(question) ? queryNames(filters) : filters.furtherEducation ? queryCount(filters) : queryFurtherStudies(filters),
    licensure:       () => /\bwho\b/i.test(question) ? queryNames(filters) : filters.tookExam ? queryCount(filters) : queryLicensure(filters),
    promotion:        () => queryPromotion(filters),
    further_training: () => queryFurtherTraining(filters),
    competencies:    () => queryCompetencies(filters, wantsRankHighest()),
    work_location:   () => BY_PROGRAM_QUESTION_PATTERN.test(question)
      ? queryWorkLocationByProgram(filters, filters.workLocation || 'abroad')
      : /\bwho\b/i.test(question) ? queryNames(filters) : queryWorkLocation(filters),
    by_program:      () => queryByProgram(filters),
    by_year:         () => queryByYear(filters),
    gender:          () => {
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
      return hasOtherFilter ? queryCount(filters) : queryGender(filters);
    },
    employment:      () => {
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
      if (isCombinedEmployedQuery) return queryRate(filters);
      if (filters.industry || filters.excludeIndustry) return queryIndustry(filters);
      if (filters.employmentStatus || filters.excludeEmploymentStatus) return queryCount(filters);
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

  // Most query functions still return a plain string; a growing set (starting
  // with queryGender) return { text, chart } instead so the AC chatbot can
  // render an inline graph alongside the answer — handle both shapes here
  // rather than converting all ~30 functions at once. queryOverview() is the
  // first to return { text, charts } (plural, multiple distinct visuals for
  // one answer) — `chart` still gets the first one so every existing
  // single-chart consumer keeps working untouched.
  const result = await fn();
  if (!result) return null;
  const { text, chart, charts, eventTitle } = typeof result === 'string' ? { text: result, chart: null, charts: null, eventTitle: null } : result;
  const resolvedCharts = charts?.length ? charts : (chart ? [chart] : null);
  // eventTitle (set by queryEventAttendanceCount/Attendees/Feedback when they
  // resolved one specific event) rides into filters purely so
  // suggestFollowUps() can build contextual event follow-up chips — it's
  // never used as an actual query filter anywhere else.
  return text ? {
    text, direct: true, topic, filters: eventTitle ? { ...filters, eventTitle } : filters,
    chart: resolvedCharts?.[0] || null,
    charts: resolvedCharts,
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
  const { college, contextQuestions } = options;
  const seedFilters = buildSeedFilters(contextQuestions);
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
      text: `Your coordinator account is scoped to college "${college}", but there are no alumni records under that college in the system. Every question will come up empty until this is fixed — please ask an admin to check that your account's college matches how alumni records are actually labeled.`,
      direct: true,
      topic: 'scope_misconfigured',
      filters: {},
    };
  }
  return runWithCollegeScope(emails, college, () => queryInner(question, seedFilters));
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
module.exports = { query, hasData, suggestFollowUps, extractPersonName, extractPersonNames, detectTopic, extractFilters, CLARIFY_COLLEGE_QUESTION, extractEventName, VISUALIZATION_REQUEST_PATTERN };
