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
  'employed', 'unemployed', 'employment', 'employee', 'employer', 'job', 'jobs', 'work', 'working',
  'status', 'situation', 'condition', 'position', 'occupation',
  // Stats vocabulary
  'how', 'what', 'who', 'when', 'where', 'many', 'much', 'count', 'average', 'percentage', 'percent', 'rate', 'total', 'number',
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
  'related', 'relevance', 'relevant', 'align', 'aligned', 'alignment', 'aligns', 'field',
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
  'program', 'programs', 'course', 'courses', 'degree', 'batch', 'year', 'graduation',
  // Demographics
  'gender', 'male', 'female', 'men', 'women',
  // Career events
  'promoted', 'promotion', 'certification', 'certifications', 'training', 'trainings',
  'prominent', 'notable', 'outstanding', 'distinguished', 'renowned',
  // Contact info
  'contact', 'mobile', 'phone', 'email',
  // Job relevance qualifiers
  'directly', 'somewhat', 'pursued',
];

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
  if (VOCABULARY.includes(lower)) return word; // already correct, leave as-is (preserves original casing)

  let best = null;
  let bestDist = Infinity;
  for (const term of VOCABULARY) {
    // Cheap length-based pre-filter before computing full edit distance.
    if (Math.abs(term.length - lower.length) > 2) continue;
    const dist = levenshtein(lower, term);
    if (dist < bestDist) { bestDist = dist; best = term; }
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
