// Mirrors backend/utils/textQuality.js — catches obvious junk input
// ("@@@@@@@@@@@", "sadsadsadsadsad", pure keyboard-mashed digits) client-side
// so the user gets immediate feedback instead of waiting on a round trip to
// hit the same check on the server.
const REPEATED_CHAR_RUN = /(.)\1{3,}/;
const LETTER_RUN        = /[a-zA-Z]{2,}/g;
const LONG_DIGIT_RUN    = /\d{6,}/;

const SALARY_PHRASES = ["negotiable", "competitive", "doe", "commensurate", "based on experience", "depends on experience"];

export function isJunkText(value, {
  requireWord = true,
  minLength = 0,
  requireMultiWord = false,
  blockAtSymbol = false,
  blockLongDigitRun = false,
  requireDigitOrPhrase = false,
} = {}) {
  const s = String(value ?? "").trim();
  if (s.length < minLength) return true;
  if (REPEATED_CHAR_RUN.test(s)) return true;
  const letterRuns = s.match(LETTER_RUN) || [];
  if (requireWord && letterRuns.length === 0) return true;
  if (requireMultiWord && letterRuns.length < 2) return true;
  if (blockAtSymbol && s.includes("@")) return true;
  if (blockLongDigitRun && LONG_DIGIT_RUN.test(s)) return true;
  if (requireDigitOrPhrase) {
    const lower = s.toLowerCase();
    if (!/\d/.test(s) && !SALARY_PHRASES.some((p) => lower.includes(p))) return true;
  }
  return false;
}
