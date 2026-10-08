// Deterministic validation layer for the LLM-extracted query plan (see
// services/queryPlanExtractor.js's own top comment on why this exists at
// all: the extraction LLM only ever produces CANDIDATE values, and every
// one of them is checked here against the real catalog/DB before it is
// trusted — a value that doesn't resolve to something real is never
// silently dropped (which would answer a broader/different question than
// what was actually asked) and never silently accepted as-is (which would
// let the LLM effectively invent a scope).
//
// This file used to hand-write one resolution block per field (~15 near-
// duplicate `if (f.xxx) {...}` blocks). It's now a generic loop over
// utils/fieldRegistry.js's declarative FIELD_REGISTRY — adding a new
// filterable field means adding one registry entry, not a new block here.
// See fieldRegistry.js's own top comment for the full rationale and the
// two fields (course/college, yearsInJob) whose logic is genuinely too
// irregular to generalize and stay as named custom resolvers there.
const {
  FIELD_REGISTRY, FIELD_REGISTRY_BY_KEY, TYPE_RESOLVERS, COMPARISON_PATTERN, BARE_STATUS_BREAKDOWN_PATTERN, CROSSTAB_PATTERN, findAllSkillMatches, findUnmatchedSkillMentions,
  detectUnsupportedConditions,
} = require('./fieldRegistry');
const { COURSE_TO_COLLEGE } = require('./collegesCourses');

/**
 * Validates a raw plan (from queryPlanExtractor.extractQueryPlan) against
 * the real course/college catalog and the live DB-observed cache (job
 * titles, industries, companies, custom questions — the same `cache` object
 * utils/verifiedCount.js already maintains via refreshCache()). Returns the
 * same shape computeVerifiedCount/Percentage/Ranking/Names/Summary expect:
 * { userFilters, tracerFilters, parts, statusMatch, unresolvedField,
 * unresolvedScope, unsupportedConditions, ambiguousField, forbiddenScope }.
 *
 * `scopeCollege` (null for an admin, a college code for a coordinator —
 * see ragService.js's own comment on where this comes from) enforces that
 * a coordinator can only ever query their own college's data. A named
 * course/college that resolves to something REAL but belongs to a
 * DIFFERENT college is refused via `forbiddenScope` — deliberately
 * distinct from `unresolvedScope` (which means "doesn't exist at all");
 * here the value is perfectly real, it's just not allowed for this user,
 * so it must never be silently substituted with the coordinator's own
 * college (that would answer a different question than the one asked) nor
 * silently honored (that would leak another college's data). An UNSCOPED
 * question (no course/college named at all) is silently scoped to the
 * coordinator's own college instead — the expected default, not a refusal.
 *
 * Returns null if `rawPlan` itself is null/malformed (extraction failed) —
 * caller treats this exactly like "no filters matched" today.
 */
function validateQueryPlan(rawPlan, cache, question, scopeCollege) {
  if (!rawPlan) return null;

  const f = { ...(rawPlan.filters || {}) };
  const userFilters = {};
  const tracerFilters = {};
  const parts = [];
  let unresolvedScope = false;
  let unresolvedField = null;
  let ambiguousField = null;
  const extraUnsupported = [];

  // professionalCertifications / pursuedTrainings / professionalDevelopmentActivities
  // are near-synonymous in casual phrasing ("certifications", "further
  // trainings", "professional development") and the extraction LLM was
  // observed live conflating them on PLAIN (non-comparison) questions too —
  // "How many alumni pursued professional certifications?" and "How many
  // alumni pursued further trainings?" both extracted
  // professionalDevelopmentActivities=true instead of their own specific
  // field, silently answering a different, broader question than asked.
  // Unlike the backstop block below (gated to comparison questions only),
  // this runs for EVERY question and explicitly WINS over whatever the LLM
  // set for the generic field whenever the more specific word is actually
  // present — specific beats generic, not first-extracted-wins. Skips
  // pursuedTrainings when a SPECIFIC training name was also extracted
  // (trainingType), since that's a different, more specific question
  // entirely (verbatim training name, not a plain yes/no).
  if (/\bcertifications?\b/i.test(question || '')) {
    f.professionalCertifications = true;
    f.professionalDevelopmentActivities = null;
  }
  if (/\btrainings?\b/i.test(question || '') && !f.trainingType) {
    f.pursuedTrainings = true;
    if (!/\bcertifications?\b/i.test(question || '')) f.professionalDevelopmentActivities = null;
  }

  // Deterministic regex fallback for any field whose registry entry
  // declares `backstop` — only applied when the LLM extraction left that
  // field null/falsy, never overrides a real extraction. Caught live: "How
  // many work locally vs abroad?" and "How many are employed vs
  // unemployed?" both extracted their own named field (workLocation,
  // employmentStatus) as null despite the question naming it explicitly —
  // an "X vs Y" comparison question seems to reliably confuse the LLM into
  // picking neither single value. A field-agnostic application point (here,
  // before any resolver runs) rather than per-resolver-type logic, so a
  // future field can opt in by just adding `backstop` to its registry entry
  // regardless of its `type`.
  //
  // Also the authoritative signal for `comparisonField` below: a field is
  // only tagged as the one being compared when ITS OWN backstop pattern
  // actually matched the question text, not merely because some value ended
  // up resolved for it. Caught live: "How many work locally vs abroad?" had
  // NO employment-status wording at all, yet the LLM's raw extraction still
  // produced a stray employmentStatus:"Employed" value alongside the
  // (also-extracted) workLocation — with comparisonField picked by registry
  // declaration order instead of textual evidence, employmentStatus (which
  // happens to be declared earlier) won and workLocation was silently
  // ignored, comparing the wrong field entirely. Requiring the backstop
  // regex to match ties the field selection to what the question actually
  // SAYS, immune to whatever else the LLM happened to also (mis)extract.
  let comparisonField = null;
  const isComparisonQuestion = Boolean(question) && COMPARISON_PATTERN.test(question);
  // Gated to comparison questions only — the entire reason any of these
  // backstops exist is the LLM's specifically observed "X vs Y" extraction
  // instability (see each backstop's own comment). Applying them
  // unconditionally would risk a plain, non-comparison question that merely
  // mentions a field's vocabulary in passing (e.g. "What CCNA trainings did
  // alumni pursue?" incidentally containing "training") getting an unasked-
  // for extra filter forced on — outside the comparison case, the normal
  // LLM-extraction-plus-validation chain already works and needs no net.
  if (isComparisonQuestion) {
    for (const entry of FIELD_REGISTRY) {
      if (!entry.backstop) continue;
      const backstopMatch = question.match(entry.backstop.pattern);
      if (!backstopMatch) continue;
      if (!f[entry.key]) f[entry.key] = entry.backstop.resolve(backstopMatch);
      const isComparable = entry.values || entry.type === 'boolean-yesno' || entry.key === 'skillRating';
      if (isComparable && !comparisonField) comparisonField = entry.key;
    }
  }

  // "technical skills vs problem solving" names TWO DIFFERENT SKILLS, not
  // one skill's rating levels — a genuinely different shape from "Excellent
  // vs Satisfactory in technical skills" (ONE skill, two levels — the
  // `comparisonField === 'skillRating'` path above already handles that
  // correctly). See findAllSkillMatches's own comment for why conflating
  // the two silently produced an unverified, LLM-fabricated second number.
  // Every distinct skill actually named is kept — "technical skills vs
  // problem solving vs communication" names three, not just the first two
  // (an earlier version of this capped it to `.slice(0, 2)`, which silently
  // dropped the third skill with no indication anything was lost). There
  // are only 8 real skill categories total (SKILL_FIELD_LABELS), so there's
  // no runaway-size risk in keeping all of them.
  //
  // A named skill that ISN'T one of the 8 real tracked categories ("...vs
  // leadership skills") must not just silently vanish from the comparison
  // either — unmatchedSkillNames (see findUnmatchedSkillMentions's own
  // comment) carries those forward so computeSkillCompare can still chart
  // whichever skills DID resolve and say plainly, in the answer itself,
  // that the rest aren't tracked. A comparison with at least ONE real skill
  // plus at least one unmatched name is still routed through the compare
  // path (not requiring 2+ REAL skills) — "technical skills vs leadership
  // skills" should still produce a (single-bar) chart for technical skills
  // with that note, not silently fall through to a generic LLM answer with
  // no verified data at all.
  let skillCompareFields = null;
  let unmatchedSkillNames = [];
  if (isComparisonQuestion) {
    const skills = findAllSkillMatches(question);
    unmatchedSkillNames = findUnmatchedSkillMentions(question);
    if (skills.length >= 2 || (skills.length >= 1 && unmatchedSkillNames.length > 0)) {
      skillCompareFields = skills;
      if (comparisonField === 'skillRating') comparisonField = null;
    }
  }

  // Cross-tab support ("employment status by gender") — unlike
  // comparisonField above, this can't reuse `entry.backstop` (built to
  // recognize a named VALUE — "male", "employed" — not a bare FIELD NAME).
  // "employment status by gender" names neither value; it names the two
  // FIELDS themselves, so detection instead matches each comparable field's
  // own `entry.label` (e.g. "gender", "employment status", "work location")
  // appearing literally in the question text. Mutually exclusive with
  // comparisonField: a "vs" question is a single-field full breakdown, a
  // "by"/"per" question is a two-field cross-tab — never both at once.
  const isCrosstabQuestion = !isComparisonQuestion && Boolean(question) && CROSSTAB_PATTERN.test(question);
  const matchedComparableFields = [];
  if (isCrosstabQuestion) {
    for (const entry of FIELD_REGISTRY) {
      const isComparable = entry.values || entry.type === 'boolean-yesno';
      if (!isComparable || !entry.label) continue;
      const labelPattern = new RegExp(`\\b${entry.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (labelPattern.test(question) && !matchedComparableFields.includes(entry.key)) {
        matchedComparableFields.push(entry.key);
      }
    }
  }
  const crosstabFields = matchedComparableFields.length >= 2 ? matchedComparableFields.slice(0, 2) : null;

  // catalog-match fields form a CHAIN (jobTitle -> industryField ->
  // companyName -> ...): once one of them fails to resolve (unresolvedField)
  // or turns out ambiguous (ambiguousField), the REST of the chain is
  // skipped — reporting more than one such failure at once would be
  // confusing, and the first one found is already a complete, honest
  // answer ("this named value doesn't match anything real"). Fields
  // outside this chain (workLocation, gender, booleans, ...) are NOT
  // gated by this — they still resolve independently regardless of
  // whether a catalog-match field failed.
  let catalogChainStopped = false;

  let courseGroupCollege = null;
  for (const entry of FIELD_REGISTRY) {
    if (entry.chain === 'catalog' && catalogChainStopped) continue;

    const resolver = entry.type === 'custom' ? entry.resolve : TYPE_RESOLVERS[entry.type];
    const patch = resolver ? resolver(entry, f, cache, question) : null;
    if (!patch) continue;

    if (patch.userFiltersPatch) Object.assign(userFilters, patch.userFiltersPatch);
    if (patch.tracerFiltersPatch) Object.assign(tracerFilters, patch.tracerFiltersPatch);
    if (patch.part) parts.push(patch.part);
    if (patch.unresolvedScope) unresolvedScope = patch.unresolvedScope;
    if (patch.extraUnsupported) extraUnsupported.push(patch.extraUnsupported);
    if (patch.courseGroupCollege) courseGroupCollege = patch.courseGroupCollege;
    if (patch.unresolvedField) {
      unresolvedField = patch.unresolvedField;
      if (entry.chain === 'catalog') catalogChainStopped = true;
    }
    if (patch.ambiguousField) {
      ambiguousField = patch.ambiguousField;
      if (entry.chain === 'catalog') catalogChainStopped = true;
    }
  }

  // Coordinator college-scoping — see this function's own doc comment.
  // Skipped entirely for admins (scopeCollege null), zero behavior change.
  // `courseGroupCollege` (set above when userFilters.course resolved to a
  // program-family `$in` array, e.g. bare "BSBA" — see
  // resolveCourseCollege's own comment) is checked FIRST since
  // `COURSE_TO_COLLEGE[userFilters.course]` can't look up an array/object
  // key at all once course stops being a single string.
  let forbiddenScope = null;
  if (scopeCollege) {
    const effectiveCollege = userFilters.college
      || courseGroupCollege
      || (typeof userFilters.course === 'string' && COURSE_TO_COLLEGE[userFilters.course])
      || null;
    if (effectiveCollege && effectiveCollege !== scopeCollege) {
      // A real course/college WAS resolved, it's just not this user's own
      // — refuse, never substitute their own college silently (that
      // answers a different question than the one actually asked).
      const requestedCourseName = typeof userFilters.course === 'string' ? userFilters.course : f.course;
      forbiddenScope = { requested: userFilters.college || requestedCourseName, allowed: scopeCollege };
      delete userFilters.course;
      delete userFilters.college;
    } else if (!effectiveCollege && !unresolvedScope) {
      // No course/college named at all (and nothing else already flagged
      // the scope as unresolved/invalid) — silently default to the
      // coordinator's own college, the expected behavior for an unscoped
      // question, not a refusal.
      userFilters.college = scopeCollege;
    }
  }

  // See BARE_STATUS_BREAKDOWN_PATTERN's own comment in fieldRegistry.js —
  // fires ONLY when nothing else in the question resolved to a real filter
  // (parts still empty, no catalog-chain failure) so it can never override
  // an actual filtered/per-person question, just the truly bare case.
  if (!comparisonField && parts.length === 0 && !unresolvedField && !ambiguousField && BARE_STATUS_BREAKDOWN_PATTERN.test(question || '')) {
    comparisonField = 'employmentStatus';
  }

  // statusMatch is exposed as its own labeled field (not just folded into
  // tracerFilters) because computeVerifiedPercentage specifically checks
  // `if (!statusMatch) return null` — a percentage question with no
  // resolvable employment status has no valid numerator at all.
  const employmentStatusEntry = FIELD_REGISTRY_BY_KEY.employmentStatus;
  const statusMatch = (f.employmentStatus && employmentStatusEntry.values[f.employmentStatus])
    ? { label: f.employmentStatus, dbPattern: employmentStatusEntry.values[f.employmentStatus], dbField: 'employmentStatus' }
    : null;
  // percentageMatch's own `label` is used verbatim in the final description
  // text ("metric: percentage matching <label>") — employment status keeps
  // its original "employment status \"Employed\"" phrasing (unchanged from
  // before this was generalized) rather than the generic fields' own
  // "<field label> \"<value>\"" shape, since that's what existing callers/
  // narration prompts were already tuned against.
  const percentageStatusLabel = statusMatch ? `employment status "${statusMatch.label}"` : null;

  // Generalizes statusMatch above beyond employmentStatus specifically — a
  // percentage question can ask for the share matching ANY comparable
  // field's resolved value ("what percentage of jobs are related to their
  // degree?", "what percentage pursued further education?"), not only
  // employed/unemployed. Used by computeVerifiedPercentage ONLY as a
  // fallback when no employmentStatus was named at all (statusMatch null)
  // — employmentStatus stays the preferred/default numerator when both are
  // somehow present. Reads back out of the ALREADY-resolved `tracerFilters`
  // (not raw `f`) so it only ever matches a field that genuinely resolved
  // to something real — never a stray unresolved/ambiguous raw value.
  let percentageMatch = statusMatch ? { ...statusMatch, label: percentageStatusLabel } : null;
  if (!percentageMatch) {
    for (const entry of FIELD_REGISTRY) {
      if (entry.key === 'employmentStatus') continue;
      const isComparable = entry.values || entry.type === 'boolean-yesno';
      if (!isComparable || !entry.dbField || !(entry.dbField in tracerFilters)) continue;
      const label = entry.type === 'boolean-yesno'
        ? (entry.partLabel || entry.label || entry.key)
        : `${entry.label} "${f[entry.key]}"`;
      percentageMatch = { label, dbField: entry.dbField };
      break;
    }
  }

  // Deterministic backstop merged in alongside the LLM's own self-reported
  // unsupportedConditions — see fieldRegistry.js's UNSUPPORTED_CONDITION_PATTERNS
  // for why this can't rely on the LLM catching it every time (observed
  // live: the same question's "top 10 of their batch" clause was
  // self-reported as unsupported on some runs and silently dropped on
  // others). Deduped by label so a condition the LLM DID catch isn't
  // listed twice just because the backstop also matched it.
  const backstopUnsupported = detectUnsupportedConditions(question || '');
  const llmUnsupported = Array.isArray(rawPlan.unsupportedConditions) ? rawPlan.unsupportedConditions : [];
  const unsupportedConditions = [...new Set([...llmUnsupported, ...extraUnsupported, ...backstopUnsupported])];

  return { userFilters, tracerFilters, parts, statusMatch, percentageMatch, unresolvedField, unresolvedScope, unsupportedConditions, ambiguousField, forbiddenScope, comparisonField, crosstabFields, skillCompareFields, unmatchedSkillNames };
}

module.exports = { validateQueryPlan };
