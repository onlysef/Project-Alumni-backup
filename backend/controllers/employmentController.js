const { Types }           = require('mongoose');
const AlumniEmployment    = require('../models/AlumniEmployment');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const TracerFormConfig    = require('../models/TracerFormConfig');
const TracerFormQuestion  = require('../models/TracerFormQuestion');
const EmploymentActivity  = require('../models/EmploymentActivity');
const User                = require('../models/User');
const XLSX                = require('xlsx');

// Maps programsCompleted → User.course code
function mapProgramToCourse(programsCompleted) {
  if (!Array.isArray(programsCompleted) || !programsCompleted.length) return '';
  const combined = programsCompleted.join(' ').toLowerCase();
  if (combined.includes('information technology')) return 'BSIT';
  if (combined.includes('computer science'))       return 'BSCS';
  if (combined.includes('information systems'))    return 'BSIS';
  if (combined.includes('information management')) return 'BSIM';
  return '';
}

// Resolves company_name, work_location, and graduation_year from extra_answers by label matching
async function resolveExtraFromTracer(extraAnswers, college = 'CCS') {
  try {
    let cfg = await TracerFormConfig.findOne({ college }).lean();
    if (!cfg) cfg = await TracerFormConfig.findOne({ college: 'CCS' }).lean();
    if (!cfg?.config?.pages) return {};
    const result = {};
    for (const page of cfg.config.pages) {
      for (const q of (page.questions || [])) {
        if (!Object.prototype.hasOwnProperty.call(extraAnswers, q.id)) continue;
        const val = extraAnswers[q.id];
        if (!val) continue;
        const label = (q.label || '').toLowerCase();
        if (!result.company_name && (label.includes('company') || label.includes('employer'))) {
          result.company_name = String(val).trim();
        }
        if (!result.work_location && label.includes('work location')) {
          result.work_location = String(val).trim();
        }
        if (!result.graduation_year && (label.includes('graduation year') || label.includes('batch year'))) {
          const yr = parseInt(String(val).trim(), 10);
          if (!isNaN(yr)) result.graduation_year = yr;
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function logActivity(userId, userName, action, targetName = '', details = '') {
  EmploymentActivity.create({
    user_id:     userId,
    user_name:   userName,
    action,
    target_name: targetName,
    details,
  }).catch(() => {});
}

async function resolveAdminName(userId) {
  try {
    const u = await User.findById(userId).select('firstName lastName');
    return u ? `${u.firstName} ${u.lastName}` : 'Admin';
  } catch {
    return 'Admin';
  }
}

function buildBasePipeline({ search, status, college, course, batch_year, date_updated, company }) {
  const empMatch = {};
  if (status) empMatch.employment_status = status;
  if (company) empMatch.company_name = { $regex: company, $options: 'i' };
  if (date_updated) {
    const start = new Date(date_updated);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date_updated);
    end.setHours(23, 59, 59, 999);
    empMatch.last_updated = { $gte: start, $lte: end };
  }

  const pipeline = [
    { $match: empMatch },
    {
      $lookup: {
        from:         'users',
        localField:   'alumni_id',
        foreignField: '_id',
        as:           'alumni',
      },
    },
    { $unwind: { path: '$alumni', preserveNullAndEmptyArrays: false } },
    { $match: { 'alumni.role': 'alumni' } },
  ];

  const andFilters = [];
  if (search) {
    andFilters.push({
      $or: [
        {
          $expr: {
            $regexMatch: {
              input:   { $concat: ['$alumni.firstName', ' ', '$alumni.lastName'] },
              regex:   search,
              options: 'i',
            },
          },
        },
        { company_name: { $regex: search, $options: 'i' } },
      ],
    });
  }
  if (college)     andFilters.push({ 'alumni.college':        college });
  if (course)      andFilters.push({ 'alumni.course':        course });
  if (batch_year)  andFilters.push({ 'alumni.graduationYear': parseInt(batch_year, 10) });

  if (andFilters.length) pipeline.push({ $match: { $and: andFilters } });

  return pipeline;
}

const listProjection = {
  $project: {
    _id:                   1,
    alumni_id:             1,
    name:                  { $concat: ['$alumni.firstName', ' ', '$alumni.lastName'] },
    college:               '$alumni.college',
    course:                '$alumni.course',
    graduation_year:       '$alumni.graduationYear',
    employment_status:     1,
    company_name:          1,
    job_title:             1,
    industry:              1,
    work_location:         1,
    salary_range:          1,
    job_related_to_course: 1,
    date_employed:         1,
    reason_unemployed:     1,
    last_updated:          1,
  },
};

// ── EMPLOYMENT RECORDS ────────────────────────────────────────────────────────

// GET /api/admin/employment/alumni-without-record  ← static, before /:id
const getAlumniWithoutRecord = async (req, res) => {
  try {
    const existing = await AlumniEmployment.distinct('alumni_id');
    const alumni = await User.find({
      role: 'alumni',
      _id:  { $nin: existing },
    })
      .select('_id firstName lastName course graduationYear')
      .sort({ lastName: 1, firstName: 1 });

    res.json({ alumni });
  } catch (err) {
    console.error('getAlumniWithoutRecord error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/employment
const createEmploymentRecord = async (req, res) => {
  try {
    const {
      alumni_id, employment_status, company_name, job_title, industry,
      work_location, salary_range, job_related_to_course,
      date_employed, reason_unemployed,
    } = req.body;

    if (!alumni_id) return res.status(400).json({ message: 'Alumni is required.' });
    const MANUAL_STATUSES = ['Employed', 'Unemployed', 'Self-employed'];
    if (!employment_status || !MANUAL_STATUSES.includes(employment_status)) {
      return res.status(400).json({ message: 'Employment status must be Employed, Unemployed, or Self-employed.' });
    }

    if (employment_status === 'Employed') {
      if (!company_name?.trim())  return res.status(400).json({ message: 'Company name is required.' });
      if (!job_title?.trim())     return res.status(400).json({ message: 'Job title is required.' });
      if (!industry?.trim())      return res.status(400).json({ message: 'Industry is required.' });
      if (!work_location?.trim()) return res.status(400).json({ message: 'Work location is required.' });
    }
    if (employment_status === 'Unemployed' && !reason_unemployed?.trim()) {
      return res.status(400).json({ message: 'Reason for unemployment is required.' });
    }
    if (employment_status === 'Self-employed' && !industry?.trim()) {
      return res.status(400).json({ message: 'Industry or business type is required.' });
    }

    const alumniUser = await User.findOne({ _id: alumni_id, role: 'alumni' }).select('firstName lastName');
    if (!alumniUser) return res.status(404).json({ message: 'Alumni not found.' });

    const record = await AlumniEmployment.create({
      alumni_id,
      employment_status,
      company_name:          company_name?.trim()      || '',
      job_title:             job_title?.trim()         || '',
      industry:              industry?.trim()          || '',
      work_location:         work_location?.trim()     || '',
      salary_range:          salary_range?.trim()      || '',
      job_related_to_course: !!job_related_to_course,
      date_employed:         date_employed             || null,
      reason_unemployed:     reason_unemployed?.trim() || '',
      last_updated:          new Date(),
    });

    const adminName = await resolveAdminName(req.user.id);
    logActivity(req.user.id, adminName, 'updated employment status', `${alumniUser.firstName} ${alumniUser.lastName}`, 'created record');

    res.status(201).json({ message: 'Employment record created.', record });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'This alumni already has an employment record.' });
    }
    console.error('createEmploymentRecord error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment
const getEmploymentRecords = async (req, res) => {
  try {
    const {
      search = '', status = '', college = '', course = '', batch_year = '',
      date_updated = '', company = '', page = 1, limit = 10,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    const base = buildBasePipeline({ search, status, college, course, batch_year, date_updated, company });

    const [records, countResult] = await Promise.all([
      AlumniEmployment.aggregate([
        ...base,
        { $sort: { last_updated: -1 } },
        { $skip: skip },
        { $limit: limitNum },
        listProjection,
      ]),
      AlumniEmployment.aggregate([...base, { $count: 'total' }]),
    ]);

    const total = countResult[0]?.total ?? 0;
    res.json({
      records,
      pagination: {
        page:  pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('getEmploymentRecords error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/activity  ← must be declared before /:id route
// Shared by both the admin route (unscoped — sees everything) and the
// coordinator route (must only see activity from their own college) — see
// routes/admin.js and routes/coordinator.js. A coordinator seeing another
// college's print/export activity would leak that other college has
// records at all, plus who's been working on them. EmploymentActivity has
// no college field of its own, only `user_id` (the staff member who
// performed the action), so scoping joins to User.college the same way
// buildBasePipeline() above already scopes the employment records table
// itself — keeping this feed consistent with what the coordinator can
// actually see there.
const getEmploymentActivity = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
    const match = {};
    if (req.user.role === 'coordinator') {
      const staffInCollege = await User.find({ college: req.user.college }).select('_id').lean();
      match.user_id = { $in: staffInCollege.map(u => u._id) };
    }
    const activities = await EmploymentActivity.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('user_name action target_name details createdAt');
    res.json({ activities });
  } catch (err) {
    console.error('getEmploymentActivity error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/export  ← must be declared before /:id route
const exportEmploymentRecords = async (req, res) => {
  try {
    const { format = 'csv', status = '', college = '', course = '', batch_year = '', search = '', company = '' } = req.query;

    const base    = buildBasePipeline({ search, status, college, course, batch_year, company });
    const records = await AlumniEmployment.aggregate([
      ...base,
      { $sort: { last_updated: -1 } },
      {
        $project: {
          Name:                    { $concat: ['$alumni.firstName', ' ', '$alumni.lastName'] },
          Course:                  '$alumni.course',
          'Batch Year':            { $ifNull: ['$alumni.graduationYear', ''] },
          'Employment Status':     '$employment_status',
          'Company Name':          '$company_name',
          'Job Title':             '$job_title',
          Industry:                '$industry',
          'Work Location':         '$work_location',
          'Salary Range':          '$salary_range',
          'Job Related to Course': { $cond: ['$job_related_to_course', 'Yes', 'No'] },
          'Last Updated':          { $dateToString: { format: '%m/%d/%Y', date: '$last_updated' } },
        },
      },
    ]);

    const adminName = await resolveAdminName(req.user.id);
    logActivity(req.user.id, adminName, 'exported employment list', '', `${format} — ${records.length} records`);

    if (format === 'excel') {
      const wb  = XLSX.utils.book_new();
      const ws  = XLSX.utils.json_to_sheet(records);
      XLSX.utils.book_append_sheet(wb, ws, 'Employment Details');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.set({
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="employment-details.xlsx"',
      });
      return res.send(buf);
    }

    const headers = records.length
      ? Object.keys(records[0])
      : ['Name','Course','Batch Year','Employment Status','Company Name','Job Title','Industry','Work Location','Salary Range','Job Related to Course','Last Updated'];

    const csv = [
      headers.map(h => `"${h}"`).join(','),
      ...records.map(r =>
        headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    res.set({
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="employment-details.csv"',
    });
    res.send('﻿' + csv);
  } catch (err) {
    console.error('exportEmploymentRecords error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/:id
const getEmploymentRecord = async (req, res) => {
  try {
    let oid;
    try { oid = new Types.ObjectId(req.params.id); }
    catch { return res.status(400).json({ message: 'Invalid record ID.' }); }

    const result = await AlumniEmployment.aggregate([
      { $match: { _id: oid } },
      {
        $lookup: {
          from: 'users', localField: 'alumni_id', foreignField: '_id', as: 'alumni',
        },
      },
      { $unwind: { path: '$alumni', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id:                   1,
          alumni_id:             1,
          name:                  { $concat: ['$alumni.firstName', ' ', '$alumni.lastName'] },
          email:                 '$alumni.email',
          course:                '$alumni.course',
          graduation_year:       '$alumni.graduationYear',
          employment_status:     1,
          company_name:          1,
          job_title:             1,
          industry:              1,
          work_location:         1,
          salary_range:          1,
          job_related_to_course: 1,
          date_employed:         1,
          employment_type:       1,
          years_in_current_job:  1,
          reason_unemployed:     1,
          last_updated:          1,
          createdAt:             1,
          updatedAt:             1,
        },
      },
    ]);

    if (!result.length) return res.status(404).json({ message: 'Employment record not found.' });

    // Attach tracer study snapshot so the admin view modal can show it
    const tracer = await TracerStudyResponse.findOne({ alumni_id: result[0].alumni_id }).lean();
    let tracer_data = null;
    if (tracer) {
      // extra_answers may be a plain object (lean) or Map — normalise to plain object
      const extraRaw = tracer.extra_answers;
      const extra_answers = (extraRaw instanceof Map)
        ? Object.fromEntries(extraRaw)
        : (extraRaw && typeof extraRaw === 'object' ? extraRaw : {});

      const extraResolved = await resolveExtraFromTracer(extra_answers);

      tracer_data = {
        occupationTitle:       tracer.occupationTitle       || '',
        industryField:         tracer.industryField         || '',
        jobRelatedToDegree:    tracer.jobRelatedToDegree    || '',
        presentEmploymentType: tracer.presentEmploymentType || '',
        yearsInCurrentJob:     tracer.yearsInCurrentJob     || '',
        companyName:           extraResolved.company_name   || '',
        workLocation:          extraResolved.work_location  || '',
        submittedAt:           tracer.submittedAt           || null,
      };
    }

    res.json({ record: { ...result[0], tracer_data } });
  } catch (err) {
    console.error('getEmploymentRecord error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/employment/:id
const updateEmploymentRecord = async (req, res) => {
  try {
    const {
      employment_status, company_name, job_title, industry,
      work_location, salary_range, job_related_to_course,
      date_employed, reason_unemployed,
      employment_type, years_in_current_job,
    } = req.body;

    const VALID_STATUSES = ['Not Yet Updated', 'Employed', 'Unemployed', 'Self-employed'];
    if (!employment_status || !VALID_STATUSES.includes(employment_status)) {
      return res.status(400).json({ message: 'Employment status is required.' });
    }
    if (employment_status === 'Employed') {
      if (!company_name?.trim())  return res.status(400).json({ message: 'Company name is required.' });
      if (!job_title?.trim())     return res.status(400).json({ message: 'Job title is required.' });
      if (!industry?.trim())      return res.status(400).json({ message: 'Industry is required.' });
      if (!work_location?.trim()) return res.status(400).json({ message: 'Work location is required.' });
    }
    if (employment_status === 'Unemployed' && !reason_unemployed?.trim()) {
      return res.status(400).json({ message: 'Reason for unemployment is required.' });
    }
    if (employment_status === 'Self-employed' && !industry?.trim()) {
      return res.status(400).json({ message: 'Industry or business type is required.' });
    }

    const updates = {
      employment_status,
      company_name:          company_name?.trim()        || '',
      job_title:             job_title?.trim()           || '',
      industry:              industry?.trim()            || '',
      work_location:         work_location?.trim()       || '',
      salary_range:          salary_range?.trim()        || '',
      job_related_to_course: !!job_related_to_course,
      date_employed:         date_employed               || null,
      reason_unemployed:     reason_unemployed?.trim()   || '',
      employment_type:       employment_type?.trim()     || '',
      years_in_current_job:  years_in_current_job?.trim() || '',
      last_updated:          new Date(),
    };

    const record = await AlumniEmployment.findByIdAndUpdate(
      req.params.id, updates, { new: true, runValidators: true }
    ).populate('alumni_id', 'firstName lastName');

    if (!record) return res.status(404).json({ message: 'Employment record not found.' });

    const adminName  = await resolveAdminName(req.user.id);
    const alumniName = record.alumni_id
      ? `${record.alumni_id.firstName} ${record.alumni_id.lastName}`
      : 'Unknown';

    logActivity(req.user.id, adminName, 'updated employment status', alumniName);

    res.json({ message: 'Employment record updated.', record });
  } catch (err) {
    console.error('updateEmploymentRecord error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/course-stats
// Returns employment & job-related rates per course (BSIT / BSCS / BSIS).
const getCourseJobStats = async (req, res) => {
  try {
    const rows = await AlumniEmployment.aggregate([
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: { '_user.0': { $exists: true } } },
      { $addFields: { _u: { $arrayElemAt: ['$_user', 0] } } },
      { $match: { '_u.role': 'alumni' } },
      {
        $group: {
          _id:         '$_u.course',
          total:       { $sum: 1 },
          employed:    { $sum: { $cond: [{ $in: ['$employment_status', ['Employed', 'Self-employed']] }, 1, 0] } },
          jobRelated:  { $sum: { $cond: [{ $eq: ['$job_related_to_course', true] }, 1, 0] } },
        },
      },
      // BSIM temporarily included alongside the original 3 courses.
      { $match: { _id: { $in: ['BSIT', 'BSCS', 'BSIS', 'BSIM'] } } },
      { $sort:  { _id: 1 } },
    ]);

    const courses = ['BSIT', 'BSCS', 'BSIS', 'BSIM'];
    const byCourse = courses.map((course) => {
      const row = rows.find((r) => r._id === course) || { total: 0, employed: 0, jobRelated: 0 };
      return {
        course,
        total:          row.total,
        employed:       row.employed,
        jobRelated:     row.jobRelated,
        employmentRate: row.total > 0 ? Math.round((row.employed   / row.total) * 100) : 0,
        jobRelatedRate: row.total > 0 ? Math.round((row.jobRelated / row.total) * 100) : 0,
      };
    });

    // BSIT breakdown by track (TSM / WMA / NA)
    // Prefer User.track; fall back to programsCompleted in TracerStudyResponse.
    const trackRows = await AlumniEmployment.aggregate([
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: { '_user.0': { $exists: true } } },
      { $addFields: { _u: { $arrayElemAt: ['$_user', 0] } } },
      { $match: { '_u.role': 'alumni', '_u.course': 'BSIT' } },
      { $lookup: { from: 'tracerstudyresponses', localField: 'alumni_id', foreignField: 'alumni_id', as: '_tracer' } },
      { $addFields: { _t: { $arrayElemAt: ['$_tracer', 0] } } },
      {
        $addFields: {
          _progStr: {
            $toLower: {
              $reduce: {
                input:        { $ifNull: ['$_t.programsCompleted', []] },
                initialValue: '',
                in:           { $concat: ['$$value', ' ', '$$this'] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          _track: {
            $switch: {
              branches: [
                // Explicit User.track wins if it's one of the valid values
                { case: { $in: ['$_u.track', ['TSM', 'WMA', 'NA']] }, then: '$_u.track' },
                // Otherwise derive from programsCompleted text
                { case: { $gt: [{ $indexOfCP: ['$_progStr', 'network administration']       }, -1] }, then: 'NA'  },
                { case: { $gt: [{ $indexOfCP: ['$_progStr', 'web and mobile']               }, -1] }, then: 'WMA' },
                { case: { $gt: [{ $indexOfCP: ['$_progStr', 'technical service management'] }, -1] }, then: 'TSM' },
              ],
              default: '',
            },
          },
        },
      },
      { $match: { _track: { $in: ['TSM', 'WMA', 'NA'] } } },
      {
        $group: {
          _id:        '$_track',
          total:      { $sum: 1 },
          employed:   { $sum: { $cond: [{ $in: ['$employment_status', ['Employed', 'Self-employed']] }, 1, 0] } },
          jobRelated: { $sum: { $cond: [{ $eq: ['$job_related_to_course', true] }, 1, 0] } },
        },
      },
    ]);

    const tracks = ['TSM', 'WMA', 'NA'];
    const bsitByTrack = tracks.map((track) => {
      const row = trackRows.find((r) => r._id === track) || { total: 0, employed: 0, jobRelated: 0 };
      return {
        track,
        total:          row.total,
        employed:       row.employed,
        jobRelated:     row.jobRelated,
        employmentRate: row.total > 0 ? Math.round((row.employed   / row.total) * 100) : 0,
        jobRelatedRate: row.total > 0 ? Math.round((row.jobRelated / row.total) * 100) : 0,
      };
    });

    const totalAlumni = await User.countDocuments({ role: 'alumni' });

    res.json({ byCourse, bsitByTrack, totalAlumni });
  } catch (err) {
    console.error('getCourseJobStats error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/survey-stats
const getSurveyStats = async (req, res) => {
  try {
    const existingUserLookup = [
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: { '_user.0': { $exists: true } } },
      { $addFields: { _u: { $arrayElemAt: ['$_user', 0] } } },
      { $match: { '_u.role': 'alumni' } },
    ];

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [totalAlumni, completedResult, thisMonthResult] = await Promise.all([
      User.countDocuments({ role: 'alumni' }),
      TracerStudyResponse.aggregate([...existingUserLookup, { $count: 'total' }]),
      TracerStudyResponse.aggregate([
        ...existingUserLookup,
        { $match: { submittedAt: { $gte: monthStart } } },
        { $count: 'total' },
      ]),
    ]);

    const completed = completedResult[0]?.total ?? 0;
    const thisMonth = thisMonthResult[0]?.total ?? 0;
    const total     = totalAlumni;
    const pending   = Math.max(0, total - completed);

    res.json({
      total,
      completed,
      pending,
      thisMonth,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    });
  } catch (err) {
    console.error('getSurveyStats error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/donut-stats?course=BSIT
const getDonutStats = async (req, res) => {
  try {
    const { course = '' } = req.query;

    const pipeline = [
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: { '_user.0': { $exists: true } } },
      { $addFields: { _u: { $arrayElemAt: ['$_user', 0] } } },
      { $match: { '_u.role': 'alumni' } },
    ];

    if (course && ['BSIT', 'BSCS', 'BSIS', 'BSIM'].includes(course)) {
      pipeline.push({ $match: { '_u.course': course } });
    }

    pipeline.push({
      $group: {
        _id:          null,
        total:        { $sum: 1 },
        employed:     { $sum: { $cond: [{ $in: ['$employment_status', ['Employed', 'Self-employed']] }, 1, 0] } },
        unemployed:   { $sum: { $cond: [{ $eq: ['$employment_status', 'Unemployed'] }, 1, 0] } },
        unidentified: { $sum: { $cond: [{ $eq: ['$employment_status', 'Not Yet Updated'] }, 1, 0] } },
      },
    });

    const result = await AlumniEmployment.aggregate(pipeline);
    const row = result[0] || { total: 0, employed: 0, unemployed: 0, unidentified: 0 };
    const { total, employed, unemployed, unidentified } = row;

    res.json({
      total,
      employed,
      unemployed,
      unidentified,
      employedPct:     total > 0 ? Math.round((employed     / total) * 100) : 0,
      unemployedPct:   total > 0 ? Math.round((unemployed   / total) * 100) : 0,
      unidentifiedPct: total > 0 ? Math.round((unidentified / total) * 100) : 0,
    });
  } catch (err) {
    console.error('getDonutStats error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/stats
const getEmploymentStats = async (req, res) => {
  try {
    const existingUserLookup = [
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: { '_user.0': { $exists: true } } },
      { $addFields: { _u: { $arrayElemAt: ['$_user', 0] } } },
      { $match: { '_u.role': 'alumni' } },
    ];

    const [counts, tracerResult] = await Promise.all([
      AlumniEmployment.aggregate([
        ...existingUserLookup,
        { $group: { _id: '$employment_status', count: { $sum: 1 } } },
      ]),
      TracerStudyResponse.aggregate([
        ...existingUserLookup,
        { $count: 'total' },
      ]),
    ]);

    const tracerCount = tracerResult[0]?.total ?? 0;
    const stats = { employed: 0, unemployed: 0, selfEmployed: 0, notYetUpdated: 0, total: 0, tracerSubmissions: tracerCount };
    for (const c of counts) {
      stats.total += c.count;
      if (c._id === 'Employed')             stats.employed      = c.count;
      else if (c._id === 'Unemployed')      stats.unemployed    = c.count;
      else if (c._id === 'Self-employed')   stats.selfEmployed  = c.count;
      else if (c._id === 'Not Yet Updated') stats.notYetUpdated = c.count;
    }
    // "employed" includes self-employed alumni — matches getDonutStats() and
    // every AI-chatbot aggregation, which all treat self-employed as employed.
    // Keeping this narrower here (literal "Employed" status only) made the
    // dashboard's top tile silently disagree with its own donut chart below.
    stats.employed += stats.selfEmployed;
    res.json(stats);
  } catch (err) {
    console.error('getEmploymentStats error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const SKILL_LABELS = {
  technicalSkills:        'Technical Skills',
  problemSolvingSkills:   'Problem-Solving Skills',
  communicationSkills:    'Communication Skills',
  projectManagement:      'Project Management',
  teamworkCollaboration:  'Teamwork & Collaboration',
  adaptability:           'Adaptability',
  workLifeBalance:        'Work-Life Balance',
  criticalThinkingSkills: 'Critical Thinking Skills',
};

// GET /api/admin/employment/tracer-analytics
// Powers the "Tracer Study Analytics" dashboard section — one aggregation
// covering every tracer-form section (respondent profile, exam, employment,
// occupation/industry, unemployment reasons, personal growth, further
// education, promotion, professional development).
const getTracerAnalytics = async (req, res) => {
  try {
    const college = (req.query.college || '').trim().toUpperCase();
    const notBlank = (field) => ({ [field]: { $nin: ['', null] } });

    // Groups by a case-INsensitive key so typos like "MAle" merge into
    // "Male" instead of showing as a separate bucket. The display label
    // used is whichever exact casing occurred most often in that group
    // (first $group ranks casing variants by count, second $group picks
    // the top one via $first after the sort) — not just the first one
    // Mongo happens to encounter.
    const ciGroup = (valueExpr) => [
      { $group: { _id: { norm: { $toLower: valueExpr }, orig: valueExpr }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $group: { _id: '$_id.norm', label: { $first: '$_id.orig' }, count: { $sum: '$count' } } },
      { $sort: { count: -1 } },
    ];
    const groupCount = (field) => [
      { $match: notBlank(field) },
      ...ciGroup(`$${field}`),
    ];

    const [result] = await TracerStudyResponse.aggregate([
      // Deleting an alumni account doesn't always reach every linked record
      // (e.g. accounts removed before cascade-delete covered
      // TracerStudyResponse, or removed directly in the database) — an
      // orphaned response with no matching User would otherwise still be
      // counted here forever, showing programs/answers for alumni that were
      // explicitly deleted. Same guard as getSurveyStats/getDonutStats above.
      //
      // Also require role === 'alumni': a response stays linked to a valid
      // User even after that account's role is changed away from alumni
      // (e.g. promoted to coordinator/admin for testing) — role changes
      // don't cascade-clean the old tracer response, so without this check
      // this dashboard's "alumni" stats silently included non-alumni
      // accounts' leftover answers.
      //
      // Optional college filter — admin sees every college by default (no
      // college scoping applies to admin, unlike coordinators), but can
      // narrow the dashboard to one college at a time via ?college=.
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: college ? { '_user.0.role': 'alumni', '_user.0.college': college } : { '_user.0.role': 'alumni' } },
      {
        $facet: {
          total: [{ $count: 'count' }],

          byGender: groupCount('gender'),
          // Some bulk-migrated records stored multiple selected programs as a
          // single ';'-joined array element instead of separate elements —
          // split those apart so each program is counted individually.
          byProgram: [
            { $unwind: { path: '$programsCompleted', preserveNullAndEmptyArrays: false } },
            { $project: { parts: { $split: ['$programsCompleted', ';'] } } },
            { $unwind: '$parts' },
            { $project: { part: { $trim: { input: '$parts' } } } },
            { $match: { part: { $ne: '' } } },
            ...ciGroup('$part'),
            { $limit: 10 },
          ],

          examStatus: groupCount('professionalExam'),
          examNames: [
            { $match: notBlank('professionalExamName') },
            ...ciGroup('$professionalExamName'),
            { $limit: 10 },
          ],

          byEmploymentStatus: groupCount('employmentStatus'),
          byJobRelevance: [
            { $match: { employmentStatus: 'Yes', ...notBlank('jobRelatedToDegree') } },
            ...ciGroup('$jobRelatedToDegree'),
          ],
          byDuration: [
            { $match: { employmentStatus: 'Yes', ...notBlank('yearsInCurrentJob') } },
            ...ciGroup('$yearsInCurrentJob'),
          ],

          topOccupations: [
            { $match: { employmentStatus: 'Yes', ...notBlank('occupationTitle') } },
            ...ciGroup('$occupationTitle'),
            { $limit: 10 },
          ],
          byIndustry: [
            { $match: { employmentStatus: 'Yes', ...notBlank('industryField') } },
            ...ciGroup('$industryField'),
          ],

          unemploymentReasons: [
            { $match: { employmentStatus: { $in: ['No', 'Never Employed'] } } },
            { $unwind: { path: '$reasonsNotEmployed', preserveNullAndEmptyArrays: false } },
            ...ciGroup('$reasonsNotEmployed'),
          ],

          personalGrowth: [
            { $project: { ratings: { $objectToArray: '$personalGrowthRatings' } } },
            { $unwind: '$ratings' },
            { $match: { 'ratings.v': { $nin: ['', null] } } },
            { $group: { _id: { skill: '$ratings.k', rating: '$ratings.v' }, count: { $sum: 1 } } },
          ],

          byFurtherEducation: groupCount('furtherEducation'),
          byTrainings: groupCount('pursuedTrainings'),

          byPromotion: groupCount('promotedInJob'),
          byAccomplishments: groupCount('significantAccomplishments'),

          byCertifications: groupCount('professionalCertifications'),
          byDevActivities: groupCount('professionalDevelopmentActivities'),
        },
      },
    ]);

    const mapRows = (rows) => (rows || []).map((r) => ({ label: r.label ?? r._id, count: r.count }));

    const personalGrowth = Object.entries(SKILL_LABELS).map(([key, label]) => {
      const ratings = {};
      (result.personalGrowth || [])
        .filter((r) => r._id.skill === key)
        .forEach((r) => { ratings[r._id.rating] = r.count; });
      return { skill: label, ratings };
    });

    res.json({
      total: result.total?.[0]?.count ?? 0,
      respondentProfile: {
        byGender: mapRows(result.byGender),
        byProgram: mapRows(result.byProgram),
      },
      professionalExam: {
        byStatus: mapRows(result.examStatus),
        byExamName: mapRows(result.examNames),
      },
      employmentOverview: {
        byStatus: mapRows(result.byEmploymentStatus),
        byJobRelevance: mapRows(result.byJobRelevance),
        byDuration: mapRows(result.byDuration),
      },
      occupationIndustry: {
        topOccupations: mapRows(result.topOccupations),
        byIndustry: mapRows(result.byIndustry),
      },
      unemploymentReasons: mapRows(result.unemploymentReasons),
      personalGrowth,
      furtherEducation: {
        byFurtherEducation: mapRows(result.byFurtherEducation),
        byTrainings: mapRows(result.byTrainings),
      },
      promotion: {
        byPromotion: mapRows(result.byPromotion),
        byAccomplishments: mapRows(result.byAccomplishments),
      },
      professionalDevelopment: {
        byCertifications: mapRows(result.byCertifications),
        byDevActivities: mapRows(result.byDevActivities),
      },
    });
  } catch (err) {
    console.error('getTracerAnalytics error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Maps tracer employmentStatus answer → AlumniEmployment enum (same logic as alumniController)
function mapTracerStatus(tracerStatus) {
  if (!tracerStatus) return 'Not Yet Updated';
  const s = String(tracerStatus).toLowerCase().trim();
  if (s === 'yes') return 'Employed';
  if (s === 'no' || s.includes('never')) return 'Unemployed';
  if (s.includes('self')) return 'Self-employed';
  if (s.includes('employ') && !s.includes('un')) return 'Employed';
  if (s.includes('unemploy')) return 'Unemployed';
  return 'Not Yet Updated';
}

// POST /api/admin/employment/sync-tracer
// Reads every existing TracerStudyResponse and pushes employment fields into AlumniEmployment.
// Safe to run multiple times (upsert). Called on mount so stale records catch up automatically.
const syncTracerToEmployment = async (req, res) => {
  try {
    const responses = await TracerStudyResponse.find().lean();
    let updated = 0;

    for (const tracer of responses) {
      const extraAnswers = (tracer.extra_answers instanceof Map)
        ? Object.fromEntries(tracer.extra_answers)
        : (tracer.extra_answers || {});

      const extraResolved = await resolveExtraFromTracer(extraAnswers);

      const reasonsArr = Array.isArray(tracer.reasonsNotEmployed) ? tracer.reasonsNotEmployed : [];
      const jrd = String(tracer.jobRelatedToDegree || '').toLowerCase().trim();

      const updates = {
        employment_status:     mapTracerStatus(tracer.employmentStatus),
        job_title:             tracer.occupationTitle       || '',
        industry:              tracer.industryField         || '',
        job_related_to_course: jrd.startsWith('yes'),
        reason_unemployed:     reasonsArr.join('; '),
        employment_type:       tracer.presentEmploymentType || '',
        years_in_current_job:  tracer.yearsInCurrentJob     || '',
        last_updated:          new Date(),
        ...extraResolved,
      };

      await AlumniEmployment.findOneAndUpdate(
        { alumni_id: tracer.alumni_id },
        { $set: updates },
        { upsert: true, new: true }
      );

      // Only backfill graduationYear from tracer if not already set on the account
      if (extraResolved.graduation_year) {
        const currentUser = await User.findById(tracer.alumni_id).select('graduationYear').lean();
        if (!currentUser?.graduationYear) {
          await User.findByIdAndUpdate(tracer.alumni_id, { graduationYear: extraResolved.graduation_year });
        }
      }

      updated++;
    }

    res.json({ updated });
  } catch (err) {
    console.error('syncTracerToEmployment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/employment/backfill
const backfillEmploymentRecords = async (req, res) => {
  try {
    const existingIds = await AlumniEmployment.distinct('alumni_id');
    const alumni      = await User.find({ role: 'alumni', _id: { $nin: existingIds } })
      .select('_id firstName lastName');

    let created = 0;
    for (const a of alumni) {
      try {
        await AlumniEmployment.create({
          alumni_id:             a._id,
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
        created++;
      } catch (err) {
        if (err.code !== 11000) console.error(`backfill skip ${a._id}:`, err.message);
      }
    }

    res.json({ created });
  } catch (err) {
    console.error('backfillEmploymentRecords error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/employment/log-print
const logPrintActivity = async (req, res) => {
  try {
    const { alumni_name = '' } = req.body;
    const adminName = await resolveAdminName(req.user.id);
    logActivity(req.user.id, adminName, 'printed employment record', alumni_name);
    res.json({ message: 'Activity logged.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── TRACER FORM QUESTIONS ─────────────────────────────────────────────────────

// GET /api/admin/employment/tracer-questions
const getTracerQuestions = async (req, res) => {
  try {
    const questions = await TracerFormQuestion.find().sort({ order_number: 1, createdAt: 1 });
    res.json({ questions });
  } catch (err) {
    console.error('getTracerQuestions error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/employment/tracer-questions
const createTracerQuestion = async (req, res) => {
  try {
    const { question_text, field_type, options, is_required, is_active, order_number } = req.body;
    if (!question_text?.trim()) {
      return res.status(400).json({ message: 'Question text is required.' });
    }

    const last = await TracerFormQuestion.findOne().sort({ order_number: -1 }).select('order_number');
    const nextOrder = order_number !== undefined ? order_number : (last ? last.order_number + 1 : 0);

    const question = await TracerFormQuestion.create({
      question_text: question_text.trim(),
      field_type:    field_type || 'text',
      options:       Array.isArray(options) ? options.filter(Boolean) : [],
      is_required:   !!is_required,
      is_active:     is_active !== false,
      order_number:  nextOrder,
    });

    const adminName = await resolveAdminName(req.user.id);
    logActivity(req.user.id, adminName, 'edited tracer form', '', 'added question');

    res.status(201).json({ message: 'Question created.', question });
  } catch (err) {
    console.error('createTracerQuestion error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/employment/tracer-questions/reorder  ← before /:id
const reorderTracerQuestions = async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ message: 'order must be an array.' });
    }
    await Promise.all(
      order.map(({ id, order_number }) =>
        TracerFormQuestion.findByIdAndUpdate(id, { order_number })
      )
    );
    const questions = await TracerFormQuestion.find().sort({ order_number: 1, createdAt: 1 });
    res.json({ message: 'Questions reordered.', questions });
  } catch (err) {
    console.error('reorderTracerQuestions error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/employment/tracer-questions/:id
const updateTracerQuestion = async (req, res) => {
  try {
    const { question_text, field_type, options, is_required, is_active, order_number } = req.body;
    const updates = {};
    if (question_text !== undefined) updates.question_text = question_text.trim();
    if (field_type    !== undefined) updates.field_type    = field_type;
    if (options       !== undefined) updates.options       = Array.isArray(options) ? options.filter(Boolean) : [];
    if (is_required   !== undefined) updates.is_required   = !!is_required;
    if (is_active     !== undefined) updates.is_active     = !!is_active;
    if (order_number  !== undefined) updates.order_number  = order_number;

    const question = await TracerFormQuestion.findByIdAndUpdate(
      req.params.id, updates, { new: true, runValidators: true }
    );
    if (!question) return res.status(404).json({ message: 'Question not found.' });

    const adminName = await resolveAdminName(req.user.id);
    logActivity(req.user.id, adminName, 'edited tracer form', '', 'updated question');

    res.json({ message: 'Question updated.', question });
  } catch (err) {
    console.error('updateTracerQuestion error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/admin/employment/tracer-questions/:id
const deleteTracerQuestion = async (req, res) => {
  try {
    const question = await TracerFormQuestion.findByIdAndDelete(req.params.id);
    if (!question) return res.status(404).json({ message: 'Question not found.' });

    const adminName = await resolveAdminName(req.user.id);
    logActivity(req.user.id, adminName, 'edited tracer form', '', 'deleted question');

    res.json({ message: 'Question deleted.' });
  } catch (err) {
    console.error('deleteTracerQuestion error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/employment/notify
const { sendEmploymentReminderBulk } = require('../utils/emailService');

// Mirrors NOTIFY_ALUMNI_DISABLED in frontend/src/pages/admin/EmploymentView.jsx.
// The 254 bulk-migrated alumni accounts must not be emailed until explicitly
// authorized — the frontend button is disabled, but that alone doesn't stop
// a direct API call, so this is the actual enforcement point. Flip both
// flags together when permission is granted.
const NOTIFY_ALUMNI_DISABLED = true;

const notifyAlumniToUpdate = async (req, res) => {
  try {
    if (NOTIFY_ALUMNI_DISABLED) {
      return res.status(403).json({ message: 'Alumni notifications are disabled — email permission not yet granted for the migrated alumni batch.' });
    }
    const { college, course } = req.body;
    const query = { role: 'alumni', status: 'active' };
    if (college) query.college = college;
    if (course)  query.course  = course;

    const alumni = await User.find(query).select('email');
    if (alumni.length === 0)
      return res.status(404).json({ message: 'No active alumni found matching the filters.' });

    const emails = alumni.map(a => a.email);
    await sendEmploymentReminderBulk(emails);

    res.json({
      message: `Reminder sent to ${emails.length} alumni.`,
      sent:  emails.length,
      total: emails.length,
    });
  } catch (err) {
    console.error('notifyAlumniToUpdate error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── TRACER RESPONSES (read-only, admin view) ──────────────────────────────────

// GET /api/admin/employment/responses/colleges
const getTracerResponseColleges = async (req, res) => {
  try {
    const result = await TracerStudyResponse.aggregate([
      {
        $lookup: {
          from:         'users',
          localField:   'alumni_id',
          foreignField: '_id',
          as:           'alumni',
        },
      },
      { $unwind: { path: '$alumni', preserveNullAndEmptyArrays: false } },
      { $match: { 'alumni.role': 'alumni', 'alumni.college': { $exists: true, $ne: '' } } },
      { $group: { _id: '$alumni.college' } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ colleges: result.map(r => r._id).filter(Boolean) });
  } catch (err) {
    console.error('getTracerResponseColleges error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/responses
const getTracerResponses = async (req, res) => {
  try {
    const {
      search = '', college = '', employment_status = '',
      date_from = '', date_to = '',
      page = 1, limit = 10,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    const rootMatch = {};
    if (employment_status) rootMatch.employmentStatus = employment_status;
    if (date_from || date_to) {
      rootMatch.submittedAt = {};
      if (date_from) { const d = new Date(date_from); d.setHours(0,0,0,0);   rootMatch.submittedAt.$gte = d; }
      if (date_to)   { const d = new Date(date_to);   d.setHours(23,59,59,999); rootMatch.submittedAt.$lte = d; }
    }

    const base = [
      { $match: rootMatch },
      {
        $lookup: {
          from:         'users',
          localField:   'alumni_id',
          foreignField: '_id',
          as:           'alumni',
        },
      },
      { $unwind: { path: '$alumni', preserveNullAndEmptyArrays: false } },
      { $match: { 'alumni.role': 'alumni' } },
    ];

    if (college) base.push({ $match: { 'alumni.college': college } });
    if (search) {
      base.push({
        $match: {
          $expr: {
            $regexMatch: {
              input:   { $concat: ['$alumni.firstName', ' ', '$alumni.lastName'] },
              regex:   search,
              options: 'i',
            },
          },
        },
      });
    }

    const [countResult] = await TracerStudyResponse.aggregate([...base, { $count: 'total' }]);
    const total = countResult?.total ?? 0;
    const pages = Math.ceil(total / limitNum) || 1;

    const responses = await TracerStudyResponse.aggregate([
      ...base,
      { $sort: { submittedAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          _id:              1,
          alumni_id:        1,
          name:             { $concat: ['$alumni.firstName', ' ', '$alumni.lastName'] },
          college:          '$alumni.college',
          course:           '$alumni.course',
          employmentStatus: 1,
          occupationTitle:  1,
          placeOfWork:      1,
          submittedAt:      1,
        },
      },
    ]);

    res.json({ responses, pagination: { total, pages, page: pageNum, limit: limitNum } });
  } catch (err) {
    console.error('getTracerResponses error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/responses/:alumni_id
const getTracerResponseDetail = async (req, res) => {
  try {
    const { alumni_id } = req.params;

    const [response, user] = await Promise.all([
      TracerStudyResponse.findOne({ alumni_id }).lean(),
      User.findById(alumni_id).select('firstName lastName college course graduationYear email').lean(),
    ]);

    if (!response) return res.status(404).json({ message: 'No tracer response found for this alumni.' });
    if (!user)     return res.status(404).json({ message: 'Alumni not found.' });

    // Normalize extra_answers (Mongoose Map → plain object)
    let extra = {};
    if (response.extra_answers) {
      if (response.extra_answers instanceof Map) {
        response.extra_answers.forEach((v, k) => { extra[k] = v; });
      } else {
        extra = { ...response.extra_answers };
      }
    }

    res.json({ response: { ...response, extra_answers: extra, alumni: user } });
  } catch (err) {
    console.error('getTracerResponseDetail error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getAlumniWithoutRecord,
  createEmploymentRecord,
  syncTracerToEmployment,
  backfillEmploymentRecords,
  getCourseJobStats,
  getDonutStats,
  getSurveyStats,
  getEmploymentStats,
  getTracerAnalytics,
  getEmploymentRecords,
  getEmploymentRecord,
  updateEmploymentRecord,
  getEmploymentActivity,
  exportEmploymentRecords,
  logPrintActivity,
  getTracerQuestions,
  createTracerQuestion,
  updateTracerQuestion,
  deleteTracerQuestion,
  reorderTracerQuestions,
  notifyAlumniToUpdate,
  getTracerResponseColleges,
  getTracerResponses,
  getTracerResponseDetail,
};
