const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Partnership = require('../models/Partnership');
const { generateOTP, sendOTPEmail } = require('../utils/emailService');

const signToken = (userId, role, college = '', tokenVersion = 0) =>
  jwt.sign({ id: userId, role, college, tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// Wrong-guess limit shared by both OTP flows (2FA login, password reset) —
// neither had ANY attempt cap before, so a phished password (2FA) or just a
// known email address (password reset — forgot-password requires no auth
// at all) was enough to script unlimited guesses against a 6-digit code
// within its 10-15 minute validity window.
const MAX_OTP_ATTEMPTS = 5;

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid email or password.' });

    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Your account has been suspended. Please contact the administrator.' });
    }

    if (user.status === 'pending') {
      if (user.role === 'employer') {
        return res.status(403).json({ message: 'Your account is pending admin approval. Please wait before logging in.' });
      }
      user.status = 'active';
      await user.save();
    }

    // 2FA branch
    if (user.isTwoFactorEnabled) {
      const otp = generateOTP();
      const tempToken = crypto.randomBytes(32).toString('hex');

      user.twoFactorOTP = otp;
      user.twoFactorOTPExpiry = new Date(Date.now() + 10 * 60 * 1000);
      user.twoFactorToken = tempToken;
      user.twoFactorTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
      user.twoFactorOTPAttempts = 0;
      await user.save();

      console.log(`[2FA] OTP sent to ${user.email}`);
      await sendOTPEmail(
        user.email,
        'Your Two-Factor Authentication Code',
        otp,
        'login verification'
      );

      return res.json({
        twoFactorRequired: true,
        tempToken,
        message: 'A verification code has been sent to your email.',
      });
    }

    const token = signToken(user._id, user.role, user.college || '', user.tokenVersion || 0);
    res.json({
      message: 'Login successful.',
      token,
      firstLogin: user.firstLogin,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        college: user.college || '',
        course: user.course,
        graduationYear: user.graduationYear,
        tracerStudyCompleted: user.tracerStudyCompleted,
        avatarUrl: user.avatarUrl || '',
        isTwoFactorEnabled: user.isTwoFactorEnabled,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// POST /api/auth/verify-2fa
const verifyTwoFactor = async (req, res) => {
  try {
    const { tempToken, otp } = req.body;

    if (!tempToken || !otp) {
      return res.status(400).json({ message: 'Token and OTP are required.' });
    }

    const user = await User.findOne({
      twoFactorToken: tempToken,
      twoFactorTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Session expired. Please login again.' });
    }
    if (user.twoFactorOTPExpiry < Date.now()) {
      return res.status(400).json({ message: 'Code has expired. Please login again.' });
    }
    if (user.twoFactorOTPAttempts >= MAX_OTP_ATTEMPTS) {
      user.twoFactorOTP = undefined;
      user.twoFactorOTPExpiry = undefined;
      user.twoFactorToken = undefined;
      user.twoFactorTokenExpiry = undefined;
      user.twoFactorOTPAttempts = 0;
      await user.save();
      return res.status(429).json({ message: 'Too many incorrect attempts. Please login again to request a new code.' });
    }
    if (user.twoFactorOTP !== otp) {
      user.twoFactorOTPAttempts += 1;
      await user.save();
      const remaining = MAX_OTP_ATTEMPTS - user.twoFactorOTPAttempts;
      return res.status(400).json({ message: `Invalid verification code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` });
    }

    user.twoFactorOTP = undefined;
    user.twoFactorOTPExpiry = undefined;
    user.twoFactorToken = undefined;
    user.twoFactorTokenExpiry = undefined;
    user.twoFactorOTPAttempts = 0;
    await user.save();

    const token = signToken(user._id, user.role, user.college || '', user.tokenVersion || 0);
    res.json({
      message: 'Login successful.',
      token,
      firstLogin: user.firstLogin,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        college: user.college || '',
        course: user.course,
        graduationYear: user.graduationYear,
        tracerStudyCompleted: user.tracerStudyCompleted,
        avatarUrl: user.avatarUrl || '',
        isTwoFactorEnabled: user.isTwoFactorEnabled,
      },
    });
  } catch (err) {
    console.error('Verify 2FA error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// POST /api/auth/resend-2fa
const resendTwoFactor = async (req, res) => {
  try {
    const { tempToken } = req.body;

    const user = await User.findOne({
      twoFactorToken: tempToken,
      twoFactorTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Session expired. Please login again.' });
    }

    const otp = generateOTP();
    user.twoFactorOTP = otp;
    user.twoFactorOTPExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.twoFactorOTPAttempts = 0;
    await user.save();

    console.log(`[2FA resend] OTP sent to ${user.email}`);
    await sendOTPEmail(
      user.email,
      'Your Two-Factor Authentication Code',
      otp,
      'login verification'
    );

    res.json({ message: 'A new code has been sent to your email.' });
  } catch (err) {
    console.error('Resend 2FA error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required.' });

    const user = await User.findOne({ email: email.toLowerCase() });
    // Always return OK to prevent email enumeration
    if (!user) {
      return res.json({ message: 'If that email is registered, a reset code has been sent.' });
    }

    const otp = generateOTP();
    user.resetOTP = otp;
    user.resetOTPExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.resetOTPAttempts = 0;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    await sendOTPEmail(user.email, 'Your Password Reset Code', otp, 'password reset');

    res.json({ message: 'If that email is registered, a reset code has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// POST /api/auth/verify-reset-otp
const verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and code are required.' });
    }

    // Matching on email + unexpired resetOTP-existing (not the OTP value
    // itself) so a wrong guess still resolves to the actual user record —
    // needed to increment/check ITS attempt counter. The old query matched
    // email+resetOTP+expiry all at once, so a wrong guess just came back as
    // "no user found" with nothing to rate-limit against.
    const user = await User.findOne({
      email: email.toLowerCase(),
      resetOTP: { $exists: true, $ne: null },
      resetOTPExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired code.' });
    }
    if (user.resetOTPAttempts >= MAX_OTP_ATTEMPTS) {
      user.resetOTP = undefined;
      user.resetOTPExpiry = undefined;
      user.resetOTPAttempts = 0;
      await user.save();
      return res.status(429).json({ message: 'Too many incorrect attempts. Please request a new reset code.' });
    }
    if (user.resetOTP !== otp) {
      user.resetOTPAttempts += 1;
      await user.save();
      const remaining = MAX_OTP_ATTEMPTS - user.resetOTPAttempts;
      return res.status(400).json({ message: `Invalid or expired code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetOTP = undefined;
    user.resetOTPExpiry = undefined;
    user.resetToken = resetToken;
    user.resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
    user.resetOTPAttempts = 0;
    await user.save();

    res.json({ message: 'Code verified.', resetToken });
  } catch (err) {
    console.error('Verify reset OTP error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      return res.status(400).json({ message: 'Token and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const user = await User.findOne({
      resetToken,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Reset session expired. Please start over.' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    // Invalidate any session issued before this reset — a forgotten-password
    // reset is often used specifically to lock out someone else who has the
    // old password, so the old session has to stop working immediately.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.json({ message: 'Password reset successfully.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// POST /api/auth/enable-2fa  (requires auth token)
const enableTwoFactor = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { isTwoFactorEnabled: true });
    res.json({ message: 'Two-factor authentication enabled.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/auth/disable-2fa  (requires auth token)
const disableTwoFactor = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { isTwoFactorEnabled: false });
    res.json({ message: 'Two-factor authentication disabled.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/auth/register-partner
const registerPartner = async (req, res) => {
  try {
    const { firstName, lastName, company, partnerType, email, password } = req.body;

    if (!firstName || !lastName || !company || !partnerType || !email || !password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).json({ message: 'Email is already registered.' });

    const partnership = await Partnership.create({
      name:    company.trim(),
      type:    partnerType,
      contact: email.toLowerCase().trim(),
      status:  'Pending',
    });

    const hashed = await bcrypt.hash(password, 10);
    await User.create({
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.toLowerCase().trim(),
      password:  hashed,
      role:      'employer',
      status:    'pending',
      firstLogin: false,
      company:   company.trim(),
      partnershipId: partnership._id,
    });

    res.status(201).json({ message: 'Registration submitted. Please wait for admin approval before logging in.' });
  } catch (err) {
    console.error('registerPartner error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  login,
  verifyTwoFactor,
  resendTwoFactor,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  enableTwoFactor,
  disableTwoFactor,
  registerPartner,
};
