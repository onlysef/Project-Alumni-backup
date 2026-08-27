// Integration tests for multi-turn conversation memory / context-aware
// follow-up questions (see ragService.js's isEllipticalContinuation()/
// buildContextQuestions() and aggregationService.js's buildSeedFilters()).
//
// Unlike tagalog-support.test.js, these exercise generateAnswer() end-to-end
// against a REAL MongoDB connection (Graduate.aggregate() is not mockable
// without a new dependency — this project deliberately stays dependency-free
// for tests, per earlier project decision). Skipped automatically unless
// MONGODB_URI is set, so `npm test` still runs cleanly with no environment
// setup for everyone else; run explicitly with a real dev database to
// exercise this file.
//
// These tests depend on specific seed data already present in the dev
// database at the time this file was written (two alumni — Liam Miranda and
// Jenica Magsakay, both BSCS — with companyName "Sutherland"; at least one
// 2022-batch alumnus). If that data is ever removed/renamed, update the
// fixtures below rather than deleting the tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
require('dotenv').config();

const skip = !process.env.MONGODB_URI;
let generateAnswer;

test.before(async () => {
  if (skip) return;
  await mongoose.connect(process.env.MONGODB_URI);
  ({ generateAnswer } = require('../services/ragService'));
});

test.after(async () => {
  if (skip) return;
  await mongoose.disconnect();
});

function turn(role, content) { return { role, content }; }

// Spec Test 1: "How many alumni work at Sutherland?" -> "Who are they?"
// must resolve to the actual company-filtered alumni list, not a generic
// "who are you referring to?" refusal.
test('multi-turn: company count -> "who are they?" resolves to the company-filtered list', { skip }, async () => {
  const first = await generateAnswer('How many alumni work at Sutherland?', [], {});
  assert.match(first.answer, /Sutherland/i);

  const history = [turn('user', 'How many alumni work at Sutherland?'), turn('assistant', first.answer)];
  const followUp = await generateAnswer('Who are they?', history, {});
  assert.match(followUp.answer, /Sutherland/i);
  assert.match(followUp.answer, /Liam Miranda/i);
  assert.match(followUp.answer, /Jenica Magsakay/i);
  assert.doesNotMatch(followUp.answer, /not sure which group/i);
});

// Memory is deliberately ONE-HOP, not a multi-turn accumulated window (user
// preference: "dapat sa magkasunod na tanong lang siya may memory" — memory
// should only apply to the immediately-next question). Turn 2 correctly
// inherits turn 1's company filter (one hop). Turn 3 inherits turn 2's OWN
// filters (program=BSCS) but must NOT reach back through turn 2 to turn 1's
// company filter too — that would be two hops.
test('multi-turn: company -> elliptical course follow-up inherits one hop back, but a THIRD turn does not reach back two hops', { skip }, async () => {
  const t1 = await generateAnswer('How many alumni work at Sutherland?', [], {});
  const h1 = [turn('user', 'How many alumni work at Sutherland?'), turn('assistant', t1.answer)];

  const t2 = await generateAnswer('How many are from BSCS?', h1, {});
  assert.match(t2.answer, /Sutherland/i, 'one-hop: must inherit the company from the immediately preceding turn');
  assert.match(t2.answer, /Computer Science/i, 'must also apply its own course filter');
  const h2 = [...h1, turn('user', 'How many are from BSCS?'), turn('assistant', t2.answer)];

  const t3 = await generateAnswer('Who are they?', h2, {});
  assert.match(t3.answer, /Computer Science/i, 'must inherit turn 2 (one hop back)');
  assert.doesNotMatch(t3.answer, /Sutherland/i, 'must NOT reach back through turn 2 to turn 1 (two hops)');
});

// Spec Test 5 (TOPIC_CHANGE): a fresh, self-contained question that names
// its own explicit subject ("the 2024 batch") must NOT inherit an unrelated
// filter (company) from several turns ago.
test('multi-turn: a self-contained new question does not inherit an unrelated earlier filter', { skip }, async () => {
  const t1 = await generateAnswer('How many alumni work at Sutherland?', [], {});
  const history = [turn('user', 'How many alumni work at Sutherland?'), turn('assistant', t1.answer)];

  const t2 = await generateAnswer('What is the employment rate of the 2024 batch?', history, {});
  assert.match(t2.answer, /2024/);
  assert.doesNotMatch(t2.answer, /Sutherland/i, 'topic change must not carry the old company filter forward');
});

// Spec Test 3: batch count -> elliptical "how many are employed?" must keep
// the graduation-year filter from the prior turn.
test('multi-turn: batch count -> elliptical "how many are employed?" keeps the batch filter', { skip }, async () => {
  const t1 = await generateAnswer('How many alumni graduated in 2022?', [], {});
  const history = [turn('user', 'How many alumni graduated in 2022?'), turn('assistant', t1.answer)];

  const t2 = await generateAnswer('How many are employed?', history, {});
  assert.match(t2.answer, /2022/, 'the batch filter from turn 1 must still apply');
  assert.match(t2.answer, /employed/i);
});

// Spec's Tagalog example: "Ilang alumni ang nagtatrabaho sa Sutherland?" ->
// "Sino sila?" must resolve the same way the English equivalent does.
test('multi-turn (Tagalog): "Ilang alumni ang nagtatrabaho sa Sutherland?" -> "Sino sila?" resolves the company-filtered list', { skip }, async () => {
  const t1 = await generateAnswer('Ilang alumni ang nagtatrabaho sa Sutherland?', [], {});
  assert.match(t1.answer, /Sutherland/i);
  const history = [turn('user', 'Ilang alumni ang nagtatrabaho sa Sutherland?'), turn('assistant', t1.answer)];

  const t2 = await generateAnswer('Sino sila?', history, {});
  assert.match(t2.answer, /Sutherland/i);
  assert.match(t2.answer, /Liam Miranda/i);
  assert.doesNotMatch(t2.answer, /not sure which group/i);
});

// A genuinely unresolvable group-referent follow-up (no prior conversation
// at all) must ask for clarification, never guess — see
// feedback_ac_clarify_dont_guess in project memory for why.
test('multi-turn: a group-referent follow-up with no prior context asks for clarification instead of guessing', { skip }, async () => {
  const result = await generateAnswer('Who are they?', [], {});
  assert.match(result.answer, /not sure which group/i);
});

// Regression: the admin AI Assistant UI's `history` includes the CURRENT
// user message as its OWN last entry (confirmed live via a debug log of the
// real request body) — without accounting for this, buildContextQuestions()
// picked up the current question itself ("sino sila?", no filters of its
// own) as "the immediately preceding turn" instead of the real prior turn
// one further back, so every group-referent follow-up through the actual
// admin UI silently fell to the clarify message even with a perfectly good
// company count one real turn back — this was NOT caught by the other tests
// above because they all built `history` WITHOUT this duplicate entry.
test('multi-turn: resolves correctly even when chatHistory duplicates the current question as its own last entry', { skip }, async () => {
  const t1 = await generateAnswer('ilan ang nagtatrabaho sa sutherland', [], {});
  const historyWithDuplicate = [
    turn('user', 'ilan ang nagtatrabaho sa sutherland'),
    turn('assistant', t1.answer),
    turn('user', 'sino sila?'), // the frontend includes the current message here too
  ];

  const t2 = await generateAnswer('sino sila?', historyWithDuplicate, {});
  assert.match(t2.answer, /sutherland/i);
  assert.match(t2.answer, /Liam Miranda/i);
  assert.doesNotMatch(t2.answer, /not sure which group/i);
});

// Regression: "ilan ang lalaki na employed?" (109) -> "ilan ang lalaki sa
// database?" was observed live still answering "109 male EMPLOYED alumni"
// — the second question deliberately drops the employment filter to ask
// about the WHOLE dataset, but named no "alumni"/"graduates" noun for the
// self-sufficiency check to recognize, so it was wrongly treated as a
// continuation and inherited employmentStatus from the first question. Only
// gender should carry through this question's OWN extraction; "sa database"
// must be recognized as an explicit, self-contained scope, not an ellipsis.
test('multi-turn: "sa database" is a self-contained scope, not a continuation — a new gender-only question drops the prior employment filter', { skip }, async () => {
  const t1 = await generateAnswer('ilan ang lalaki na employed', [], {});
  assert.match(t1.answer, /employed/i);
  const history = [turn('user', 'ilan ang lalaki na employed'), turn('assistant', t1.answer)];

  const t2 = await generateAnswer('ilan ang lalaki sa database', history, {});
  assert.doesNotMatch(t2.answer, /employed/i, 'must not inherit the employment filter from the prior turn');
  assert.match(t2.answer, /male/i);
});

// Unrelated to conversation memory, but caught live in the same session and
// reuses this file's DB-connected generateAnswer() setup rather than
// standing up a separate test file for one small fix. ACKNOWLEDGMENT_PATTERN
// (queryClassifier.js) groups actual gratitude ("thanks"/"salamat") together
// with a plain "moving on" acknowledgment ("ok"/"sige"/"got it") under one
// 'acknowledgment' type — replying "You're welcome!" to a bare "okay" is a
// non-sequitur (observed live: a user said "okay" right after being told to
// keep the conversation respectful, not a thank-you at all). Uses a non-empty
// history — with NO prior conversation, both phrasings now correctly fall
// through to the greeting response instead (see the next test).
test('acknowledgment: a plain "okay"/"sige" gets a neutral reply, not "You\'re welcome!" (which only fits actual gratitude)', { skip }, async () => {
  const history = [turn('user', 'how many alumni are employed?'), turn('assistant', 'There are 170 employed alumni.')];

  const plain = await generateAnswer('okay', history, {});
  assert.doesNotMatch(plain.answer, /you're welcome/i);

  const gratitude = await generateAnswer('salamat', history, {});
  assert.match(gratitude.answer, /you're welcome/i);
});

// Regression: "okay" as literally the FIRST message of a brand new
// conversation was observed live still answering the acknowledgment reply
// instead of the greeting — TWICE. First with history=[] (fixed by checking
// chatHistory.length === 0), then again because the real admin UI sends
// `history` with the CURRENT message already included as its own entry (see
// buildContextQuestions()'s own comment) — so a brand-new conversation's
// history isn't actually [], it's [{role:'user', content:'okay'}], and a
// bare length check never caught it. hasPriorConversation() accounts for
// this; both history shapes are tested here so neither regresses again.
test('acknowledgment: a bare "okay"/"salamat" with NO real prior conversation gets the greeting, not an acknowledgment of nothing', { skip }, async () => {
  for (const history of [[], [turn('user', 'okay')]]) {
    const okay = await generateAnswer('okay', history, {});
    assert.doesNotMatch(okay.answer, /you're welcome|anything else i can help/i, `history=${JSON.stringify(history)}`);
    assert.match(okay.answer, /I'm AC/i, `history=${JSON.stringify(history)}`);
  }

  const salamat = await generateAnswer('salamat', [turn('user', 'salamat')], {});
  assert.doesNotMatch(salamat.answer, /you're welcome|anything else i can help/i);
  assert.match(salamat.answer, /I'm AC/i);
});
