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
const Graduate           = require('../models/Graduate');
const EmbeddingDocument  = require('../models/EmbeddingDocument');
const SavedJob           = require('../models/SavedJob');
const JobApplication     = require('../models/JobApplication');
const JobAlertSeen       = require('../models/JobAlertSeen');
const Resume             = require('../models/Resume');
const Interview          = require('../models/Interview');
const ImportedFile       = require('../models/ImportedFile');
const Job                = require('../models/Job');
const { sendAccountCreatedEmail } = require('../utils/emailService');
const { matchesFileSignature } = require('../utils/fileSignature');

// Same pattern as the schema-level match validator on User.email — checked
// here too so a malformed address in a single-account create or a bulk
// import row gets a clean 400/skip instead of surfacing as a raw Mongoose
// ValidationError.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const { firstName, middleInitial, lastName, email, role, college, course, graduationYear, track } = req.body;
    if (!firstName || !lastName || !email || !role) {
      return res.status(400).json({ message: 'firstName, lastName, email, and role are required.' });
    }
    if (!EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    // College is the basis for every college-scoping check in the system
    // (coordinator data access, alumni tracer form, employment records) — an
    // alumni or coordinator created without one falls through those checks
    // unpredictably (e.g. defaults to CCS, or matches nothing).
    if (['alumni', 'coordinator'].includes(role.toLowerCase()) && !college) {
      return res.status(400).json({ message: 'College is required for Alumni and Coordinator accounts.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: 'Email is already registered.' });

    const tempPassword = generateTempPassword();
    const hashed = await bcrypt.hash(tempPassword, 10);

    const userData = {
      firstName:     firstName.trim(),
      middleInitial: middleInitial ? middleInitial.trim() : '',
      lastName:      lastName.trim(),
      email:      email.toLowerCase().trim(),
      password:   hashed,
      role:       role.toLowerCase(),
      // Stays 'pending' even though the admin created it directly — the
      // account still needs the alumni themselves to open it, activate it,
      // and set their own password on first login. 'active' would skip that
      // required first-login step entirely.
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
    const { firstName, middleInitial, lastName, email, role, status, college, course, graduationYear, track, partnershipId } = req.body;

    const existing = await User.findById(req.params.id, 'role college status tokenVersion');
    if (!existing) return res.status(404).json({ message: 'User not found.' });

    const updates = {};
    if (firstName      !== undefined) updates.firstName      = firstName.trim();
    if (middleInitial  !== undefined) updates.middleInitial  = middleInitial.trim();
    if (lastName       !== undefined) updates.lastName       = lastName.trim();
    if (email          !== undefined) updates.email          = email.toLowerCase().trim();
    if (role           !== undefined) updates.role           = role;
    if (status         !== undefined) updates.status         = status;
    if (college        !== undefined) updates.college        = college ? college.trim().toUpperCase() : '';
    if (course         !== undefined) updates.course         = course ? course.trim().toUpperCase() : course;
    if (graduationYear !== undefined) updates.graduationYear = graduationYear ? Number(graduationYear) : undefined;
    if (track          !== undefined) updates.track          = (updates.course ?? course) === 'BSIT' ? (track || '') : '';
    // Links an employer account to the partner company it's allowed to post
    // jobs under — job creation is blocked until this is set. '' unlinks.
    if (partnershipId  !== undefined) updates.partnershipId  = partnershipId || null;

    // Same rule createUser enforces, applied here too — college is the basis
    // for every college-scoping check in the system, so an edit that leaves
    // (or turns) an alumni/coordinator account without one falls through
    // those checks unpredictably, same as at creation time.
    const finalRole    = updates.role    !== undefined ? updates.role    : existing.role;
    const finalCollege = updates.college !== undefined ? updates.college : existing.college;
    if (['alumni', 'coordinator'].includes(finalRole) && !finalCollege) {
      return res.status(400).json({ message: 'College is required for Alumni and Coordinator accounts.' });
    }

    // A JWT already issued to this user carries the role/college/status
    // baked in at login time and is otherwise trusted for its full life —
    // suspending the account, changing its role, or moving it to a
    // different college must invalidate that token immediately instead of
    // leaving it valid (with the OLD permissions) until it naturally
    // expires (up to 7 days).
    const revokesSession =
      (updates.status !== undefined && updates.status === 'suspended') ||
      (updates.role !== undefined && updates.role !== existing.role) ||
      (updates.college !== undefined && updates.college !== existing.college);
    if (revokesSession) updates.tokenVersion = (existing.tokenVersion || 0) + 1;

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

    // Cascade delete all records linked to this user.
    // allSettled so one failing delete never blocks the rest.
    // Graduate (the AC AI Assistant's stats/RAG source) has no alumni_id —
    // submitTracerStudy() upserts it by email instead — so it's matched the
    // same way here. Its live-submission RAG chunk is tagged with the
    // Graduate _id, so that has to be looked up before it can be removed.
    const cascadeResults = await Promise.allSettled([
      AlumniEmployment.deleteOne({ alumni_id: req.params.id }),
      TracerStudyResponse.deleteOne({ alumni_id: req.params.id }),
      Appointment.deleteMany({ alumni_id: req.params.id }),
      AttendanceLog.deleteMany({ alumni_id: req.params.id }),
      EventFeedback.deleteMany({ alumni_id: req.params.id }),
      EventInterested.deleteMany({ alumni_id: req.params.id }),
      ActivityLog.deleteMany({ user_id: req.params.id }),
      EmploymentActivity.deleteMany({ user_id: req.params.id }),
      Notification.deleteMany({ user_id: req.params.id }),
      SavedJob.deleteMany({ alumni_id: req.params.id }),
      JobApplication.deleteMany({ alumni_id: req.params.id }),
      JobAlertSeen.deleteMany({ alumni_id: req.params.id }),
      Resume.deleteOne({ alumni_id: req.params.id }),
      Interview.deleteMany({ $or: [{ alumni_id: req.params.id }, { employer_id: req.params.id }] }),
      // Deleting an employer account used to leave their open Job postings
      // behind forever — still listed to alumni, still counted in the
      // partnership's job-opportunity stats, still acceptable applications,
      // with no employer left to manage or respond to any of it. Closing
      // (not deleting) them matches jobController.deleteJob's own policy of
      // never hard-deleting a posting that already has real applications —
      // an alumnus's application history has to keep pointing at something.
      Job.updateMany({ postedBy: req.params.id, status: 'open' }, { status: 'closed' }),
      (async () => {
        if (!user.email) return;
        // Prefer the indexed user_id FK (set whenever a live tracer/employment
        // action touched this record); Graduate.email isn't schema-normalized
        // to lowercase (bulk-imported rows keep the source spreadsheet's
        // original casing), so an exact match there would still silently miss
        // records — kept as a fallback for rows that predate user_id.
        const graduate = await Graduate.findOneAndDelete({
          $or: [
            { user_id: req.params.id },
            { $expr: { $eq: [{ $toLower: { $ifNull: ['$email', ''] } }, user.email.toLowerCase().trim()] } },
          ],
        });
        if (graduate) {
          await EmbeddingDocument.deleteMany({ source_type: 'imported_file', 'metadata.graduate_id': String(graduate._id) });
        }
      })(),
    ]);
    cascadeResults.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`deleteUser cascade[${i}] error:`, r.reason);
    });

    res.json({ message: 'User deleted.' });
  } catch (err) {
    console.error('deleteUser error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/users/import
const importUsers = async (req, res) => {
  let importedFile = null;
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    if (!matchesFileSignature(req.file.buffer, ext)) {
      return res.status(400).json({ message: `File content doesn't match a .${ext} file.` });
    }

    // Bulk account imports had no file-level audit trail at all — only the
    // per-row email-uniqueness check, with no record of who imported what
    // file or when. Same tracking record the AI document-ingestion pipeline
    // already uses for this.
    const contentHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    importedFile = await ImportedFile.create({
      file_name:    req.file.originalname,
      file_type:    ext === 'csv' ? 'csv' : 'excel',
      content_hash: contentHash,
      status:       'processing',
      imported_by:  req.user.id,
    });

    let workbook, sheet, rows;
    try {
      workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      sheet    = workbook.Sheets[workbook.SheetNames[0]];
      rows     = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    } catch (parseErr) {
      await ImportedFile.updateOne({ _id: importedFile._id }, { status: 'failed', error_message: parseErr.message });
      return res.status(400).json({ message: 'Could not read that spreadsheet. It may be corrupted.' });
    }

    if (!rows.length) {
      await ImportedFile.updateOne({ _id: importedFile._id }, { status: 'failed', error_message: 'Spreadsheet is empty.' });
      return res.status(400).json({ message: 'Spreadsheet is empty.' });
    }

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
      if (!EMAIL_RE.test(email)) {
        failed.push({ email, name: `${firstName} ${lastName}`, reason: 'Invalid email format.' });
        continue;
      }

      if (rawRole === 'alumni' && (!college || !course || !graduationYear)) {
        failed.push({ email, name: `${firstName} ${lastName}`, reason: 'Missing college, course, or graduationYear.' });
        continue;
      }
      if (rawRole === 'coordinator' && !college) {
        failed.push({ email, name: `${firstName} ${lastName}`, reason: 'Missing college.' });
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
      await ImportedFile.updateOne(
        { _id: importedFile._id },
        { status: 'done', ingested_at: new Date(), raw_row_count: rows.length, chunk_count: 0 }
      );
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
      // Same reasoning as createUser() above — stays 'pending' so each
      // imported alumnus still has to open their account and set their own
      // password on first login.
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

    await ImportedFile.updateOne(
      { _id: importedFile._id },
      { status: 'done', ingested_at: new Date(), raw_row_count: rows.length, chunk_count: created.length }
    );

    res.status(200).json({
      message: `Import complete. ${parts.join(', ')}.`,
      created,
      skipped,
      failed,
    });
  } catch (err) {
    console.error('importUsers error:', err);
    if (importedFile) {
      await ImportedFile.updateOne({ _id: importedFile._id }, { status: 'failed', error_message: err.message }).catch(() => {});
    }
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
    // The old password (and any session logged in under it) must stop
    // working the moment a new temp password is issued.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
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

    // Resolve which of the requested IDs actually still exist BEFORE
    // updating — updateMany's counts alone can't tell the caller WHICH
    // specific IDs succeeded, and the previous version just echoed back the
    // full input array as "updated" regardless of whether every ID was
    // actually matched. A user deleted by someone else between selection
    // and submission used to still show as successfully updated in the UI.
    const existingIds = (await User.find({ _id: { $in: ids } }, '_id').lean()).map(u => String(u._id));

    // A JWT already issued to a suspended user is otherwise trusted until
    // it naturally expires (see updateUser's tokenVersion comment above) —
    // bulk-suspend has to close that same gap.
    const update = status === 'suspended'
      ? { $set: { status }, $inc: { tokenVersion: 1 } }
      : { $set: { status } };
    const result = await User.updateMany({ _id: { $in: existingIds } }, update);

    res.json({
      message:  `${existingIds.length} of ${ids.length} account(s) updated.`,
      updated:  existingIds,
      modified: result.modifiedCount,
    });
  } catch (err) {
    console.error('bulkUpdateStatus error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { createUser, getUsers, updateUser, deleteUser, importUsers, upload, resendCredentials, getNotifications, bulkUpdateStatus };
