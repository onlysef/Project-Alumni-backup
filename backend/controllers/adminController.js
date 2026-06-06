const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');
const User = require('../models/User');
const { sendAccountCreatedEmail } = require('../utils/emailService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_, file, cb) {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls, or .csv files are allowed.'), ok);
  },
});

const SAFE_FIELDS = '-password -twoFactorOTP -twoFactorOTPExpiry -twoFactorToken -twoFactorTokenExpiry -resetOTP -resetOTPExpiry -resetToken -resetTokenExpiry';

function generateTempPassword() {
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower   = 'abcdefghijklmnopqrstuvwxyz';
  const digits  = '0123456789';
  const symbols = '!@#$%^&*';
  const chars = [
    upper[crypto.randomInt(upper.length)],
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    lower[crypto.randomInt(lower.length)],
    lower[crypto.randomInt(lower.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    digits[crypto.randomInt(digits.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
    symbols[crypto.randomInt(symbols.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// POST /api/admin/users
const createUser = async (req, res) => {
  try {
    const { firstName, lastName, email, role } = req.body;
    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ message: 'firstName, lastName, email, and role are required.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: 'Email is already registered.' });

    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 12);

    const user = await User.create({
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.toLowerCase().trim(),
      password:  hashed,
      role:      role.toLowerCase(),
      status:    'pending',
    });

    let emailSent = true;
    try {
      await sendAccountCreatedEmail(user.email, user.firstName, tempPassword);
    } catch (emailErr) {
      console.error('createUser email error:', emailErr);
      emailSent = false;
    }

    const safe = await User.findById(user._id).select(SAFE_FIELDS);
    res.status(201).json({
      message: emailSent
        ? 'Account created. Login credentials sent to email.'
        : 'Account created. Could not send email — check email config.',
      user: safe,
    });
  } catch (err) {
    console.error('createUser error:', err);
    if (!res.headersSent) res.status(500).json({ message: err.message || 'Server error.' });
  }
};

// GET /api/admin/users
const getUsers = async (req, res) => {
  try {
    const users = await User.find({}, SAFE_FIELDS).sort({ createdAt: -1 });
    res.json({ users });
  } catch (err) {
    console.error('getUsers error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/users/:id
const updateUser = async (req, res) => {
  try {
    const { firstName, lastName, email, role, status } = req.body;
    const updates = {};
    if (firstName !== undefined) updates.firstName = firstName.trim();
    if (lastName  !== undefined) updates.lastName  = lastName.trim();
    if (email     !== undefined) updates.email     = email.toLowerCase().trim();
    if (role      !== undefined) updates.role      = role;
    if (status    !== undefined) updates.status    = status;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true, select: SAFE_FIELDS }
    );
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User updated.', user });
  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/users/:id
const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    console.error('deleteUser error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/users/import
const importUsers = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) return res.status(400).json({ message: 'Spreadsheet is empty.' });

    const created = [];
    const skipped = [];
    const failed  = [];

    const VALID_ROLES = ['admin', 'alumni', 'coordinator', 'employer'];

    for (const row of rows) {
      const firstName      = String(row.firstName      || row['First Name']      || row.firstname      || '').trim();
      const lastName       = String(row.lastName       || row['Last Name']       || row.lastname       || '').trim();
      const email          = String(row.email          || row['Email']           || '').trim().toLowerCase();
      const rawRole        = String(row.role           || row['Role']            || 'alumni').trim().toLowerCase();
      const course         = String(row.course         || row['Course']          || '').trim();
      const gradYearRaw    = row.graduationYear || row['Graduation Year'] || row.GraduationYear || '';
      const graduationYear = parseInt(gradYearRaw) || undefined;

      if (!firstName || !lastName || !email) {
        failed.push({ email: email || '(blank)', reason: 'Missing firstName, lastName, or email.' });
        continue;
      }

      const role = VALID_ROLES.includes(rawRole) ? rawRole : 'alumni';

      try {
        const existing = await User.findOne({ email });
        if (existing) {
          skipped.push({ email, name: `${firstName} ${lastName}`, reason: 'Email already registered.' });
          continue;
        }

        const tempPassword = generateTempPassword();
        const hashed       = await bcrypt.hash(tempPassword, 12);

        const userData = { firstName, lastName, email, password: hashed, role, status: 'pending' };
        if (course)         userData.course         = course;
        if (graduationYear) userData.graduationYear = graduationYear;

        const user = await User.create(userData);

        let emailSent = true;
        try {
          await sendAccountCreatedEmail(user.email, user.firstName, tempPassword);
        } catch {
          emailSent = false;
        }

        created.push({ email, name: `${firstName} ${lastName}`, emailSent });
      } catch (err) {
        failed.push({ email, name: `${firstName} ${lastName}`, reason: err.message });
      }
    }

    res.status(200).json({
      message: `Import complete. ${created.length} created, ${skipped.length} skipped, ${failed.length} failed.`,
      created,
      skipped,
      failed,
    });
  } catch (err) {
    console.error('importUsers error:', err);
    if (!res.headersSent) res.status(500).json({ message: err.message || 'Server error.' });
  }
};

module.exports = { createUser, getUsers, updateUser, deleteUser, importUsers, upload };
