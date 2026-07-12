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
