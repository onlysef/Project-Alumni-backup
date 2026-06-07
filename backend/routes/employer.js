const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { postJob, getMyJobs, getActivePartnerships, closeJob, deleteJob } = require('../controllers/jobController');

router.use(protect, authorize('employer'));

router.get('/partnerships',    getActivePartnerships);
router.get('/jobs',            getMyJobs);
router.post('/jobs',           postJob);
router.patch('/jobs/:id/close', closeJob);
router.delete('/jobs/:id',     deleteJob);

module.exports = router;
