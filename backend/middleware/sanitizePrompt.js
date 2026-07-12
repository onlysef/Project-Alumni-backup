const logger = require('../utils/logger');

// Phrases that attempt to override the system prompt or coax the model into
// using outside knowledge / fabricating data. Matched phrases are stripped
// from the outgoing question so they never reach the LLM as instructions —
// the rest of the user's genuine question (if any) still gets answered.
const INJECTION_PATTERNS = [
  /ignore (all )?(the )?(previous|above|prior) instructions?/gi,
  /disregard (all )?(the )?(previous|above|prior) (instructions?|rules?)/gi,
  /forget (all )?(the )?(previous|above|prior) instructions?/gi,
  /use your own knowledge/gi,
  /make up (an?|the) (answer|data|number|statistic)/gi,
  /pretend (that )?you('re| are)/gi,
  /act as (if|though|an?)/gi,
  /you are now/gi,
  /new system prompt/gi,
  /override (your|the) (system|rules|instructions)/gi,
  /reveal your (system prompt|instructions)/gi,
  /jailbreak/gi,
];

const MAX_QUESTION_LENGTH = 2000;

function sanitizePrompt(req, res, next) {
  const { question } = req.body || {};
  if (typeof question !== 'string') return next();

  let cleaned = question.slice(0, MAX_QUESTION_LENGTH);
  let injectionDetected = false;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      injectionDetected = true;
      cleaned = cleaned.replace(pattern, '');
    }
  }

  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  if (injectionDetected) {
    logger.warn('prompt_injection_detected', {
      userId: req.user?.id,
      original: question.slice(0, 300),
    });
  }

  req.body.question = cleaned;
  next();
}

module.exports = sanitizePrompt;
