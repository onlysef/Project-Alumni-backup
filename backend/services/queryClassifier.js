const GREETING_PATTERN = /^\s*(hi|hello|hey|yo|good\s?(morning|afternoon|evening)|greetings|sup)[\s!.,]*$/i;

const HELP_PATTERNS = [
  /\bwhat can you (do|help|answer)\b/i,
  /\bhow (do|can) (i|you) use\b/i,
  /\bshow (me )?(available )?(commands|capabilities|features)\b/i,
  /\bwhat (questions|topics) can (i|you)\b/i,
  /^\s*help\s*$/i,
  /\bhow does this (chat|assistant|bot) work\b/i,
];

// High-confidence off-topic patterns — general knowledge / entertainment / small talk
// that has nothing to do with graduate tracer records. Kept narrow and conservative:
// anything ambiguous falls through to statistical/qualitative (the safe default),
// since the RAG/aggregation layers already refuse when no data supports an answer.
const UNKNOWN_PATTERNS = [
  /\b(nba|nfl|nhl|mlb|premier league|world cup|olympics)\b/i,
  /\bweather\b/i,
  /\btell me a joke\b/i,
  /\bwho (won|wins|is the (president|prime minister))\b/i,
  /\bwhat('?s| is) the (capital|meaning of life)\b/i,
  /\bwrite (me )?(a poem|a song|code|a story)\b/i,
  /\brecipe for\b/i,
  /\bstock price\b/i,
  // Math/calculation — neither matched here before, so these fell through
  // to the full statistical/RAG pipeline (wasted LLM call) and came back
  // with the generic "I don't have enough data in the tracer study
  // records" refusal — technically true but confusing, since it implies
  // the AI searched for relevant data rather than recognizing the question
  // as simply off-topic. The `-` operator is deliberately excluded from the
  // arithmetic pattern: "2020-2023" (a year range) would otherwise false-
  // positive as a subtraction expression.
  /\bcalculate\b|\bcalculator\b/i,
  /\d+\s*[\+*x×\/÷]\s*\d+/,
  /\bwhat\s+is\s+\d+.{0,15}(plus|minus|times|multiplied|divided)\b/i,
  // Current events / news — same issue as above, same fix.
  /\b(trending|breaking)\s+news\b|\bnews\b.{0,20}\btoday\b|\bcurrent\s+events\b|\btop\s+headlines\b/i,
  // General science/space trivia ("newly discovered earthlike planet") —
  // same issue as math/news above: fell through to the full RAG pipeline
  // and came back sounding like the AI searched tracer records and came up
  // short, rather than plainly stating this is outside what it answers.
  /\b(newly|recently)\s+discovered\b|\bscientists?\s+(have\s+)?discover/i,
  /\b(earthlike|exoplanet|galaxy|asteroid|comet|black hole|solar system)\b/i,
  // Entertainment (movies, TV, music, celebrities) — not tracked here.
  /\b(movie|film)\b.{0,20}\b(recommendations?|watch|review)\b|\bwho\s+(plays|played)\b.{0,20}\bin\b|\bbest\s+(movies?|tv\s+shows?|series|songs?|albums?)\b|\blatest\s+album\b|\bnew\s+song\b/i,
  /\bceleb(rity|rities)\b|\bhollywood\b|\bfamous\s+actor\b/i,
  // Health/medical advice — outside scope, and not something to answer
  // without a real medical source regardless of scope.
  /\b(symptoms?\s+of|cure\s+for|treatment\s+for|medicine\s+for)\b|\bshould\s+i\s+(take|see\s+a\s+doctor)\b/i,
  // Legal advice.
  /\bis\s+it\s+legal\s+to\b|\bwhat\s+are\s+my\s+(legal\s+)?rights\b|\bcan\s+i\s+sue\b/i,
  // Travel/tourism.
  /\bbest\s+places?\s+to\s+visit\b|\bflight\s+(prices?|tickets?)\b|\btourist\s+(spots?|attractions?)\b|\bvisa\s+requirements?\b/i,
  // General history/geography trivia unrelated to the tracer domain.
  /\bwhen\s+did\b.{0,30}\b(end|start|begin)\b|\bwho\s+invented\b|\bhow\s+tall\s+is\b|\bhow\s+old\s+is\s+the\s+(earth|universe)\b/i,
  // Gadget/product shopping advice — not career/industry related.
  /\bwhich\s+phone\s+should\s+i\s+buy\b|\b(iphone|android)\s+(vs|review)\b|\bwhat\s+laptop\s+should\s+i\s+buy\b/i,
  // Relationship/personal advice.
  /\bhow\s+to\s+(ask\s+someone\s+out|break\s+up|propose)\b|\brelationship\s+advice\b/i,
  // Astrology.
  /\bhoroscope\b|\bzodiac\s+sign\b|\bastrology\b/i,
  // Gaming.
  /\bhow\s+to\s+beat\b.{0,15}\blevel\b|\bbest\s+gaming\s+(setup|pc)\b|\bvideo\s+games?\b/i,
  // Translation requests.
  /\btranslate\b.{0,20}\bto\s+(spanish|french|japanese|korean|chinese|tagalog|nihongo)\b/i,
  // Currency conversion.
  /\bconvert\b.{0,20}\b(dollars?|pesos?|euros?)\s+to\b|\bexchange\s+rate\b/i,
  // Job-interview / résumé coaching — general career advice, not a question
  // about THIS institution's graduate/tracer records. The word "job" alone
  // satisfies aggregationService's generic EMPLOYMENT_SIGNAL fallback, which
  // used to answer these with the full employment Yes/No breakdown — a
  // confident non-answer to what is really advice-seeking, not a stats query.
  /\bhow\s+(should|do|can)\s+i\s+prepare\s+(for|to\s+attend)\s+(a\s+|an\s+)?(job\s+)?interview\b|\binterview\s+(tips?|advice|questions?|preparation)\b|\bhow\s+to\s+(ace|pass)\s+an?\s+interview\b|\bhow\s+to\s+write\s+a\s+(resume|résumé|cv|cover\s+letter)\b/i,
];

const STATISTICAL_PATTERNS = [
  /\bhow many\b/i,
  /\bhow much\b/i,
  /\bcount\b/i,
  /\baverage\b/i,
  /\bpercentage\b/i,
  /\brate\b/i,
  /\btotal\b/i,
  /\bnumber of\b/i,
  /\bmost common\b/i,
  /\bhighest\b/i,
  /\blowest\b/i,
  /\branking\b/i,
  /\bbreakdown\b/i,
  /\bdistribution\b/i,
  /\bstatistic/i,
  /\bhow long\b/i,
  /\bwhat (is|was|are|were) the (employment|unemployment|percentage|rate|number|count|average|total)\b/i,
  // "explain/describe the employment situation" reads as qualitative but is
  // really asking for a count/breakdown — must hit aggregation, not a partial
  // top-K RAG sample presented as if it were the whole dataset.
  /\b(employment|job|work)\s+(situation|status|condition)\b/i,
  /\bwhich (program|course|batch|year)\b/i,
  /\bshow me\b/i,
  /\blist\b/i,
];

const QUALITATIVE_PATTERNS = [
  /\bwhat challenge/i,
  /\bwhy\b/i,
  /\bdescribe\b/i,
  /\bsummariz/i,
  /\bsuggest/i,
  /\bfeedback\b/i,
  /\breason(s)?\b/i,
  /\bexplain\b/i,
  /\bopinion/i,
  /\bcomment/i,
  /\bwhat do.*think/i,
  /\bwhat.*said\b/i,
  /\bwhat.*feel/i,
  /\binsight/i,
  /\bexperience\b/i,
  /\brecommend/i,
];

/**
 * Classify a question as 'greeting', 'help', 'unknown', 'statistical', 'qualitative', or 'mixed'.
 * Defaults to 'statistical' for ambiguous questions so MongoDB is tried first.
 */
function classify(question) {
  const q = (question || '').trim();

  if (GREETING_PATTERN.test(q)) return 'greeting';
  if (HELP_PATTERNS.some(p => p.test(q))) return 'help';
  if (UNKNOWN_PATTERNS.some(p => p.test(q))) return 'unknown';

  const isStat = STATISTICAL_PATTERNS.some(p => p.test(q));
  const isQual = QUALITATIVE_PATTERNS.some(p => p.test(q));
  if (isStat && isQual) return 'mixed';
  if (isQual) return 'qualitative';
  return 'statistical';
}

module.exports = { classify };
