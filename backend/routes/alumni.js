const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { changePassword, completeOnboarding } = require('../controllers/alumniController');

router.post('/change-password',      protect, authorize('alumni'), changePassword);
router.post('/complete-onboarding',  protect, authorize('alumni'), completeOnboarding);

module.exports = router;
