const crypto = require('crypto');
const EmployerInvite = require('../models/EmployerInvite');
const User = require('../models/User');
const { sendEmployerInviteEmail } = require('../utils/emailService');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildInviteLink(token) {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  return `${clientUrl}/employer-signup?token=${token}`;
}

// POST /api/admin/employer-invites
const createEmployerInvite = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ message: 'A valid email address is required.' });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) return res.status(400).json({ message: 'This email is already registered to an account.' });

    // Superseding a still-pending invite for the same email rather than
    // stacking duplicates — only one active link per email at a time.
    await EmployerInvite.deleteMany({ email: normalizedEmail, used: false });

    const token = crypto.randomBytes(32).toString('hex');
    const invite = await EmployerInvite.create({
      email:     normalizedEmail,
      token,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdBy: req.user.id,
    });

    const link = buildInviteLink(token);
    try {
      await sendEmployerInviteEmail(normalizedEmail, link);
    } catch (emailErr) {
      console.error('createEmployerInvite email error:', emailErr);
      return res.status(201).json({
        message: 'Invite created, but the email failed to send. Copy the link below and share it manually.',
        invite, link,
      });
    }

    res.status(201).json({ message: 'Invite sent.', invite, link });
  } catch (err) {
    console.error('createEmployerInvite error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employer-invites
const getEmployerInvites = async (req, res) => {
  try {
    const invites = await EmployerInvite.find().sort({ createdAt: -1 });
    res.json({ invites });
  } catch (err) {
    console.error('getEmployerInvites error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/employer-invites/:id
const revokeEmployerInvite = async (req, res) => {
  try {
    const invite = await EmployerInvite.findById(req.params.id);
    if (!invite) return res.status(404).json({ message: 'Invite not found.' });
    if (invite.used) return res.status(400).json({ message: 'This invite has already been used and cannot be revoked.' });
    await invite.deleteOne();
    res.json({ message: 'Invite revoked.' });
  } catch (err) {
    console.error('revokeEmployerInvite error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/auth/employer-invite/:token  (public — the signup page calls this
// on load to unlock the form and prefill/lock the email field)
const validateEmployerInviteToken = async (req, res) => {
  try {
    const invite = await EmployerInvite.findOne({ token: req.params.token });
    if (!invite) return res.status(404).json({ message: 'This invite link is invalid.' });
    if (invite.used) return res.status(400).json({ message: 'This invite link has already been used.' });
    if (invite.expiresAt < new Date()) return res.status(400).json({ message: 'This invite link has expired. Please request a new one.' });
    res.json({ email: invite.email });
  } catch (err) {
    console.error('validateEmployerInviteToken error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { createEmployerInvite, getEmployerInvites, revokeEmployerInvite, validateEmployerInviteToken };
