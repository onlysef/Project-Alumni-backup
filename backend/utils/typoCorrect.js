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
  // "late" -> "rate" (single-letter substitution). None of these are ever a
  // typo of the domain term they'd get rewritten to.
  'word', 'words', 'rule', 'rules', 'filed', 'late',
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

function correctWord(word) {
  const lower = word.toLowerCase();
  if (STOPWORDS.has(lower)) return word; // common function word — never a typo target
  if (VOCABULARY.includes(lower)) return word; // already correct, leave as-is (preserves original casing)

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

function correctTypos(question) {
  if (!question) return question;
  return question
    .split(/(\s+)/) // keep whitespace segments so spacing/punctuation-adjacent words are preserved
    .map(segment => {
      const match = segment.match(/^([A-Za-z]+)([?!.,;:]*)$/);
      if (!match) return segment;
      const [, word, punctuation] = match;
      return correctWord(word) + punctuation;
    })
    .join('');
}

module.exports = { correctTypos };
