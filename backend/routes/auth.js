const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register-partner',  ctrl.registerPartner);
router.post('/login',             ctrl.login);
router.post('/verify-2fa',        ctrl.verifyTwoFactor);
router.post('/resend-2fa',        ctrl.resendTwoFactor);
router.post('/forgot-password',   ctrl.forgotPassword);
router.post('/verify-reset-otp',  ctrl.verifyResetOTP);
router.post('/reset-password',    ctrl.resetPassword);
router.post('/enable-2fa',  protect, ctrl.enableTwoFactor);
router.post('/disable-2fa', protect, ctrl.disableTwoFactor);

module.exports = router;
