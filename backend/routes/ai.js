const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const sanitizePrompt = require('../middleware/sanitizePrompt');
const { aiChatLimiter } = require('../middleware/rateLimit');
const {
  chat,
  reembed,
  ingestFile,
  ingestStatus,
  listSources,
  deleteSource,
  getFlags,
  reviewFlag,
} = require('../controllers/aiController');

router.use(protect, authorize('admin', 'coordinator'));

router.post('/chat',                   aiChatLimiter, sanitizePrompt, chat);
router.post('/reembed',                authorize('admin'), reembed);
// Knowledge-base management — admin-only, same as reembed/deleteSource
// above. This router is mounted for both 'admin' and 'coordinator' (line
// 15), and these three were the only ones missing the guard: a coordinator
// could otherwise upload files straight into the shared vector store (with
// no college tag, polluting every college's AI assistant answers), list
// every imported file system-wide, and poll any file's ingestion status.
router.post('/ingest',                 authorize('admin'), ...ingestFile);
router.get( '/ingest/status/:id',      authorize('admin'), ingestStatus);
router.get( '/sources',                authorize('admin'), listSources);
router.delete('/sources/:id',          authorize('admin'), deleteSource);

// Flag review queue is admin-only (same as the knowledge-base management
// routes above).
router.get(  '/flags',                 authorize('admin'), getFlags);
router.patch('/flags/:id',             authorize('admin'), reviewFlag);

module.exports = router;
