const crypto          = require('crypto');
const bcrypt          = require('bcryptjs');
const multer          = require('multer');
const xlsx            = require('xlsx');
const User            = require('../models/User');
const AlumniEmployment   = require('../models/AlumniEmployment');
const EmploymentActivity = require('../models/EmploymentActivity');
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
    const { firstName, lastName, email, role, course, graduationYear } = req.body;
    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ message: 'firstName, lastName, email, and role are required.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: 'Email is already registered.' });

    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 12);

    const userData = {
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      email:     email.toLowerCase().trim(),
      password:  hashed,
      role:      role.toLowerCase(),
      status:    'pending',
    };
    if (course         && role.toLowerCase() === 'alumni') userData.course         = course.trim().toUpperCase();
    if (graduationYear && role.toLowerCase() === 'alumni') userData.graduationYear = Number(graduationYear);

    const user = await User.create(userData);

    // Auto-create employment record for alumni
    if (role.toLowerCase() === 'alumni') {
      AlumniEmployment.create({
        alumni_id:             user._id,
        employment_status:     'Not Yet Updated',
        company_name:          'N/A',
        job_title:             null,
        industry:              null,
        work_location:         null,
        salary_range:          '',
        job_related_to_course: null,
        date_employed:         null,
        reason_unemployed:     null,
        last_updated:          new Date(),
      }).catch(() => {});
    }

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
    const { firstName, lastName, email, role, status, course, graduationYear } = req.body;
    const updates = {};
    if (firstName      !== undefined) updates.firstName      = firstName.trim();
    if (lastName       !== undefined) updates.lastName       = lastName.trim();
    if (email          !== undefined) updates.email          = email.toLowerCase().trim();
    if (role           !== undefined) updates.role           = role;
    if (status         !== undefined) updates.status         = status;
    if (course         !== undefined) updates.course         = course ? course.trim().toUpperCase() : course;
    if (graduationYear !== undefined) updates.graduationYear = graduationYear ? Number(graduationYear) : undefined;

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

    const created             = [];
    const skipped             = [];
    const failed              = [];
    let   employmentCreated   = 0;
    let   employmentSkipped   = 0;

    const adminName = req.user
      ? (await User.findById(req.user.id).select('firstName lastName').then(u => u ? `${u.firstName} ${u.lastName}` : 'Admin').catch(() => 'Admin'))
      : 'Admin';

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

      let user = null;
      try {
        const existing = await User.findOne({ email });
        if (existing) {
          skipped.push({ email, name: `${firstName} ${lastName}`, reason: 'Email already registered.' });
          continue;
        }

        const tempPassword = generateTempPassword();
        const hashed       = await bcrypt.hash(tempPassword, 12);

        const userData = { firstName, lastName, email, password: hashed, role, status: 'pending' };
        if (course)         userData.course         = course.toUpperCase();
        if (graduationYear) userData.graduationYear = graduationYear;

        user = await User.create(userData);

        // ── Auto-create employment record for alumni ──────────────────────────
        if (role === 'alumni') {
          const empExists = await AlumniEmployment.exists({ alumni_id: user._id });
          if (empExists) {
            employmentSkipped++;
          } else {
            try {
              await AlumniEmployment.create({
                alumni_id:             user._id,
                employment_status:     'Not Yet Updated',
                company_name:          'N/A',
                job_title:             null,
                industry:              null,
                work_location:         null,
                salary_range:          '',
                job_related_to_course: null,
                date_employed:         null,
                reason_unemployed:     null,
                last_updated:          new Date(),
              });
              employmentCreated++;

              // Log activity (fire-and-forget)
              EmploymentActivity.create({
                user_id:     req.user?.id || null,
                user_name:   adminName,
                action:      'added to employment details',
                target_name: `${firstName} ${lastName}`,
                details:     'auto-created from user import',
              }).catch(() => {});
            } catch (empErr) {
              if (empErr.code === 11000) {
                // Duplicate key — already exists, just skip
                employmentSkipped++;
              } else {
                // Employment creation failed — rollback user to keep data consistent
                await User.findByIdAndDelete(user._id).catch(() => {});
                failed.push({
                  email,
                  name: `${firstName} ${lastName}`,
                  reason: `User created but employment record failed: ${empErr.message}. User has been removed.`,
                });
                continue;
              }
            }
          }
        }

        let emailSent = true;
        try {
          await sendAccountCreatedEmail(user.email, user.firstName, tempPassword);
        } catch {
          emailSent = false;
        }

        created.push({
          email,
          name:      `${firstName} ${lastName}`,
          role,
          emailSent,
          employmentCreated: role === 'alumni',
        });
      } catch (err) {
        // If user was created before the error, remove it
        if (user?._id) {
          await User.findByIdAndDelete(user._id).catch(() => {});
        }
        failed.push({ email, name: `${firstName} ${lastName}`, reason: err.message });
      }
    }

    const parts = [
      `${created.length} user${created.length !== 1 ? 's' : ''} imported`,
      ...(employmentCreated > 0   ? [`${employmentCreated} employment record${employmentCreated !== 1 ? 's' : ''} created`]  : []),
      ...(employmentSkipped > 0   ? [`${employmentSkipped} employment record${employmentSkipped !== 1 ? 's' : ''} skipped (already existed)`] : []),
      ...(skipped.length > 0      ? [`${skipped.length} skipped`]   : []),
      ...(failed.length > 0       ? [`${failed.length} failed`]     : []),
    ];

    res.status(200).json({
      message: `Import complete. ${parts.join(', ')}.`,
      created,
      skipped,
      failed,
      employmentCreated,
      employmentSkipped,
    });
  } catch (err) {
    console.error('importUsers error:', err);
    if (!res.headersSent) res.status(500).json({ message: err.message || 'Server error.' });
  }
};

module.exports = { createUser, getUsers, updateUser, deleteUser, importUsers, upload };
