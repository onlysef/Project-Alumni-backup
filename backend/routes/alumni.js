const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { changePassword, updatePassword, updateAvatar, completeOnboarding, submitTracerStudy, getMyTracerResponse, getTracerFormConfig, getHomeSummary, getMyEmployment, updateMyEmployment } = require('../controllers/alumniController');
const { getAnnouncements, toggleLike, getComments, addComment, trackShare } = require('../controllers/announcementController');
const { getAlumniEvents, toggleInterested, getCoordinatorNotifications, markNotificationsRead } = require('../controllers/eventController');

router.post('/change-password',      protect, authorize('alumni'), changePassword);
router.post('/complete-onboarding',  protect, authorize('alumni'), completeOnboarding);
router.get('/tracer-study',          protect, authorize('alumni'), getMyTracerResponse);
router.post('/tracer-study',         protect, authorize('alumni'), submitTracerStudy);
router.get('/tracer-form-config',    protect, authorize('alumni'), getTracerFormConfig);
router.get('/home-summary',          protect, authorize('alumni'), getHomeSummary);
router.get('/employment',            protect, authorize('alumni'), getMyEmployment);
router.put('/employment',            protect, authorize('alumni'), updateMyEmployment);
router.put('/password',              protect, authorize('alumni'), updatePassword);
router.put('/avatar',                protect, authorize('alumni'), updateAvatar);

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
