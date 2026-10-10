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
  detectUnsupportedConditions, findCatalogComparisonValues, SPECIALIZATION_VALUES, findCustomQuestionComparisonValues, findYearComparisonValues, findSingleYearMention,
  CORRELATION_PATTERN, SKILL_NAME_BACKSTOP_PATTERN, resolveSkillNameFromText,
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

  // graduationYear backstop — caught live: "Why are 2024 graduates
  // unemployed?" non-deterministically extracted graduationYear as null on
  // some runs despite the year being named explicitly, silently answering
  // the UNSCOPED system-wide total instead of just batch 2024's. Only
  // fills in when the LLM left it null AND exactly one plausible year is
  // mentioned (findSingleYearMention's own comment) — never overrides a
  // real extraction, and stays out of the way of a genuine 2+-year
  // comparison question (findYearComparisonValues, checked separately
  // below).
  if (!f.graduationYear) {
    const singleYear = findSingleYearMention(question);
    if (singleYear) f.graduationYear = singleYear;
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
  let catalogComparisonValues = null;
  const isComparisonQuestion = Boolean(question) && COMPARISON_PATTERN.test(question);

  // Year-over-year comparison ("How many employed alumni, 2024 vs 2025?") —
  // checked FIRST, ahead of the generic enum/boolean backstop loop below.
  // Caught live: that question contains the word "employed", which matches
  // employmentStatus's own backstop pattern (`/\b(...|employed|...)\b/i`)
  // ANYWHERE in the text, not just when employment status is actually the
  // thing being compared — the backstop loop used to run first and always
  // won, answering with an unscoped-by-year Employed vs Unemployed
  // breakdown for only ONE of the two named years, with zero connection to
  // "2025" at all. Two explicit 4-digit years named is a far more specific,
  // unambiguous signal of what's actually being compared than a loose
  // single-word match, so it must be tried first and claim comparisonField
  // before the generic loop gets a chance to grab it for the wrong field.
  // See findYearComparisonValues's own comment in fieldRegistry.js.
  if (isComparisonQuestion) {
    const matchedYears = findYearComparisonValues(question);
    if (matchedYears) {
      comparisonField = 'graduationYear';
      catalogComparisonValues = matchedYears;
    }
  }

  // specialization (TSM/WMA/NA) — same precedence reasoning as the
  // year-comparison check just above, moved here for the identical reason:
  // caught live, "Compare TSM and WMA graduates' employment rate" names two
  // real specializations explicitly, but "employment rate" ALSO matches
  // employmentStatus's own backstop pattern — when this check ran AFTER the
  // generic enum/boolean backstop loop below, employmentStatus always won
  // the race and WMA was silently dropped entirely (TSM became a plain
  // scope filter on an Employed-vs-Unemployed breakdown, with zero
  // connection to WMA at all — the exact same failure shape the
  // year-comparison fix above was built for). Two real specialization
  // codes named explicitly is a far more specific, unambiguous signal than
  // a loose single-word backstop match, so — same as years — it must be
  // tried first. See computeComparison's own bespoke specialization branch
  // in verifiedCount.js for why this field can't just reuse the generic
  // catalog-match path (it lives on User.track, not a tracer field, and
  // isn't a live DB catalog list like jobTitle/industryField are).
  if (isComparisonQuestion && !comparisonField) {
    const matchedSpecs = SPECIALIZATION_VALUES.filter((v) => new RegExp(`\\b${v}\\b`, 'i').test(question));
    if (matchedSpecs.length >= 2) {
      comparisonField = 'specialization';
      catalogComparisonValues = matchedSpecs;
      // Seeds f.specialization (if the LLM didn't already set one — same
      // instability every other "vs" backstop exists for) so the normal
      // per-field resolver loop further down still runs
      // resolveSpecializationFilter, which sets userFilters.course = 'BSIT'
      // as a side effect — without this, the coordinator college-scope
      // check would never see BSIT/CCS as the effective college for a
      // specialization comparison whose own filters.specialization came
      // back null, letting a coordinator from a DIFFERENT college query
      // CCS-only track data.
      if (!f.specialization) f.specialization = matchedSpecs[0];
    }
  }

  // Cross-field boolean comparison ("certifications vs further trainings")
  // — unlike every comparison above (which compares two VALUES of the SAME
  // field), this names two DIFFERENT boolean fields at once. Caught live:
  // "How many alumni pursued professional certifications vs further
  // trainings?" crashed (computeComparison assumed a single field's own
  // Yes/No split, and professionalCertifications/pursuedTrainings don't
  // even define a `label` the crash path needed) — and once that crash was
  // fixed, the generic single-field backstop loop below still picked only
  // ONE of the two fields and silently used the OTHER as an unrelated
  // scope filter ("certifications among those who also did trainings"),
  // answering a completely different question than "how many did each".
  // crossBooleanFields carries BOTH field keys through so
  // computeCrossBooleanComparison (verifiedCount.js) can report each
  // field's own Yes-count side by side instead.
  let crossBooleanFields = null;
  if (isComparisonQuestion && /\bcertifications?\b/i.test(question) && /\btrainings?\b/i.test(question)) {
    crossBooleanFields = ['professionalCertifications', 'pursuedTrainings'];
  }

  // Gated to comparison questions only (and only when the year-comparison/
  // specialization/cross-boolean checks above didn't already claim the
  // field) — the entire reason any of
  // these backstops exist is the LLM's specifically observed "X vs Y"
  // extraction instability (see each backstop's own comment). Applying them
  // unconditionally would risk a plain, non-comparison question that merely
  // mentions a field's vocabulary in passing (e.g. "What CCNA trainings did
  // alumni pursue?" incidentally containing "training") getting an unasked-
  // for extra filter forced on — outside the comparison case, the normal
  // LLM-extraction-plus-validation chain already works and needs no net.
  if (isComparisonQuestion && !comparisonField && !crossBooleanFields) {
    for (const entry of FIELD_REGISTRY) {
      if (!entry.backstop) continue;
      const backstopMatch = question.match(entry.backstop.pattern);
      if (!backstopMatch) continue;
      if (!f[entry.key]) f[entry.key] = entry.backstop.resolve(backstopMatch);
      const isComparable = entry.values || entry.type === 'boolean-yesno' || entry.key === 'skillRating';
      if (isComparable && !comparisonField) comparisonField = entry.key;
    }
  }

  // Catalog-match fields (jobTitle, industryField, companyName,
  // employmentType, trainingType, ...) have no fixed `values` enum, so the
  // backstop loop above can never recognize them as comparable — see
  // findCatalogComparisonValues's own comment in fieldRegistry.js. Only
  // attempted when nothing above already resolved a comparisonField, so
  // the year-comparison/enum/boolean checks above always win when both are
  // somehow plausible for the same question.
  if (isComparisonQuestion && !comparisonField) {
    for (const entry of FIELD_REGISTRY) {
      if (entry.type !== 'catalog-match') continue;
      const matched = findCatalogComparisonValues(entry, question, cache);
      if (matched) {
        comparisonField = entry.key;
        catalogComparisonValues = matched;
        break;
      }
    }
  }

  // customQuestion comparison ("how many chose X vs Y for [some admin-
  // added question]?") — the last field with no "vs" support at all. Unlike
  // every comparison above, this needs the LLM to have still named WHICH
  // question is being asked about (f.customQuestion.label) — there's no
  // global/fixed set of possible values to scan blind the way catalog-match
  // or specialization can, each custom question has its own small,
  // independently-defined option set. See findCustomQuestionComparisonValues's
  // own comment in fieldRegistry.js.
  let customQuestionComparisonIds = null;
  let customQuestionComparisonLabel = null;
  if (isComparisonQuestion && !comparisonField && f.customQuestion?.label) {
    const customMatch = findCustomQuestionComparisonValues(f.customQuestion, question, cache);
    if (customMatch) {
      comparisonField = 'customQuestion';
      catalogComparisonValues = customMatch.values;
      customQuestionComparisonIds = customMatch.entries.map((e) => e.id);
      customQuestionComparisonLabel = customMatch.entries[0].label;
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

  // Cross-tab support ("employment status by gender", or 3+ dimensions —
  // "employment status by gender by college") — unlike comparisonField
  // above, this can't reuse `entry.backstop` (built to recognize a named
  // VALUE — "male", "employed" — not a bare FIELD NAME). "employment status
  // by gender" names neither value; it names the FIELDS themselves, so
  // detection instead matches each comparable field's own `entry.label`
  // (e.g. "gender", "employment status", "work location") appearing
  // literally in the question text. Mutually exclusive with comparisonField:
  // a "vs" question is a single-field full breakdown, a "by"/"per" question
  // is a cross-tab — never both at once. Capped at 4 fields (not
  // unbounded) — purely a sanity ceiling against a pathological question
  // that happens to mention many comparable field labels at once; the
  // Cartesian product computeVerifiedCrossTab builds grows multiplicatively
  // with each added dimension (3 fields of ~3 values each is already 27
  // queries), and a real question asking to cross-tab 5+ dimensions at once
  // would produce a chart far too dense to read anyway.
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
  const crosstabFields = matchedComparableFields.length >= 2 ? matchedComparableFields.slice(0, 4) : null;

  // Correlation-style question ("do alumni with Excellent technical skills
  // get employed more?", "does gender affect employment?") — answered as an
  // employment RATE within each group of the OTHER named field (see
  // computeVerifiedCorrelation's own top comment in verifiedCount.js for
  // why this scope, not a real statistics correlation coefficient).
  // "employment"/"employed" itself is always the OUTCOME side, never the
  // grouping field — a question correlating employment with itself makes
  // no sense, so the employmentStatus label is explicitly excluded from
  // the grouping-field search below. Mutually exclusive with crosstabFields/
  // comparisonField (checked in that order — whichever already resolved
  // wins; this is only attempted when nothing else claimed the question).
  let correlationField = null;
  const isCorrelationQuestion = !isComparisonQuestion && !crosstabFields && Boolean(question) && CORRELATION_PATTERN.test(question);
  if (isCorrelationQuestion) {
    for (const entry of FIELD_REGISTRY) {
      if (entry.key === 'employmentStatus') continue;
      const isComparable = entry.values || entry.type === 'boolean-yesno';
      if (!isComparable || !entry.label) continue;
      const labelPattern = new RegExp(`\\b${entry.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (labelPattern.test(question)) { correlationField = entry.key; break; }
    }
    // skillRating is a special case (same as comparisonField's own skill
    // handling above) — its real field is dynamic
    // (personalGrowthRatings.<whichever skill was named>), not a label this
    // loop's generic match can find, so it needs the same
    // SKILL_NAME_BACKSTOP_PATTERN detection used elsewhere. Seeds
    // f.skillRating (if not already set) so the normal resolver loop below
    // still runs resolveSkillRating and leaves the dynamic dbField key
    // sitting in tracerFilters for computeVerifiedCorrelation to read back,
    // the same mechanism computeComparison's own skillRating branch relies on.
    if (!correlationField) {
      const skillMatch = question.match(SKILL_NAME_BACKSTOP_PATTERN);
      if (skillMatch) {
        correlationField = 'skillRating';
        if (!f.skillRating) f.skillRating = { skill: resolveSkillNameFromText(skillMatch[1]), rating: null };
      }
    }
  }

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

  // personName has no generic resolver (see fieldRegistry.js's own comment
  // on why — a specific-person lookup is handled entirely by
  // computeVerifiedPersonLookup, not the per-field filter-resolution loop
  // above), so it's read directly off the raw extracted filters here rather
  // than coming from a patch like every other field.
  const personName = typeof f.personName === 'string' && f.personName.trim() ? f.personName.trim() : null;

  return { userFilters, tracerFilters, parts, statusMatch, percentageMatch, unresolvedField, unresolvedScope, unsupportedConditions, ambiguousField, forbiddenScope, comparisonField, catalogComparisonValues, customQuestionComparisonIds, customQuestionComparisonLabel, crosstabFields, skillCompareFields, unmatchedSkillNames, correlationField, personName, crossBooleanFields };
}

module.exports = { validateQueryPlan };
