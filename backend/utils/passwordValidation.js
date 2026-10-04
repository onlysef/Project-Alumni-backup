// Shared password strength rule — previously duplicated as a bare
// `password.length < 8` check independently in 5 different controller
// functions (registerAlumni, employer signup, resetPassword, changePassword,
// updatePassword), with no shared helper. Centralized here so a future rule
// change only has to land once instead of risking one call site getting
// missed the way independent copies of the same check always eventually do
// in this codebase (the exact "one more place to update" problem several
// other fixes this session ran into).
const MIN_PASSWORD_LENGTH = 9; // "more than 8 characters"
const PASSWORD_REQUIREMENT_MESSAGE =
  `Password must be more than 8 characters and include at least one uppercase letter and one symbol.`;

function isStrongPassword(password) {
  if (typeof password !== 'string' || password.length <= 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}

module.exports = { isStrongPassword, PASSWORD_REQUIREMENT_MESSAGE, MIN_PASSWORD_LENGTH };
