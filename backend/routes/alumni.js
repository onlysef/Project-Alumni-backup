const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { changePassword, updatePassword, updateAvatar, sendInquiry, completeOnboarding, submitTracerStudy, getMyTracerResponse, getTracerFormConfig, getHomeSummary, getMyEmployment, updateMyEmployment, getSuggestedAlumni, getCareerRecommendations, searchJobs, getSavedJobs, toggleSavedJob, getJobAlertsPref, updateJobAlertsPref, getMyResume, updateMyResume } = require('../controllers/alumniController');
const { getAnnouncements, toggleLike, getComments, addComment, trackShare } = require('../controllers/announcementController');
const { getAlumniEvents, toggleInterested, getCoordinatorNotifications, markNotificationsRead } = require('../controllers/eventController');
const { getOfficeSettings, getAvailableStaff, bookAppointment, getBookedSlots } = require('../controllers/appointmentController');

router.post('/change-password',      protect, authorize('alumni'), changePassword);
router.post('/complete-onboarding',  protect, authorize('alumni'), completeOnboarding);
router.get('/tracer-study',          protect, authorize('alumni'), getMyTracerResponse);
router.post('/tracer-study',         protect, authorize('alumni'), submitTracerStudy);
router.get('/tracer-form-config',    protect, authorize('alumni'), getTracerFormConfig);
router.get('/home-summary',          protect, authorize('alumni'), getHomeSummary);
router.get('/suggested',             protect, authorize('alumni'), getSuggestedAlumni);
router.get('/career-recommendations', protect, authorize('alumni'), getCareerRecommendations);
router.get('/jobs/search',           protect, authorize('alumni'), searchJobs);
router.get('/jobs/saved',            protect, authorize('alumni'), getSavedJobs);
router.post('/jobs/saved/toggle',    protect, authorize('alumni'), toggleSavedJob);
router.get('/job-alerts',            protect, authorize('alumni'), getJobAlertsPref);
router.put('/job-alerts',            protect, authorize('alumni'), updateJobAlertsPref);
router.get('/resume',                protect, authorize('alumni'), getMyResume);
router.put('/resume',                protect, authorize('alumni'), updateMyResume);
router.get('/employment',            protect, authorize('alumni'), getMyEmployment);
router.put('/employment',            protect, authorize('alumni'), updateMyEmployment);
router.put('/password',              protect, authorize('alumni'), updatePassword);
router.put('/avatar',                protect, authorize('alumni'), updateAvatar);
router.post('/inquiry',              protect, authorize('alumni'), sendInquiry);
router.get('/appointments/settings', protect, authorize('alumni'), getOfficeSettings);
router.get('/appointments/staff',    protect, authorize('alumni'), getAvailableStaff);
router.get('/appointments/booked-slots', protect, authorize('alumni'), getBookedSlots);
router.post('/appointments',         protect, authorize('alumni'), bookAppointment);

// Same underlying Announcement data/logic the admin panel manages — alumni
// only get read + like/comment/share, no create/update/delete.
router.get('/announcements',                protect, authorize('alumni'), getAnnouncements);
router.post('/announcements/:id/like',      protect, authorize('alumni'), toggleLike);
router.get('/announcements/:id/comments',   protect, authorize('alumni'), getComments);
router.post('/announcements/:id/comment',   protect, authorize('alumni'), addComment);
router.post('/announcements/:id/share',     protect, authorize('alumni'), trackShare);

router.get('/events',                       protect, authorize('alumni'), getAlumniEvents);
router.post('/events/:id/interested',       protect, authorize('alumni'), toggleInterested);

// Same generic per-user Notification read/mark-read logic the coordinator
// side already uses (keyed only by req.user.id, nothing coordinator-specific).
router.get('/notifications',                protect, authorize('alumni'), getCoordinatorNotifications);
router.patch('/notifications/read',         protect, authorize('alumni'), markNotificationsRead);

module.exports = router;
