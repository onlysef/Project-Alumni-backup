const { Types }           = require('mongoose');
const AlumniEmployment    = require('../models/AlumniEmployment');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const TracerFormConfig    = require('../models/TracerFormConfig');
const TracerFormQuestion  = require('../models/TracerFormQuestion');
const EmploymentActivity  = require('../models/EmploymentActivity');
const User                = require('../models/User');
const XLSX                = require('xlsx');
const { escapeRegex }     = require('../utils/escapeRegex');
const { FIXED_KEYS }      = require('../utils/tracerFixedKeys');
const { getResumeForAlumnus } = require('../utils/resumeBuilder');

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

// Resolves company_name, work_location, and graduation_year from extra_answers by label matching.
// `prefetchedCfg` lets a caller that's resolving this for many tracers in a
// loop (syncTracerToEmployment) pass the same config in once instead of
// this function re-querying the identical TracerFormConfig doc on every
// single call — the config doesn't vary per-tracer within one sync run.
async function resolveExtraFromTracer(extraAnswers, college = 'CCS', prefetchedCfg = null) {
  try {
    let cfg = prefetchedCfg;
    if (!cfg) {
      cfg = await TracerFormConfig.findOne({ college }).lean();
      if (!cfg) cfg = await TracerFormConfig.findOne({ college: 'CCS' }).lean();
    }
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

// Despite the name, this resolves any staff member's display name (admin
// or coordinator) — used everywhere logActivity needs a human-readable
// actor name from just a user id.
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
  if (company) empMatch.company_name = { $regex: escapeRegex(company), $options: 'i' };
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
              regex:   escapeRegex(search),
              options: 'i',
            },
          },
        },
        { company_name: { $regex: escapeRegex(search), $options: 'i' } },
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

// GET /api/admin/employment/batch-years  ← static, before /:id
// Actual distinct graduation years across all alumni — the Employment,
// Export, and Notify pages' "Batch Year" filters used to hardcode a fixed
// [2020..2024] list, which silently hid every alumnus from any other batch
// (this dataset alone ranges from 2000 to 2025).
const getBatchYears = async (req, res) => {
  try {
    const match = { role: 'alumni', graduationYear: { $ne: null } };
    if (req.query.college) match.college = req.query.college;
    const years = await User.distinct('graduationYear', match);
    res.json({ years: years.sort((a, b) => b - a) });
  } catch (err) {
    console.error('getBatchYears error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

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
    const fullHistory = req.query.hours === 'all';
    const requestedHours = parseInt(req.query.hours, 10);
    const hours = fullHistory ? null : (Number.isFinite(requestedHours)
      ? Math.min(168, Math.max(1, requestedHours))
      : 24);
    const match = fullHistory ? {} : { createdAt: { $gte: new Date(Date.now() - hours * 60 * 60 * 1000) } };
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
          __alumni_id:             '$alumni_id',
          __college:               '$alumni.college',
        },
      },
    ]);

    // Add the alumni's full tracer study answers as extra columns — every
    // distinct college represented in this export gets its own form config
    // read, and every question across all of them (fixed-schema or custom,
    // rating tables exploded one column per row) becomes its own column,
    // de-duplicated by question id so the same fixed field from two
    // colleges' forms doesn't produce two columns.
    const distinctColleges = [...new Set(records.map((r) => r.__college).filter(Boolean))];
    const [configs, tracers] = await Promise.all([
      distinctColleges.length ? TracerFormConfig.find({ college: { $in: distinctColleges } }).lean() : [],
      TracerStudyResponse.find({ alumni_id: { $in: records.map((r) => r.__alumni_id) } }).lean(),
    ]);
    const tracerByAlumni = new Map(tracers.map((t) => [String(t.alumni_id), t]));

    const getAnswer = (t, qid) => {
      if (!t) return undefined;
      if (Object.prototype.hasOwnProperty.call(t, qid)) return t[qid];
      const extra = t.extra_answers instanceof Map ? Object.fromEntries(t.extra_answers) : (t.extra_answers || {});
      return extra[qid];
    };

    const columns = [];
    const seen = new Set();
    configs.forEach((cfg) => {
      (cfg.config?.pages || []).forEach((page) => {
        (page.questions || []).forEach((q) => {
          if (q.type === 'static_text') return;
          if (q.id === 'consent') return; // validated client-side only, never persisted — always blank
          if (q.type === 'rating_table') {
            (q.rows || []).forEach((row) => {
              const key = `${q.id}::${row.key}`;
              if (seen.has(key)) return;
              seen.add(key);
              columns.push({ id: q.id, rowKey: row.key, header: `${q.label} - ${row.label}` });
            });
            return;
          }
          if (seen.has(q.id)) return;
          seen.add(q.id);
          columns.push({ id: q.id, header: q.label });
        });
      });
    });

    records.forEach((r) => {
      const t = tracerByAlumni.get(String(r.__alumni_id));
      columns.forEach((col) => {
        const raw = getAnswer(t, col.id);
        let val;
        if (col.rowKey) {
          val = (raw && raw[col.rowKey]) || '';
        } else if (col.id === 'placeOfWork') {
          // This question is only ever meant to be answered "Local" or
          // "Abroad" — some responses predate that and still hold a
          // specific place instead (e.g. "Taguig", "Clark, Pampanga"),
          // which read as noise mixed in with everyone else's Local/Abroad
          // answers. Every such legacy value on file is a Philippine city,
          // so it's normalized to "Local" here rather than left as-is.
          const v = String(raw || '').toLowerCase();
          val = !v ? '' : v.includes('abroad') ? 'Abroad' : 'Local';
        } else {
          val = Array.isArray(raw) ? raw.join('; ') : (raw ?? '');
        }
        const header = Object.prototype.hasOwnProperty.call(r, col.header) ? `${col.header} (Tracer)` : col.header;
        r[header] = val;
      });
      delete r.__alumni_id;
      delete r.__college;
    });

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
          college:               '$alumni.college',
          course:                '$alumni.course',
          graduation_year:       '$alumni.graduationYear',
          avatarUrl:             '$alumni.avatarUrl',
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
          skills:                1,
          experience:            1,
          contact_email:         1,
          contact_number:        1,
          facebook:              1,
          linkedin:              1,
          last_updated:          1,
          createdAt:             1,
          updatedAt:             1,
        },
      },
    ]);

    if (!result.length) return res.status(404).json({ message: 'Employment record not found.' });
    // Set by the coordinator route middleware — a coordinator can only view
    // a record belonging to their own college, even by guessing/hand-
    // crafting another alumni's record id directly in the URL.
    if (req.forcedCollege && result[0].college !== req.forcedCollege) {
      return res.status(403).json({ message: 'Access denied.' });
    }

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
        // Employment (already used by the compact summary above the full record)
        occupationTitle:       tracer.occupationTitle       || '',
        industryField:         tracer.industryField         || '',
        jobRelatedToDegree:    tracer.jobRelatedToDegree    || '',
        presentEmploymentType: tracer.presentEmploymentType || '',
        yearsInCurrentJob:     tracer.yearsInCurrentJob     || '',
        // Genuine TracerStudyResponse fields — safe to round-trip through
        // "Edit Record" since they map 1:1 to real question ids.
        companyName:           tracer.companyName           || '',
        placeOfWork:           tracer.placeOfWork           || '',
        // Best-effort fuzzy-matched fallbacks from custom questions (e.g. a
        // college whose form uses its own differently-labeled "Company"
        // question instead of the fixed field) — display-only backup for
        // the Employment Summary section above; deliberately NOT reused as
        // an editable field's value since these don't map to any single
        // real question id and saving them back could write to the wrong
        // place. See resolveExtraFromTracer's own comment for the matching rules.
        resolvedCompanyName:   extraResolved.company_name   || '',
        resolvedWorkLocation:  extraResolved.work_location  || '',
        submittedAt:           tracer.submittedAt           || null,

        // Full tracer study answers — the "whole record" view shows all of
        // this, not just the employment slice above.
        contactNumber:            tracer.contactNumber            || '',
        gender:                   tracer.gender                   || '',
        programsCompleted:        tracer.programsCompleted        || [],
        professionalExam:         tracer.professionalExam         || '',
        professionalExamName:     tracer.professionalExamName     || '',
        employmentStatus:         tracer.employmentStatus         || '',
        reasonsNotEmployed:       tracer.reasonsNotEmployed        || [],
        furtherEducation:         tracer.furtherEducation         || '',
        furtherEducationType:     tracer.furtherEducationType     || '',
        pursuedTrainings:         tracer.pursuedTrainings         || '',
        trainingType:             tracer.trainingType             || '',
        personalGrowthRatings:    tracer.personalGrowthRatings    || {},
        promotedInJob:                     tracer.promotedInJob                     || '',
        significantAccomplishments:        tracer.significantAccomplishments        || '',
        professionalCertifications:        tracer.professionalCertifications        || '',
        professionalDevelopmentActivities: tracer.professionalDevelopmentActivities || '',
        extra_answers,
      };
    }

    // Which questions are "new" for this specific alumni — custom/imported
    // questions on their college's CURRENT form they haven't answered yet,
    // plus anything an admin explicitly flagged via Notify Alumni. Same
    // computation as getMyTracerResponse/getNotifyCandidates, surfaced here
    // too so the Edit Record modal can highlight them instead of them
    // blending in with every other already-answered field.
    let newQuestionIds = [];
    if (tracer) {
      const cfg = await TracerFormConfig.findOne({ college: result[0].college }).lean();
      const answeredKeys = new Set(Object.keys(tracer_data.extra_answers || {}));
      const pendingIds   = new Set(tracer.pendingUpdateQuestionIds || []);
      (cfg?.config?.pages || []).forEach((p) => (p.questions || []).forEach((q) => {
        if (q.type === 'static_text') return;
        if (pendingIds.has(q.id)) { newQuestionIds.push(q.id); return; }
        if (!FIXED_KEYS.has(q.id) && !answeredKeys.has(q.id)) newQuestionIds.push(q.id);
      }));
    }

    // Alumni's own Job Connect profile/resume (summary, skills, experience,
    // education, certifications, projects, languages) — falls back to a
    // suggestion built from their actual data if they never explicitly
    // saved one, same as the employer-facing "View resume" already does.
    const { resume, isSaved: resumeIsSaved } = await getResumeForAlumnus(result[0].alumni_id);

    // Contact Email/Number aren't asked for on this record from scratch —
    // they already exist elsewhere (the account's own login email, already
    // fetched above as `email`; the tracer study's own "Contact Number"
    // question) — so admin/coordinator sees that instead of a blank field
    // that looks like it was never filled in at all.
    const contact_email  = result[0].contact_email  || result[0].email || '';
    const contact_number = result[0].contact_number || tracer?.contactNumber || '';

    res.json({ record: { ...result[0], contact_email, contact_number, tracer_data, resume, resume_is_saved: resumeIsSaved, new_question_ids: newQuestionIds } });
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
      skills, experience, contact_email, contact_number, facebook, linkedin,
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

    // Set by the coordinator route middleware — checked before any update
    // is applied, so a coordinator can never edit a record outside their
    // own college even by hand-crafting a request with another alumni's id.
    if (req.forcedCollege) {
      const existing = await AlumniEmployment.findById(req.params.id).populate('alumni_id', 'college').lean();
      if (!existing) return res.status(404).json({ message: 'Employment record not found.' });
      if ((existing.alumni_id?.college || '') !== req.forcedCollege) {
        return res.status(403).json({ message: 'Access denied.' });
      }
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
      skills:                skills?.trim()              || '',
      experience:            experience?.trim()          || '',
      contact_email:         contact_email?.trim()       || '',
      contact_number:        contact_number?.trim()      || '',
      facebook:              facebook?.trim()            || '',
      linkedin:              linkedin?.trim()             || '',
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

// Mirrors alumniController.js's own AVATAR_DATA_URI_RE/MAX_AVATAR_BYTES —
// same validation, just for an admin/coordinator setting someone ELSE's
// photo (that endpoint only ever writes to req.user.id, the caller's own
// account) rather than duplicating a shared constant across two files for
// two small regex/size checks.
const AVATAR_DATA_URI_RE = /^data:image\/(png|jpe?g|gif|webp);base64,([a-zA-Z0-9+/]+=*)$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB decoded

// PATCH /api/admin/employment/:id/avatar  (also mounted under /coordinator,
// scoped to their college via req.forcedCollege — see updateEmploymentRecord)
const updateEmploymentRecordAvatar = async (req, res) => {
  try {
    const { avatarUrl } = req.body;
    if (typeof avatarUrl !== 'string') return res.status(400).json({ message: 'avatarUrl is required.' });

    const match = avatarUrl.match(AVATAR_DATA_URI_RE);
    if (!match) return res.status(400).json({ message: 'Avatar must be a PNG, JPEG, GIF, or WEBP image.' });

    const decodedSize = Buffer.byteLength(match[2], 'base64');
    if (decodedSize > MAX_AVATAR_BYTES) {
      return res.status(400).json({ message: 'Avatar image must be smaller than 2MB.' });
    }

    const emp = await AlumniEmployment.findById(req.params.id).populate('alumni_id', 'college firstName lastName').lean();
    if (!emp) return res.status(404).json({ message: 'Employment record not found.' });
    if (req.forcedCollege && (emp.alumni_id?.college || '') !== req.forcedCollege) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    await User.findByIdAndUpdate(emp.alumni_id._id, { avatarUrl });

    const adminName = await resolveAdminName(req.user.id);
    const alumniName = emp.alumni_id ? `${emp.alumni_id.firstName} ${emp.alumni_id.lastName}` : 'Unknown';
    logActivity(req.user.id, adminName, "updated alumni's profile photo", alumniName);

    res.json({ avatarUrl });
  } catch (err) {
    console.error('updateEmploymentRecordAvatar error:', err);
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

// GET /api/admin/employment/donut-stats — accepts the same filter set as
// getTracerAnalytics (college/course/track/batch range/gender/employment
// status/job-related/further education/survey year), plus the legacy
// ?course= param this chart's own dropdown still sends.
const getDonutStats = async (req, res) => {
  try {
    const { userMatch, tracerMatch, needsTracerJoin } = buildEmploymentChartFilters(req.query);

    const pipeline = [
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: { '_user.0': { $exists: true } } },
      { $addFields: { _u: { $arrayElemAt: ['$_user', 0] } } },
      { $match: { '_u.role': 'alumni', ...userMatch } },
    ];

    if (needsTracerJoin) {
      pipeline.push(
        { $lookup: { from: 'tracerstudyresponses', localField: 'alumni_id', foreignField: 'alumni_id', as: '_tracer' } },
        { $addFields: { _t: { $arrayElemAt: ['$_tracer', 0] } } },
        { $match: tracerMatch },
      );
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

// Case-insensitive exact-match filter — lets a canonical label picked from
// an already-normalized options list (see getTracerFilterOptions) match
// every casing variant of that value actually stored in the DB, the same
// tolerance ciGroup already applies when grouping for display.
const ciEq = (field, value) => ({ [field]: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } });

// Builds the two $match objects shared by getTracerAnalytics and
// exportTracerAnalytics so the filter-to-query translation lives in exactly
// one place. `userLookupMatch` applies to the joined `_user` array (scopes
// which alumni are considered at all); `tracerMatch` applies to the
// TracerStudyResponse document itself (scopes which of THOSE alumni's
// answers count) — kept separate because User-side filters (college/course/
// batch) and TracerStudyResponse-side filters (gender/employmentStatus/etc.)
// answer different questions: a non-respondent has no gender/employmentStatus
// at all, so KPIs like "alumni who haven't responded yet" must only ever be
// scoped by the User-side filters, never the response-side ones.
function buildTracerFilterMatch(query) {
  const college           = (query.college || '').trim().toUpperCase();
  const course            = (query.course || '').trim().toUpperCase();
  // BSIT-only specialization (User.track: TSM/WMA/NA) — only meaningful
  // once a course is picked, same dependency the frontend's cascading
  // Course → Track select already enforces.
  const track             = (query.track || '').trim().toUpperCase();
  const graduationYearFrom = parseInt(query.graduationYearFrom, 10);
  const graduationYearTo   = parseInt(query.graduationYearTo, 10);
  const gender             = (query.gender || '').trim();
  const employmentStatus   = (query.employmentStatus || '').trim();
  const jobRelatedToDegree = (query.jobRelatedToDegree || '').trim();
  const furtherEducation   = (query.furtherEducation || '').trim();
  const surveyYear         = parseInt(query.surveyYear, 10);

  const userScope = { role: 'alumni' };
  if (college) userScope.college = college;
  if (course)  userScope.course  = course;
  if (track)   userScope.track   = track;
  if (!isNaN(graduationYearFrom) || !isNaN(graduationYearTo)) {
    userScope.graduationYear = {};
    if (!isNaN(graduationYearFrom)) userScope.graduationYear.$gte = graduationYearFrom;
    if (!isNaN(graduationYearTo))   userScope.graduationYear.$lte = graduationYearTo;
  }

  const userLookupMatch = { '_user.0.role': 'alumni' };
  if (college) userLookupMatch['_user.0.college'] = college;
  if (course)  userLookupMatch['_user.0.course']  = course;
  if (track)   userLookupMatch['_user.0.track']   = track;
  if (userScope.graduationYear) userLookupMatch['_user.0.graduationYear'] = userScope.graduationYear;

  const tracerMatch = {};
  if (gender)             Object.assign(tracerMatch, ciEq('gender', gender));
  if (employmentStatus)   Object.assign(tracerMatch, ciEq('employmentStatus', employmentStatus));
  if (jobRelatedToDegree) Object.assign(tracerMatch, ciEq('jobRelatedToDegree', jobRelatedToDegree));
  if (furtherEducation)   Object.assign(tracerMatch, ciEq('furtherEducation', furtherEducation));
  if (!isNaN(surveyYear)) tracerMatch.$expr = { $eq: [{ $year: '$submittedAt' }, surveyYear] };

  return { userScope, userLookupMatch, tracerMatch };
}

// Same 10-field filter vocabulary as buildTracerFilterMatch above, but
// shaped for aggregations that start from AlumniEmployment (getDonutStats)
// and join the alumnus's User/TracerStudyResponse docs as singular `_u`/`_t`
// sub-documents (via $arrayElemAt) rather than the raw `_user` array
// TracerStudyResponse-rooted aggregations use — so the match keys need
// `_u.`/`_t.` prefixes instead.
function buildEmploymentChartFilters(query) {
  const college           = (query.college || '').trim().toUpperCase();
  const course            = (query.course || '').trim().toUpperCase();
  const track             = (query.track || '').trim().toUpperCase();
  const graduationYearFrom = parseInt(query.graduationYearFrom, 10);
  const graduationYearTo   = parseInt(query.graduationYearTo, 10);
  const gender             = (query.gender || '').trim();
  const employmentStatus   = (query.employmentStatus || '').trim();
  const jobRelatedToDegree = (query.jobRelatedToDegree || '').trim();
  const furtherEducation   = (query.furtherEducation || '').trim();
  const surveyYear         = parseInt(query.surveyYear, 10);

  const userMatch = {};
  if (college) userMatch['_u.college'] = college;
  if (course)  userMatch['_u.course']  = course;
  if (track)   userMatch['_u.track']   = track;
  if (!isNaN(graduationYearFrom) || !isNaN(graduationYearTo)) {
    userMatch['_u.graduationYear'] = {};
    if (!isNaN(graduationYearFrom)) userMatch['_u.graduationYear'].$gte = graduationYearFrom;
    if (!isNaN(graduationYearTo))   userMatch['_u.graduationYear'].$lte = graduationYearTo;
  }

  const tracerMatch = {};
  if (gender)             Object.assign(tracerMatch, ciEq('_t.gender', gender));
  if (employmentStatus)   Object.assign(tracerMatch, ciEq('_t.employmentStatus', employmentStatus));
  if (jobRelatedToDegree) Object.assign(tracerMatch, ciEq('_t.jobRelatedToDegree', jobRelatedToDegree));
  if (furtherEducation)   Object.assign(tracerMatch, ciEq('_t.furtherEducation', furtherEducation));
  if (!isNaN(surveyYear)) tracerMatch.$expr = { $eq: [{ $year: '$_t.submittedAt' }, surveyYear] };

  const needsTracerJoin = !!(gender || employmentStatus || jobRelatedToDegree || furtherEducation || !isNaN(surveyYear));

  return { userMatch, tracerMatch, needsTracerJoin };
}

// Powers the "Tracer Study Analytics" dashboard section — one aggregation
// covering every tracer-form section (respondent profile, exam, employment,
// occupation/industry, unemployment reasons, personal growth, further
// education, promotion, professional development) plus a set of headline
// KPI numbers, all scoped by the same combined filter set (see
// buildTracerFilterMatch above). Shared by getTracerAnalytics (the dashboard
// endpoint) and exportTracerAnalytics (the Excel "Summary" sheet) so this
// pipeline exists in exactly one place.
async function computeTracerAnalytics(query) {
    const { userScope, userLookupMatch, tracerMatch } = buildTracerFilterMatch(query);
    const tracerMatchStage = Object.keys(tracerMatch).length ? [{ $match: tracerMatch }] : [];

    const [[result], totalAlumniOnRoll, totalActiveAlumni] = await Promise.all([
      TracerStudyResponse.aggregate([
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
      // College/course/batch-year filters (userLookupMatch) narrow which
      // alumni are considered at all; the remaining tracer-only filters
      // (tracerMatch/tracerMatchStage) narrow which of those alumni's
      // answers count — prepended to every facet branch below so every
      // chart AND every KPI is scoped by the identical combined filter set.
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: userLookupMatch },
      {
        $facet: {
          // Deliberately NOT prefixed with tracerMatchStage — this counts
          // every alumnus in the User-side filter scope regardless of
          // whether/how they answered the tracer-only fields, since a
          // non-respondent has no gender/employmentStatus/etc. at all.
          totalInUserScope: [{ $count: 'count' }],

          total: [...tracerMatchStage, { $count: 'count' }],

          byGender: [...tracerMatchStage, ...groupCount('gender')],
          // Some bulk-migrated records stored multiple selected programs as a
          // single ';'-joined array element instead of separate elements —
          // split those apart so each program is counted individually.
          byProgram: [
            ...tracerMatchStage,
            { $unwind: { path: '$programsCompleted', preserveNullAndEmptyArrays: false } },
            { $project: { parts: { $split: ['$programsCompleted', ';'] } } },
            { $unwind: '$parts' },
            { $project: { part: { $trim: { input: '$parts' } } } },
            { $match: { part: { $ne: '' } } },
            ...ciGroup('$part'),
            { $limit: 10 },
          ],

          examStatus: [...tracerMatchStage, ...groupCount('professionalExam')],
          examNames: [
            ...tracerMatchStage,
            { $match: notBlank('professionalExamName') },
            ...ciGroup('$professionalExamName'),
            { $limit: 10 },
          ],

          byEmploymentStatus: [...tracerMatchStage, ...groupCount('employmentStatus')],
          byJobRelevance: [
            ...tracerMatchStage,
            { $match: { employmentStatus: 'Yes', ...notBlank('jobRelatedToDegree') } },
            ...ciGroup('$jobRelatedToDegree'),
          ],
          byDuration: [
            ...tracerMatchStage,
            { $match: { employmentStatus: 'Yes', ...notBlank('yearsInCurrentJob') } },
            ...ciGroup('$yearsInCurrentJob'),
          ],

          topOccupations: [
            ...tracerMatchStage,
            { $match: { employmentStatus: 'Yes', ...notBlank('occupationTitle') } },
            ...ciGroup('$occupationTitle'),
            { $limit: 10 },
          ],
          byIndustry: [
            ...tracerMatchStage,
            { $match: { employmentStatus: 'Yes', ...notBlank('industryField') } },
            ...ciGroup('$industryField'),
          ],

          unemploymentReasons: [
            ...tracerMatchStage,
            { $match: { employmentStatus: { $in: ['No', 'Never Employed'] } } },
            { $unwind: { path: '$reasonsNotEmployed', preserveNullAndEmptyArrays: false } },
            ...ciGroup('$reasonsNotEmployed'),
          ],

          personalGrowth: [
            ...tracerMatchStage,
            { $project: { ratings: { $objectToArray: '$personalGrowthRatings' } } },
            { $unwind: '$ratings' },
            { $match: { 'ratings.v': { $nin: ['', null] } } },
            { $group: { _id: { skill: '$ratings.k', rating: '$ratings.v' }, count: { $sum: 1 } } },
          ],

          byFurtherEducation: [...tracerMatchStage, ...groupCount('furtherEducation')],
          byTrainings: [...tracerMatchStage, ...groupCount('pursuedTrainings')],

          byPromotion: [...tracerMatchStage, ...groupCount('promotedInJob')],
          byAccomplishments: [...tracerMatchStage, ...groupCount('significantAccomplishments')],

          byCertifications: [...tracerMatchStage, ...groupCount('professionalCertifications')],
          byDevActivities: [...tracerMatchStage, ...groupCount('professionalDevelopmentActivities')],
        },
      },
      ]),
      User.countDocuments(userScope),
      User.countDocuments({ ...userScope, status: 'active' }),
    ]);

    const mapRows = (rows) => (rows || []).map((r) => ({ label: r.label ?? r._id, count: r.count }));

    const personalGrowth = Object.entries(SKILL_LABELS).map(([key, label]) => {
      const ratings = {};
      (result.personalGrowth || [])
        .filter((r) => r._id.skill === key)
        .forEach((r) => { ratings[r._id.rating] = r.count; });
      return { skill: label, ratings };
    });

    // KPI tiles for the dashboard header — all derived in JS from facet
    // branches already computed above, no extra Mongo round-trips.
    // "Total Active Alumni"/"Total Alumni on Roll"/"Not-Yet Tracer
    // Response"/"Overall Tracer Response Rate" intentionally use only the
    // User-side filter scope (totalAlumniOnRoll/totalInUserScope), never the
    // tracer-only filters — see buildTracerFilterMatch's comment.
    const YES_STARTS = /^yes/i;
    // "Employed" here includes self-employed respondents — matches
    // getDonutStats() and every AI-chatbot aggregation, which all treat
    // self-employed as employed. A plain /^yes$/i (excluding "Self-Employed")
    // made this KPI tile silently disagree with the donut chart right below it.
    const YES = /^yes$|^self[- ]?employed$/i;
    // Same "unemployed" vocabulary the unemploymentReasons facet above
    // already uses ($in: ['No', 'Never Employed']) — matched as a regex here
    // since these labels went through ciGroup's casing normalization.
    const NOT_EMPLOYED = /^no$|never/i;
    const findCount = (rows, re) => rows.reduce((s, r) => (re.test(r.label) ? s + r.count : s), 0);

    const totalRespondents     = result.total?.[0]?.count ?? 0;
    const totalInUserScope     = result.totalInUserScope?.[0]?.count ?? 0;
    const notYetTracerResponse = Math.max(0, totalAlumniOnRoll - totalInUserScope);
    const overallResponseRate  = totalAlumniOnRoll ? Math.round((totalInUserScope / totalAlumniOnRoll) * 100) : 0;

    const employedRespondents          = findCount(mapRows(result.byEmploymentStatus), YES);
    const unemployedRespondents        = findCount(mapRows(result.byEmploymentStatus), NOT_EMPLOYED);
    const employmentRate               = totalRespondents ? Math.round((employedRespondents / totalRespondents) * 100) : 0;
    const furtherEducationCount        = findCount(mapRows(result.byFurtherEducation), YES);
    const professionalDevelopmentCount = findCount(mapRows(result.byDevActivities), YES);
    const awardsCount                  = findCount(mapRows(result.byAccomplishments), YES_STARTS);

    const RATING_SCORE = { excellent: 5, competent: 4, satisfactory: 3, beginner: 2, 'non-acceptable': 1 };
    let growthSum = 0, growthN = 0;
    (result.personalGrowth || []).forEach((r) => {
      const score = RATING_SCORE[String(r._id.rating).toLowerCase().trim()];
      if (score) { growthSum += score * r.count; growthN += r.count; }
    });
    const avgPersonalGrowthScore = growthN ? +(growthSum / growthN).toFixed(2) : null;

    const kpis = {
      totalActiveAlumni,
      totalAlumniOnRoll,
      totalTracerRespondents: totalRespondents,
      notYetTracerResponse,
      overallResponseRate,
      employedRespondents,
      unemployedRespondents,
      employmentRate,
      furtherEducationCount,
      professionalDevelopmentCount,
      awardsCount,
      avgPersonalGrowthScore,
    };

    return {
      kpis,
      total: totalRespondents,
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
    };
}

// GET /api/admin/employment/tracer-analytics
const getTracerAnalytics = async (req, res) => {
  try {
    const data = await computeTracerAnalytics(req.query);
    res.json(data);
  } catch (err) {
    console.error('getTracerAnalytics error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/tracer-filter-options  ← static, before /:id
// Supplies the option lists for the Tracer Dashboard's filter dropdowns.
// Fetched once, unfiltered, on page mount rather than recomputed per applied
// filter — these vocabularies change rarely, and recomputing them from an
// already-filtered subset would make other dropdowns' options shrink/
// disappear as soon as one filter is picked. College/course options aren't
// included here — they're a fixed application vocabulary, not user-submitted
// free text, so the frontend keeps them as a static constant instead of a DB
// round-trip.
const getTracerFilterOptions = async (req, res) => {
  try {
    const dedupField = (field) =>
      TracerStudyResponse.aggregate([...groupCount(field), { $project: { _id: 0, label: 1 } }]);

    const [genders, employmentStatuses, jobRelated, furtherEd, years, gradBounds] = await Promise.all([
      dedupField('gender'),
      dedupField('employmentStatus'),
      dedupField('jobRelatedToDegree'),
      dedupField('furtherEducation'),
      TracerStudyResponse.aggregate([
        { $match: notBlank('submittedAt') },
        { $group: { _id: { $year: '$submittedAt' } } },
        { $sort: { _id: -1 } },
      ]),
      User.aggregate([
        { $match: { role: 'alumni', graduationYear: { $ne: null } } },
        { $group: { _id: null, min: { $min: '$graduationYear' }, max: { $max: '$graduationYear' } } },
      ]),
    ]);

    res.json({
      genders:                   genders.map((g) => g.label),
      employmentStatuses:        employmentStatuses.map((g) => g.label),
      jobRelatedToDegreeOptions: jobRelated.map((g) => g.label),
      furtherEducationOptions:   furtherEd.map((g) => g.label),
      surveyYears:               years.map((y) => y._id).filter(Boolean),
      graduationYearBounds:      gradBounds[0] ? { min: gradBounds[0].min, max: gradBounds[0].max } : { min: null, max: null },
    });
  } catch (err) {
    console.error('getTracerFilterOptions error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const TRACER_KPI_LABELS = {
  totalActiveAlumni:            'Total Active Alumni',
  totalAlumniOnRoll:            'Total Alumni on Roll',
  totalTracerRespondents:       'Total Tracer Respondents',
  notYetTracerResponse:         'Not-Yet Tracer Response',
  overallResponseRate:          'Overall Tracer Response Rate (%)',
  employedRespondents:          'Total Employed',
  unemployedRespondents:        'Total Unemployed',
  employmentRate:               'Employment Rate (%)',
  furtherEducationCount:        'Further Education (Yes)',
  professionalDevelopmentCount: 'Professional Development (Yes)',
  awardsCount:                  'Awards / Recognition (Yes)',
  avgPersonalGrowthScore:       'Avg. Personal Growth Score (1-5)',
};

// Array-of-arrays for the Excel export's "Summary" sheet: KPI values, then
// one Label/Count/Percent block per existing chart section — same shape the
// dashboard's own per-chart CSV export already uses (distCsv/ratingMatrixCsv
// in TracerDashboardView.jsx), just server-side so it can sit in one sheet.
function buildTracerSummaryRows(data) {
  const rows = [['Tracer Study Analytics — Summary'], []];

  rows.push(['KPI', 'Value']);
  Object.entries(TRACER_KPI_LABELS).forEach(([key, label]) => {
    rows.push([label, data.kpis[key] ?? '']);
  });
  rows.push([]);

  const pctOf = (count, total) => (total > 0 ? `${Math.round((count / total) * 100)}%` : '');
  function distBlock(title, list) {
    rows.push([title]);
    rows.push(['Label', 'Count', 'Percent']);
    const total = (list || []).reduce((a, r) => a + r.count, 0);
    (list || []).forEach((r) => rows.push([r.label, r.count, pctOf(r.count, total)]));
    rows.push([]);
  }

  distBlock('Respondent Profile — By Gender', data.respondentProfile.byGender);
  distBlock('Respondent Profile — By Program', data.respondentProfile.byProgram);
  distBlock('Professional Examination — Participation', data.professionalExam.byStatus);
  distBlock('Employment Overview — Status', data.employmentOverview.byStatus);
  distBlock('Employment Overview — Job-Relatedness', data.employmentOverview.byJobRelevance);
  distBlock('Employment Overview — Duration in Current Job', data.employmentOverview.byDuration);
  distBlock('Occupation and Industry — Top Occupations', data.occupationIndustry.topOccupations);
  distBlock('Occupation and Industry — By Industry', data.occupationIndustry.byIndustry);
  distBlock('Unemployment Reasons', data.unemploymentReasons);
  distBlock('Further Education — Pursued Further Education', data.furtherEducation.byFurtherEducation);
  distBlock('Further Education — Pursued Trainings', data.furtherEducation.byTrainings);
  distBlock('Promotion and Recognition — Promoted in Current Job', data.promotion.byPromotion);
  distBlock('Promotion and Recognition — Significant Accomplishments', data.promotion.byAccomplishments);
  distBlock('Professional Development — Certifications', data.professionalDevelopment.byCertifications);
  distBlock('Professional Development — Activities', data.professionalDevelopment.byDevActivities);

  rows.push(['Personal Growth Assessment']);
  rows.push(['Skill', 'Rating', 'Count', 'Percent']);
  (data.personalGrowth || []).forEach(({ skill, ratings }) => {
    const total = Object.values(ratings).reduce((a, b) => a + b, 0);
    Object.entries(ratings).forEach(([rating, count]) => {
      rows.push([skill, rating, count, pctOf(count, total)]);
    });
  });

  return rows;
}

// GET /api/admin/employment/tracer-analytics/export  ← static, before /:id
// Modeled directly on exportEmploymentRecords above. CSV is the raw
// per-respondent rows only (single-table by nature); Excel additionally gets
// a "Summary" sheet (KPIs + every chart section) built from the exact same
// computeTracerAnalytics() the dashboard itself renders, so the export
// always agrees with what's on screen for the same applied filters.
const exportTracerAnalytics = async (req, res) => {
  try {
    const { format = 'csv' } = req.query;
    const { userLookupMatch, tracerMatch } = buildTracerFilterMatch(req.query);
    const tracerMatchStage = Object.keys(tracerMatch).length ? [{ $match: tracerMatch }] : [];

    const respondentRows = await TracerStudyResponse.aggregate([
      { $lookup: { from: 'users', localField: 'alumni_id', foreignField: '_id', as: '_user' } },
      { $match: userLookupMatch },
      ...tracerMatchStage,
      { $addFields: { _u: { $arrayElemAt: ['$_user', 0] } } },
      { $sort: { submittedAt: -1 } },
      {
        $project: {
          _id: 0,
          Name:                                  { $concat: ['$_u.firstName', ' ', '$_u.lastName'] },
          College:                                '$_u.college',
          Course:                                 '$_u.course',
          Track:                                  { $ifNull: ['$_u.track', ''] },
          'Batch Year':                           { $ifNull: ['$_u.graduationYear', ''] },
          Gender:                                 '$gender',
          'Employment Status':                    '$employmentStatus',
          Occupation:                             '$occupationTitle',
          Industry:                               '$industryField',
          'Job Related to Degree':                '$jobRelatedToDegree',
          'Years in Current Job':                 '$yearsInCurrentJob',
          'Professional Exam':                    '$professionalExam',
          'Exam Name':                            '$professionalExamName',
          'Further Education':                    '$furtherEducation',
          'Pursued Trainings':                    '$pursuedTrainings',
          'Promoted in Job':                      '$promotedInJob',
          'Significant Accomplishments':          '$significantAccomplishments',
          'Professional Certifications':          '$professionalCertifications',
          'Professional Development Activities':  '$professionalDevelopmentActivities',
          'Submitted At':                         { $dateToString: { format: '%m/%d/%Y', date: '$submittedAt' } },
        },
      },
    ]);

    const adminName = await resolveAdminName(req.user.id);
    logActivity(req.user.id, adminName, 'exported tracer analytics', '', `${format} — ${respondentRows.length} records`);

    if (format === 'excel') {
      const summaryData = await computeTracerAnalytics(req.query);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildTracerSummaryRows(summaryData)), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(respondentRows), 'Respondent Data');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.set({
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="tracer-analytics.xlsx"',
      });
      return res.send(buf);
    }

    const headers = respondentRows.length
      ? Object.keys(respondentRows[0])
      : ['Name','College','Course','Track','Batch Year','Gender','Employment Status','Occupation','Industry',
         'Job Related to Degree','Years in Current Job','Professional Exam','Exam Name','Further Education',
         'Pursued Trainings','Promoted in Job','Significant Accomplishments','Professional Certifications',
         'Professional Development Activities','Submitted At'];

    const csv = [
      headers.map((h) => `"${h}"`).join(','),
      ...respondentRows.map((r) =>
        headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    res.set({
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="tracer-analytics.csv"',
    });
    res.send('﻿' + csv);
  } catch (err) {
    console.error('exportTracerAnalytics error:', err);
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
//
// This used to reprocess EVERY tracer response, every time, sequentially —
// each with its own TracerFormConfig lookup and up to 3 more DB round-trips
// — regardless of whether anything had actually changed since the last
// sync. With 258 responses that took 30+ seconds on every single Employment
// Details page load. Now it only touches tracers whose response was
// updated more recently than the last sync recorded on that alumnus's
// AlumniEmployment (tracer_synced_at) — a page load with nothing new to
// sync does two cheap lookup queries and no per-tracer writes at all — and
// the config lookup that used to repeat per-tracer happens once up front.
const syncTracerToEmployment = async (req, res) => {
  try {
    const responses = await TracerStudyResponse.find().lean();
    if (!responses.length) return res.json({ updated: 0, skipped: 0 });

    const alumniIds = responses.map((t) => t.alumni_id);
    const existing = await AlumniEmployment.find(
      { alumni_id: { $in: alumniIds } },
      'alumni_id tracer_synced_at'
    ).lean();
    const syncedAtMap = new Map(existing.map((e) => [String(e.alumni_id), e.tracer_synced_at]));

    const pending = responses.filter((tracer) => {
      const syncedAt = syncedAtMap.get(String(tracer.alumni_id));
      return !syncedAt || new Date(tracer.updatedAt) > new Date(syncedAt);
    });

    if (!pending.length) return res.json({ updated: 0, skipped: responses.length });

    let cfg = await TracerFormConfig.findOne({ college: 'CCS' }).lean();

    await Promise.all(pending.map(async (tracer) => {
      const extraAnswers = (tracer.extra_answers instanceof Map)
        ? Object.fromEntries(tracer.extra_answers)
        : (tracer.extra_answers || {});

      const extraResolved = await resolveExtraFromTracer(extraAnswers, 'CCS', cfg);

      const reasonsArr = Array.isArray(tracer.reasonsNotEmployed) ? tracer.reasonsNotEmployed : [];
      const jrd = String(tracer.jobRelatedToDegree || '').toLowerCase().trim();

      const computed = {
        employment_status:     mapTracerStatus(tracer.employmentStatus),
        job_title:             tracer.occupationTitle       || '',
        industry:              tracer.industryField         || '',
        job_related_to_course: jrd.startsWith('yes'),
        reason_unemployed:     reasonsArr.join('; '),
        employment_type:       tracer.presentEmploymentType || '',
        years_in_current_job:  tracer.yearsInCurrentJob     || '',
        ...extraResolved,
      };

      // `pending` above is keyed off TracerStudyResponse.updatedAt, which
      // Mongoose bumps on ANY change to that document — including fields
      // that have nothing to do with employment data (e.g. Notify Alumni's
      // pendingUpdateQuestionIds flag). Without this comparison, that alone
      // used to overwrite last_updated with "now" even though none of the
      // actual synced fields changed, making the Employment table's "Last
      // Updated" column lie about when the alumni's data was really touched.
      const current = await AlumniEmployment.findOne({ alumni_id: tracer.alumni_id }).lean();
      const changed = !current || Object.keys(computed).some(
        (k) => JSON.stringify(current[k] ?? null) !== JSON.stringify(computed[k] ?? null)
      );

      const updates = {
        ...computed,
        tracer_synced_at: new Date(),
        ...(changed ? { last_updated: new Date() } : {}),
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
    }));

    res.json({ updated: pending.length, skipped: responses.length - pending.length });
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

// GET /api/admin/employment/notify-candidates
// Same filter set as getEmploymentRecords, but each row also reports how many
// of the alumni's college's current custom/imported tracer-form questions
// they haven't answered yet ("new questions" — added or imported after they
// last submitted). Lets the Notify Alumni page target only alumni who
// actually have something new to fill in, instead of everyone matching the
// filters regardless of whether they need to do anything.
const getNotifyCandidates = async (req, res) => {
  try {
    const {
      search = '', status = '', college = '', course = '', batch_year = '',
      new_questions_only = '', page = 1, limit = 25,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const base = buildBasePipeline({ search, status, college, course, batch_year, company: '' });
    const allRecords = await AlumniEmployment.aggregate([
      ...base,
      { $sort: { last_updated: -1 } },
      listProjection,
    ]);

    // Small, college-keyed set of "answerable, non-fixed" question ids per
    // current form config — cheap to hold in memory (one doc per college).
    const configs = await TracerFormConfig.find({}).select('college config').lean();
    const collegeQuestionIds = new Map();
    configs.forEach((c) => {
      const ids = new Set();
      (c.config?.pages || []).forEach((p) => (p.questions || []).forEach((q) => {
        if (q.type !== 'static_text' && !FIXED_KEYS.has(q.id)) ids.add(q.id);
      }));
      collegeQuestionIds.set(c.college, ids);
    });

    const alumniIds = allRecords.map((r) => r.alumni_id);
    const responses = await TracerStudyResponse.find({ alumni_id: { $in: alumniIds } })
      .select('alumni_id extra_answers pendingUpdateQuestionIds').lean();
    const responseByAlumni = new Map(responses.map((r) => [String(r.alumni_id), r]));

    const withCounts = allRecords.map((r) => {
      const resp = responseByAlumni.get(String(r.alumni_id));
      // null = alumni never submitted at all — a different case (they need
      // the full form, not just the new-question gap) so it's kept distinct
      // from 0 ("submitted before and is fully caught up").
      let newQuestionsCount = null;
      if (resp) {
        const answeredKeys = new Set(Object.keys(resp.extra_answers || {}));
        const pendingIds   = new Set(resp.pendingUpdateQuestionIds || []);
        const questionIds  = collegeQuestionIds.get(r.college) || new Set();
        const autoNew      = [...questionIds].filter((id) => !answeredKeys.has(id) && !pendingIds.has(id)).length;
        newQuestionsCount  = autoNew + pendingIds.size;
      }
      return { ...r, newQuestionsCount };
    });

    const filtered = new_questions_only === 'true'
      ? withCounts.filter((r) => r.newQuestionsCount > 0)
      : withCounts;

    const total = filtered.length;
    const skip  = (pageNum - 1) * limitNum;
    const records = filtered.slice(skip, skip + limitNum);

    res.json({
      records,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 1 },
    });
  } catch (err) {
    console.error('getNotifyCandidates error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/admin/employment/notify
const { sendEmploymentReminderBulk } = require('../utils/emailService');

// Mirrors NOTIFY_ALUMNI_DISABLED in frontend/src/pages/admin/NotifyAlumniView.jsx.
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
    const { college, course, alumni_ids, question_ids } = req.body;
    const query = { role: 'alumni', status: 'active' };
    // Explicit selection (checked rows on the Notify Alumni page) takes
    // priority over the college/course scope — those two are mutually
    // exclusive ways of picking a recipient list, not filters that combine.
    if (Array.isArray(alumni_ids) && alumni_ids.length > 0) {
      query._id = { $in: alumni_ids };
    } else {
      if (college) query.college = college;
      if (course)  query.course  = course;
    }
    // Set by the coordinator route middleware — scopes the query to their
    // assigned college even when alumni_ids was used, so a coordinator can
    // never sneak in another college's alumni via a hand-crafted request.
    if (req.forcedCollege) query.college = req.forcedCollege;

    const alumni = await User.find(query).select('email');
    if (alumni.length === 0)
      return res.status(404).json({ message: 'No active alumni found matching the filters.' });

    // Optional: admin picked specific existing questions (not just
    // auto-detected new ones) that these alumni should re-answer/update —
    // flagged on their TracerStudyResponse so the alumni-side "new
    // questions" gate surfaces them too. Only meaningful for alumni who
    // already have a response; someone who's never submitted gets the full
    // form regardless and doesn't need this flag.
    if (Array.isArray(question_ids) && question_ids.length > 0) {
      await TracerStudyResponse.updateMany(
        { alumni_id: { $in: alumni.map((a) => a._id) } },
        { $addToSet: { pendingUpdateQuestionIds: { $each: question_ids } } },
      );
    }

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
    const lookup = [
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

    const [colleges, batches] = await Promise.all([
      TracerStudyResponse.aggregate([
        ...lookup,
        { $match: { 'alumni.college': { $exists: true, $ne: '' } } },
        { $group: { _id: '$alumni.college' } },
        { $sort: { _id: 1 } },
      ]),
      TracerStudyResponse.aggregate([
        ...lookup,
        { $match: { 'alumni.graduationYear': { $exists: true, $ne: null } } },
        { $group: { _id: '$alumni.graduationYear' } },
        { $sort: { _id: -1 } },
      ]),
    ]);

    res.json({
      colleges: colleges.map(r => r._id).filter(Boolean),
      batches:  batches.map(r => r._id).filter(Boolean),
    });
  } catch (err) {
    console.error('getTracerResponseColleges error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/employment/responses
const getTracerResponses = async (req, res) => {
  try {
    const {
      search = '', college = '', batch = '', employment_status = '',
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
    if (batch)   base.push({ $match: { 'alumni.graduationYear': parseInt(batch, 10) } });
    if (search) {
      base.push({
        $match: {
          $expr: {
            $regexMatch: {
              input:   { $concat: ['$alumni.firstName', ' ', '$alumni.lastName'] },
              regex:   escapeRegex(search),
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
    // Set by the coordinator route middleware — a coordinator can only open
    // a response belonging to their own college, even by guessing/hand-
    // crafting another alumni's id directly in the URL.
    if (req.forcedCollege && user.college !== req.forcedCollege) {
      return res.status(403).json({ message: 'Access denied.' });
    }

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
  getBatchYears,
  createEmploymentRecord,
  syncTracerToEmployment,
  backfillEmploymentRecords,
  getDonutStats,
  getCourseJobStats,
  getSurveyStats,
  getEmploymentStats,
  getTracerAnalytics,
  getTracerFilterOptions,
  exportTracerAnalytics,
  getEmploymentRecords,
  getEmploymentRecord,
  updateEmploymentRecord,
  updateEmploymentRecordAvatar,
  getEmploymentActivity,
  exportEmploymentRecords,
  logPrintActivity,
  getTracerQuestions,
  createTracerQuestion,
  updateTracerQuestion,
  deleteTracerQuestion,
  reorderTracerQuestions,
  notifyAlumniToUpdate,
  getNotifyCandidates,
  getTracerResponseColleges,
  getTracerResponses,
  getTracerResponseDetail,
  logActivity,
  resolveAdminName,
};
