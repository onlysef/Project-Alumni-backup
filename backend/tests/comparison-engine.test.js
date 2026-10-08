// Regression coverage for the comparison/cross-tab/ranking engine added
// across this session (utils/verifiedCount.js, utils/fieldRegistry.js,
// utils/queryPlanValidator.js, services/queryPlanExtractor.js). DB-backed
// against the real TracerStudyResponse/User collections (same discipline as
// CLAUDE.md's own "prefer deterministic checks over further prompt-
// patching" note) — these numbers are READ-ONLY assertions against whatever
// real data currently exists, not fixtures, so a failure here means either
// a real regression or the underlying data genuinely changed; check which
// before assuming the code is at fault.
//
// Run with: npm test (uses Node's built-in test runner, node --test)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
require('dotenv').config();

const { installMockHf } = require('./helpers/mockHf');
// Must install BEFORE requiring verifiedCount.js — that module destructures
// extractQueryPlan out of queryPlanExtractor's exports at require() time, so
// mutating the export later (e.g. inside before()) would be too late. See
// helpers/mockHf.js for the full rationale.
const mockHf = installMockHf();
const { computeVerifiedStat, getPlan } = require('../utils/verifiedCount');

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
});

after(async () => {
  mockHf.mock.restore();
  await mongoose.disconnect();
});

test('generic comparison engine: employed vs unemployed silently folds self-employed in when not mentioned', async () => {
  const r = await computeVerifiedStat('How many are employed vs unemployed?', undefined, null);
  assert.ok(r, 'expected a verified result, got null');
  // Self-employed isn't named, so comparisonFold drops it as its own row
  // and shows no "(includes self-employed)" annotation either — a plain
  // "Employed: N" is the correct, deliberately unannotated shape here.
  assert.match(r.description, /Employed: \d+/);
  assert.match(r.description, /Unemployed: \d+/);
  assert.doesNotMatch(r.description, /Self-Employed: \d+/, 'Self-Employed should be folded in, not shown separately, unless the question names it');
});

test('generic comparison engine: naming self-employed explicitly surfaces the fold annotation', async () => {
  const r = await computeVerifiedStat('How many are employed vs unemployed vs self-employed?', undefined, null);
  assert.ok(r, 'expected a verified result, got null');
  assert.match(r.description, /Employed \(includes self-employed\): \d+/);
  assert.match(r.description, /Self-Employed: \d+/);
});

test('generic comparison engine: workLocation picks the correct field under a "vs" question', async () => {
  const r = await computeVerifiedStat('How many work locally vs abroad?', undefined, null);
  assert.ok(r);
  assert.match(r.description, /Local: \d+/);
  assert.match(r.description, /Abroad: \d+/);
});

test('comparison phrasing variants all resolve to the same comparison engine', async () => {
  const phrasings = [
    'How many are employed compare to unemployed?',
    'How many are employed vs unemployed?',
  ];
  for (const q of phrasings) {
    const r = await computeVerifiedStat(q, undefined, null);
    assert.ok(r, `expected a result for: ${q}`);
    assert.match(r.description, /employment status comparison/);
  }
});

test('cross-tab: employment status by gender returns a 2D breakdown', async () => {
  const r = await computeVerifiedStat('employment status breakdown by gender', undefined, null);
  assert.ok(r);
  assert.match(r.description, /cross-tab/);
  assert.match(r.description, /Male/);
  assert.match(r.description, /Female/);
});

test('skill compare: two different skills both get independently verified breakdowns', async () => {
  const r = await computeVerifiedStat('How do alumni rate their technical skills vs problem solving?', undefined, null);
  assert.ok(r);
  assert.match(r.description, /technical skills/);
  assert.match(r.description, /problem solving skills/);
  // both skills must each report all 5 rating levels
  const technicalSection = r.description.split('problem solving skills')[0];
  for (const level of ['Excellent', 'Competent', 'Satisfactory', 'Beginner', 'Non-Acceptable']) {
    assert.match(technicalSection, new RegExp(level), `technical skills section missing ${level}`);
  }
});

test('professionalExamName: "LET" abbreviation resolves via synonym match', async () => {
  const plan = await getPlan('How many passed the LET?', undefined, null);
  assert.equal(plan.unresolvedField, null, 'LET should resolve via synonymSubstrings, not report unresolved');
});

test('graduationYear: plain filter resolves to a real batch year', async () => {
  const r = await computeVerifiedStat('How many 2023 graduates are employed?', undefined, null);
  assert.ok(r);
  assert.match(r.description, /batch 2023/);
});

test('graduationYear: trend (no direction) is chronological, ranking (with direction) is by count', async () => {
  const trend = await computeVerifiedStat('How has the employment rate changed per batch year?', undefined, null);
  assert.ok(trend);
  assert.match(trend.description, /chronological/);

  const ranked = await computeVerifiedStat('Which batch year had the highest number of employed graduates?', undefined, null);
  assert.ok(ranked);
  assert.match(ranked.description, /highest batch year/);
});

test('rate-mode ranking: ranks programs by employment RATE, not headcount', async () => {
  const r = await computeVerifiedStat('What are the top 3 programs by employment rate?', undefined, null);
  assert.ok(r);
  assert.match(r.description, /by employment rate/);
  assert.match(r.description, /%/);
});

test('skill ranking: ranks the 8 skill categories against each other', async () => {
  const r = await computeVerifiedStat('Which skill do alumni rate themselves highest in?', undefined, null);
  assert.ok(r);
  assert.match(r.description, /skill rated "Excellent"/);
});

test('compareScope: two named programs compared directly, not confused with the generic employmentStatus comparison', async () => {
  const r = await computeVerifiedStat('Compare BSIT and BSCS employment rates.', undefined, null);
  assert.ok(r);
  assert.match(r.description, /program comparison/);
  assert.match(r.description, /BSIT/);
  assert.match(r.description, /BSCS/);
  // regression guard for the critical bug fixed this session: compareScope
  // must win even when intent resolves to "percentage" instead of "ranking"
  assert.doesNotMatch(r.description, /employment status comparison/, 'must not fall through to the generic employed-vs-unemployed engine');
});

test('coordinator college-scoping: compareScope refuses a program outside the coordinator\'s own college', async () => {
  const r = await computeVerifiedStat('Compare BSIT and BSEd-Eng employment rates.', undefined, 'CCS');
  assert.ok(r);
  assert.equal(r.type, 'forbidden');
});

test('coordinator college-scoping: compareScope allows two programs within the coordinator\'s own college', async () => {
  const r = await computeVerifiedStat('Compare BSIT and BSCS employment rates.', undefined, 'CCS');
  assert.ok(r);
  assert.notEqual(r.type, 'forbidden');
});

test('comparison engine always attaches a chart (a "vs" question is inherently a side-by-side breakdown)', async () => {
  const withoutChart = await computeVerifiedStat('How many are employed vs unemployed?', undefined, null);
  assert.ok(withoutChart);
  assert.ok(withoutChart.charts.length > 0, 'comparisons always include a chart, not gated behind chart-request wording');

  const withChart = await computeVerifiedStat('Show a chart of employed vs unemployed', undefined, null);
  assert.ok(withChart);
  assert.ok(withChart.charts.length > 0, 'expected a chart when one was explicitly requested');
  assert.equal(withChart.charts[0].type, 'bars');
});

test('percentage generalizes beyond employmentStatus: jobRelatedToDegree can be the numerator too', async () => {
  const r = await computeVerifiedStat('What percentage of jobs are related to their degree?', undefined, null);
  assert.ok(r, 'expected a verified result, got null — percentage must not be hardcoded to employmentStatus only');
  assert.equal(r.type, 'percentage');
  assert.match(r.description, /job relation to degree "Related"/);
});

test('professionalCertifications and pursuedTrainings resolve to DIFFERENT fields, not both collapsing to professionalDevelopmentActivities', async () => {
  const certs = await computeVerifiedStat('How many alumni pursued professional certifications?', undefined, null);
  const trainings = await computeVerifiedStat('How many alumni pursued further trainings?', undefined, null);
  assert.ok(certs && trainings);
  assert.match(certs.description, /has professional certifications/);
  assert.match(trainings.description, /pursued trainings/);
  assert.notEqual(certs.count, undefined);
  assert.notEqual(trainings.count, undefined);
  // Regression guard for the bug this session: both used to silently
  // extract the SAME generic field and return the identical count.
  assert.notEqual(certs.count, trainings.count, 'certifications and trainings are tracked by separate fields with different real counts — identical counts means the conflation bug is back');
});

test('reasons for unemployment: a bare breakdown request is answered by a deterministic multi-select aggregation, never narrated by the LLM', async () => {
  const r = await computeVerifiedStat('What are the reasons for unemployment among alumni?', undefined, null);
  assert.ok(r, 'expected a verified result, got null — this must not fall through to unverified LLM/RAG narration');
  assert.equal(r.type, 'unsupported', 'deterministic bypass type, same as other hard-coded-text results that skip LLM narration');
  assert.match(r.description, /Waiting for the right job opportunity: \d+/);
  assert.match(r.description, /Lack of work experience: \d+/);
  assert.ok(r.charts?.length > 0, 'expected a breakdown chart');
});

test('reasons for unemployment: a specific NAMED reason still uses the existing catalog-match count path, not the breakdown', async () => {
  const r = await computeVerifiedStat('How many cited lack of work experience as their reason?', undefined, null);
  assert.ok(r);
  assert.equal(r.type, 'count');
  assert.match(r.description, /reason for not being employed "Lack of work experience"/);
});

test('promotions and awards: plain boolean-field count questions resolve correctly', async () => {
  const promoted = await computeVerifiedStat('How many alumni were promoted in their job?', undefined, null);
  const awards = await computeVerifiedStat('How many alumni received awards or recognition?', undefined, null);
  assert.ok(promoted && awards);
  assert.match(promoted.description, /was promoted in their job/);
  assert.match(awards.description, /reported an award or recognition/);
});

test('full-time/part-time employment type is deterministically flagged as unsupported vocabulary, not silently answered with the wrong field', async () => {
  const r = await computeVerifiedStat('How many are full-time vs part-time employees?', undefined, null);
  assert.ok(r);
  assert.match(r.description, /not tracked/i, 'the real tracked vocabulary is Regular\\/Permanent, Contractual, etc. — full-time\\/part-time must be disclosed as unsupported, not silently mapped to employmentStatus');
});
