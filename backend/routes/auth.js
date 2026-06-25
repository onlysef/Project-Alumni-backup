const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/User');

router.post('/register-partner',  ctrl.registerPartner);
router.post('/login',             ctrl.login);
router.post('/verify-2fa',        ctrl.verifyTwoFactor);
router.post('/resend-2fa',        ctrl.resendTwoFactor);
router.post('/forgot-password',   ctrl.forgotPassword);
router.post('/verify-reset-otp',  ctrl.verifyResetOTP);
router.post('/reset-password',    ctrl.resetPassword);
router.post('/enable-2fa',  protect, ctrl.enableTwoFactor);
router.post('/disable-2fa', protect, ctrl.disableTwoFactor);

router.get('/settings', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('settings');
    res.json({ settings: user?.settings ?? {} });
  } catch {
    res.status(500).json({ message: 'Failed to fetch settings' });
  }
});

router.put('/settings', protect, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { settings: req.body.settings ?? {} } },
      { new: true }
    ).select('settings');
    res.json({ settings: user.settings });
  } catch {
    res.status(500).json({ message: 'Failed to save settings' });
  }
});

module.exports = router;
