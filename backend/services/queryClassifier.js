// Filipino/Taglish greetings ("kumusta"/"musta"/"kamusta") added alongside
// the English ones — this is a PH university portal where coordinators and
// admins code-switch constantly (see queryClassifier.js audit note: every
// other pattern group below was English-only, and the only bilingual part of
// this whole pipeline used to be OFFENSIVE_PATTERN — i.e. the system
// understood Filipino best when it was being insulted). "po"/"ho" (politeness
// particles) are optional trailing words, not part of the greeting itself.
// Trailing-letter repetition ("hii", "heyy", "helloo", "yooo", "suppp") is
// common casual typing for a greeting, not a typo needing correction — the
// "+" after each word's last letter tolerates it without opening up false
// matches on unrelated words.
//
// Expanded beyond the original English+Tagalog core word list: a few more
// common English greeting words (hola/howdy/hiya/oi/oy/wassup/"what's up"),
// "good day"/"good noon" (both common Philippine-English usage alongside the
// original morning/afternoon/evening), and "magandang umaga/hapon/gabi/araw"
// (the actual Tagalog phrase, as opposed to just "kumusta"/"musta", which
// are closer to "how are you"). The trailing-word group is now a repeatable
// list (not just po/ho) so multiple fillers can chain — "kumusta na po",
// "hi guys po" — and covers common address/particle words on their own.
// "ac"/"ai" added to that trailing list so a greeting directed AT the
// assistant by name ("hello ac!", "hi ai") still matches — those aren't
// address terms like "guys"/"everyone" grammatically, but serve the exact
// same role here (naming who the greeting is for, not changing its meaning).
const GREETING_PATTERN = /^\s*(hi+|hello+|he+y+|yo+|hola|howdy|hiya|oi+|oy+|wassup|what'?s\s*up|good\s?(morning|afternoon|evening|day|noon)|greetings|su+p+|kumusta|kamusta|musta|magandang\s+(umaga|hapon|gabi|araw))(?:\s+(po|ho|na|ka|kayo|there|guys|everyone|all|bro|sis|ac|ai))*[\s!.,]*$/i;

// A bare acknowledgment ("thanks", "okay", "salamat") had no category of its
// own before — it fell to the 'statistical' default, hit RAG with nothing
// relevant to retrieve, and came back as a confusing "I couldn't find
// relevant information" refusal to what was never really a question.
// Anchored whole-message, same as GREETING_PATTERN, so it can't misfire
// mid-sentence ("thanks for the info" stays unmatched — that's a real
// follow-up, not a bare acknowledgment).
//
// One-or-more repeated ACK_WORD tokens (comma/space/"and"/"at" separated) —
// not just a single one — so a chained "okay, thanks!" (two acknowledgment
// words back to back, a very natural way to close out a conversation)
// still matches. Originally only matched ONE token exactly, so "okay,
// thanks!" fell all the way through to the generic 'unknown' refusal
// ("I'm designed to answer questions related to the Graduate Tracer Study
// records...") — a strange reply to what was just a friendly sign-off.
const ACK_WORD = '(?:thanks|thank\\s*you|ty|ok|okay|got\\s*it|cool|alright|perfect|nice(?:\\s+one)?|salamat|sige|ayos|okay\\s+lang|po|ho)';
const ACKNOWLEDGMENT_PATTERN = new RegExp(`^\\s*${ACK_WORD}(?:\\s*(?:[,]|and|at)?\\s*${ACK_WORD})*[\\s!.,]*$`, 'i');

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

// Known keyboard-row mash substrings — "qwertyuiop", "asdfghjkl", "zxcvbnm"
// and reversed/shifted runs of them. These have vowels (so the vowel-less
// check below misses them) and reasonably high letter diversity (so the
// distinct-letter check below can miss them too), but they essentially never
// occur inside a real English/Tagalog word, so a bare substring match is
// safe here.
const KEYBOARD_MASH_PATTERN = /qwert|ertyui|asdfg|sdfghj|zxcvb|xcvbnm|poiuy|lkjhg|mnbvc/i;

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
//   "asdkjfhg" or "qwrtyzxc";
// - the keyboard-row check catches mashes that DO have vowels ("qwertyuiop");
// - the distinct-letter-ratio check catches other same-finger/random mashes
//   that have vowels, reasonable letter variety, and aren't a known
//   keyboard row ("asdsadasdas" ~27% distinct, "hahahaha" ~25% distinct) —
//   real words at 7+ letters consistently land well above 50% (e.g.
//   "employment" 80%, "respondents" 73%, "pinakamataas" 61%, "nagtatrabaho"
//   67%), so requiring under half the letters to be distinct is a
//   conservative bar that leaves ordinary (if repetitive-looking) domain
//   words untouched;
// - the consonant-cluster check catches mashes with vowels AND reasonable
//   letter variety that still aren't a real word ("aewifjweivfcdsgfedg" has
//   a 7-consonant run "vfcdsgf") — no English or Tagalog word in this
//   domain's actual vocabulary runs 5+ consonants in a row (the worst case
//   checked, "assessment"/"respondents", tops out at 3), so 5+ is a
//   conservative, generalizable signal rather than one more hand-picked
//   string pattern.
function isUnrecognizedInput(q) {
  if (!q) return false;
  if (!/[a-zA-Z0-9]/.test(q)) return true;
  const tokens = q.trim().split(/\s+/);
  if (tokens.length === 1 && /^[a-zA-Z]{7,}$/.test(tokens[0])) {
    const t = tokens[0];
    if (!/[aeiouAEIOU]/.test(t)) return true;
    if (KEYBOARD_MASH_PATTERN.test(t)) return true;
    if (new Set(t.toLowerCase()).size / t.length < 0.5) return true;
    const consonantRuns = t.match(/[^aeiouAEIOU]+/g) || [];
    if (Math.max(0, ...consonantRuns.map((r) => r.length)) >= 5) return true;
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
  // "what should I do here?" / "what do I do here" — a first-time user's
  // most natural way to ask "how do I use this thing," but matched none of
  // the alternatives above (none cover bare "what should/do I do"). Fell
  // through to the generic UNKNOWN_RESPONSE refusal ("I'm designed to
  // answer questions related to the Graduate Tracer Study records... unable
  // to respond to unrelated inquiries") instead of HELP_RESPONSE's actually
  // useful capability list with example questions.
  /\bwhat (?:should|do) i do(?:\s+here)?\b/i,
  // "Can I ask (you) something/a question?" — a permission-seeking preamble,
  // not a real question yet, so there's nothing for the statistical/RAG
  // pipeline to search for. Previously fell all the way through to the
  // generic UNKNOWN_RESPONSE refusal ("I'm designed to answer questions
  // related to the Graduate Tracer Study records...") even though the exact
  // same INTENT already had a Tagalog equivalent two lines below ("ano ang
  // pwede kong itanong") that correctly routed to 'help' — an English/
  // Tagalog asymmetry in the same file. End-anchored (allowing trailing
  // punctuation) so a real question that happens to start the same way
  // ("can I ask something about the employment rate") still falls through
  // to the actual statistical pipeline instead of being swallowed here.
  /\bcan\s+i\s+ask\s+(?:you\s+)?(?:something|a\s+question|anything)\s*[?.!]*\s*$/i,
  // Filipino/Taglish — "ano ang kaya mong gawin" ("what can you do"), "paano
  // (kita\/ko) gamitin ito" ("how do I use this"), "ano (pwede\|puwede) kong
  // itanong" ("what can I ask"), "pwede ba akong magtanong" ("may I ask").
  /\bano (ang )?kaya mo(ng)?\s*(gawin|sagutin|tulungan)\b/i,
  /\bpaano (ko|kita|namin)?\s*(gamitin|magamit)\b/i,
  /\bano (ang )?(pwede|puwede) ko(ng)? (itanong|tanungin)\b/i,
  /\b(pwede|puwede)\s+(po\s+)?(ba\s+)?(ako|akong)?\s*magtanong\b/i,
];

// "Who/what are you" style questions directed at AC itself — a near-universal
// first thing real users ask any chatbot, in either language. Previously
// unhandled: it isn't OFFENSIVE_PATTERN, GREETING_PATTERN, or HELP_PATTERNS,
// so it fell all the way through to 'statistical', aggregationService found
// no matching topic (there is none — it's not a data question), and it
// landed on the generic UNKNOWN_RESPONSE refusal in both English and
// Tagalog alike ("I'm designed to answer questions related to the Graduate
// Tracer Study records...") — which reads as AC failing to understand
// Tagalog specifically, even though English "who are you" hit the exact
// same refusal. Checked before HELP_PATTERNS/UNKNOWN_PATTERNS so it gets its
// own friendly self-introduction instead.
const IDENTITY_PATTERNS = [
  /\bwho\s+are\s+(?:you|u)\b/i,
  /\bwhat\s+are\s+(?:you|u)\b/i,
  /\bwhat('?s|\s+is)\s+your\s+name\b/i,
  /\btell\s+me\s+(about\s+)?yourself\b/i,
  /\bintroduce\s+yourself\b/i,
  /\bsino\s+ka(\s+ba)?\b/i,
  /\bano\s+ka(\s+ba)?\b/i,
  /\bano(?:\s+ang)?\s+pangalan\s+mo\b/i,
  /\banong\s+pangalan\s+mo\b/i,
];

// "Who am I?" / "sino ako?" — a question about the USER (their own logged-in
// account), NOT about the assistant — a completely different intent from
// IDENTITY_PATTERNS above ("who are you?"). Checked separately, ahead of
// IDENTITY_PATTERNS, so it can never be swallowed by the "who/what are you"
// self-introduction path. Caught live: "sino ako?" was answered as if it had
// asked "sino ka?" ("who are you?") — see ragService.js's condenseQuestion()
// translation-prompt fix for the other half of that bug (the LLM translation
// step was flipping "ako"/I into "you" before this classifier ever saw it).
const WHO_AM_I_PATTERNS = [
  /\bwho\s+am\s+i\b/i,
  /\bam\s+i\s+logged\s+in\s+as\b/i,
  /\bsino\s+ako(\s+ba)?\b/i,
  /\bano\s+ako(\s+ba)?\b/i,
];

// A bare trigger word/phrase with nothing after it to say what it should act
// ON or refer TO — every one of these MUST be followed by a real subject in
// a genuine question ("how many alumni are employed", "why did they
// resign", "compare BSIT and BSCS") — occurring alone, anchored whole-
// message like GREETING_PATTERN above, is an unfinished thought rather than
// a legitimate (if terse) one. Without this, these fell through to
// 'statistical' (the classify() default) or 'qualitative', found no topic
// or retrievable context, and landed on the generic "I can't answer
// unrelated questions" refusal — reading as if the message were off-topic,
// when the real issue is that it never said what it was asking about.
// Checked before UNKNOWN_PATTERNS below (no overlap in trigger words either
// way, but keeps both "short-circuit before the generic dispatch" groups
// together) and returns its own 'incomplete' classification so ragService.js
// can ask a targeted clarifying question instead of guessing.
const INCOMPLETE_THOUGHT_PATTERNS = [
  // Statistical-shaped action verbs with no object.
  /^\s*(show\s+me|give\s+me|list|tell\s+me|ipakita(?:\s+mo)?|ilista(?:\s+mo)?|ibigay\s+mo)\s*(?:po|ho)?\s*[?.!]*\s*$/i,
  // Statistical-shaped bare nouns/quantifiers with nothing to count or measure.
  /^\s*(how\s+many|how\s+much|total|average|count|number\s+of|percentage|ranking|breakdown|distribution|compare|graphs?|charts?|visuali[sz]e|visuali[sz]ations?|plot|ilan|porsyento|porsiyento)\s*(?:po|ho)?\s*[?.!]*\s*$/i,
  // Qualitative-shaped bare trigger words with no named subject.
  /^\s*(why|explain|describe|summarize|suggest|recommend|feedback|bakit|ipaliwanag|mungkahi)\s*(?:po|ho)?\s*[?.!]*\s*$/i,
  // One step less bare than "show me"/"give me" alone above — "give me the
  // numbers"/"show me stats"/"tell me something" still say nothing about
  // WHAT numbers/stats/something is wanted, just with a generic filler word
  // standing in for a real subject instead of no object at all. Without
  // this, these fell through to the generic FALLBACK_RESPONSE refusal in
  // ragService.js ("I could not find relevant information...") instead of
  // this classification's own, more useful "what would you like to know?
  // For example: employment rate, industries..." clarifying question.
  /^\s*(?:show|give|tell)\s+me\s+(?:the\s+|some\s+)?(?:numbers?|stats?|statistics?|data|info(?:rmation)?|something|stuff|more)\s*(?:po|ho)?\s*[?.!]*\s*$/i,
];
function isIncompleteThought(q) {
  return INCOMPLETE_THOUGHT_PATTERNS.some((p) => p.test(q));
}

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
  // Arithmetic pattern moved out of this array — see ARITHMETIC_PATTERN and
  // classify()'s own use of it below (needs to run against a date-stripped
  // copy of the question, not `q` directly).
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
  // "who is the most famous X" (rapper, singer, athlete, scientist,
  // anything) — general pop-culture/trivia phrasing, not covered by the
  // specific actor/celebrity/hollywood triggers above. This phrasing never
  // legitimately appears in a tracer-study question, so it's a safe, broad
  // signal on its own. Without this, "who is the most famous rapper"
  // classified 'statistical' (the default), reached aggregationService with
  // nothing to match, and for a college-scoped coordinator came back as the
  // confusing "no tracer study data matching that" refusal instead of
  // plainly stating this is outside what AC answers.
  /\bmost\s+famous\b|\bworld'?s\s+famous\b/i,
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
  // General "what is a/an X" (a giraffe, an atom) — a strong signal on its
  // own: a legitimate tracer-study question always asks about a definite,
  // specific thing ("what is THE employment rate", "what is X's job"),
  // never an indefinite "a/an" one. Domain nouns are excluded from the
  // trigger (a coordinator might legitimately ask "what is a graduate's
  // employment status") so this only catches genuine general-knowledge
  // definition requests.
  /\bwhat\s+(?:is|are)\s+an?\s+(?!alumni\b|alumnus\b|alumna\b|graduates?\b|respondents?\b|tracer\b)[a-z]+/i,
  // Bare mass-noun science/general-knowledge definitions ("what is matter",
  // "what is energy") — these have no article, so the pattern above can't
  // catch them; kept as a short curated list (matching this file's existing
  // convention for every other off-topic category) rather than an
  // open-ended "what is X" match, which would also swallow legitimate
  // questions like "what is employment" or "what is the tracer study".
  /\bwhat\s+is\s+(matter|energy|gravity|electricity|magnetism|photosynthesis|evolution|democracy|capitalism|socialism|inflation|climate\s+change|global\s+warming)\b/i,
  // Current time/date — a live-clock question, nothing this data-source can
  // ever answer regardless of how it's phrased.
  /\bwhat\s+time\s+is\s+it\b|\bwhat('?s|\s+is)\s+(today'?s\s+date|the\s+date\s+today)\b|\bwhat\s+day\s+is\s+it\b/i,
  // Unit conversion (distance/weight/temperature) — currency conversion is
  // already covered above; this is the same "convert X to Y" shape for
  // other unit families.
  /\bconvert\b.{0,20}\b(km|kilometers?|miles?|kg|kilograms?|pounds?|lbs|celsius|fahrenheit|feet|inches?|meters?)\b|\bhow\s+many\s+(km|kilometers?|miles?|kg|pounds?|feet|inches?|meters?)\s+(?:is|are|in)\b/i,
  // Cooking/recipe instructions beyond the "recipe for X" phrasing already
  // caught above — "how to cook/bake/boil X", "how long to bake X".
  /\bhow\s+(?:to|do\s+(?:i|you)|long\s+to)\s+(cook|bake|boil|fry|grill|roast)\b/i,
  // Tech support for the user's own personal devices — not this system.
  /\bhow\s+(?:to|do\s+i)\s+fix\s+my\s+(wifi|internet|computer|laptop|phone|printer)\b|\bwhy\s+is\s+my\s+(wifi|internet|computer|laptop|phone)\s+(slow|not\s+working|broken)\b/i,
  // General business/investing/entrepreneurship advice — career advice in
  // general terms, not a question about THIS institution's alumni records
  // (same reasoning as the interview-coaching exclusion above).
  /\bhow\s+to\s+start\s+a\s+business\b|\bhow\s+to\s+invest\s+in\b|\bstock\s+market\s+tips\b|\bbest\s+stocks?\s+to\s+buy\b|\bhow\s+to\s+become\s+rich\b/i,
  // Diet/fitness/weight-loss advice.
  /\bhow\s+to\s+lose\s+weight\b|\bworkout\s+(plan|routine)\b|\bdiet\s+plan\b|\bhow\s+to\s+build\s+muscle\b/i,
  // Advanced/general math (algebra, calculus) beyond the simple arithmetic
  // already caught above.
  /\bsolve\s+for\s+[a-z]\b|\bquadratic\s+formula\b|\bderivative\s+of\b|\bintegral\s+of\b/i,
  // Meta questions about the AI itself (what model it is, whether it's
  // sentient/ChatGPT/etc.) — not a tracer-study question, and answering it
  // accurately would mean explaining internal implementation details this
  // assistant shouldn't reveal anyway (see SYSTEM_PROMPT's own rule against
  // that in ragService.js).
  // "u" alongside "you" throughout — texting shorthand real users actually
  // type ("do u love me"), not just the formal spelling.
  /\bare\s+(?:you|u)\s+(chatgpt|gpt|an?\s+ai|sentient|conscious|real|human)\b|\bwhat\s+(ai\s+)?model\s+are\s+(?:you|u)\b|\bwho\s+(made|created|built)\s+(?:you|u)\b/i,
  // Personal/emotional questions directed at the AI itself ("do you love
  // me", "will you marry me") — same reasoning as the AI-identity meta
  // questions above: not a tracer-study question, and this assistant has no
  // feelings to report on regardless of scope.
  /\bdo\s+(?:you|u)\s+(love|like|hate|miss)\s+me\b|\bwill\s+you\s+marry\s+me\b|\bare\s+(?:you|u)\s+(?:my\s+)?(friend|boyfriend|girlfriend)\b|\bcan\s+(?:you|u)\s+be\s+my\s+(friend|girlfriend|boyfriend)\b/i,
  // Religion/spirituality.
  /\bis\s+god\s+real\b|\bwhat\s+religion\b|\bbible\s+verse\b|\bquran\b|\bhoroscope\s+reading\b|\bmeaning\s+of\s+life\b/i,
  // General programming/coding HELP (explaining a concept), distinct from
  // "write me code" (already caught above by the poem/song/code/story
  // pattern) — "how does recursion work", "explain a for loop".
  /\bhow\s+does\s+recursion\s+work\b|\bexplain\s+(a\s+)?for\s+loop\b|\bwhat\s+is\s+(a\s+)?(variable|function|array|api|database)\s+in\s+programming\b|\bdebug\s+my\s+code\b/i,
  // Pet care.
  /\bhow\s+to\s+(take\s+care\s+of|train)\s+(a\s+|my\s+)?(dog|cat|puppy|kitten|pet)\b|\bwhat\s+to\s+feed\s+(my\s+)?(dog|cat|pet)\b/i,
  // Parenting advice.
  /\bhow\s+to\s+discipline\s+(a\s+|my\s+)?child\b|\bbest\s+baby\s+names?\b|\bparenting\s+(tips?|advice)\b/i,
  // Real estate / housing / insurance / vehicle advice — general consumer
  // life-advice categories, same reasoning as the gadget-shopping and
  // business-advice exclusions above.
  /\bshould\s+i\s+(?:rent|buy)\b.{0,20}\bhouse\b|\bhow\s+to\s+buy\s+a\s+house\b|\bmortgage\s+rates?\b|\bwhich\s+insurance\s+should\s+i\s+get\b|\bwhich\s+car\s+should\s+i\s+buy\b|\bbest\s+car\s+to\s+buy\b/i,
  // Riddles/puzzles/random trivia — a request for entertainment content,
  // same category as the existing "tell me a joke" trigger.
  /\bgive\s+me\s+a\s+riddle\b|\bcrossword\s+clue\b|\btell\s+me\s+a\s+fun\s+fact\b|\brandom\s+trivia\b/i,
  // Restaurant/shopping recommendations unrelated to the tracer domain.
  /\bbest\s+restaurants?\s+(near|in)\b|\bwhere\s+(can|should)\s+i\s+(eat|shop)\b/i,
  // General essay/letter writing beyond résumé/cover-letter (already
  // caught above) — "write me an essay", "write a letter to my landlord".
  /\bwrite\s+(me\s+)?an?\s+(essay|speech|letter)\s+(about|to|on)\b/i,
  // General life-skill "how to" requests unrelated to career/tracer topics.
  /\bhow\s+to\s+(tie\s+a\s+tie|swim|drive|ride\s+a\s+bike|change\s+a\s+tire)\b/i,
  // Household/cleaning tips.
  /\bhow\s+to\s+(remove|clean)\s+a?\s*(stain|carpet|mold)\b|\bcleaning\s+tips?\b/i,
  // Fashion/style advice.
  /\bwhat\s+should\s+i\s+wear\b|\boutfit\s+ideas?\b|\bfashion\s+(tips?|advice)\b/i,
  // General "why/how" science trivia (distinct from the domain's own
  // employment "why" questions, which never ask about the natural world).
  /\bwhy\s+is\s+the\s+sky\s+blue\b|\bhow\s+do\s+plants\s+grow\b|\bwhy\s+do\s+we\s+dream\b|\bhow\s+does\s+the\s+brain\s+work\b/i,
  // Dictionary/vocabulary lookups for ordinary words, not tracer-study terms.
  /\bwhat\s+does\s+the\s+word\s+\w+\s+mean\b|\bdefine\s+the\s+word\s+\w+\b/i,
  // "Top 10" / "best of" list requests outside the career/industry domain.
  /\btop\s+10\s+(movies?|songs?|games?|books?|places?)\b|\bbest\s+programming\s+languages?\b/i,
  // Motivation/self-improvement content requests.
  /\bmotivational\s+quotes?\b|\bhow\s+to\s+be\s+(more\s+)?productive\b|\bhow\s+to\s+stop\s+procrastinating\b/i,
  // Sports predictions/betting — distinct from the existing NBA/NFL league
  // trigger (that one catches league NAMES; this catches the prediction/
  // betting INTENT regardless of which sport).
  /\bwho\s+will\s+win\s+the\s+game\b|\bbetting\s+odds?\b|\bsports?\s+predictions?\b/i,
  // Games/random-generator requests directed at the AI for fun, not data.
  /\bflip\s+a\s+coin\b|\broll\s+a\s+dice\b|\bpick\s+a\s+random\s+number\b|\bplay\s+a\s+game\s+with\s+me\b|\b20\s+questions\b/i,
  // General "explain X" for a buzzword/topic unrelated to this domain —
  // kept as a short curated list, same convention as the science-trivia
  // mass-noun list above, rather than an open-ended "explain X" match
  // (which would also swallow a legitimate "explain the employment rate").
  /\bexplain\s+(quantum\s+physics|blockchain|cryptocurrency|bitcoin|artificial\s+intelligence|machine\s+learning)\b/i,
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

// Arithmetic off-topic detector ("what is 2+2", "calculate 10/2") — kept
// OUTSIDE UNKNOWN_PATTERNS and tested separately (see classify() below)
// against a DATE-STRIPPED copy of the question, not the raw string. A
// combined single regex with lookaround guards was tried first to exclude
// calendar dates ("9/11/2026") from the "/" division branch, but failed
// empirically: the generic \d+/\d+ match backtracks its greedy \d+ to dodge
// a failing lookahead, which still carves "9/1" + "1/2026" out of
// "9/11/2026" as two separate bogus matches even with lookbehind/lookahead
// exclusions in place. Stripping the whole date substring first sidesteps
// that backtracking pitfall entirely instead of trying to out-clever it
// with more lookaround. Caught live: an event-disambiguation reply copying
// a date straight back from a list this app itself rendered ("Alumni
// Reunion (9/11/2026)") misclassified as off-topic arithmetic ("9 divided
// by 11"), triggering the generic "I can't answer unrelated questions"
// refusal for what was actually a perfectly answerable follow-up. The `-`
// operator is still deliberately excluded here too, same reasoning as
// UNKNOWN_PATTERNS' own comment: "2020-2023" (a year range) would otherwise
// false-positive as subtraction.
const ARITHMETIC_PATTERN = /\d+\s*[\+*x×÷\/]\s*\d+/;
const INLINE_DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

/**
 * Classify a question as 'offensive', 'unclear', 'greeting', 'acknowledgment', 'who_am_i', 'identity', 'help', 'incomplete', 'unknown', 'statistical', 'qualitative', or 'mixed'.
 * Defaults to 'statistical' for ambiguous questions so MongoDB is tried first.
 */
function classify(question) {
  const q = (question || '').trim();

  if (OFFENSIVE_PATTERN.test(q)) return 'offensive';
  if (isUnrecognizedInput(q)) return 'unclear';
  if (GREETING_PATTERN.test(q)) return 'greeting';
  if (ACKNOWLEDGMENT_PATTERN.test(q)) return 'acknowledgment';
  if (WHO_AM_I_PATTERNS.some(p => p.test(q))) return 'who_am_i';
  if (IDENTITY_PATTERNS.some(p => p.test(q))) return 'identity';
  if (HELP_PATTERNS.some(p => p.test(q))) return 'help';
  if (isIncompleteThought(q)) return 'incomplete';
  if (UNKNOWN_PATTERNS.some(p => p.test(q))) return 'unknown';
  if (ARITHMETIC_PATTERN.test(q.replace(INLINE_DATE_PATTERN, ''))) return 'unknown';

  const isStat = STATISTICAL_PATTERNS.some(p => p.test(q));
  const isQual = QUALITATIVE_PATTERNS.some(p => p.test(q));
  if (isStat && isQual) return 'mixed';
  if (isQual) return 'qualitative';
  return 'statistical';
}

module.exports = { classify };
