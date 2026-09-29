// Rejects obvious junk/spam input ("@@@@@@@@@@@", "sadsadsadsadsad", pure
// keyboard-mashed digits) without needing a dictionary or NLP model — used to
// gate free-text fields (job postings, etc.) where a plain non-empty check
// lets keyboard-mashing straight into the database.
const REPEATED_CHAR_RUN = /(.)\1{3,}/;    // e.g. "aaaa", "@@@@"
const LETTER_RUN        = /[a-zA-Z]{2,}/g; // a real alphabetic run
const LONG_DIGIT_RUN    = /\d{6,}/;        // e.g. a fake location's "2323123123"

const SALARY_PHRASES = ['negotiable', 'competitive', 'doe', 'commensurate', 'based on experience', 'depends on experience'];

/**
 * @param requireWord     at least one 2+ letter run must exist — false for
 *                         fields that are legitimately pure numbers/symbols
 *                         on their own (salaryRange: "20000-30000").
 * @param minLength        floor on the trimmed length.
 * @param requireMultiWord at least 2 SEPARATE letter runs must exist —
 *                         "rwedfwfewfwef" is one unbroken run of letters (no
 *                         real sentence is a single 13-letter token), while a
 *                         genuine description/responsibility/requirement is
 *                         always more than one word. Not applied to
 *                         title/location, which can legitimately be one word
 *                         ("Manila", "Cashier").
 * @param blockAtSymbol    "@" never appears in a real title or location.
 * @param blockLongDigitRun a location glued to a 6+ digit run (a Philippine
 *                         ZIP is 4 digits) is not a real address.
 * @param requireDigitOrPhrase for salaryRange: real salary text always has
 *                         either a number or is one of a handful of known
 *                         phrases ("Negotiable") — pure letters with neither
 *                         ("asdsadasdsad") is gibberish, not a hidden range.
 */
function isJunkText(value, {
  requireWord = true,
  minLength = 0,
  requireMultiWord = false,
  blockAtSymbol = false,
  blockLongDigitRun = false,
  requireDigitOrPhrase = false,
} = {}) {
  const s = String(value ?? '').trim();
  if (s.length < minLength) return true;
  if (REPEATED_CHAR_RUN.test(s)) return true;
  const letterRuns = s.match(LETTER_RUN) || [];
  if (requireWord && letterRuns.length === 0) return true;
  if (requireMultiWord && letterRuns.length < 2) return true;
  if (blockAtSymbol && s.includes('@')) return true;
  if (blockLongDigitRun && LONG_DIGIT_RUN.test(s)) return true;
  if (requireDigitOrPhrase) {
    const lower = s.toLowerCase();
    if (!/\d/.test(s) && !SALARY_PHRASES.some((p) => lower.includes(p))) return true;
  }
  return false;
}

module.exports = { isJunkText };
