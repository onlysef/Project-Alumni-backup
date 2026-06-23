const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { getEmploymentRecords, getEmploymentActivity } = require('../controllers/employmentController');

router.use(protect, authorize('admin', 'coordinator'));

// Must declare /activity before /:id to avoid route collision
router.get('/employment/activity', getEmploymentActivity);
router.get('/employment',          getEmploymentRecords);

module.exports = router;
