// Filipino/Taglish greetings ("kumusta"/"musta"/"kamusta") added alongside
// the English ones — this is a PH university portal where coordinators and
// admins code-switch constantly (see queryClassifier.js audit note: every
// other pattern group below was English-only, and the only bilingual part of
// this whole pipeline used to be OFFENSIVE_PATTERN — i.e. the system
// understood Filipino best when it was being insulted). "po"/"ho" (politeness
// particles) are optional trailing words, not part of the greeting itself.
const GREETING_PATTERN = /^\s*(hi|hello|hey|yo|good\s?(morning|afternoon|evening)|greetings|sup|kumusta|kamusta|musta)(\s+po|\s+ho)?[\s!.,]*$/i;

// A bare acknowledgment ("thanks", "okay", "salamat") had no category of its
// own before — it fell to the 'statistical' default, hit RAG with nothing
// relevant to retrieve, and came back as a confusing "I couldn't find
// relevant information" refusal to what was never really a question.
// Anchored whole-message, same as GREETING_PATTERN, so it can't misfire
// mid-sentence ("thanks for the info" stays unmatched — that's a real
// follow-up, not a bare acknowledgment).
const ACKNOWLEDGMENT_PATTERN = /^\s*(thanks|thank\s*you|ty|ok|okay|got\s*it|cool|alright|perfect|nice(\s+one)?|salamat|sige|ayos|okay\s+lang)(\s+po|\s+ho)?[\s!.,]*$/i;

// Profanity/abuse aimed at the assistant — checked before every other
// classification so a message like "fuck u" doesn't fall through to the
// generic statistical/RAG pipeline and come back with a confusing "I don't
// have enough data" refusal that reads as if the bot searched for an answer
// and came up short, instead of acknowledging the actual problem (the
// message itself). Covers common English profanity/insults and Tagalog/
// Filipino (incl. common Bisaya) profanity/insults, since this is a PH
// university portal — deliberately broad (mild insults like "tanga"/"bobo"/
// "stupid" included, not just strong profanity) per explicit request to
// cover "lahat ng possible offensive words", INCLUDING common typo/leetspeak
// variants (dropped vowels, letter-for-number substitution, doubled/missing
// letters) — real users type these fast and angry, rarely with correct
// spelling, so an exact-word list alone misses most real occurrences.
const OFFENSIVE_PATTERN = new RegExp('\\b(' + [
  // English profanity (+ common misspellings/leetspeak)
  'fuck(?:ing|er|ed|s)?', 'fuk+(?:in|ing|er|ed)?', 'fck', 'fcuk', 'fuq', 'phuck',
  'shit(?:ty|s)?', 'sh[i1]t', 'sht', 'shyt', 'bullsh[i1]t',
  'bitch(?:es|y)?', 'b[i1]tch', 'btch',
  'assh[o0]les?', 'ash+[o0]le', 'jack\\s*ass', 'bastards?', 'basterd',
  'dick(?:head)?s?', 'd[i1]ck', 'pussy', 'pusy', 'cunts?', 'wh[o0]res?', 'sluts?',
  'motherf\\w*', 'nigg(?:a|er)s?', 'fagg?ots?', 'retards?(?:ed)?',
  'douche(?:bag)?s?', 'pricks?', 'twats?', 'wankers?', 'crap',
  'id[i1]ots?', 'stup[i1]d', 'morons?', 'dumb\\s*ass(?:es)?', 'imbec[i1]le',
  'asshat', 'scumbag',
  // Filipino / Tagalog / Bisaya profanity & insults (+ common typo/shortcut spellings)
  // "putangina"/"tangina" are almost always typed either as one run-on word,
  // as two words ("putang ina"), or fused with a following pronoun
  // ("tanginamo") — this single pattern covers all three shapes at once;
  // the entries after it catch dropped-vowel contractions ("tangna",
  // "tnginamo") that don't fit the "tang" + "ina" skeleton at all.
  '(?:p+u+)?tang\\s*[i1]na(?:mo|mu)?',
  'putangna', 'ptangina', 'tangna', 'tng[i1]na(?:mo|mu)?',
  'pak+y*u+', 'pucha(?:ng)?', 'puta',
  'gag[o0uh]', 'g4go', 'gaga',
  'ul[o0]l', 'ulul', 'ul[o0]+l',
  'tarantad[oa]', 'trantado', 'tarantad',
  'punyeta', 'punyet', 'leche', 'letse', 'lecheng',
  'kupal', 'kupl', 'inutil',
  'bobo', 'bobu', 'b[o0]b[o0]', 'boba',
  'tanga(?:ng)?', 'tng[a4]', 'tanha',
  'bugok', 'buguk', 'bug[o0]k',
  'engot', 'gunggong', 'abnoy', 'lintik', 'lintek',
  'peste', 'hayop\\s*ka', 'yawa', 'ulupong', 'walang\\s*hiya',
].join('|') + ')\\b', 'i');

// Minimal input-sanity check (P2 audit item) — catches input that was never
// really a question at all: pure emoji/symbol strings, or a single
// keyboard-mash token. Without this, these fall through to the
// statistical/RAG default and come back as a generic "I don't have enough
// data in the tracer study records" refusal, which reads as if the
// assistant searched and came up short rather than recognizing there was
// nothing to search for. Deliberately narrow to avoid misfiring on real
// (if terse) domain input:
// - the no-letters-or-digits check only fires on pure emoji/punctuation/
//   whitespace, so any real word or acronym is untouched;
// - the vowel-less-token check requires 7+ letters with zero vowels, well
//   above every real acronym in this domain (BSCS/BSIT/WMA/TSM/PRC are all
//   4 characters or fewer), so it only catches genuine random mashes like
//   "asdkjfhg" or "qwrtyzxc".
function isUnrecognizedInput(q) {
  if (!q) return false;
  if (!/[a-zA-Z0-9]/.test(q)) return true;
  const tokens = q.trim().split(/\s+/);
  if (tokens.length === 1 && /^[a-zA-Z]{7,}$/.test(tokens[0]) && !/[aeiouAEIOU]/.test(tokens[0])) {
    return true;
  }
  return false;
}

const HELP_PATTERNS = [
  /\bwhat can you (do|help|answer)\b/i,
  /\bhow (do|can) (i|you) use\b/i,
  /\bshow (me )?(available )?(commands|capabilities|features)\b/i,
  /\bwhat (questions|topics) can (i|you)\b/i,
  /^\s*help\s*$/i,
  /\bhow does this (chat|assistant|bot) work\b/i,
  // Filipino/Taglish — "ano ang kaya mong gawin" ("what can you do"), "paano
  // (kita\/ko) gamitin ito" ("how do I use this"), "ano (pwede\|puwede) kong
  // itanong" ("what can I ask").
  /\bano (ang )?kaya mo(ng)?\s*(gawin|sagutin|tulungan)\b/i,
  /\bpaano (ko|kita|namin)?\s*(gamitin|magamit)\b/i,
  /\bano (ang )?(pwede|puwede) ko(ng)? (itanong|tanungin)\b/i,
];

// High-confidence off-topic patterns — general knowledge / entertainment / small talk
// that has nothing to do with graduate tracer records. Kept narrow and conservative:
// anything ambiguous falls through to statistical/qualitative (the safe default),
// since the RAG/aggregation layers already refuse when no data supports an answer.
const UNKNOWN_PATTERNS = [
  /\b(nba|nfl|nhl|mlb|premier league|world cup|olympics)\b/i,
  /\bweather\b|\bpanahon\b/i,
  /\btell me a joke\b|\bmagbigay\s+ka\s+ng\s+biro\b|\bmagpatawa\s+ka\b/i,
  /\bwho (won|wins|is the (president|prime minister))\b|\bsino\s+(ang\s+)?(nanalo|panalo|pangulo|presidente)\b/i,
  /\bwhat('?s| is) the (capital|meaning of life)\b|\bano\s+(ang\s+)?kabisera\b/i,
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
  /\bcalculate\b|\bcalculator\b|\bkalkulahin\b/i,
  /\d+\s*[\+*x×\/÷]\s*\d+/,
  /\bwhat\s+is\s+\d+.{0,15}(plus|minus|times|multiplied|divided)\b/i,
  // Current events / news — same issue as above, same fix.
  /\b(trending|breaking)\s+news\b|\bnews\b.{0,20}\btoday\b|\bcurrent\s+events\b|\btop\s+headlines\b|\bbalita\s+(ngayon|ngayong\s+araw)\b/i,
  // General science/space trivia ("newly discovered earthlike planet") —
  // same issue as math/news above: fell through to the full RAG pipeline
  // and came back sounding like the AI searched tracer records and came up
  // short, rather than plainly stating this is outside what it answers.
  /\b(newly|recently)\s+discovered\b|\bscientists?\s+(have\s+)?discover/i,
  /\b(earthlike|exoplanet|galaxy|asteroid|comet|black hole|solar system)\b/i,
  // Entertainment (movies, TV, music, celebrities) — not tracked here.
  /\b(movie|film)\b.{0,20}\b(recommendations?|watch|review)\b|\bwho\s+(plays|played)\b.{0,20}\bin\b|\bbest\s+(movies?|tv\s+shows?|series|songs?|albums?)\b|\blatest\s+album\b|\bnew\s+song\b/i,
  /\bceleb(rity|rities)\b|\bhollywood\b|\bfamous\s+actor\b|\bartista\b/i,
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
  /\bhoroscope\b|\bzodiac\s+sign\b|\bastrology\b|\bhoroskopo\b|\bkapalaran\b/i,
  // Gaming.
  /\bhow\s+to\s+beat\b.{0,15}\blevel\b|\bbest\s+gaming\s+(setup|pc)\b|\bvideo\s+games?\b/i,
  // Translation requests.
  /\btranslate\b.{0,20}\bto\s+(spanish|french|japanese|korean|chinese|tagalog|nihongo)\b|\bisalin\b.{0,20}\bsa\s+(ingles|english|espanyol|hapon|koreano)\b/i,
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
  // Filipino/Taglish statistical triggers — "ilan" (how many), "ilista"/
  // "ipakita" (list/show), "porsyento"/"porsiyento" (percentage), "pinaka-
  // mataas"/"pinakamababa" (highest/lowest), "bilang" (count/number). Without
  // these, a fully-Filipino statistical question has no trigger word at all
  // and falls to classify()'s 'statistical' default only by accident — this
  // makes the match explicit instead of relying on that fallback.
  /\bilan\b/i,
  /\bilista\b|\bipakita\b/i,
  /\bpors[iy]ento\b/i,
  /\bpinaka[- ]?mataas\b|\bpinaka[- ]?mababa\b/i,
  /\bbilang\s+ng\b/i,
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
  // Filipino/Taglish qualitative triggers — "bakit" (why), "dahilan" (reason),
  // "ipaliwanag"/"paliwanag" (explain), "palagay"/"opinyon" (opinion),
  // "karanasan" (experience), "mungkahi" (suggestion), "puna" (comment/critique).
  /\bbakit\b/i,
  /\bdahilan\b/i,
  /\bipaliwanag\b|\bpaliwanag\b/i,
  /\bpalagay\b|\bopinyon\b/i,
  /\bkaranasan\b/i,
  /\bmungkahi\b/i,
  /\bpuna\b/i,
];

/**
 * Classify a question as 'offensive', 'unclear', 'greeting', 'acknowledgment', 'help', 'unknown', 'statistical', 'qualitative', or 'mixed'.
 * Defaults to 'statistical' for ambiguous questions so MongoDB is tried first.
 */
function classify(question) {
  const q = (question || '').trim();

  if (OFFENSIVE_PATTERN.test(q)) return 'offensive';
  if (isUnrecognizedInput(q)) return 'unclear';
  if (GREETING_PATTERN.test(q)) return 'greeting';
  if (ACKNOWLEDGMENT_PATTERN.test(q)) return 'acknowledgment';
  if (HELP_PATTERNS.some(p => p.test(q))) return 'help';
  if (UNKNOWN_PATTERNS.some(p => p.test(q))) return 'unknown';

  const isStat = STATISTICAL_PATTERNS.some(p => p.test(q));
  const isQual = QUALITATIVE_PATTERNS.some(p => p.test(q));
  if (isStat && isQual) return 'mixed';
  if (isQual) return 'qualitative';
  return 'statistical';
}

module.exports = { classify };
