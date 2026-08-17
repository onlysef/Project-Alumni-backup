// Several search endpoints build a MongoDB $regex directly from a raw query
// param (name/company/etc. search boxes) with no escaping — a user-supplied
// pattern like `(a+)+$` sent as the search term makes MongoDB's regex engine
// hang evaluating it against the collection (catastrophic backtracking),
// degrading the shared DB for every role. Escaping regex metacharacters
// before they reach $regex makes the search term always match literally,
// which is what every one of these "search by name" boxes actually wants.
function escapeRegex(str) {
  return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };
