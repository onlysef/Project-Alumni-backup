const bcrypt               = require('bcryptjs');
const User                 = require('../models/User');
const AlumniEmployment     = require('../models/AlumniEmployment');
const TracerStudyResponse  = require('../models/TracerStudyResponse');
const TracerFormConfig     = require('../models/TracerFormConfig');
const Graduate             = require('../models/Graduate');
const EmbeddingDocument    = require('../models/EmbeddingDocument');
const Announcement         = require('../models/Announcement');
const Job                  = require('../models/Job');
const Event                = require('../models/Event');
const { getTracerFormConfig } = require('./tracerFormConfigController');
const { getEmbedding }        = require('../services/embeddingService');
const { tracerRowToText }     = require('../utils/fileParser');

// The set of keys that the TracerStudyResponse schema handles directly.
// Everything else in the submitted answers object goes into extra_answers.
const FIXED_KEYS = new Set([
  'consent', // validated on frontend; not persisted
  'contactNumber', 'gender',
  'programsCompleted', 'professionalExam', 'professionalExamName',
  'employmentStatus', 'companyName', 'placeOfWork', 'occupationTitle', 'industryField',
  'presentEmploymentType', 'jobRelatedToDegree', 'yearsInCurrentJob',
  'reasonsNotEmployed',
  'furtherEducation', 'furtherEducationType',
  'pursuedTrainings', 'trainingType',
  'personalGrowthRatings',
  'promotedInJob', 'significantAccomplishments',
  'professionalCertifications', 'professionalDevelopmentActivities',
]);

// Maps the tracer form's employmentStatus answer to AlumniEmployment status enum.
// The tracer form typically uses "Yes" / "No" / "Never Employed".
function mapEmploymentStatus(tracerStatus) {
  if (!tracerStatus) return 'Not Yet Updated';
  const s = String(tracerStatus).toLowerCase().trim();
  if (s === 'yes') return 'Employed';
  if (s === 'no')  return 'Unemployed';
  if (s.includes('never'))  return 'Unemployed';
  if (s.includes('self'))   return 'Self-employed';
  // Fallback: look for "employ" but exclude "unemploy"
  if (s.includes('employ') && !s.includes('un')) return 'Employed';
  if (s.includes('unemploy')) return 'Unemployed';
  return 'Not Yet Updated';
}

// Extracts only the AlumniEmployment fields that come from the tracer form.
// company_name and work_location are resolved separately via resolveExtraEmploymentFields.
function extractEmploymentFromTracer(answers) {
  const reasonsArr = Array.isArray(answers.reasonsNotEmployed)
    ? answers.reasonsNotEmployed
    : answers.reasonsNotEmployed ? [answers.reasonsNotEmployed] : [];

  // jobRelatedToDegree may be a full sentence ("Yes, my job is related to…")
  const jrd = String(answers.jobRelatedToDegree || '').toLowerCase().trim();

  return {
    employment_status:     mapEmploymentStatus(answers.employmentStatus),
    company_name:           answers.companyName          || '',
    job_title:             answers.occupationTitle      || '',
    industry:              answers.industryField        || '',
    job_related_to_course: jrd.startsWith('yes'),
    reason_unemployed:     reasonsArr.join('; '),
    employment_type:       answers.presentEmploymentType || '',
    years_in_current_job:  answers.yearsInCurrentJob    || '',
  };
}

// Maps programsCompleted array → User.course code (BSIT / BSCS / BSIS)
function mapProgramToCourse(programsCompleted) {
  if (!Array.isArray(programsCompleted) || !programsCompleted.length) return '';
  const combined = programsCompleted.join(' ').toLowerCase();
  if (combined.includes('information technology')) return 'BSIT';
  if (combined.includes('computer science'))       return 'BSCS';
  if (combined.includes('information systems'))    return 'BSIS';
  if (combined.includes('information management')) return 'BSIM';
  return '';
}

// Maps programsCompleted → BSIT track (TSM / WMA / NA / '')
function mapProgramToTrack(programsCompleted) {
  if (!Array.isArray(programsCompleted) || !programsCompleted.length) return '';
  const combined = programsCompleted.join(' ').toLowerCase();
  if (combined.includes('network administration'))       return 'NA';
  if (combined.includes('web and mobile'))               return 'WMA';
  if (combined.includes('technical service management')) return 'TSM';
  return '';
}

// Finds company_name, work_location, and graduation_year from admin-added custom
// tracer questions by matching question labels — no hardcoded IDs.
// `college` must be the SUBMITTING alumnus's own college, not a fixed
// default — this used to always read CCS's form config regardless of who
// submitted, so a non-CCS alumnus's "Company Name"/"Work Location"/
// "Graduation Year" answers (which live under different question IDs in
// their own college's form) never matched anything here and silently never
// populated their AlumniEmployment record.
async function resolveExtraEmploymentFields(extraAnswers, college) {
  try {
    const cfg = (college && await TracerFormConfig.findOne({ college }).lean())
              || await TracerFormConfig.findOne().sort({ updatedAt: -1 }).lean();
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

// POST /api/alumni/change-password
// Only used by the first-login onboarding flow — the alumnus is already
// authenticated via the one-time temp password they were just handed, so
// there's nothing meaningful to verify it against.
const changePassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.user.id, { password: hashed });
    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('changePassword error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /api/alumni/password — self-service change from Account Settings.
// Unlike changePassword above, this requires and verifies the current
// password first — an already-logged-in but unattended session shouldn't
// be enough on its own to lock the real owner out of their account.
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword) return res.status(400).json({ message: 'Current password is required.' });
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }
    const user = await User.findById(req.user.id).select('password');
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) return res.status(400).json({ message: 'Current password is incorrect.' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('updatePassword error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /api/alumni/avatar
const updateAvatar = async (req, res) => {
  try {
    const { avatarUrl } = req.body;
    if (typeof avatarUrl !== 'string') return res.status(400).json({ message: 'avatarUrl is required.' });
    await User.findByIdAndUpdate(req.user.id, { avatarUrl });
    res.json({ avatarUrl });
  } catch (err) {
    console.error('updateAvatar error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/alumni/complete-onboarding
const completeOnboarding = async (req, res) => {
  try {
    const {
      employment_status,
      company_name,
      job_title,
      industry,
      work_location,
      salary_range,
      job_related_to_course,
      date_employed,
      reason_unemployed,
    } = req.body;

    if (!employment_status) {
      return res.status(400).json({ message: 'Employment status is required.' });
    }

    await AlumniEmployment.findOneAndUpdate(
      { alumni_id: req.user.id },
      {
        alumni_id:             req.user.id,
        employment_status,
        company_name:          company_name          || null,
        job_title:             job_title             || null,
        industry:              industry              || null,
        work_location:         work_location         || null,
        salary_range:          salary_range          || '',
        job_related_to_course: job_related_to_course ?? null,
        date_employed:         date_employed         || null,
        reason_unemployed:     reason_unemployed     || null,
        last_updated:          new Date(),
      },
      { upsert: true, new: true }
    );

    await User.findByIdAndUpdate(req.user.id, { firstLogin: false });

    res.json({ message: 'Onboarding complete.' });
  } catch (err) {
    console.error('completeOnboarding error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/alumni/tracer-study  — returns the alumni's existing response so the
// frontend can pre-populate the form for editing.
const getMyTracerResponse = async (req, res) => {
  try {
    const response = await TracerStudyResponse.findOne({ alumni_id: req.user.id }).lean();
    if (!response) return res.json({ submitted: false, data: null });

    // Convert extra_answers Map to plain object if needed
    if (response.extra_answers instanceof Map) {
      const obj = {};
      for (const [k, v] of response.extra_answers) obj[k] = v;
      response.extra_answers = obj;
    }

    res.json({ submitted: true, data: response });
  } catch (err) {
    console.error('getMyTracerResponse error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/alumni/tracer-study
// Accepts a flat answers object. Upserts the TracerStudyResponse so alumni can
// re-submit to update their answers. Also auto-syncs the AlumniEmployment record.
const submitTracerStudy = async (req, res) => {
  try {
    const alumniId = req.user.id;
    const body     = req.body;

    // Separate extra (custom admin-added) answers from the fixed schema fields
    const extra_answers = {};
    for (const [key, value] of Object.entries(body)) {
      if (!FIXED_KEYS.has(key)) extra_answers[key] = value;
    }

    // Upsert — creates on first submit, overwrites on re-submit
    await TracerStudyResponse.findOneAndUpdate(
      { alumni_id: alumniId },
      {
        $set: {
          contactNumber:    body.contactNumber    || '',
          gender:           body.gender           || '',
          programsCompleted:    body.programsCompleted    || [],
          professionalExam:     body.professionalExam     || '',
          professionalExamName: body.professionalExamName || '',
          employmentStatus:     body.employmentStatus     || '',
          companyName:           body.companyName           || '',
          placeOfWork:           body.placeOfWork           || '',
          occupationTitle:       body.occupationTitle       || '',
          industryField:         body.industryField         || '',
          presentEmploymentType: body.presentEmploymentType || '',
          jobRelatedToDegree:    body.jobRelatedToDegree    || '',
          yearsInCurrentJob:     body.yearsInCurrentJob     || '',
          reasonsNotEmployed:    body.reasonsNotEmployed    || [],
          furtherEducation:      body.furtherEducation      || '',
          furtherEducationType:  body.furtherEducationType  || '',
          pursuedTrainings:      body.pursuedTrainings      || '',
          trainingType:          body.trainingType          || '',
          personalGrowthRatings: body.personalGrowthRatings || {},
          promotedInJob:                     body.promotedInJob                     || '',
          significantAccomplishments:        body.significantAccomplishments        || '',
          professionalCertifications:        body.professionalCertifications        || '',
          professionalDevelopmentActivities: body.professionalDevelopmentActivities || '',
          extra_answers,
          submittedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // Auto-sync employment record from tracer answers.
    // Extra custom questions (company name, work location) are resolved by label matching.
    const employmentUpdate = extractEmploymentFromTracer(body);
    const extraFields      = await resolveExtraEmploymentFields(extra_answers, req.user.college);
    Object.assign(employmentUpdate, extraFields);

    // When alumni is not employed, explicitly clear work-related fields so stale
    // data from a previous "employed" submission doesn't linger.
    const isNotEmployed = ['Unemployed', 'Not Yet Updated'].includes(employmentUpdate.employment_status);
    if (isNotEmployed) {
      employmentUpdate.company_name  = '';
      employmentUpdate.work_location = '';
      employmentUpdate.job_title     = '';
    }

    await AlumniEmployment.findOneAndUpdate(
      { alumni_id: alumniId },
      { $set: { ...employmentUpdate, last_updated: new Date() } },
      { upsert: true, new: true }
    );

    // Update User.course, track, and graduationYear from tracer answers
    const userUpdates = { tracerStudyCompleted: true };
    const currentUser = await User.findById(alumniId).select('course track graduationYear').lean();
    if (!currentUser?.course) {
      const mapped = mapProgramToCourse(body.programsCompleted);
      if (mapped) userUpdates.course = mapped;
    }
    // Always sync track from programsCompleted (BSIT only)
    const resolvedCourse = userUpdates.course ?? currentUser?.course ?? '';
    if (resolvedCourse === 'BSIT') {
      const mappedTrack = mapProgramToTrack(body.programsCompleted);
      if (mappedTrack) userUpdates.track = mappedTrack;
    }
    if (!currentUser?.graduationYear && extraFields.graduation_year) {
      userUpdates.graduationYear = extraFields.graduation_year;
    }
    const updatedUser = await User.findByIdAndUpdate(alumniId, userUpdates, { new: true })
      .select('firstName lastName email');

    // Keep the AI chatbot's data in sync automatically — it only ever reads
    // from the Graduate collection (never TracerStudyResponse/AlumniEmployment
    // directly), so without this hook, live tracer submissions would be
    // permanently invisible to it. Non-blocking: a sync failure here must never
    // fail the alumni's actual tracer submission.
    try {
      if (updatedUser?.email) {
        const graduatePatch = {
          name:             `${updatedUser.firstName} ${updatedUser.lastName}`.trim(),
          email:            updatedUser.email.toLowerCase().trim(),
          contact:          body.contactNumber || null,
          gender:           body.gender || null,
          program:          Array.isArray(body.programsCompleted) ? body.programsCompleted.join(';') : null,
          yearGraduated:    userUpdates.graduationYear ?? currentUser?.graduationYear ?? null,
          employmentStatus: body.employmentStatus || null,
          employmentType:   body.presentEmploymentType || null,
          workLocation:     body.placeOfWork || null,
          jobTitle:         body.occupationTitle || null,
          industry:         body.industryField || null,
          jobRelated:       body.jobRelatedToDegree || null,
          yearsInJob:       body.yearsInCurrentJob || null,
          tookExam:         body.professionalExam || null,
          furtherEducation: body.furtherEducation || null,
          furtherTraining:  body.pursuedTrainings || null,
          hasPromotion:     body.promotedInJob || null,
          competencies: {
            technicalSkills:   body.personalGrowthRatings?.technicalSkills || null,
            communication:     body.personalGrowthRatings?.communicationSkills || null,
            problemSolving:    body.personalGrowthRatings?.problemSolvingSkills || null,
            projectManagement: body.personalGrowthRatings?.projectManagement || null,
            teamwork:          body.personalGrowthRatings?.teamworkCollaboration || null,
            adaptability:      body.personalGrowthRatings?.adaptability || null,
            workLifeBalance:   body.personalGrowthRatings?.workLifeBalance || null,
            criticalThinking:  body.personalGrowthRatings?.criticalThinkingSkills || null,
          },
          data: body,
        };

        const graduateDoc = await Graduate.findOneAndUpdate(
          { email: graduatePatch.email },
          { $set: graduatePatch },
          { upsert: true, new: true }
        );

        // Rebuild this person's RAG chunk so descriptive/RAG questions about
        // them reflect the latest submission too, not just aggregation stats.
        const text = tracerRowToText({
          full_name:         graduatePatch.name,
          contact:            graduatePatch.contact,
          email:              graduatePatch.email,
          sex:                graduatePatch.gender,
          program:            graduatePatch.program,
          date_graduated:     graduatePatch.yearGraduated,
          employment_status:  graduatePatch.employmentStatus,
          employment_type:    graduatePatch.employmentType,
          job_title:          graduatePatch.jobTitle,
          industry:           graduatePatch.industry,
          work_location:      graduatePatch.workLocation,
          relevance:          graduatePatch.jobRelated,
          job_duration:       graduatePatch.yearsInJob,
          board_exam:         graduatePatch.tookExam,
          further_studies:    graduatePatch.furtherEducation,
          trainings:          graduatePatch.furtherTraining,
          promoted:           graduatePatch.hasPromotion,
        }, graduatePatch.yearGraduated);

        const embedding = await getEmbedding(text);
        await EmbeddingDocument.deleteMany({ source_type: 'imported_file', 'metadata.graduate_id': String(graduateDoc._id) });
        await EmbeddingDocument.create({
          source_type: 'imported_file',
          file_id:     null,
          content:     text,
          metadata:    { sheet_type: 'tracer', source: 'live_submission', graduate_id: String(graduateDoc._id) },
          embedding,
          chunk_index: 0,
        });
      }
    } catch (syncErr) {
      console.error('AI chatbot Graduate sync failed (non-blocking):', syncErr.message);
    }

    res.status(200).json({ message: 'Tracer study submitted successfully.' });
  } catch (err) {
    console.error('submitTracerStudy error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Out of a fixed checklist, since AlumniEmployment defaults company_name to
// 'N/A' and employment_status to 'Not Yet Updated' rather than leaving them
// empty — those default values must count as "not filled", not as real
// answers, or an alumnus who never touched their employment record would
// still show a non-zero completeness score. Limited to the fields the
// alumni's own Employment Details form actually lets them edit — the
// earlier version also checked employment_type, a field with no input on
// that form at all, so alumni could never reach 100% no matter what they did.
function computeProfileCompleteness(emp) {
  if (!emp) return 0;
  const filled = [
    emp.employment_status && emp.employment_status !== 'Not Yet Updated',
    emp.company_name && emp.company_name !== 'N/A',
    !!emp.job_title,
    !!emp.industry,
    !!emp.work_location,
  ].filter(Boolean).length;
  return Math.round((filled / 5) * 100);
}

// GET /api/alumni/employment — self-service read of the alumnus's own record
const getMyEmployment = async (req, res) => {
  try {
    const emp = await AlumniEmployment.findOne({ alumni_id: req.user.id }).lean();
    res.json({ employment: emp || null });
  } catch (err) {
    console.error('getMyEmployment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /api/alumni/employment — self-service update of the alumnus's own record
const updateMyEmployment = async (req, res) => {
  try {
    const {
      employment_status, company_name, job_title, industry, work_location,
      salary_range, date_employed, skills, experience,
    } = req.body;

    const updates = {
      employment_status: employment_status || 'Not Yet Updated',
      company_name:      company_name || 'N/A',
      job_title:         job_title || null,
      industry:          industry || null,
      work_location:     work_location || null,
      salary_range:      salary_range || '',
      skills:            skills || '',
      experience:        experience || '',
      last_updated:      new Date(),
    };
    if (date_employed) updates.date_employed = new Date(date_employed);

    const emp = await AlumniEmployment.findOneAndUpdate(
      { alumni_id: req.user.id },
      { $set: updates },
      { upsert: true, new: true }
    );
    res.json({ employment: emp });
  } catch (err) {
    console.error('updateMyEmployment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/alumni/home-summary
// Single call backing the alumni Home page's quick-stat cards, profile
// strength ring, and "similar paths" list — these used to be hardcoded
// placeholder numbers/names with no backend behind them at all.
const getHomeSummary = async (req, res) => {
  try {
    const alumniId = req.user.id;
    const me = await User.findById(alumniId).select('course college graduationYear').lean();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // The card itself is labeled "News, jobs, and campus events" — it used
    // to only count Announcement docs, so posting a new Event (a separate
    // model entirely) never moved this number, contradicting its own label.
    const college = me?.college || '';
    const eventVisibilities = ['Public', 'All Alumni'];
    if (college) eventVisibilities.push(college, `${college} Alumni`);
    const recentEventsFilter = { visibility: { $in: eventVisibilities }, createdAt: { $gte: thirtyDaysAgo } };
    // "What needs your attention" should keep showing an event for as long
    // as it's still upcoming, not just for 30 days after it was posted — an
    // event announced 40 days in advance would otherwise vanish from the
    // list before it even happens, while still being the most relevant
    // thing on the page.
    const upcomingEventsFilter = { visibility: { $in: eventVisibilities }, event_datetime: { $gte: new Date() } };

    const [announcementsCount, recentEventsCount, recommendedJobsCount, employment, networkMatchesCount, similarAlumni, recentAnnouncements, recentJobs, recentEvents] = await Promise.all([
      Announcement.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Event.countDocuments(recentEventsFilter),
      Job.countDocuments({ status: 'open' }),
      AlumniEmployment.findOne({ alumni_id: alumniId }).lean(),
      me?.course ? User.countDocuments({ role: 'alumni', course: me.course, _id: { $ne: alumniId } }) : 0,
      me?.course
        ? User.find({ role: 'alumni', course: me.course, _id: { $ne: alumniId } })
            .select('firstName lastName course graduationYear')
            .limit(3)
            .lean()
        : [],
      Announcement.find({ createdAt: { $gte: thirtyDaysAgo } }).sort({ createdAt: -1 }).limit(6).select('title type createdAt').lean(),
      Job.find({ status: 'open', createdAt: { $gte: thirtyDaysAgo } }).sort({ createdAt: -1 }).limit(6).select('title location createdAt').lean(),
      Event.find(upcomingEventsFilter).sort({ event_datetime: 1 }).limit(6).select('title location createdAt event_datetime').lean(),
    ]);

    const similarIds = similarAlumni.map((a) => a._id);
    const similarEmployments = similarIds.length
      ? await AlumniEmployment.find({ alumni_id: { $in: similarIds } }).lean()
      : [];
    const empByAlumni = new Map(similarEmployments.map((e) => [String(e.alumni_id), e]));

    const similarAlumniOut = similarAlumni.map((a) => {
      const emp = empByAlumni.get(String(a._id));
      const gradDiff = (me?.graduationYear && a.graduationYear) ? Math.abs(me.graduationYear - a.graduationYear) : null;
      const score = gradDiff === null ? 85 : Math.max(60, 95 - gradDiff * 3);
      return {
        name: `${a.firstName} ${a.lastName}`,
        initials: `${(a.firstName || '')[0] || ''}${(a.lastName || '')[0] || ''}`.toUpperCase(),
        role: emp?.job_title || 'Role not yet updated',
        match: `${a.course}${a.graduationYear ? ` · Batch ${a.graduationYear}` : ''}`,
        score: `${score}%`,
        category: 'Course match',
        reason: gradDiff === 0 ? 'Same course and batch' : 'Same course',
      };
    });

    // "What needs your attention" showed only the single most recent item
    // per category, so a second/third event (or news post) within the same
    // window silently never appeared even though it was just as recent —
    // merge all three sources and re-sort so every recent item shows,
    // newest first, instead of one per type.
    const recentUpdates = [
      // subtitle is intentionally blank here — Announcement.type is always
      // "News" now (the composer no longer offers any other type), so
      // reusing it as the subtitle just repeated the "News" kind label.
      ...recentAnnouncements.map((a) => ({ kind: 'News', title: a.title, subtitle: '', createdAt: a.createdAt, section: 'announcements' })),
      ...recentEvents.map((e) => ({ kind: 'Event', title: e.title, subtitle: e.location || 'Event', createdAt: e.createdAt, section: 'announcements&filter=Events' })),
      ...recentJobs.map((j) => ({ kind: 'Job', title: j.title, subtitle: j.location || 'Open position', createdAt: j.createdAt, section: 'jobconnect' })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 6);

    res.json({
      announcementsCount: announcementsCount + recentEventsCount,
      recommendedJobsCount,
      networkMatchesCount,
      profileCompleteness: computeProfileCompleteness(employment),
      similarAlumni: similarAlumniOut,
      recentUpdates,
    });
  } catch (err) {
    console.error('getHomeSummary error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { changePassword, updatePassword, updateAvatar, completeOnboarding, submitTracerStudy, getMyTracerResponse, getTracerFormConfig, getHomeSummary, getMyEmployment, updateMyEmployment };
