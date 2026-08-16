const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  postJob, getMyJobs, getActivePartnerships, updateJob, closeJob, deleteJob,
  getApplicants, updateApplicantStatus, getApplicantResume, messageApplicant,
  getInterviews, scheduleInterview, updateInterview, cancelInterview, deleteInterview,
} = require('../controllers/jobController');
const { getCoordinatorNotifications, markNotificationsRead } = require('../controllers/eventController');

router.use(protect, authorize('employer'));

router.get('/partnerships',    getActivePartnerships);
router.get('/notifications',   getCoordinatorNotifications);
router.patch('/notifications/read', markNotificationsRead);
router.get('/jobs',            getMyJobs);
router.post('/jobs',           postJob);
router.patch('/jobs/:id',      updateJob);
router.patch('/jobs/:id/close', closeJob);
router.delete('/jobs/:id',     deleteJob);
router.get('/applicants',                 getApplicants);
router.patch('/applicants/:id/status',    updateApplicantStatus);
router.get('/applicants/:id/resume',      getApplicantResume);
router.post('/applicants/:id/message',    messageApplicant);
router.get('/interviews',              getInterviews);
router.post('/interviews',             scheduleInterview);
router.patch('/interviews/:id',        updateInterview);
router.patch('/interviews/:id/cancel', cancelInterview);
router.delete('/interviews/:id',       deleteInterview);

module.exports = router;
