const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { changePassword, updatePassword, updateAvatar, sendInquiry, completeOnboarding, submitTracerStudy, getMyTracerResponse, getTracerFormConfig, getHomeSummary, getMyEmployment, updateMyEmployment, getSuggestedAlumni, messageAlumnus, getCareerRecommendations, getCareerNextStep, getCareerFitExplanation, extractSkills, searchJobs, getPartnerJobPostings, getJobSkillTip, getSavedJobs, toggleSavedJob, getJobAlertsPref, updateJobAlertsPref, getMyResume, updateMyResume, deleteMyResume, updateMyResumeFile, deleteMyResumeFile, getApplications, logApplication, updateApplicationStatus, deleteApplication } = require('../controllers/alumniController');
const { getAlumniAnnouncements, toggleLike, getComments, addComment, updateComment, deleteComment, trackShare } = require('../controllers/announcementController');
const { getAlumniEvents, toggleInterested, getCoordinatorNotifications, markNotificationsRead } = require('../controllers/eventController');
const { getOfficeSettings, getAvailableStaff, bookAppointment, getBookedSlots } = require('../controllers/appointmentController');
const { submitEventFeedback, getMyEventFeedback } = require('../controllers/feedbackController');

router.post('/change-password',      protect, authorize('alumni'), changePassword);
router.post('/complete-onboarding',  protect, authorize('alumni'), completeOnboarding);
router.get('/tracer-study',          protect, authorize('alumni'), getMyTracerResponse);
router.post('/tracer-study',         protect, authorize('alumni'), submitTracerStudy);
router.get('/tracer-form-config',    protect, authorize('alumni'), getTracerFormConfig);
router.get('/home-summary',          protect, authorize('alumni'), getHomeSummary);
router.get('/suggested',             protect, authorize('alumni'), getSuggestedAlumni);
router.post('/network/:id/message',  protect, authorize('alumni'), messageAlumnus);
router.get('/career-recommendations', protect, authorize('alumni'), getCareerRecommendations);
router.get('/career-recommendations/next-step', protect, authorize('alumni'), getCareerNextStep);
router.get('/career-recommendations/explain', protect, authorize('alumni'), getCareerFitExplanation);
router.post('/skills/extract',       protect, authorize('alumni'), extractSkills);
router.get('/jobs/search',           protect, authorize('alumni'), searchJobs);
router.get('/jobs/partner-postings', protect, authorize('alumni'), getPartnerJobPostings);
router.get('/jobs/skill-tip',        protect, authorize('alumni'), getJobSkillTip);
router.get('/jobs/saved',            protect, authorize('alumni'), getSavedJobs);
router.post('/jobs/saved/toggle',    protect, authorize('alumni'), toggleSavedJob);
router.get('/job-alerts',            protect, authorize('alumni'), getJobAlertsPref);
router.put('/job-alerts',            protect, authorize('alumni'), updateJobAlertsPref);
router.get('/resume',                protect, authorize('alumni'), getMyResume);
router.put('/resume',                protect, authorize('alumni'), updateMyResume);
router.delete('/resume',             protect, authorize('alumni'), deleteMyResume);
router.put('/resume/file',           protect, authorize('alumni'), updateMyResumeFile);
router.delete('/resume/file',        protect, authorize('alumni'), deleteMyResumeFile);
router.get('/applications',          protect, authorize('alumni'), getApplications);
router.post('/applications',         protect, authorize('alumni'), logApplication);
router.patch('/applications/:id/status', protect, authorize('alumni'), updateApplicationStatus);
router.delete('/applications/:id',   protect, authorize('alumni'), deleteApplication);
router.get('/employment',            protect, authorize('alumni'), getMyEmployment);
router.put('/employment',            protect, authorize('alumni'), updateMyEmployment);
router.put('/password',              protect, authorize('alumni'), updatePassword);
router.put('/avatar',                protect, authorize('alumni'), updateAvatar);
router.post('/inquiry',              protect, authorize('alumni'), sendInquiry);
router.get('/appointments/settings', protect, authorize('alumni'), getOfficeSettings);
router.get('/appointments/staff',    protect, authorize('alumni'), getAvailableStaff);
router.get('/appointments/booked-slots', protect, authorize('alumni'), getBookedSlots);
router.post('/appointments',         protect, authorize('alumni'), bookAppointment);

// Lean, Announcement-only read (no Event/Job union, no poster-name lookups)
// — the admin panel's merged feed lives in getAnnouncements instead.
router.get('/announcements',                protect, authorize('alumni'), getAlumniAnnouncements);
router.post('/announcements/:id/like',      protect, authorize('alumni'), toggleLike);
router.get('/announcements/:id/comments',   protect, authorize('alumni'), getComments);
router.post('/announcements/:id/comment',   protect, authorize('alumni'), addComment);
router.put('/announcements/:id/comment/:commentId',    protect, authorize('alumni'), updateComment);
router.delete('/announcements/:id/comment/:commentId', protect, authorize('alumni'), deleteComment);
router.post('/announcements/:id/share',     protect, authorize('alumni'), trackShare);

router.get('/events',                       protect, authorize('alumni'), getAlumniEvents);
router.post('/events/:id/interested',       protect, authorize('alumni'), toggleInterested);
router.get('/events/:id/feedback',          protect, authorize('alumni'), getMyEventFeedback);
router.post('/events/:id/feedback',         protect, authorize('alumni'), submitEventFeedback);

// Same generic per-user Notification read/mark-read logic the coordinator
// side already uses (keyed only by req.user.id, nothing coordinator-specific).
router.get('/notifications',                protect, authorize('alumni'), getCoordinatorNotifications);
router.patch('/notifications/read',         protect, authorize('alumni'), markNotificationsRead);

module.exports = router;
