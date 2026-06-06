const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { generateOTP, sendOTPEmail } = require('../utils/emailService');

const signToken = (userId, role) =>
  jwt.sign({ id: userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, course, graduationYear } = req.body;

    if (!firstName || !lastName || !email || !password || !course || !graduationYear) {
      return res.status(400).json({ message: 'All fields are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: 'Email is already registered.' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      password: hashed,
      course,
      graduationYear: parseInt(graduationYear),
    });

    const token = signToken(user._id, user.role);
    res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        course: user.course,
        graduationYear: user.graduationYear,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ message: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid email or password.' });

    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Your account has been suspended. Please contact the administrator.' });
    }

    if (user.status === 'pending') {
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
      await user.save();

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

    const token = signToken(user._id, user.role);
    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        course: user.course,
        graduationYear: user.graduationYear,
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
    if (user.twoFactorOTP !== otp) {
      return res.status(400).json({ message: 'Invalid verification code.' });
    }
    if (user.twoFactorOTPExpiry < Date.now()) {
      return res.status(400).json({ message: 'Code has expired. Please login again.' });
    }

    user.twoFactorOTP = undefined;
    user.twoFactorOTPExpiry = undefined;
    user.twoFactorToken = undefined;
    user.twoFactorTokenExpiry = undefined;
    await user.save();

    const token = signToken(user._id, user.role);
    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        course: user.course,
        graduationYear: user.graduationYear,
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
    await user.save();

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

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetOTP: otp,
      resetOTPExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired code.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetOTP = undefined;
    user.resetOTPExpiry = undefined;
    user.resetToken = resetToken;
    user.resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
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

module.exports = {
  register,
  login,
  verifyTwoFactor,
  resendTwoFactor,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  enableTwoFactor,
  disableTwoFactor,
};
