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
const { sendInquiryEmail }    = require('../utils/emailService');

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

// POST /api/alumni/inquiry
const sendInquiry = async (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!subject || !subject.trim()) return res.status(400).json({ message: 'Subject is required.' });
    if (!message || !message.trim()) return res.status(400).json({ message: 'Message is required.' });

    const user = await User.findById(req.user.id).select('firstName lastName email');
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    await sendInquiryEmail(`${user.firstName} ${user.lastName}`, user.email, subject.trim(), message.trim());
    res.json({ message: 'Your inquiry has been sent to the Alumni Office.' });
  } catch (err) {
    console.error('sendInquiry error:', err);
    res.status(500).json({ message: 'Could not send your inquiry right now. Please try again later.' });
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

function parseSkillList(skills) {
  return (skills || '')
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Ranks how close another alumnus's career path is to the viewer's own,
// using course, batch year, industry, and shared skills as signals. Used
// both for the Home page's pre-filtered (same-course) "similar paths" list
// and the general Suggested Alumni directory, where course match itself is
// one of the signals rather than a precondition for being scored at all.
function computeMatchScore(me, candidate, myEmp, theirEmp) {
  let score = 40;
  const reasons = [];

  if (me?.course && candidate.course && me.course === candidate.course) {
    score += 20;
    reasons.push('same course');
  }

  if (me?.graduationYear && candidate.graduationYear) {
    const gradDiff = Math.abs(me.graduationYear - candidate.graduationYear);
    score += Math.max(0, 15 - gradDiff * 2);
    if (gradDiff === 0) reasons.push('same batch');
  } else {
    score += 8;
  }

  const myIndustry = (myEmp?.industry || '').trim().toLowerCase();
  const theirIndustry = (theirEmp?.industry || '').trim().toLowerCase();
  if (myIndustry && theirIndustry && myIndustry === theirIndustry) {
    score += 8;
    reasons.push('same industry');
  }

  const mySkills = parseSkillList(myEmp?.skills);
  const theirSkills = parseSkillList(theirEmp?.skills);
  if (mySkills.length && theirSkills.length) {
    const overlap = mySkills.filter((s) => theirSkills.includes(s)).length;
    if (overlap > 0) {
      score += Math.round((overlap / Math.max(mySkills.length, theirSkills.length)) * 10);
      reasons.push('overlapping skills');
    }
  }

  const capped = Math.min(98, Math.max(35, Math.round(score)));
  const reasonText = reasons.length
    ? reasons[0][0].toUpperCase() + reasons[0].slice(1) + (reasons.length > 1 ? `, ${reasons.slice(1).join(', ')}` : '')
    : 'Career path match';
  return { score: capped, reason: reasonText };
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
      // Not limited to 3 here — every same-course alumnus is scored below so
      // the 3 actually shown are the closest matches, not just the first 3
      // returned by the database in whatever order it happened to store them.
      me?.course
        ? User.find({ role: 'alumni', course: me.course, _id: { $ne: alumniId } })
            .select('firstName lastName course graduationYear avatarUrl')
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
      const { score, reason } = computeMatchScore(me, a, employment, emp);
      return {
        _id: a._id,
        name: `${a.firstName} ${a.lastName}`,
        avatarUrl: a.avatarUrl || '',
        initials: `${(a.firstName || '')[0] || ''}${(a.lastName || '')[0] || ''}`.toUpperCase(),
        role: cleanEmploymentValue(emp?.job_title) || 'Role not yet updated',
        company: cleanEmploymentValue(emp?.company_name) || 'Not yet updated',
        industry: cleanEmploymentValue(emp?.industry),
        location: cleanEmploymentValue(emp?.work_location),
        skills: cleanEmploymentValue(emp?.skills),
        course: a.course || '',
        year: a.graduationYear || '',
        match: `${a.course}${a.graduationYear ? ` · Batch ${a.graduationYear}` : ''}`,
        scoreNum: score,
        score: `${score}%`,
        category: 'Course match',
        reason,
      };
    })
      .sort((a, b) => b.scoreNum - a.scoreNum)
      .slice(0, 3)
      .map(({ scoreNum, ...rest }) => rest);

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

const PLACEHOLDER_EMPLOYMENT_VALUES = new Set(['N/A', 'None', 'null', 'undefined', '']);
const cleanEmploymentValue = (v) => (v && !PLACEHOLDER_EMPLOYMENT_VALUES.has(v) ? v : '');

// GET /api/alumni/suggested?course=&year=&search=&limit=
// Backs the "Suggested Alumni" directory — this used to be 8 hardcoded
// fake profiles with no backend behind them at all.
const getSuggestedAlumni = async (req, res) => {
  try {
    const { course, year, search } = req.query;
    const limit = Math.min(600, Math.max(1, parseInt(req.query.limit, 10) || 60));

    const match = { role: 'alumni', _id: { $ne: req.user.id } };
    if (course && course !== 'All') match.course = course;
    if (year && year !== 'All') match.graduationYear = Number(year);

    const [me, myEmp, users, allCourses, allYears] = await Promise.all([
      User.findById(req.user.id).select('course graduationYear').lean(),
      AlumniEmployment.findOne({ alumni_id: req.user.id }).lean(),
      User.find(match, 'firstName lastName course graduationYear avatarUrl').sort({ lastName: 1 }).lean(),
      User.distinct('course', { role: 'alumni', course: { $nin: [null, ''] } }),
      User.distinct('graduationYear', { role: 'alumni', graduationYear: { $ne: null } }),
    ]);

    const ids = users.map((u) => u._id);
    const empRecords = ids.length
      ? await AlumniEmployment.find(
          { alumni_id: { $in: ids } },
          'alumni_id job_title company_name industry work_location skills'
        ).lean()
      : [];
    const empMap = new Map(empRecords.map((e) => [String(e.alumni_id), e]));

    let results = users.map((u) => {
      const emp = empMap.get(String(u._id));
      const { score, reason } = computeMatchScore(me, u, myEmp, emp);
      return {
        _id: u._id,
        name: `${u.firstName} ${u.lastName}`,
        avatarUrl: u.avatarUrl || '',
        role: cleanEmploymentValue(emp?.job_title) || 'Not yet updated',
        company: cleanEmploymentValue(emp?.company_name) || 'Not yet updated',
        industry: cleanEmploymentValue(emp?.industry),
        location: cleanEmploymentValue(emp?.work_location),
        skills: cleanEmploymentValue(emp?.skills),
        course: u.course || '',
        year: u.graduationYear || '',
        matchScore: score,
        matchReason: reason,
      };
    });

    if (search) {
      const q = search.toLowerCase();
      results = results.filter((r) => `${r.name} ${r.role} ${r.company}`.toLowerCase().includes(q));
    }

    // Closest matches first, so the directory leads with the alumni most
    // relevant to the viewer instead of an arbitrary alphabetical order.
    results.sort((a, b) => b.matchScore - a.matchScore);

    const total = results.length;
    results = results.slice(0, limit);

    res.json({
      alumni: results,
      total,
      filters: {
        courses: allCourses.filter(Boolean).sort(),
        years: allYears.filter(Boolean).sort((a, b) => b - a),
      },
    });
  } catch (err) {
    console.error('getSuggestedAlumni error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ============ CAREER RECOMMENDATION ============

const CAREER_PATHS = [
  { title: 'Full-Stack Developer', text: 'Build complete web applications using modern frontend and backend technologies.', skills: ['React', 'Node.js', 'JavaScript', 'HTML', 'CSS', 'SQL'], industries: ['Information Technology'], courses: ['BSIT', 'BSCS'] },
  { title: 'Software Engineer', text: 'Design, develop, and maintain reliable software systems for growing organizations.', skills: ['Java', 'Python', 'Git', 'Algorithms', 'Object-Oriented Programming', 'System Design'], industries: ['Information Technology'], courses: ['BSCS', 'BSIT'] },
  { title: 'Data Analyst', text: 'Turn raw business data into useful reports, dashboards, and actionable insights.', skills: ['SQL', 'Python', 'Excel', 'Power BI', 'Data Visualization'], industries: ['Information Technology', 'Business Process Outsourcing'], courses: ['BSIS', 'BSCS', 'BSIT'] },
  { title: 'IT Support Specialist', text: 'Keep an organization’s hardware, software, and networks running smoothly for end users.', skills: ['Troubleshooting', 'Networking', 'Hardware', 'Customer Service', 'Windows'], industries: ['Information Technology'], courses: ['BSIT', 'BSIS'] },
  { title: 'Systems Analyst', text: 'Bridge business needs and technical solutions by analyzing and documenting system requirements.', skills: ['Requirements Analysis', 'SQL', 'Business Process', 'Documentation', 'UML'], industries: ['Information Technology', 'Business Process Outsourcing'], courses: ['BSIS', 'BSIT'] },
  { title: 'Network Administrator', text: 'Set up, secure, and maintain the networks that keep an organization connected.', skills: ['Networking', 'Cisco', 'Security', 'Linux', 'Troubleshooting'], industries: ['Information Technology'], courses: ['BSIT'] },
  { title: 'UI/UX Designer', text: 'Design intuitive, user-centered interfaces for websites and applications.', skills: ['Figma', 'Wireframing', 'User Research', 'Prototyping', 'Adobe XD'], industries: ['Information Technology'], courses: ['BSIT', 'BSCS', 'BSIM'] },
  { title: 'IT Project Coordinator', text: 'Plan, schedule, and coordinate the moving pieces of technology projects from kickoff to delivery.', skills: ['Project Management', 'Communication', 'Scheduling', 'Agile', 'Leadership'], industries: ['Information Technology', 'Business Process Outsourcing'], courses: ['BSIM', 'BSIS', 'BSIT'] },
  { title: 'Database Administrator', text: 'Keep an organization’s databases available, performant, and backed up.', skills: ['SQL', 'Database Management', 'MySQL', 'Oracle', 'Backup and Recovery'], industries: ['Information Technology'], courses: ['BSCS', 'BSIT', 'BSIS'] },
  { title: 'Business Analyst', text: 'Translate business problems into requirements that technical teams can act on.', skills: ['Business Process', 'Communication', 'Excel', 'SQL', 'Requirements Analysis'], industries: ['Business Process Outsourcing', 'Information Technology'], courses: ['BSIM', 'BSIS'] },
];

// Covers the same spread of industries as the Tracer Study form's industry
// list (Information Technology, Education, Virtual Assistance, Customer
// Service, Engineering/Construction, Marketing, Healthcare, Manufacturing,
// Finance, HR, Government, Non-Profit) — alumni from IT-adjacent courses
// often end up in any of these, not just software roles.
const SKILL_BUCKETS = [
  { name: 'Programming', keywords: ['javascript', 'python', 'java', 'c++', 'c#', 'php', 'programming', 'coding', 'typescript', 'ruby', 'swift', 'kotlin', 'software development', 'algorithms', 'data structures'] },
  { name: 'Web Development', keywords: ['html', 'css', 'react', 'node', 'vue', 'angular', 'web development', 'frontend', 'backend', 'wordpress', 'next.js', 'tailwind', 'bootstrap', 'rest api', 'laravel'] },
  { name: 'Database Management', keywords: ['sql', 'mysql', 'database', 'oracle', 'mongodb', 'postgresql', 'data management', 'firebase', 'nosql'] },
  { name: 'Networking', keywords: ['networking', 'cisco', 'network', 'router', 'firewall', 'network security', 'lan', 'wan', 'ip addressing', 'network administration'] },
  { name: 'Design', keywords: ['figma', 'design', 'ui', 'ux', 'photoshop', 'adobe', 'wireframe', 'prototyping', 'illustrator', 'canva', 'graphic design', 'video editing'] },
  { name: 'Project Management', keywords: ['project management', 'agile', 'scrum', 'planning', 'scheduling', 'kanban', 'jira', 'trello', 'coordination', 'risk management'] },
  { name: 'Communication', keywords: ['communication', 'presentation', 'writing', 'leadership', 'teamwork', 'collaboration', 'public speaking', 'negotiation', 'interpersonal skills'] },
  { name: 'Customer Service & Support', keywords: ['customer service', 'technical support', 'call center', 'chat support', 'email support', 'crm', 'zendesk', 'helpdesk', 'client relations', 'complaint handling', 'customer support'] },
  { name: 'Virtual Assistance', keywords: ['virtual assistant', 'remote work', 'scheduling', 'email management', 'calendar management', 'data entry', 'transcription', 'social media management', 'administrative support'] },
  { name: 'Healthcare', keywords: ['patient care', 'nursing', 'clinical', 'medical assistant', 'first aid', 'cpr', 'pharmacy', 'healthcare', 'medical billing', 'emr', 'vital signs'] },
  { name: 'Manufacturing & Engineering', keywords: ['quality control', 'production', 'autocad', 'cad', 'assembly', 'lean manufacturing', 'six sigma', 'machining', 'inventory management', 'process improvement', 'quality assurance'] },
  { name: 'Finance & Accounting', keywords: ['accounting', 'bookkeeping', 'quickbooks', 'payroll', 'taxation', 'auditing', 'financial analysis', 'budgeting', 'reconciliation', 'accounts payable', 'accounts receivable'] },
  { name: 'Marketing & Sales', keywords: ['digital marketing', 'social media marketing', 'seo', 'content creation', 'sales', 'branding', 'copywriting', 'market research', 'advertising', 'lead generation'] },
  { name: 'Administrative & Office', keywords: ['clerical', 'office administration', 'filing', 'records management', 'ms office', 'excel', 'word', 'powerpoint', 'documentation', 'data entry'] },
  { name: 'Human Resources', keywords: ['recruitment', 'employee relations', 'onboarding', 'hr policies', 'talent acquisition', 'performance management', 'compensation', 'training and development'] },
  { name: 'Education & Training', keywords: ['teaching', 'lesson planning', 'tutoring', 'curriculum development', 'classroom management', 'training', 'mentoring', 'facilitation'] },
  { name: 'Construction & Trades', keywords: ['construction', 'carpentry', 'welding', 'electrical work', 'plumbing', 'site supervision', 'blueprint reading', 'safety compliance'] },
];

const normalizeSkillText = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function textContainsSkill(userSkillsText, skill) {
  const norm = normalizeSkillText(skill);
  // Symbol-heavy keywords like "C++" or "C#" strip down to a bare "c" once
  // punctuation is removed, which then matches almost any text — too short
  // to be a meaningful signal, so skip them rather than false-positive.
  if (norm.length < 2) return false;
  return normalizeSkillText(userSkillsText).includes(norm);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const careerEmbeddingText = (career) =>
  `${career.title}. ${career.text} Relevant skills: ${career.skills.join(', ')}. Industry: ${career.industries.join(', ')}.`;

// The 10 career descriptions never change at runtime, so their embeddings
// are computed once per server process and reused — otherwise every single
// page load would cost 10 extra Hugging Face API calls for nothing.
let careerEmbeddingsCache = null;
async function getCareerEmbeddings() {
  if (!careerEmbeddingsCache) {
    careerEmbeddingsCache = await Promise.all(
      CAREER_PATHS.map((career) => getEmbedding(careerEmbeddingText(career)))
    );
  }
  return careerEmbeddingsCache;
}

function missingSkillFor(career, userSkillsText) {
  return career.skills.find((s) => !textContainsSkill(userSkillsText, s)) || null;
}

// Keyword/course/industry heuristic — used only as a fallback if the
// embedding call fails (HF API down, no key configured, etc.) so the page
// still returns something instead of a hard error.
function computeCareerMatchFallback(career, userSkillsText, userIndustry, userCourse) {
  const matchedSkills = career.skills.filter((s) => textContainsSkill(userSkillsText, s));
  const skillRatio = career.skills.length ? matchedSkills.length / career.skills.length : 0;

  let score = Math.round(skillRatio * 70);
  if (userCourse && career.courses.includes(userCourse)) score += 15;
  if (userIndustry && career.industries.some((i) => i.toLowerCase() === userIndustry.toLowerCase())) score += 15;
  score = Math.min(98, Math.max(10, score));

  return score;
}

function computeSkillStrengths(userSkillsText) {
  return SKILL_BUCKETS
    .map((bucket) => ({
      name: bucket.name,
      value: Math.round((bucket.keywords.filter((k) => textContainsSkill(userSkillsText, k)).length / bucket.keywords.length) * 100),
    }))
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);
}

// GET /api/alumni/career-recommendations
// Matches the alumnus's profile against a fixed set of career path templates
// using cosine similarity between Hugging Face embeddings of the alumnus's
// profile text and each career's description — not keyword matching. This
// used to be 3 hardcoded career cards with no backend behind them at all.
const getCareerRecommendations = async (req, res) => {
  try {
    const [me, employment] = await Promise.all([
      User.findById(req.user.id).select('course').lean(),
      AlumniEmployment.findOne({ alumni_id: req.user.id }).lean(),
    ]);

    const userSkillsText = employment?.skills || '';
    const userIndustry = cleanEmploymentValue(employment?.industry);
    const userJobTitle = cleanEmploymentValue(employment?.job_title);
    const userCourse = me?.course || '';

    let rawScores;
    try {
      const profileText = [
        userCourse && `Course: ${userCourse}.`,
        userJobTitle && `Current role: ${userJobTitle}.`,
        userIndustry && `Industry: ${userIndustry}.`,
        userSkillsText && `Skills: ${userSkillsText}.`,
      ].filter(Boolean).join(' ') || 'No profile information provided yet.';

      const [profileEmbedding, careerEmbeddings] = await Promise.all([
        getEmbedding(profileText),
        getCareerEmbeddings(),
      ]);
      rawScores = careerEmbeddings.map((vec) => cosineSimilarity(profileEmbedding, vec));
    } catch (embedErr) {
      console.error('career recommendation embedding failed, using keyword fallback:', embedErr.message);
      rawScores = null;
    }

    let scored;
    if (rawScores) {
      // Fixed calibration, not per-user min-max: min-maxing each alumnus's
      // own 10 scores against each other always stretches their single best
      // option up near 98%, even when that "best" option is only a mediocre,
      // coincidental match — measured directly against this embedding model,
      // a genuinely strong match (skills/role/industry all aligned) lands
      // around 0.75-0.78 raw cosine, while an unrelated profile still
      // clears 0.55-0.60 against most career descriptions (professional
      // English text about jobs never reads as fully dissimilar). Anchoring
      // the scale to those real numbers means the percentage reflects actual
      // fit, not just which of the 10 templates happened to be least bad.
      const FLOOR = 0.50;
      const CEIL = 0.80;
      scored = CAREER_PATHS.map((career, i) => ({
        career,
        score: Math.round(Math.min(98, Math.max(5, ((rawScores[i] - FLOOR) / (CEIL - FLOOR)) * 100))),
      }));
    } else {
      scored = CAREER_PATHS.map((career) => ({
        career,
        score: computeCareerMatchFallback(career, userSkillsText, userIndustry, userCourse),
      }));
    }

    const careers = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ career, score }) => ({
        title: career.title,
        text: career.text,
        match: score,
        skills: career.skills.slice(0, 3),
        missing: missingSkillFor(career, userSkillsText),
      }));

    res.json({
      profileCompleteness: computeProfileCompleteness(employment),
      careers,
      skillStrengths: computeSkillStrengths(userSkillsText),
      hasSkills: !!userSkillsText.trim(),
    });
  } catch (err) {
    console.error('getCareerRecommendations error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { changePassword, updatePassword, updateAvatar, sendInquiry, completeOnboarding, submitTracerStudy, getMyTracerResponse, getTracerFormConfig, getHomeSummary, getMyEmployment, updateMyEmployment, getSuggestedAlumni, getCareerRecommendations };
