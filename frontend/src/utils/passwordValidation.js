// Mirrors backend/utils/passwordValidation.js — keep both in sync. Shared
// so every password form (signup, onboarding, change-password) enforces the
// identical rule instead of each duplicating its own length check, the same
// "one more place to update" risk this app's other shared validators
// (skillClassification.js, textQuality.js) already exist to avoid.
export const PASSWORD_REQUIREMENT_MESSAGE =
  'Password must be more than 8 characters and include at least one uppercase letter and one symbol.';

export function isStrongPassword(password) {
  if (typeof password !== 'string' || password.length <= 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}
