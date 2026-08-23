const logger = require('../utils/logger');
const { stripInjectionPhrases } = require('../utils/injectionFilter');
const AiFlag = require('../models/AiFlag');

const MAX_QUESTION_LENGTH = 2000;

function sanitizePrompt(req, res, next) {
  const { question } = req.body || {};
  if (typeof question !== 'string') return next();

  const truncated = question.slice(0, MAX_QUESTION_LENGTH);
  const { cleaned, injectionDetected } = stripInjectionPhrases(truncated);

  if (injectionDetected) {
    logger.warn('prompt_injection_detected', {
      userId: req.user?.id,
      original: question.slice(0, 300),
    });
    // Fire-and-forget — a flag-queue write must never block or fail the
    // actual chat request it's just recording.
    AiFlag.create({
      type: 'injection',
      question: question.slice(0, 300),
      sourceType: 'chat',
      source: req.user?.id || null,
    }).catch(() => {});
  }

  req.body.question = cleaned;
  next();
}

module.exports = sanitizePrompt;
