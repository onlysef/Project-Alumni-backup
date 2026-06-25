const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { createUser, getUsers, updateUser, deleteUser, importUsers, upload, resendCredentials, getNotifications } = require('../controllers/adminController');
const {
  getAnnouncements, getAnnouncement, getRecentAnnouncements,
  createAnnouncement, updateAnnouncement, deleteAnnouncement,
  toggleLike, getComments, addComment, trackShare, getRecentActivity,
} = require('../controllers/announcementController');
const {
  getPartnerships, createPartnership, updatePartnership, deletePartnership,
} = require('../controllers/partnershipController');
const { getAllJobs } = require('../controllers/jobController');
const {
  getAlumniWithoutRecord, createEmploymentRecord, syncTracerToEmployment, backfillEmploymentRecords,
  getCourseJobStats, getDonutStats, getSurveyStats, getEmploymentStats,
  getEmploymentRecords, getEmploymentRecord, updateEmploymentRecord,
  getEmploymentActivity, exportEmploymentRecords, logPrintActivity,
  getTracerQuestions, createTracerQuestion, updateTracerQuestion,
  deleteTracerQuestion, reorderTracerQuestions,
} = require('../controllers/employmentController');
const {
  getOfficeSettings,  updateOfficeSettings,
  getStaff,          createStaff,    updateStaff,    deleteStaff,
  getAppointments,   createAppointment,
  updateAppointmentStatus, deleteAppointment,
} = require('../controllers/appointmentController');
const {
  getTracerFormConfig, updateTracerFormConfig,
} = require('../controllers/tracerFormConfigController');

// All routes below require a valid token AND admin role
router.use(protect, authorize('admin'));

router.get('/notifications', getNotifications);

router.post('/users',                      createUser);
router.post('/users/import',               upload.single('file'), importUsers);
router.get('/users',                       getUsers);
router.patch('/users/:id',                 updateUser);
router.delete('/users/:id',               deleteUser);
router.post('/users/:id/resend-credentials', resendCredentials);

router.get('/announcements',                    getAnnouncements);
router.get('/announcements/activity',           getRecentActivity);
router.get('/announcements/recent',             getRecentAnnouncements);
router.get('/announcements/:id',               getAnnouncement);
router.post('/announcements',                   createAnnouncement);
router.patch('/announcements/:id',              updateAnnouncement);
router.delete('/announcements/:id',             deleteAnnouncement);
router.post('/announcements/:id/like',          toggleLike);
router.get('/announcements/:id/comments',       getComments);
router.post('/announcements/:id/comment',       addComment);
router.post('/announcements/:id/share',         trackShare);

router.get('/partnerships',        getPartnerships);
router.post('/partnerships',       createPartnership);
router.patch('/partnerships/:id',  updatePartnership);
router.delete('/partnerships/:id', deletePartnership);

router.get('/jobs', getAllJobs);

// Employment records — static sub-paths before /:id
router.get('/employment/course-stats',               getCourseJobStats);
router.get('/employment/donut-stats',                getDonutStats);
router.get('/employment/survey-stats',               getSurveyStats);
router.get('/employment/stats',                      getEmploymentStats);
router.get('/employment/activity',                   getEmploymentActivity);
router.get('/employment/export',                     exportEmploymentRecords);
router.get('/employment/alumni-without-record',      getAlumniWithoutRecord);
router.post('/employment/sync-tracer',               syncTracerToEmployment);
router.post('/employment/backfill',                  backfillEmploymentRecords);
router.post('/employment/log-print',                 logPrintActivity);

// Tracer form config (integrated 6-page form)
router.get('/tracer-form-config',  getTracerFormConfig);
router.put('/tracer-form-config',  updateTracerFormConfig);

// Tracer form — reorder before /:id
router.get('/employment/tracer-questions',            getTracerQuestions);
router.post('/employment/tracer-questions',           createTracerQuestion);
router.patch('/employment/tracer-questions/reorder',  reorderTracerQuestions);
router.patch('/employment/tracer-questions/:id',      updateTracerQuestion);
router.delete('/employment/tracer-questions/:id',     deleteTracerQuestion);

// Employment CRUD
router.get('/employment',       getEmploymentRecords);
router.post('/employment',      createEmploymentRecord);
router.get('/employment/:id',   getEmploymentRecord);
router.patch('/employment/:id', updateEmploymentRecord);

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
