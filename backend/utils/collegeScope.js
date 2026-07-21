const { AsyncLocalStorage } = require('async_hooks');

// Request-scoped "which college's alumni am I allowed to see" context for
// the AC AI Assistant. A college coordinator must only ever see their own
// college's tracer study data — but Graduate (the tracer-study collection)
// has no `college` field of its own, only a free-text `program`, and the
// ~40 query functions in aggregationService.js each build their own
// MongoDB pipeline independently (most don't share a common builder), so
// threading a college filter through every one of them individually would
// be large and easy to miss a spot on.
//
// AsyncLocalStorage lets the scope be set ONCE per request (in
// aggregationService.query()) and read by a single Mongoose pre-hook (see
// models/Graduate.js) that every one of those functions already passes
// through — no call site needs to change. It's async-safe: concurrent
// requests from different coordinators each get their own isolated store,
// unlike a plain module-level variable.
const storage = new AsyncLocalStorage();

// `emails` is a lowercased array of allowed alumni email addresses, or null
// for no restriction (admin / non-college-scoped requests).
function runWithCollegeScope(emails, fn) {
  return storage.run({ emails }, fn);
}

function getCollegeScopeEmails() {
  return storage.getStore()?.emails || null;
}

module.exports = { runWithCollegeScope, getCollegeScopeEmails };
