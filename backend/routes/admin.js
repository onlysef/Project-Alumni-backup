const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { createUser, getUsers, updateUser, deleteUser, importUsers, upload, resendCredentials, getNotifications, bulkUpdateStatus } = require('../controllers/adminController');
const { updateAlumniTracerData, extractSkills } = require('../controllers/alumniController');
const {
  getAnnouncements, getAnnouncement, getRecentAnnouncements,
  createAnnouncement, updateAnnouncement, deleteAnnouncement,
  toggleLike, getComments, addComment, trackShare, getRecentActivity,
  updateEventAdmin, updateJobAdmin, deleteEventAdmin, deleteJobAdmin,
} = require('../controllers/announcementController');
const {
  getPartnerships, createPartnership, updatePartnership, deletePartnership,
} = require('../controllers/partnershipController');
const {
  createEmployerInvite, getEmployerInvites, revokeEmployerInvite,
} = require('../controllers/employerInviteController');
const { getAllJobs } = require('../controllers/jobController');
const {
  getAlumniWithoutRecord, getBatchYears, createEmploymentRecord, syncTracerToEmployment, backfillEmploymentRecords,
  getDonutStats, getCourseJobStats, getSurveyStats, getEmploymentStats, getTracerAnalytics,
  getTracerFilterOptions, exportTracerAnalytics,
  getEmploymentRecords, getEmploymentRecord, updateEmploymentRecord, updateEmploymentRecordAvatar,
  getEmploymentActivity, exportEmploymentRecords, logPrintActivity,
  getTracerQuestions, createTracerQuestion, updateTracerQuestion,
  deleteTracerQuestion, reorderTracerQuestions, notifyAlumniToUpdate, getNotifyCandidates,
  getTracerResponseColleges, getTracerResponses, getTracerResponseDetail,
} = require('../controllers/employmentController');
const {
  getOfficeSettings,  updateOfficeSettings,
  getStaff,          createStaff,    updateStaff,    deleteStaff,
  getAppointments,   createAppointment,
  updateAppointmentStatus, deleteAppointment,
} = require('../controllers/appointmentController');
const {
  getTracerFormConfig, updateTracerFormConfig, importGoogleFormConfig,
} = require('../controllers/tracerFormConfigController');

// All routes below require a valid token AND admin role
router.use(protect, authorize('admin'));

router.get('/notifications', getNotifications);

router.post('/users',                        createUser);
router.post('/users/import',                 upload.single('file'), importUsers);
router.patch('/users/bulk-status',           bulkUpdateStatus);
router.get('/users',                         getUsers);
router.patch('/users/:id',                   updateUser);
router.delete('/users/:id',                  deleteUser);
router.post('/users/:id/resend-credentials', resendCredentials);

router.get('/announcements',                    getAnnouncements);
router.get('/announcements/activity',           getRecentActivity);
router.get('/announcements/recent',             getRecentAnnouncements);
router.get('/announcements/:id',               getAnnouncement);
router.post('/announcements',                   createAnnouncement);
router.patch('/announcements/:id',              updateAnnouncement);
router.delete('/announcements/:id',             deleteAnnouncement);
// Edit an Event/Job pulled into the merged feed above (see getAnnouncements'
// $unionWith) — separate admin-only endpoints, not the coordinator/employer
// ones, since those are hard-scoped to the college/account that owns the
// record (see updateEventAdmin/updateJobAdmin's own comments for why reusing
// them wasn't an option).
router.patch('/announcements/events/:id',       updateEventAdmin);
router.patch('/announcements/jobs/:id',         updateJobAdmin);
router.delete('/announcements/events/:id',      deleteEventAdmin);
router.delete('/announcements/jobs/:id',        deleteJobAdmin);
router.post('/announcements/:id/like',          toggleLike);
router.get('/announcements/:id/comments',       getComments);
router.post('/announcements/:id/comment',       addComment);
router.post('/announcements/:id/share',         trackShare);

router.get('/partnerships',        getPartnerships);
router.post('/partnerships',       createPartnership);
router.patch('/partnerships/:id',  updatePartnership);
router.delete('/partnerships/:id', deletePartnership);

router.get('/employer-invites',        getEmployerInvites);
router.post('/employer-invites',       createEmployerInvite);
router.delete('/employer-invites/:id', revokeEmployerInvite);

router.get('/jobs', getAllJobs);

// Employment records — static sub-paths before /:id
router.get('/employment/donut-stats',                getDonutStats);
router.get('/employment/course-stats',               getCourseJobStats);
router.get('/employment/survey-stats',               getSurveyStats);
router.get('/employment/stats',                      getEmploymentStats);
router.get('/employment/tracer-analytics',            getTracerAnalytics);
router.get('/employment/tracer-filter-options',      getTracerFilterOptions);
router.get('/employment/tracer-analytics/export',    exportTracerAnalytics);
router.get('/employment/activity',                   getEmploymentActivity);
router.get('/employment/export',                     exportEmploymentRecords);
router.get('/employment/alumni-without-record',      getAlumniWithoutRecord);
router.get('/employment/batch-years',                getBatchYears);
router.post('/employment/sync-tracer',               syncTracerToEmployment);
router.post('/employment/backfill',                  backfillEmploymentRecords);
router.post('/employment/log-print',                 logPrintActivity);
router.post('/employment/notify',                    notifyAlumniToUpdate);
router.get('/employment/notify-candidates',          getNotifyCandidates);
router.get('/employment/responses/colleges',         getTracerResponseColleges);
router.get('/employment/responses',                  getTracerResponses);
router.get('/employment/responses/:alumni_id',       getTracerResponseDetail);

// Tracer form config (integrated 6-page form)
router.get('/tracer-form-config',  getTracerFormConfig);
router.put('/tracer-form-config',  updateTracerFormConfig);
router.post('/tracer-form-config/import-google-form', importGoogleFormConfig);

// Tracer form — reorder before /:id
router.get('/employment/tracer-questions',            getTracerQuestions);
router.post('/employment/tracer-questions',           createTracerQuestion);
router.patch('/employment/tracer-questions/reorder',  reorderTracerQuestions);
router.patch('/employment/tracer-questions/:id',      updateTracerQuestion);
router.delete('/employment/tracer-questions/:id',     deleteTracerQuestion);

// Employment CRUD
router.get('/employment',       getEmploymentRecords);
router.post('/employment',      createEmploymentRecord);
router.get('/employment/:id',        getEmploymentRecord);
router.patch('/employment/:id',      updateEmploymentRecord);
router.patch('/employment/:id/avatar', updateEmploymentRecordAvatar);
router.patch('/employment/:id/tracer', updateAlumniTracerData);
router.post('/skills/extract',         extractSkills);

// Office settings
router.get('/appointments/settings',   getOfficeSettings);
router.patch('/appointments/settings', updateOfficeSettings);

// Staff management
router.get('/appointments/staff',          getStaff);
router.post('/appointments/staff',         createStaff);
router.patch('/appointments/staff/:id',    updateStaff);
router.delete('/appointments/staff/:id',   deleteStaff);

// Appointments
router.get('/appointments',                   getAppointments);
router.post('/appointments',                  createAppointment);
router.patch('/appointments/:id/status',      updateAppointmentStatus);
router.delete('/appointments/:id',            deleteAppointment);

module.exports = router;
