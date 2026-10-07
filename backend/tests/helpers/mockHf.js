// Mocks services/queryPlanExtractor.js's extractQueryPlan directly, so the
// regression suite (tests/comparison-engine.test.js) exercises the REST of
// the pipeline (queryPlanValidator.js, verifiedCount.js) deterministically
// without spending real HF credits on every run. Mocking the module's own
// exported function (rather than HfInference.prototype.chatCompletion) is
// necessary because @huggingface/inference attaches chatCompletion as an
// OWN property on each client instance, not the prototype — there's no
// shared prototype method to intercept, and queryPlanExtractor.js's internal
// `hf` instance isn't exported for us to reach individually.
//
// IMPORTANT: this module must be require()'d (and the mock installed)
// BEFORE anything requires utils/verifiedCount.js, since that file does
// `const { extractQueryPlan } = require('../services/queryPlanExtractor')`
// at load time — destructuring copies whatever function reference is on the
// module object AT THAT MOMENT. Module caching means the swap below affects
// every other require() of this module for the rest of the process too, so
// don't install it in a suite that also needs real extraction.
//
// Fixtures in tests/fixtures/extractionFixtures.json were captured from a
// REAL HF_CHAT_MODEL (70B) run, not hand-written. Some fixture `intent`
// values look "wrong" at a glance (e.g. a cross-tab question extracted as
// intent:"summary") — harmless, because comparison/cross-tab routing in
// queryPlanValidator.js is regex-matched against the raw question text, not
// the LLM's self-reported intent. Verified this before trusting the
// fixtures as-is; don't hand-edit `intent` to "fix" it without re-checking.
const { mock } = require('node:test');
const queryPlanExtractor = require('../../services/queryPlanExtractor');
const fixtures = require('../fixtures/extractionFixtures.json');

function installMockHf() {
  return mock.method(queryPlanExtractor, 'extractQueryPlan', async (question) => {
    const plan = fixtures[question];
    if (!plan) {
      throw new Error(`mockHf: no fixture for question: ${JSON.stringify(question)}`);
    }
    return plan;
  });
}

module.exports = { installMockHf };
