const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  chat,
  suggestions,
  reembed,
  ingestFile,
  ingestStatus,
  listSources,
  deleteSource,
} = require('../controllers/aiController');

router.use(protect, authorize('admin', 'coordinator'));

router.post('/chat',                   chat);
router.post('/suggestions',            suggestions);
router.post('/reembed',                authorize('admin'), reembed);
router.post('/ingest',                 ...ingestFile);
router.get( '/ingest/status/:id',      ingestStatus);
router.get( '/sources',                listSources);
router.delete('/sources/:id',          authorize('admin'), deleteSource);

module.exports = router;
