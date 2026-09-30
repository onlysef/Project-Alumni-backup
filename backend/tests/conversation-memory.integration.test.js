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

// Regression: a follow-up whose ONLY inherited filters are gender +
// employment status (no job title, company, industry, or program) was
// observed live still answering "not sure which group you mean" —
// detectTopic() found no topic keyword in "sino sino sila?" itself, and the
// topic===null fallback only recognized jobTitleRegex/companyRegex/industry/
// program as strong-enough evidence of a names request, not gender/status
// alone. Broadened to any resolved filter at all.
test('multi-turn: a follow-up whose only inherited filters are gender + status still resolves (not just job title/company)', { skip }, async () => {
  const first = await generateAnswer('ilan ang babaeng may trabaho', [], {});
  assert.match(first.answer, /female/i);

  const history = [turn('user', 'ilan ang babaeng may trabaho'), turn('assistant', first.answer)];
  const followUp = await generateAnswer('sino sino sila?', history, {});
  assert.doesNotMatch(followUp.answer, /not sure which group/i);
  assert.match(followUp.answer, /female/i);
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

// Regression: "okay, thanks!" (two acknowledgment words chained) fell all
// the way through to the 'unknown' refusal ("I'm designed to answer
// questions related to the Graduate Tracer Study records...") because
// ACKNOWLEDGMENT_PATTERN only matched exactly one acknowledgment word. Now
// classifies as 'acknowledgment', and since it DOES contain real gratitude
// ("thanks"), gets the "You're welcome!" reply, not the plain one.
test('acknowledgment: a chained "okay, thanks!" is recognized and gets the gratitude reply', { skip }, async () => {
  const history = [turn('user', 'how many alumni are employed?'), turn('assistant', 'There are 170 employed alumni.')];
  const result = await generateAnswer('okay, thanks!', history, {});
  assert.match(result.answer, /you're welcome/i);
  assert.doesNotMatch(result.answer, /designed to answer questions/i);
});

// Regression: "kumusta AC" (a Tagalog greeting addressed to AC) classifies
// correctly as 'greeting' in its ORIGINAL language, but was observed live
// still answering an off-persona LLM-improvised "I'm functioning within
// normal parameters" — condenseQuestion() translated it to "How are you,
// AC?" before classify() ever saw it, and that translated phrasing no
// longer matches GREETING_PATTERN (which requires a specific greeting word
// at the very start). Translation is now skipped entirely for a message
// that already classifies as greeting/acknowledgment/offensive in its
// original language.
test('greeting: "kumusta ATREIA" gets the canned greeting, not an off-persona LLM improvisation', { skip }, async () => {
  const result = await generateAnswer('kumusta ATREIA', [], {});
  assert.match(result.answer, /I am ATREIA/i);
  assert.doesNotMatch(result.answer, /functioning within normal parameters/i);
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
    assert.match(okay.answer, /I am ATREIA/i, `history=${JSON.stringify(history)}`);
  }

  const salamat = await generateAnswer('salamat', [turn('user', 'salamat')], {});
  assert.doesNotMatch(salamat.answer, /you're welcome|anything else i can help/i);
  assert.match(salamat.answer, /I am ATREIA/i);
});

// Regression: "saan siya nagtatrabaho?" ("where does SHE work?") right after
// a person lookup for Meg Nicole Serrano was observed live answering "There
// are 170 employed alumni in the tracer study database" — a real,
// confident, but completely wrong answer. Two compounding causes, both
// fixed: (1) isEllipticalContinuation() treated the SINGULAR pronoun "siya"
// the same as a PLURAL/group referent, wrongly routing this through the
// filter-inheritance mechanism (which can't resolve WHO "siya" is — only
// condenseQuestion()'s LLM translation can, by substituting the real name);
// (2) even with that fixed, the untranslated-text-first aggregation attempt
// still independently matched "nagtatrabaho" as a generic employment-status
// query on its own, before ever reaching the correctly name-translated
// "Where does Meg Nicole Serrano work?". A single-person follow-up must
// resolve to that specific person's record, not an unrelated aggregate.
test('single-person pronoun follow-up: "saan siya nagtatrabaho?" resolves to the named person, not an unrelated aggregate count', { skip }, async () => {
  const lookup = await generateAnswer('sino si Meg Nicole', [], {});
  assert.match(lookup.answer, /Meg Nicole/i);

  const history = [turn('user', 'sino si Meg Nicole'), turn('assistant', lookup.answer)];
  const followUp = await generateAnswer('saan siya nagtatrabaho?', history, {});
  assert.match(followUp.answer, /Meg Nicole/i);
  assert.doesNotMatch(followUp.answer, /170|employed alumni in the tracer study database/i);
});

// Regression: the SAME follow-up above, once it correctly reached the named
// person's record, still answered with the ENTIRE 8-field record (program,
// year, job title, industry, work location, status, contact, email) instead
// of just the work location that was actually asked about — the narrated
// one-line answer ("Meg Nicole Serrano works locally within the
// Philippines.") was REJECTED by personFactsDropped because "Local (within
// the Philippines)" doesn't appear verbatim (the LLM naturally reworded the
// parenthetical), even though the answer was accurate and on-topic. A
// question about ONE field should get a focused answer, not a full dump.
test('single-person follow-up: a question about ONE field gets a focused answer, not the entire record', { skip }, async () => {
  const lookup = await generateAnswer('sino si Meg Nicole', [], {});
  const history = [turn('user', 'sino si Meg Nicole'), turn('assistant', lookup.answer)];

  const followUp = await generateAnswer('san siya nagtatrabaho', history, {});
  assert.match(followUp.answer, /Meg Nicole/i);
  // A full-record dump would include several of these on separate lines —
  // absence of "Contact Number"/"Email" (fields nobody asked about) is the
  // actual signal a focused answer was given, not the raw block fallback.
  assert.doesNotMatch(followUp.answer, /Contact Number|Email:/i);
});

// The 5 GROUP follow-up shapes named directly in the "context-aware
// follow-up questions" spec, all after the same Sutherland-scoped setup
// question. Each used to either fall through to an unrelated generic
// employment count (bare "nagtatrabaho"/"position" satisfying
// EMPLOYMENT_SIGNAL before TOPIC_PATTERNS.names ever got a chance) or
// resolve the wrong dimension entirely (a bare "IT" abbreviation always
// meant the degree PROGRAM before, never the industry someone works in).
test('group follow-ups: "saan sila", "sino sila", "ilan sa kanila ang nasa IT", "position nila", "kailan sila nagtapos" all resolve correctly', { skip }, async () => {
  const setup = await generateAnswer('Ilang alumni ang nagtatrabaho sa Sutherland?', [], {});
  const history = [turn('user', 'Ilang alumni ang nagtatrabaho sa Sutherland?'), turn('assistant', setup.answer)];

  const where = await generateAnswer('Saan sila nagtatrabaho?', history, {});
  assert.match(where.answer, /Taguig|Clark|Pampanga/i, 'must show actual work locations, not a generic employment count');

  const who = await generateAnswer('Sino sila?', history, {});
  assert.match(who.answer, /Liam Miranda/i);
  assert.match(who.answer, /Jenica Magsakay/i);

  const inIT = await generateAnswer('Ilan sa kanila ang nasa IT?', history, {});
  assert.match(inIT.answer, /\*\*1\*\*/, 'only Liam Miranda has industry "Information Technology" — Jenica\'s is Customer Service');

  const position = await generateAnswer('Ano ang position nila?', history, {});
  assert.match(position.answer, /Software Engineer/i);
  assert.match(position.answer, /Call Center Agent/i);

  const when = await generateAnswer('Kailan sila nagtapos?', history, {});
  assert.match(when.answer, /2021|2022/, 'must show actual graduation years, not a generic employment count');
});

// Regression: "sino silaaa!!!" (elongated "silaaa" + repeated "!!!") right
// after a Sutherland count was observed live NOT resolving through the
// deterministic group-referent path at all — GROUP_REFERENT_WORD's \bsila\b
// requires a word boundary right after "sila" that "silaaa" (still elongated
// at that point) never has. The bug was that isEllipticalContinuation()/
// isGroupReferentFollowUp() were tested against rawQuestion (captured
// BEFORE correctTypos() ever runs), not the typo/noise-corrected text, so
// collapseRepeatedLetters() collapsing "silaaa" -> "sila" never actually
// reached this check. Fell through to an LLM-narrated partial answer
// instead of the clean, deterministic 2-person list.
test('robustness: elongated letters + repeated punctuation ("sino silaaa!!!") still resolve through the deterministic group-referent path', { skip }, async () => {
  const setup = await generateAnswer('Ilang alumni ang nagtatrabaho sa Sutherland?', [], {});
  const history = [turn('user', 'Ilang alumni ang nagtatrabaho sa Sutherland?'), turn('assistant', setup.answer)];

  const result = await generateAnswer('sino silaaa!!!', history, {});
  assert.match(result.answer, /Jenica Magsakay/i);
  assert.match(result.answer, /Liam Miranda/i);
});

// Regression: "ilan nsa sutherland???" (typo "nsa" for "nasa", repeated
// "???") was observed live answering "There are 170 employed alumni" —
// completely ignoring Sutherland — because neither the stray-punctuation
// collapsing nor the "nsa"->"nasa" short-word alias existed yet, and the
// verb-less "nasa X" company pattern (no "nagtatrabaho") didn't exist
// either.
test('robustness: "ilan nsa sutherland???" (typo + repeated punctuation, no verb) resolves the company-scoped count', { skip }, async () => {
  const result = await generateAnswer('ilan nsa sutherland???', [], {});
  assert.match(result.answer, /\*\*2\*\*/);
  assert.match(result.answer, /sutherland/i);
});
