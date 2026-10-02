// Lightweight typo correction for the AI assistant's domain vocabulary.
// Runs once, upstream of classify()/detectTopic()/extractFilters(), so a
// single misspelling of a key trigger word ("gradutes") doesn't silently
// break every regex-based matcher downstream that expects the exact spelling.
//
// Deliberately narrow: only corrects words close to a KNOWN domain term, and
// only when short/common words aren't at risk of false-positive correction
// (a person's name accidentally "fixed" into a vocabulary word). This is not
// general-purpose spellcheck — it exists to stop a typo in a keyword from
// silently routing a question to the wrong place or into an unnecessary
// refusal, which is what actually happened.
// Audited against every trigger word in queryClassifier.js's GREETING/HELP/
// STATISTICAL/QUALITATIVE patterns and aggregationService.js's TOPIC_PATTERNS
// + extractFilters() — not just the words a first pass happened to test.
const VOCABULARY = [
  // People / records
  'graduate', 'graduates', 'alumni', 'alumnus', 'respondent', 'respondents', 'people', 'records', 'name', 'names',
  // Employment
  'employed', 'unemployed', 'employment', 'unemployment', 'employee', 'employer', 'job', 'jobs', 'work', 'working',
  'status', 'situation', 'condition', 'position', 'occupation',
  // Stats vocabulary
  'how', 'what', 'who', 'when', 'where', 'there', 'many', 'much', 'count', 'average', 'percentage', 'percent', 'rate', 'total', 'number',
  'common', 'highest', 'lowest', 'ranking', 'breakdown', 'distribution', 'statistics', 'statistic',
  'show', 'list', 'which', 'found', 'got',
  // Qualitative / conversational
  'challenge', 'challenges', 'why', 'describe', 'summarize', 'suggest', 'suggestions', 'feedback',
  'reason', 'reasons', 'explain', 'opinion', 'comment', 'insight', 'insights', 'experience', 'recommend',
  'think', 'said', 'feel', 'discuss',
  // Help / greeting
  'help', 'commands', 'capabilities', 'features', 'questions', 'topics', 'hello', 'hi', 'hey', 'greetings',
  // Overview / survey
  'tracer', 'survey', 'activity', 'overview', 'summary', 'overall', 'general', 'data', 'info', 'result', 'results',
  // Industry / sector
  'industry', 'industries', 'government', 'private', 'sector', 'type',
  // Relevance / alignment
  'related', 'unrelated', 'relevance', 'relevant', 'irrelevant', 'align', 'aligned', 'alignment', 'aligns', 'field',
  // Further studies
  'further', 'studies', 'study', 'education', 'masters', 'doctorate', 'postgrad',
  // Licensure
  'license', 'licensure', 'licensed', 'exam', 'examination', 'professional', 'board', 'passed', 'failed', 'took',
  // "passer"/"passers" (a NOUN, "board passer" = someone who passed the
  // board exam) is a different, legitimate word from "passed" (the verb),
  // not a typo of it — but with no protected entry of its own, it sat
  // exactly 1 substitution away from "passed" and got silently rewritten.
  // Caught live: "Ilang porsyento ng alumni ang board passer?" became
  // "...ang board passed?", which no longer matched aggregationService.js's
  // own `board\s+passers?` trigger (that gate was specifically added for
  // the noun phrasing) — tookExam never got set, and the question fell
  // through to a keyword-overlap clarify instead of the real pass rate.
  'passer', 'passers',
  // Competencies
  'competency', 'competencies', 'skill', 'skills', 'technical', 'communication', 'teamwork', 'adaptability',
  'performance', 'critical', 'thinking', 'project', 'management', 'balance',
  // Location
  'location', 'local', 'locally', 'abroad', 'overseas',
  // Program / academic
  'program', 'programs', 'course', 'courses', 'degree', 'batch', 'year', 'years', 'graduation',
  // Demographics
  'gender', 'male', 'female', 'men', 'women',
  // Career events
  'promoted', 'promotion', 'certification', 'certifications', 'training', 'trainings',
  'prominent', 'notable', 'outstanding', 'distinguished', 'renowned',
  // Contact info
  'contact', 'mobile', 'phone', 'email',
  // Job relevance qualifiers
  'directly', 'somewhat', 'pursued',
  // Portal-wide domains (announcements, jobs, staff, appointments, events,
  // partnerships, office) — added alongside those features; without these,
  // any typo in a trigger word for these domains ("evemt") silently fails
  // to route at all and falls through to an unrelated Graduate/tracer-study
  // default answer instead.
  'announcement', 'announcements', 'news', 'posted',
  'opening', 'openings', 'listing', 'listings', 'vacancy', 'vacancies', 'posting', 'postings',
  'staff', 'available', 'role', 'roles',
  'appointment', 'appointments', 'booking', 'bookings', 'schedule', 'scheduled', 'pending', 'approved', 'cancelled',
  'event', 'events', 'attend', 'attended', 'attendance', 'upcoming', 'venue',
  'partnership', 'partnerships', 'partner', 'partners', 'company', 'companies',
  'office', 'hours', 'open', 'close', 'closed',
  'profile', 'account', 'updated', 'edited', 'changed',
  // Filipino/Taglish routing words — mirrors the Filipino trigger patterns
  // added to queryClassifier.js's GREETING/HELP/STATISTICAL/QUALITATIVE
  // pattern groups. These are added here NOT for translation (this module
  // never translates Filipino to English) but for the same reason every
  // other entry above exists: so a typo'd Filipino trigger word ("bakiit",
  // "ilaan") still reaches its correctly-spelled form instead of either (a)
  // going unrecognized, or (b) — the real risk without this entry — getting
  // Levenshtein-matched to an unrelated ENGLISH vocabulary word that happens
  // to sit within edit distance (corrupting the question's actual meaning,
  // the exact bug class STOPWORDS above already guards English words
  // against). Listing the correctly-spelled forms here also means
  // correctWord()'s `VOCABULARY.includes(lower)` early-return protects them
  // from ever being "corrected" away from Filipino into English at all.
  'kumusta', 'kamusta', 'musta',
  'kaya', 'gawin', 'sagutin', 'tulungan', 'paano', 'gamitin', 'magamit', 'pwede', 'puwede', 'itanong', 'tanungin',
  'ilan', 'ilang', 'ilista', 'ipakita', 'porsyento', 'porsiyento', 'pinakamataas', 'pinakamababa', 'bilang',
  // "ibang" ("other"/"foreign," as in "ibang bansa" = "another/foreign
  // country," the standard Tagalog phrase for "abroad") is a DIFFERENT word
  // from "ilang" ("how many"/"some") just above, not a typo of it — but
  // with no protected entry of its own, it sat exactly 1 substitution away
  // ('b' vs 'l') and silently got "corrected" INTO "ilang" once that word
  // was added to this vocabulary. Caught live: "Ilan ang mga alumning hindi
  // nagtrabaho sa ibang bansa?" ("how many alumni do NOT work abroad?")
  // became "...sa ilang bansa?" ("...in SOME countries?"), destroying the
  // one phrase aggregationService.js's hasAbroadSignal check depends on —
  // workLocation never got set to 'abroad' at all, and the question fell
  // through to the generic bare employed-alumni count.
  'ibang',
  // "aling"/"alin" ("which") had no protected entry at all, so it fuzzy-
  // matched to the unrelated ENGLISH vocabulary word "align" (job-relevance
  // vocabulary, added for "aligns with their course" phrasing) — within
  // edit distance via a simple letter transposition ("-ing" vs "-ign").
  // Caught live: "Aling programa ang may pinakamataas na employment rate?"
  // ("WHICH program has the highest employment rate?") got silently rewritten
  // to "Align programa ang...", which no longer matched any "which
  // program"-shaped trigger downstream — the by-program ranking question
  // collapsed into the generic bare overall rate, with the LLM then
  // fabricating a specific, entirely nonexistent program name ("the College
  // of Engineering") to paper over the lost "which program" framing.
  'aling', 'alin', 'anong', 'alamin',
  'bakit', 'dahilan', 'ipaliwanag', 'paliwanag', 'palagay', 'opinyon', 'karanasan', 'mungkahi', 'puna',
  // Alumni-tracer domain vocabulary from the project's own Tagalog reference
  // table (nagtapos, kumpanya, sahod, etc.) — mirrors ragService.js's
  // DOMAIN_KEYWORDS additions for the same reason as every entry above.
  'nagtapos', 'gradweyt', 'trabaho', 'nagtatrabaho', 'tatrabaho', 'kasalukuyang', 'kasalukuyan',
  'kurso', 'programa', 'baytse', 'industriya', 'kumpanya', 'kompanya', 'posisyon',
  'sahod', 'kita', 'lokasyon', 'lugar', 'sumagot', 'nasa', 'sila', 'nila', 'kanila', 'siya', 'niya',
  // Systematic audit (2026-10-02): ran every common Tagalog pronoun, particle,
  // connector, and domain word a real user plausibly types through
  // correctTypos() looking for the exact "aling"/"ibang"/"passer" collision
  // shape (a legitimate, correctly-spelled word silently rewritten into an
  // unrelated VOCABULARY term) BEFORE it causes a live wrong answer, instead
  // of waiting for the next one to surface one at a time. Found 14 more:
  // 'kada' ("per"/"each," as in "kada taon" = "per year" — TOPIC_PATTERNS.
  // by_year's own trigger phrase) -> 'kaya' ("so"/"can"); 'lang' ("only/
  // just," one of the single most common Tagalog particles) -> 'ilang'
  // ("how many/some"); 'iyan' ("that") -> 'ilan' ("how many"); 'muna'
  // ("first/for now") -> 'puna' (VOCABULARY's "feedback/comment" term,
  // risking a misroute into the event-feedback topic); 'galing' ("from"/
  // "skilled," as in "saan ka galing") -> 'aling' ("which"); 'kanya' ("his/
  // her/its") -> 'kaya'; 'niyan' ("that's/its," genitive of iyan) -> 'niya'
  // ("his/her"); 'nagtrabaho' (past tense "worked") -> 'nagtatrabaho'
  // (present/ongoing "is working" — a real tense change, not a spelling
  // fix); 'kayo'/'akin'/'amin'/'atin'/'inyo' (you-plural/mine/ours/yours —
  // common possessive/personal pronouns) -> 'kaya'/'alin'/'alin'/'alin'/
  // 'info' respectively. None of these are typos of the word they were
  // being rewritten into; each is its own distinct, correctly-spelled word.
  'kada', 'lang', 'iyan', 'muna', 'galing', 'kanya', 'niyan', 'nagtrabaho',
  'kayo', 'akin', 'amin', 'atin', 'inyo',
  // Re-running the same audit AFTER the batch above exposed exactly the
  // "whack-a-mole" risk documented at the top of this list: adding 'kayo'/
  // 'amin'/'atin'/'inyo'/'iyan'/'niyan' just now created SEVEN BRAND NEW
  // collisions against words that were previously safe (nothing near them
  // existed in VOCABULARY before): 'tayo' ("we," inclusive) -> 'kayo';
  // 'namin' ("our," exclusive) -> 'amin'; 'natin' ("our," inclusive) ->
  // 'atin'; 'ninyo' ("your," plural) -> 'inyo'; 'iyon' ("that," far
  // demonstrative) -> 'iyan'; 'diyan' ("there," near) -> 'iyan'; 'niyon'
  // (genitive of iyon) -> 'niyan'. Added in the SAME pass rather than
  // waiting for each to surface as its own live bug later — re-audited
  // again after this addition too, confirming no further NEW collisions.
  'tayo', 'namin', 'natin', 'ninyo', 'iyon', 'diyan', 'niyon',
  // One more new collision from the 'namin' addition just above: 'naman'
  // (a near-universal Tagalog particle, roughly "also"/"though"/softening
  // emphasis — e.g. "ano naman ang trabaho niya") -> 'namin' ("our").
  'naman',
  // Second, broader audit wave: 'mali' ("wrong/incorrect") -> 'male' (the
  // ENGLISH gender term — a particularly dangerous collision, since it could
  // silently inject a gender filter into an unrelated question); 'siyam'
  // ("nine") -> 'siya' ("he/she"); 'tanong'/'tinanong' (the NOUN "question"
  // and its past-tense verb form "asked") -> 'itanong' (the base verb "to
  // ask," already in this list) — related but grammatically distinct words.
  'mali', 'siyam', 'tanong', 'tinanong',
];

// Common English function words (pronouns, articles, prepositions, auxiliary
// verbs) — never spelling-corrected, no matter how close they land to a
// VOCABULARY term by edit distance. These are among the most frequent words
// in any English sentence, so when one appears it is essentially always
// intentional, correctly-spelled, and NOT a typo of a domain term — but
// several sit exactly 1 edit away from an unrelated vocabulary word ("there"
// -> "where", "they" -> "hey", "these" -> "there"), and correcting them
// silently rewrites the question's actual meaning before the user ever sees
// it (e.g. "are there?" became "are where?", turning a count question into
// a location question). Checked BEFORE the Levenshtein search entirely, so
// no vocabulary addition can ever re-create this bug for these words.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'me', 'my', 'we', 'us', 'our', 'ours', 'you', 'your', 'yours', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their', 'there', 'here', 'near', 'then', 'than',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'make', 'made', 'into',
  'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
  'and', 'or', 'but', 'if', 'so', 'not', 'no', 'yes', 'nor', 'such', 'whom',
  'thank', 'thanks', 'yeah', 'yep', 'nope', 'okay', 'ok',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'about',
  'more', 'most', 'some', 'any', 'each', 'every', 'both', 'few', 'other', 'another', 'same', 'own', 'all',
  'watch', 'watched', 'watching', 'iphone', 'android', 'game', 'games',
  // "named" -> "name" (1-edit deletion, within maxDistanceFor(5)=1) broke
  // "is there an alumni NAMED vincent" into "...alumni NAME vincent" —
  // harmless-looking, but it was the reason that question's real intent
  // (search for a specific person) was never recognized at all.
  'named', 'call', 'called', 'calling',
  // Number words — always ordinary, correctly-spelled English, and easy
  // targets for this exact bug class (see "three" -> "there": an adjacent-
  // letter swap the Damerau-Levenshtein distance treats as a single edit).
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'first', 'second', 'third', 'last',
  // "mean"/"means"/"meant" ("I mean...", "that means...") sit exactly one
  // deletion away from the VOCABULARY demographic term "men" ("mean" minus
  // the 'a'), which is well within maxDistanceFor(4)=1 — so "I mean how many
  // are unemployed" silently became "I men how many are unemployed",
  // matching the gender filter's `\bmen\b` trigger and answering with the
  // MALE-only unemployed count for a question that never mentioned gender
  // at all. Filler/conversational verbs like this are never a typo of a
  // short demographic noun, same reasoning as the other entries here.
  'mean', 'means', 'meant',
  // Ordinary English words that sit exactly 1 edit away from an unrelated
  // VOCABULARY term: "word" -> "work", "rule" -> "role", "filed" -> "field",
  // "late" -> "rate", "wear" -> "year" (single-letter substitution). None of
  // these are ever a typo of the domain term they'd get rewritten to — "wear"
  // specifically broke "what should i wear" (a plain out-of-scope fashion
  // question) into "...i year", which then classified as a totally different
  // (and legitimate-looking) statistical question about graduation year.
  'word', 'words', 'rule', 'rules', 'filed', 'late', 'wear', 'wears', 'wearing', 'wore',
]);

// Damerau-Levenshtein (optimal string alignment): like Levenshtein but also
// treats two adjacent swapped letters ("hgihest" -> "highest") as a single
// edit instead of two — the single most common typo pattern, and one plain
// Levenshtein under-penalizes badly enough that short words never got fixed.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1); // adjacent transposition
      }
    }
  }
  return dp[m][n];
}

// Max edit distance allowed to still count as "the same word, typo'd" —
// scaled by length so short words need a near-exact match (avoids false
// positives) while longer words tolerate one or two slipped characters.
function maxDistanceFor(len) {
  if (len <= 3) return 0;
  if (len <= 7) return 1;
  return 2;
}

// A tiny curated set of short (<=3-letter) typos that are common and
// unambiguous enough to correct even though maxDistanceFor() below
// deliberately requires an EXACT match for words this short — a plain
// Levenshtein pass at this length risks corrupting some OTHER short,
// legitimately-spelled word into an unrelated vocabulary term, so the
// general path stays conservative. Checked as an explicit alias instead,
// bypassing that length restriction only for these specific, low-collision
// cases. "nsa" ("nasa" minus one letter — Tagalog "in/at") caught live via
// "ilan nsa sutherland???" failing to resolve the company. Add more here
// only when a similarly clear, low-risk case comes up, not preemptively.
const SHORT_WORD_ALIASES = { nsa: 'nasa' };

function correctWord(word) {
  const lower = word.toLowerCase();
  if (STOPWORDS.has(lower)) return word; // common function word — never a typo target
  if (VOCABULARY.includes(lower)) return word; // already correct, leave as-is (preserves original casing)
  if (SHORT_WORD_ALIASES[lower]) return SHORT_WORD_ALIASES[lower];

  let best = null;
  let bestDist = Infinity;
  for (const term of VOCABULARY) {
    // Cheap length-based pre-filter before computing full edit distance.
    if (Math.abs(term.length - lower.length) > 2) continue;
    const dist = levenshtein(lower, term);
    if (dist < bestDist) { bestDist = dist; best = term; }
  }

  // Never accept a correction that adds/removes a leading negation prefix
  // ("unemployment" -> "employment", "unrelated" -> "related") — a missing
  // vocabulary entry should be fixed by adding the word above, not silently
  // patched over here, because this exact edit shape inverts the question's
  // meaning rather than fixing a spelling slip. This is a general guard
  // (not just for the specific words above) so the same bug can't quietly
  // reappear for any other un-/non-/in-/dis- prefixed domain term that
  // hasn't been added to VOCABULARY yet.
  if (best) {
    const stripsPrefix = (p) => lower.startsWith(p) && lower.slice(p.length) === best;
    const addsPrefix    = (p) => best.startsWith(p) && best.slice(p.length) === lower;
    if (['un', 'non', 'in', 'dis'].some(p => stripsPrefix(p) || addsPrefix(p))) return word;
  }

  if (best && bestDist > 0 && bestDist <= maxDistanceFor(lower.length)) {
    return best;
  }
  return word;
}

// Many downstream Tagalog regexes (aggregationService.js's job-title/"bilang
// X" patterns, person-lookup patterns, etc.) match "nagtatrabaho"/"nagwowork"
// as one literal token. Casual typing very commonly splits the "nag" prefix
// from the reduplicated verb root with a space or hyphen ("nag tatrabaho",
// "nag-tatrabaho") — caught live when "ilan ang nag tatrabaho bilang FULL
// TIME LECTURER" returned 0 despite the data existing, because extractFilters
// found no jobTitle at all (the "bilang X" pattern requires "nagtatrabaho" as
// one word). Fixing this once here, upstream of every pattern that assumes
// the compound is unsplit, is the same "deterministic layer, not per-regex
// patches" fix as SAAN_NAGTATRABAHO_PATTERN's loose `.{0,20}trabaho` already
// applies for the person-lookup case — this generalizes it for every other
// pattern instead of loosening each one individually.
function collapseSplitCompounds(text) {
  return text.replace(/\bnag[\s-]+(wowork|ta+trabaho)\b/gi, 'nag$1');
}

// Stray symbols that are never a real part of any alumni-tracer question —
// a fat-fingered trailing "\" (a stray unshifted key next to Enter on many
// keyboard layouts) or similar are dropped outright rather than left to
// silently break every downstream regex that expects the sentence to end in
// ordinary punctuation. Caught live: "sino ang nagtatrabaho sa Accenture\"
// extracted NO company at all (COMPANY_LOOKUP_PATTERN's required trailing
// `[?!.]|\s*$` never matched with a stray "\" sitting between the company
// name and the end of the string), while the identical question one
// character shorter worked correctly. Deliberately a narrow, explicit list
// (not a blanket "strip anything non-alphanumeric") — email addresses ("@"),
// URLs ("/"), and ordinary punctuation must all survive untouched.
const STRAY_SYMBOL_PATTERN = /[\\~^`|]+/g;

function stripStraySymbols(text) {
  return text.replace(STRAY_SYMBOL_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}

// Collapses a run of 3+ identical consecutive lowercase LETTERS down to one —
// "silaaa"/"sinooo" (emphatic elongation, extremely common in informal
// Filipino/English chat typing: "ilan nsa sutherland???", "sino silaaa!!!")
// isn't a typo Levenshtein distance can fix (the edit distance to the real
// word only grows with every repeated letter), so it has to be normalized
// BEFORE word-level correctWord() ever runs, not left to it. Threshold of
// 3+ (not 2+) leaves ordinary double letters ("committee", "kailangan")
// completely untouched — no real English or Filipino word repeats the same
// letter 3+ times in a row.
//
// Lowercase only ([a-z], not [a-zA-Z]) — a run of repeated UPPERCASE letters
// is never emphatic chat typing (nobody elongates a word by holding shift);
// it's almost always a fumbled all-caps acronym, where collapsing to a
// single letter can accidentally manufacture an unrelated real trigger word.
// Caught live: "How many CCCCS alumni are employed?" (a fumbled "CCS", the
// college code, typed with extra C's) collapsed to "CS" — which just
// happens to ALSO be the real abbreviation for the Computer Science program
// (see SPEC_ABBR in aggregationService.js) — and silently answered with the
// Computer Science employment count instead of recognizing "CCCCS" doesn't
// match any real college code at all.
function collapseRepeatedLetters(text) {
  return text.replace(/([a-z])\1{2,}/g, '$1');
}

// Collapses repeated punctuation ("???", "!!!") down to a single mark —
// same emphatic-typing noise as collapseRepeatedLetters above, just for
// punctuation instead of letters. Doesn't change meaning, and downstream
// patterns that expect exactly one sentence-ending punctuation mark
// (COMPANY_LOOKUP_PATTERN's trailing `[?!.]`, etc.) see clean input either way.
function collapseRepeatedPunctuation(text) {
  return text.replace(/([?!.,])\1+/g, '$1');
}

function correctTypos(question) {
  if (!question) return question;
  question = stripStraySymbols(question);
  question = collapseRepeatedLetters(question);
  question = collapseRepeatedPunctuation(question);
  const corrected = question
    .split(/(\s+)/) // keep whitespace segments so spacing/punctuation-adjacent words are preserved
    .map(segment => {
      const match = segment.match(/^([A-Za-z]+)([?!.,;:]*)$/);
      if (!match) return segment;
      const [, word, punctuation] = match;
      return correctWord(word) + punctuation;
    })
    .join('');
  return collapseSplitCompounds(corrected);
}

module.exports = { correctTypos };
