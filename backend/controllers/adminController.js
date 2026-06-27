const crypto          = require('crypto');
const bcrypt          = require('bcryptjs');
const multer          = require('multer');
const xlsx            = require('xlsx');
const User            = require('../models/User');
const AlumniEmployment   = require('../models/AlumniEmployment');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const EmploymentActivity = require('../models/EmploymentActivity');
const Partnership        = require('../models/Partnership');
const Announcement       = require('../models/Announcement');
const Appointment        = require('../models/Appointment');
const ActivityLog        = require('../models/ActivityLog');
const AttendanceLog      = require('../models/AttendanceLog');
const EventFeedback      = require('../models/EventFeedback');
const EventInterested    = require('../models/EventInterested');
const Notification       = require('../models/Notification');
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
    const { firstName, lastName, email, role, college, course, graduationYear, track } = req.body;
    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ message: 'firstName, lastName, email, and role are required.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: 'Email is already registered.' });

    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);

    const userData = {
      firstName:  firstName.trim(),
      lastName:   lastName.trim(),
      email:      email.toLowerCase().trim(),
      password:   hashed,
      role:       role.toLowerCase(),
      status:     'pending',
      firstLogin: true,
    };
    if (role.toLowerCase() === 'coordinator') {
      if (college) userData.college = college.trim().toUpperCase();
    }
    if (role.toLowerCase() === 'alumni') {
      if (college)        userData.college        = college.trim().toUpperCase();
      if (course)         userData.course         = course.trim().toUpperCase();
      if (graduationYear) userData.graduationYear = Number(graduationYear);
      if (track && userData.course === 'BSIT') userData.track = track;
    }

    const user = await User.create(userData);

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
    const { firstName, lastName, email, role, status, college, course, graduationYear, track } = req.body;
    const updates = {};
    if (firstName      !== undefined) updates.firstName      = firstName.trim();
    if (lastName       !== undefined) updates.lastName       = lastName.trim();
    if (email          !== undefined) updates.email          = email.toLowerCase().trim();
    if (role           !== undefined) updates.role           = role;
    if (status         !== undefined) updates.status         = status;
    if (college        !== undefined) updates.college        = college ? college.trim().toUpperCase() : '';
    if (course         !== undefined) updates.course         = course ? course.trim().toUpperCase() : course;
    if (graduationYear !== undefined) updates.graduationYear = graduationYear ? Number(graduationYear) : undefined;
    if (track          !== undefined) updates.track          = (updates.course ?? course) === 'BSIT' ? (track || '') : '';

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true, select: SAFE_FIELDS }
    );
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Auto-remove employment record when role is changed away from alumni
    let employmentRemoved = false;
    if (role && role !== 'alumni') {
      const deleted = await AlumniEmployment.findOneAndDelete({ alumni_id: req.params.id });
      if (deleted) employmentRemoved = true;
    }

    res.json({
      message: employmentRemoved
        ? 'User updated. Employment record removed (role is no longer Alumni).'
        : 'User updated.',
      user,
      employmentRemoved,
    });
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

    // Cascade delete all records linked to this user
    await Promise.all([
      AlumniEmployment.deleteOne({ alumni_id: req.params.id }),
      TracerStudyResponse.deleteOne({ alumni_id: req.params.id }),
      Appointment.deleteMany({ alumni_id: req.params.id }),
      AttendanceLog.deleteMany({ alumni_id: req.params.id }),
      EventFeedback.deleteMany({ alumni_id: req.params.id }),
      EventInterested.deleteMany({ alumni_id: req.params.id }),
      ActivityLog.deleteMany({ user_id: req.params.id }),
      EmploymentActivity.deleteMany({ user_id: req.params.id }),
      Notification.deleteMany({ user_id: req.params.id }),
    ]);

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

    // ── Phase 1: parse rows synchronously ────────────────────────────────
    const parsed = [];
    for (const row of rows) {
      const firstName      = String(row.firstName || row['First Name'] || row.firstname || '').trim();
      const lastName       = String(row.lastName  || row['Last Name']  || row.lastname  || '').trim();
      const email          = String(row.email     || row['Email']      || '').trim().toLowerCase();
      const rawRole        = String(row.role      || row['Role']       || 'alumni').trim().toLowerCase();
      const college        = String(row.college   || row['College']    || '').trim();
      const course         = String(row.course    || row['Course']     || '').trim();
      const gradYearRaw    = row.graduationYear   || row['Graduation Year'] || row.GraduationYear || '';
      const graduationYear = parseInt(gradYearRaw) || undefined;

      if (!firstName || !lastName || !email) {
        failed.push({ email: email || '(blank)', reason: 'Missing firstName, lastName, or email.' });
        continue;
      }

      if (rawRole === 'alumni' && (!college || !course || !graduationYear)) {
        failed.push({ email, name: `${firstName} ${lastName}`, reason: 'Missing college, course, or graduationYear.' });
        continue;
      }

      parsed.push({
        firstName, lastName, email,
        role:          VALID_ROLES.includes(rawRole) ? rawRole : 'alumni',
        college:       college ? college.toUpperCase() : undefined,
        course:        course ? course.toUpperCase() : undefined,
        graduationYear,
        tempPassword:  generateTempPassword(),
      });
    }

    // ── Phase 2: one query for all existing emails ────────────────────────
    const existingDocs   = await User.find({ email: { $in: parsed.map(r => r.email) } }).select('email').lean();
    const existingEmails = new Set(existingDocs.map(u => u.email));

    const toInsert = [];
    for (const r of parsed) {
      if (existingEmails.has(r.email)) {
        skipped.push({ email: r.email, name: `${r.firstName} ${r.lastName}`, reason: 'Email already registered.' });
      } else {
        toInsert.push(r);
      }
    }

    if (!toInsert.length) {
      return res.status(200).json({
        message: `Import complete. 0 users imported${skipped.length ? `, ${skipped.length} skipped` : ''}${failed.length ? `, ${failed.length} failed` : ''}.`,
        created, skipped, failed,
      });
    }

    // ── Phase 3: hash all passwords in parallel ───────────────────────────
    // Cost 4: temp passwords must be changed on first login, so minimal rounds is fine
    const BATCH = 8;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      await Promise.all(toInsert.slice(i, i + BATCH).map(async r => {
        r.hashed = await bcrypt.hash(r.tempPassword, 4);
      }));
    }

    // ── Phase 4: bulk insert in one DB round-trip ─────────────────────────
    const docs = toInsert.map(r => ({
      firstName:  r.firstName,
      lastName:   r.lastName,
      email:      r.email,
      password:   r.hashed,
      role:       r.role,
      status:     'pending',
      firstLogin: true,
      ...(r.college        ? { college: r.college }               : {}),
      ...(r.course         ? { course: r.course }                : {}),
      ...(r.graduationYear ? { graduationYear: r.graduationYear } : {}),
    }));

    let insertedUsers = [];
    try {
      insertedUsers = await User.insertMany(docs, { ordered: false });
    } catch (bulkErr) {
      insertedUsers = bulkErr.insertedDocs || [];
      for (const we of (bulkErr.writeErrors || [])) {
        const r = toInsert[we.index];
        if (r) failed.push({ email: r.email, name: `${r.firstName} ${r.lastName}`, reason: we.errmsg || 'Insert failed.' });
      }
    }

    // ── Phase 5: fire all emails concurrently (non-blocking) ─────────────
    const tempPasswordMap = new Map(toInsert.map(r => [r.email, r.tempPassword]));
    for (const user of insertedUsers) {
      const tempPassword = tempPasswordMap.get(user.email);
      created.push({ email: user.email, name: `${user.firstName} ${user.lastName}`, role: user.role, emailSent: true });
      if (tempPassword) sendAccountCreatedEmail(user.email, user.firstName, tempPassword).catch(() => {});
    }

    const parts = [
      `${created.length} user${created.length !== 1 ? 's' : ''} imported`,
      ...(skipped.length > 0 ? [`${skipped.length} skipped`] : []),
      ...(failed.length > 0  ? [`${failed.length} failed`]   : []),
    ];

    res.status(200).json({
      message: `Import complete. ${parts.join(', ')}.`,
      created,
      skipped,
      failed,
    });
  } catch (err) {
    console.error('importUsers error:', err);
    if (!res.headersSent) res.status(500).json({ message: err.message || 'Server error.' });
  }
};

// POST /api/admin/users/:id/resend-credentials
const resendCredentials = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const tempPassword = crypto.randomBytes(4).toString('hex');
    user.password = await bcrypt.hash(tempPassword, 10);
    user.status   = 'pending';
    await user.save();

    await sendAccountCreatedEmail(user.email, user.firstName, tempPassword);
    res.json({ message: `Credentials resent to ${user.email}.`, status: 'Pending' });
  } catch (err) {
    console.error('resendCredentials error:', err);
    res.status(500).json({ message: 'Failed to resend credentials.' });
  }
};

const getNotifications = async (req, res) => {
  try {
    const [pendingUsers, empActivity, pendingPartners, recentAnnouncements, pendingAppointments] = await Promise.all([
      User.find({ role: 'alumni', status: 'pending' })
        .select('firstName lastName createdAt').sort({ createdAt: -1 }).limit(5).lean(),
      EmploymentActivity.find()
        .sort({ createdAt: -1 }).limit(5).lean(),
      Partnership.find({ status: 'Pending' })
        .select('name createdAt').sort({ createdAt: -1 }).limit(5).lean(),
      Announcement.find()
        .select('title createdAt').sort({ createdAt: -1 }).limit(5).lean(),
      Appointment.find({ status: 'Pending' })
        .select('alumni_name purpose createdAt').sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    const notifications = [
      ...pendingUsers.map(u => ({
        type: 'pending_user',
        title: 'New alumni registration',
        body: `${u.firstName} ${u.lastName} is waiting for account approval.`,
        createdAt: u.createdAt,
      })),
      ...empActivity.map(a => ({
        type: 'employment',
        title: 'Employment update',
        body: `${a.user_name} ${a.action}.`,
        createdAt: a.createdAt,
      })),
      ...pendingPartners.map(p => ({
        type: 'partnership',
        title: 'Partnership request',
        body: `${p.name} needs review.`,
        createdAt: p.createdAt,
      })),
      ...recentAnnouncements.map(a => ({
        type: 'announcement',
        title: 'Announcement posted',
        body: `"${a.title}" was published.`,
        createdAt: a.createdAt,
      })),
      ...pendingAppointments.map(a => ({
        type: 'appointment',
        title: 'Appointment request',
        body: `${a.alumni_name} requested an appointment${a.purpose ? ` — ${a.purpose}` : ''}.`,
        createdAt: a.createdAt,
      })),
    ];

    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ notifications: notifications.slice(0, 20) });
  } catch (err) {
    console.error('getNotifications error:', err);
    res.status(500).json({ message: 'Failed to load notifications.' });
  }
};

// PATCH /api/admin/users/bulk-status
const bulkUpdateStatus = async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ message: 'No user IDs provided.' });
    if (!['active', 'suspended'].includes(status))
      return res.status(400).json({ message: 'Invalid status.' });

    const result = await User.updateMany({ _id: { $in: ids } }, { status });
    res.json({
      message:  `${result.modifiedCount} account(s) updated.`,
      updated:  ids,
      modified: result.modifiedCount,
    });
  } catch (err) {
    console.error('bulkUpdateStatus error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { createUser, getUsers, updateUser, deleteUser, importUsers, upload, resendCredentials, getNotifications, bulkUpdateStatus };
