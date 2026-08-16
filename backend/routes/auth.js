const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const ctrl     = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const { loginLimiter, otpLimiter } = require('../middleware/rateLimit');
const User     = require('../models/User');

router.post('/register-partner',  ctrl.registerPartner);
router.post('/login',             loginLimiter, ctrl.login);
router.post('/verify-2fa',        otpLimiter, ctrl.verifyTwoFactor);
router.post('/resend-2fa',        otpLimiter, ctrl.resendTwoFactor);
router.post('/forgot-password',   otpLimiter, ctrl.forgotPassword);
router.post('/verify-reset-otp',  otpLimiter, ctrl.verifyResetOTP);
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

// POST /api/auth/change-password  — works for admin, coordinator, alumni
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'All fields are required.' });
    if (newPassword.length < 8)
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });

    const user = await User.findById(req.user.id).select('password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ message: 'Current password is incorrect.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.user.id, { password: hashed });
    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
