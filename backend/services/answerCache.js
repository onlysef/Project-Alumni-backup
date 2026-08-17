// In-memory cache for AC assistant answers — same pattern already used
// elsewhere in this app for per-user caching (alumniController.js's
// recommendedJobsCache), just applied to chat answers.
//
// Invalidation is two-layered, on purpose (a plain TTL alone risks serving a
// stale answer after data changes; a version stamp alone risks never
// expiring an entry if a mutation point is ever missed):
//   1. `dataVersion` — bumped immediately whenever Graduate/EmbeddingDocument
//      data changes through a path this module knows about (file ingested,
//      file deleted, re-embed completed, a live tracer/employment
//      submission). A cached entry from an older version is never served.
//   2. `CACHE_TTL_MS` — a backstop for any data-changing path this module
//      doesn't know about, so a missed invalidation call self-heals within
//      10 minutes instead of staying wrong indefinitely.
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map(); // key -> { result, dataVersion, expiresAt }
let dataVersion = 0;

function bumpDataVersion() {
  dataVersion += 1;
}

function normalizeKey(question, college) {
  return `${college || ''}::${question.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function get(question, college) {
  const key = normalizeKey(question, college);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.dataVersion !== dataVersion || entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function set(question, college, result) {
  const key = normalizeKey(question, college);
  cache.set(key, { result, dataVersion, expiresAt: Date.now() + CACHE_TTL_MS });
}

module.exports = { get, set, bumpDataVersion };
