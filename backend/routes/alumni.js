const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { changePassword, completeOnboarding, submitTracerStudy, getMyTracerResponse, getTracerFormConfig } = require('../controllers/alumniController');

router.post('/change-password',      protect, authorize('alumni'), changePassword);
router.post('/complete-onboarding',  protect, authorize('alumni'), completeOnboarding);
router.get('/tracer-study',          protect, authorize('alumni'), getMyTracerResponse);
router.post('/tracer-study',         protect, authorize('alumni'), submitTracerStudy);
router.get('/tracer-form-config',    protect, authorize('alumni'), getTracerFormConfig);

module.exports = router;
