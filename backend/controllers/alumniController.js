const bcrypt               = require('bcryptjs');
const { HfInference }       = require('@huggingface/inference');
const User                 = require('../models/User');
const AlumniEmployment     = require('../models/AlumniEmployment');
const TracerStudyResponse  = require('../models/TracerStudyResponse');
const TracerFormConfig     = require('../models/TracerFormConfig');
const Graduate             = require('../models/Graduate');
const EmbeddingDocument    = require('../models/EmbeddingDocument');
const Announcement         = require('../models/Announcement');
const Job                  = require('../models/Job');
const SavedJob              = require('../models/SavedJob');
const Resume                = require('../models/Resume');
const Event                = require('../models/Event');
const { getTracerFormConfig } = require('./tracerFormConfigController');
const { getEmbedding }        = require('../services/embeddingService');
const careerjetService         = require('../services/careerjetService');
const { tracerRowToText }     = require('../utils/fileParser');
const { sendInquiryEmail }    = require('../utils/emailService');
const { SKILL_BUCKETS, skillLabel, ALL_SKILL_KEYWORDS, textContainsSkill } = require('../utils/skillMatching');

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

  if (me?.course && candidate.course && me.course.trim().toUpperCase() === candidate.course.trim().toUpperCase()) {
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
      // Scored below to surface the 3 closest matches rather than just the
      // first 3 the database happened to return — but courses like BSIT run
      // 140+ alumni, so this is capped to a 60-alumnus sample instead of
      // literally everyone, trading a small chance of missing the single
      // best match for a bounded, predictable query cost on every Home load
      // and 30s poll.
      me?.course
        ? User.find({ role: 'alumni', course: me.course, _id: { $ne: alumniId } })
            .select('firstName lastName course graduationYear avatarUrl')
            .limit(60)
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

const hf = new HfInference(process.env.HF_API_KEY);
const CAREER_CHAT_MODEL = process.env.HF_CHAT_MODEL || 'meta-llama/Llama-3.2-3B-Instruct';

// The "Suggested next step" line used to be one fixed template string
// ("Complete a course in X to qualify for more Y roles.") every time —
// same wording no matter who was looking at it. This asks the chat model
// for a fresh, specific sentence instead, and falls back to that template
// only if the API call fails.
async function generateNextStepSuggestion({ topCareer, userCourse, userJobTitle, userSkillsText }) {
  try {
    const prompt = `Alumnus profile — course: ${userCourse || 'not specified'}; current role: ${userJobTitle || 'not yet employed'}; skills: ${userSkillsText || 'none listed yet'}.
Top recommended career path: "${topCareer.title}" (${topCareer.match}% match). ${topCareer.missing ? `Their biggest skill gap for this path is: ${topCareer.missing}.` : 'They already cover this path\'s core skills.'}
Write ONE short, specific, encouraging sentence (max 25 words) telling this alumnus what to do next to improve their fit for this career path. No preamble, no quotes, just the sentence.`;

    const completion = await hf.chatCompletion({
      model: CAREER_CHAT_MODEL,
      provider: process.env.HF_PROVIDER || 'featherless-ai',
      messages: [
        { role: 'system', content: 'You are a concise, encouraging career advisor for a university alumni portal.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 60,
    });

    const text = completion.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
    return text || null;
  } catch (err) {
    console.error('generateNextStepSuggestion failed, using template fallback:', err.message);
    return null;
  }
}

// Derived from a real dataset (Kaggle: "Candidate Job Role Dataset",
// ckshetty/candidate-job-role-dataset — 1000 candidate rows across 22 job
// roles). `skills` per role are the actual most-frequent skills reported for
// that role in the dataset (not hand-picked), filtered to skills appearing
// in 2+ rows for that role. "Video Game Designer" (1 row) was merged into
// "Game Developer" (50 rows, identical skill set) as an obvious duplicate
// label, not a real distinct role.
// `courses` maps only where the dataset's qualification field is a direct
// equivalent to one of this portal's 4 actual alumni courses (BSIT/BSCS/
// BSIS/BSIM) — left empty for roles whose real-data qualification (Data
// Science, Cybersecurity, Design, Marketing, HR, Finance, Game Development,
// Statistics, AI) has no honest TSU-course counterpart, rather than forcing
// a fabricated match.
const CAREER_PATHS = [
  { title: 'AIML', text: 'Build and train machine learning and deep learning models to solve real-world problems.', skills: ['Python', 'Deep Learning', 'NLP', 'TensorFlow'], industries: ['Information Technology'], courses: [] },
  { title: 'Backend Developer', text: 'Design and maintain the server-side logic, APIs, and databases behind an application.', skills: ['Java', 'SQL', 'REST APIs', 'Spring', 'Hibernate', 'Microservices'], industries: ['Information Technology'], courses: ['BSIT', 'BSCS'] },
  { title: 'Blockchain Developer', text: 'Build decentralized applications and smart contracts on blockchain platforms.', skills: ['Solidity', 'Ethereum', 'Web3', 'Blockchain', 'JavaScript'], industries: ['Information Technology'], courses: ['BSCS'] },
  { title: 'C# Developer', text: 'Build Windows and enterprise applications using the .NET ecosystem.', skills: ['C#', 'Azure', 'SQL Server', 'ASP.NET', '.NET Core'], industries: ['Information Technology'], courses: ['BSCS'] },
  { title: 'Cybersecurity Engineer', text: 'Protect systems and networks from threats through security monitoring and testing.', skills: ['SIEM', 'Network Security', 'Penetration Testing', 'Firewalls', 'Ethical Hacking'], industries: ['Information Technology'], courses: [] },
  { title: 'Data Analyst', text: 'Turn raw business data into reports, dashboards, and actionable insights.', skills: ['SQL', 'Python', 'Pandas', 'Data Visualization', 'Tableau', 'Statistics', 'R'], industries: ['Information Technology'], courses: [] },
  { title: 'Data Scientist', text: 'Apply statistics and machine learning to extract insights and build predictive models.', skills: ['Python', 'TensorFlow', 'Machine Learning', 'SQL', 'Keras', 'R', 'NLP'], industries: ['Information Technology'], courses: [] },
  { title: 'Designer', text: 'Design intuitive, user-centered interfaces for websites and applications.', skills: ['Figma', 'UI/UX', 'Adobe XD', 'Prototyping', 'Sketch', 'Wireframing'], industries: ['Information Technology'], courses: [] },
  { title: 'DevOps Engineer', text: 'Automate and manage the infrastructure and deployment pipeline for software systems.', skills: ['AWS', 'Jenkins', 'Terraform', 'Docker', 'Linux'], industries: ['Information Technology'], courses: ['BSCS'] },
  { title: 'Finance', text: 'Analyze financial data and manage risk to support business decisions.', skills: ['Financial Modeling', 'Excel', 'Communication', 'Risk Analysis'], industries: ['Finance and Banking'], courses: [] },
  { title: 'Frontend Developer', text: 'Build the user-facing interface of web applications.', skills: ['HTML', 'CSS', 'React', 'JavaScript', 'Redux', 'TypeScript'], industries: ['Information Technology'], courses: ['BSCS'] },
  { title: 'Full Stack Java Developer', text: 'Build complete web applications end-to-end using Java-based technologies.', skills: ['Java', 'AWS', 'Spring Boot', 'Angular', 'Spring', 'React'], industries: ['Information Technology'], courses: ['BSIT', 'BSCS'] },
  { title: 'Full Stack Python Developer', text: 'Build complete web applications end-to-end using Python-based technologies.', skills: ['Python', 'JavaScript', 'PostgreSQL', 'Django', 'Flask', 'SQL'], industries: ['Information Technology'], courses: ['BSCS'] },
  { title: 'Game Developer', text: 'Design and build interactive games using modern game engines.', skills: ['C++', 'Game Design', 'Unity', 'Unreal Engine', 'VR Development', 'VR', '3D Modeling'], industries: ['Information Technology'], courses: [] },
  { title: 'HR', text: 'Manage recruitment, employee relations, and workplace policies.', skills: ['Recruitment', 'HR Policies', 'HR Management', 'Employee Relations', 'Training'], industries: ['Human Resources'], courses: [] },
  { title: 'Kubernetes Operations Engineer', text: 'Manage containerized infrastructure and deployments at scale.', skills: ['Kubernetes', 'Docker', 'Helm', 'AWS', 'GCP', 'CI/CD'], industries: ['Information Technology'], courses: ['BSCS'] },
  { title: 'Marketing', text: 'Plan and run campaigns that grow a brand’s reach and engagement.', skills: ['Analytics', 'SEO', 'Digital Marketing', 'PPC', 'Social Media', 'Marketing Campaigns'], industries: ['Marketing'], courses: [] },
  { title: 'Mobile Developer', text: 'Build native mobile applications for iOS and Android.', skills: ['Swift', 'UI/UX', 'iOS Development', 'Core Data', 'Java', 'Kotlin', 'REST APIs', 'iOS'], industries: ['Information Technology'], courses: ['BSCS', 'BSIT'] },
  { title: 'PHP Developer', text: 'Build server-side web applications using PHP and its frameworks.', skills: ['PHP', 'MySQL', 'JavaScript', 'Laravel', 'Symfony'], industries: ['Information Technology'], courses: ['BSIT'] },
  { title: 'Software Project Manager', text: 'Plan, coordinate, and deliver software projects on time and on budget.', skills: ['Agile', 'Scrum', 'Project Management', 'JIRA', 'Stakeholder Management'], industries: ['Information Technology'], courses: ['BSIM'] },
  { title: 'Web Developer', text: 'Build and maintain websites and web applications.', skills: ['JavaScript', 'HTML', 'CSS', 'Node.js', 'MongoDB', 'Express', 'Vue.js'], industries: ['Information Technology'], courses: ['BSCS', 'BSIT'] },
];

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

// S = Sr*40% + Er*20% + Xr*30% + CS*10%
// Sr: candidate's skill-set overlap with the role's required skills
// Er: educational-background relevance (course matches the role's field)
// Xr: candidate's experience level
// CS: cosine similarity between the candidate's profile and the role
const SCORE_WEIGHTS = { Sr: 0.40, Er: 0.20, Xr: 0.30, CS: 0.10 };

function computeSkillRatio(career, userSkillsText) {
  if (!career.skills.length) return 0;
  const matched = career.skills.filter((s) => textContainsSkill(userSkillsText, s)).length;
  return matched / career.skills.length;
}

function computeEducationScore(career, userCourse) {
  const normalized = (userCourse || '').trim().toUpperCase();
  return normalized && career.courses.includes(normalized) ? 1 : 0;
}

// Bracket labels match the Employment Details form's EXPERIENCE_LEVELS and
// the Tracer Study's years_in_current_job options respectively — whichever
// of the two the alumnus actually filled in is used, so a Tracer Study
// answer alone (far more consistently completed than Employment Details'
// own free-form experience field) still counts.
const EXPERIENCE_SCORE_MAP = {
  'No experience yet': 0,
  'Less than 1 year': 0.2,
  '1-2 years': 0.4,
  '3-5 years': 0.6,
  '5-10 years': 0.8,
  '10+ years': 1,
};
const YEARS_IN_JOB_SCORE_MAP = {
  'Less than 6 months': 0.15,
  '6 months to 1 year': 0.3,
  '1 to 2 years': 0.45,
  '2 to 3 years': 0.6,
  '3 to 5 years': 0.75,
  'More than 5 years': 1,
};

function computeExperienceScore(employment) {
  if (employment?.experience && EXPERIENCE_SCORE_MAP[employment.experience] !== undefined) {
    return EXPERIENCE_SCORE_MAP[employment.experience];
  }
  if (employment?.years_in_current_job && YEARS_IN_JOB_SCORE_MAP[employment.years_in_current_job] !== undefined) {
    return YEARS_IN_JOB_SCORE_MAP[employment.years_in_current_job];
  }
  return 0;
}

// Raw cosine similarity for this embedding model sits roughly in [0.50, 0.80]
// for professional-text comparisons (measured directly against real alumni
// profiles) — rescaled to a plain 0-1 fraction so it composes with the other
// three weighted components on the same scale.
function normalizeCosine(raw) {
  const FLOOR = 0.50;
  const CEIL = 0.80;
  return Math.min(1, Math.max(0, (raw - FLOOR) / (CEIL - FLOOR)));
}

function computeCareerScore(career, { userSkillsText, userCourse, experienceScore, cosineScore }) {
  const Sr = computeSkillRatio(career, userSkillsText);
  const Er = computeEducationScore(career, userCourse);
  const Xr = experienceScore;
  const CS = cosineScore;
  const S = Sr * SCORE_WEIGHTS.Sr + Er * SCORE_WEIGHTS.Er + Xr * SCORE_WEIGHTS.Xr + CS * SCORE_WEIGHTS.CS;
  return {
    score: Math.round(Math.min(98, Math.max(5, S * 100))),
    breakdown: {
      skills: Math.round(Sr * 100),
      education: Math.round(Er * 100),
      experience: Math.round(Xr * 100),
      profileSimilarity: Math.round(CS * 100),
    },
  };
}

// Each bucket's keyword list (9-15 items) exists so a wide range of skill
// phrasings can be matched, not because a real alumnus is expected to name
// that many. Scoring against the full list length made 1-2 genuine skills
// read as 7-11%, which understates them. Instead we score against a fixed
// target of matched skills per category, so a handful of real matches reads
// as a meaningfully "strong" bar.
const SKILL_STRENGTH_TARGET = 6;

function computeSkillStrengths(userSkillsText) {
  return SKILL_BUCKETS
    .map((bucket) => {
      const matched = bucket.keywords.filter((k) => textContainsSkill(userSkillsText, k));
      return {
        name: bucket.name,
        value: Math.min(100, Math.round((matched.length / SKILL_STRENGTH_TARGET) * 100)),
        matched: matched.map(skillLabel),
      };
    })
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
    const experienceScore = computeExperienceScore(employment);

    // CS (cosine similarity) is only the embedding-dependent piece of the
    // formula — Sr, Er, and Xr don't need the Hugging Face API at all, so if
    // it fails (network/HF down), CS just falls back to a neutral 0.5
    // instead of the whole recommendation failing.
    let cosineScores = null;
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
      cosineScores = careerEmbeddings.map((vec) => normalizeCosine(cosineSimilarity(profileEmbedding, vec)));
    } catch (embedErr) {
      console.error('career recommendation embedding failed, CS defaults to neutral:', embedErr.message);
    }

    // S = Sr*40% + Er*20% + Xr*30% + CS*10%
    const careers = CAREER_PATHS
      .map((career, i) => ({
        career,
        result: computeCareerScore(career, {
          userSkillsText,
          userCourse,
          experienceScore,
          cosineScore: cosineScores ? cosineScores[i] : 0.5,
        }),
      }))
      .sort((a, b) => b.result.score - a.result.score)
      .slice(0, 5)
      .map(({ career, result }) => {
        const allSkills = career.skills.map((s) => ({ name: s, matched: textContainsSkill(userSkillsText, s) }));
        const missingSkills = allSkills.filter((s) => !s.matched).map((s) => s.name);
        return {
          title: career.title,
          text: career.text,
          match: result.score,
          breakdown: result.breakdown,
          skills: career.skills.slice(0, 3),
          allSkills,
          missing: missingSkills[0] || null,
          missingCount: missingSkills.length,
          industries: career.industries,
        };
      });

    const topCareer = careers[0];
    const nextStep = topCareer
      ? (await generateNextStepSuggestion({ topCareer, userCourse, userJobTitle, userSkillsText }))
        || (topCareer.missing
          ? `Complete a course in ${topCareer.missing} to qualify for more ${topCareer.title} roles.`
          : 'Keep your Employment Details up to date to get sharper career matches.')
      : 'Fill out your Employment Details to start getting career recommendations.';

    res.json({
      profileCompleteness: computeProfileCompleteness(employment),
      careers,
      skillStrengths: computeSkillStrengths(userSkillsText),
      hasSkills: !!userSkillsText.trim(),
      nextStep,
    });
  } catch (err) {
    console.error('getCareerRecommendations error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Proxies the Job Connect search bar to Careerjet's public job search API.
// Careerjet has no notion of a per-alumnus "match %" or required skills, so
// those are derived locally from the alumnus's own Employment Details
// skills (same parseSkillList/textContainsSkill helpers career-path scoring
// uses) rather than fabricated. If Careerjet is unreachable or not yet
// configured with an affid, this responds 200 with an empty result set and
// `unavailable: true` instead of failing the whole page.
const EMPLOYMENT_TYPE_LABELS = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  permanent: 'Permanent',
  contract: 'Contract',
  temporary: 'Temporary',
  internship: 'Internship/Training',
  volunteer: 'Volunteer',
};
const CONTRACT_PERIOD_BY_TYPE = { 'full-time': 'f', 'part-time': 'p' };
const CONTRACT_TYPE_BY_TYPE = { permanent: 'p', contract: 'c', temporary: 't', internship: 'i', volunteer: 'v' };

const searchJobs = async (req, res) => {
  try {
    const { keywords = '', location = '', type = '', page = 1, pagesize = 20, sort = 'relevance' } = req.query;

    const employment = await AlumniEmployment.findOne({ alumni_id: req.user.id }).lean();
    const userSkillsText = employment?.skills || '';

    // With no explicit search typed, "Recommended for You" is only
    // meaningful if the Careerjet query itself is seeded from the
    // alumnus's own profile — an empty keyword search just returns
    // Careerjet's generic global feed, which has nothing to do with them.
    const hasExplicitSearch = !!keywords.trim();
    const firstUserSkill = userSkillsText.split(/[,;\n]/)[0]?.trim() || '';
    const profileKeywords = employment?.job_title?.trim() || firstUserSkill;
    const baseKeywords = hasExplicitSearch ? keywords.trim() : profileKeywords;

    const referrerUrl = `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/alumni/job-connect`;
    const userIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();

    let data;
    try {
      data = await careerjetService.searchJobs({
        keywords: baseKeywords,
        location,
        contracttype: CONTRACT_TYPE_BY_TYPE[type] || '',
        contractperiod: CONTRACT_PERIOD_BY_TYPE[type] || '',
        page,
        pagesize,
        sort,
        userIp,
        userAgent: req.headers['user-agent'],
        referrerUrl,
      });
    } catch (apiErr) {
      console.error('Careerjet search failed:', apiErr.message);
      return res.json({ jobs: [], total: 0, page: Number(page), pages: 0, unavailable: true });
    }

    // Careerjet filters by contracttype/contractperiod server-side but
    // doesn't echo either back per listing — since the filter was applied,
    // every result here genuinely matches it, so labeling them is honest
    // (unlike guessing a "work setup" from the description text used to be).
    const typeLabel = EMPLOYMENT_TYPE_LABELS[type] || '';

    const jobs = (data.jobs || []).map((job) => {
      const jobText = `${job.title || ''} ${job.description || ''}`;

      // What this specific posting is actually asking for, read off the
      // shared skill vocabulary (Careerjet gives no structured skill tags).
      const jobSkillKeywords = ALL_SKILL_KEYWORDS.filter((kw) => textContainsSkill(jobText, kw)).slice(0, 6);
      const skills = jobSkillKeywords.map((kw) => ({ name: skillLabel(kw), matched: textContainsSkill(userSkillsText, kw) }));
      const matchedCount = skills.filter((s) => s.matched).length;

      return {
        title: job.title,
        company: job.company || 'Company not listed',
        location: job.locations || location || 'Philippines',
        type: typeLabel,
        posted: job.date || '',
        url: job.url,
        description: job.description || '',
        salary: job.salary || '',
        match: skills.length ? Math.round((matchedCount / skills.length) * 100) : null,
        skills,
      };
    });

    // "Recommended for You" only makes sense as jobs with an actual match —
    // a real search (user typed something) still shows everything Careerjet
    // returned, just ranked best-match-first.
    jobs.sort((a, b) => (b.match ?? -1) - (a.match ?? -1));
    const finalJobs = hasExplicitSearch ? jobs : jobs.filter((j) => (j.match ?? 0) > 0);

    res.json({
      jobs: finalJobs,
      total: finalJobs.length,
      page: data.page || Number(page),
      pages: data.pages ?? 1,
      hasProfile: !!profileKeywords,
    });
  } catch (err) {
    console.error('searchJobs error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const getSavedJobs = async (req, res) => {
  try {
    const jobs = await SavedJob.find({ alumni_id: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json({ jobs });
  } catch (err) {
    console.error('getSavedJobs error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Single toggle endpoint (save if not already saved, unsave if it is) keyed
// on the job's Careerjet url — simpler for the frontend than two separate
// save/unsave calls that both need to know the current saved state first.
const toggleSavedJob = async (req, res) => {
  try {
    const { url, title, company, location, type, posted, description, salary, match, skills } = req.body;
    if (!url || !title) {
      return res.status(400).json({ message: 'Job url and title are required.' });
    }

    const existing = await SavedJob.findOne({ alumni_id: req.user.id, url });
    if (existing) {
      await existing.deleteOne();
      return res.json({ saved: false });
    }

    await SavedJob.create({
      alumni_id: req.user.id, title, company, location, type, posted, url, description, salary, match, skills,
    });
    res.json({ saved: true });
  } catch (err) {
    console.error('toggleSavedJob error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const getJobAlertsPref = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('jobAlertsEnabled').lean();
    res.json({ enabled: user?.jobAlertsEnabled !== false });
  } catch (err) {
    console.error('getJobAlertsPref error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const updateJobAlertsPref = async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    await User.findByIdAndUpdate(req.user.id, { jobAlertsEnabled: enabled });
    res.json({ enabled });
  } catch (err) {
    console.error('updateJobAlertsPref error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const getMyResume = async (req, res) => {
  try {
    const existing = await Resume.findOne({ alumni_id: req.user.id }).lean();
    if (existing) {
      return res.json({ resume: existing, isSaved: true });
    }

    // No resume saved yet — suggest a starting point built from the
    // alumnus's actual profile (skills, education) instead of a placeholder
    // they'd have to overwrite by hand. Nothing here is persisted until
    // they actually click Save.
    const [user, employment, tracer] = await Promise.all([
      User.findById(req.user.id).select('firstName middleInitial lastName email course graduationYear').lean(),
      AlumniEmployment.findOne({ alumni_id: req.user.id }).lean(),
      TracerStudyResponse.findOne({ alumni_id: req.user.id }).lean(),
    ]);

    const fullName = [user?.firstName, user?.middleInitial ? `${user.middleInitial}.` : '', user?.lastName].filter(Boolean).join(' ');

    const experienceLines = [];
    if (employment?.job_title) {
      experienceLines.push([employment.job_title, employment.company_name].filter((v) => v && v !== 'N/A').join(' - '));
      const meta = [employment.employment_type, employment.years_in_current_job].filter(Boolean).join(' · ');
      if (meta) experienceLines.push(meta);
    }

    const educationLines = [];
    if (user?.course) educationLines.push(`${user.course} - Tarlac State University`);
    if (user?.graduationYear) educationLines.push(`Batch ${user.graduationYear}`);

    // Templated from real fields (course, job title, company, skills) — not
    // fabricated content, just a natural-language stitch of what's already
    // on file, the same way the placeholder mock read before it was per-user.
    const topSkills = (employment?.skills || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    const jobTitleArticle = employment?.job_title && /^[aeiou]/i.test(employment.job_title) ? 'an' : 'a';
    const summaryLead = [
      user?.course ? `${user.course} graduate of Tarlac State University` : null,
      employment?.job_title
        ? `with experience as ${jobTitleArticle} ${employment.job_title}${employment.company_name && employment.company_name !== 'N/A' ? ` at ${employment.company_name}` : ''}`
        : (employment?.experience ? `with ${employment.experience.toLowerCase()} of professional experience` : null),
    ].filter(Boolean).join(' ');
    let summary = summaryLead ? `${summaryLead}.` : '';
    if (topSkills.length) summary += `${summary ? ' ' : ''}Skilled in ${topSkills.join(', ')}.`;

    const suggested = {
      name: fullName,
      address: '',
      phone: tracer?.contactNumber || '',
      email: user?.email || '',
      linkedin: '',
      summary,
      skills: employment?.skills || '',
      experience: experienceLines.join('\n'),
      education: educationLines.join('\n'),
      // TracerStudyResponse.professionalCertifications is a Yes/No survey
      // answer ("do you have certifications"), not the actual certification
      // names — there's no field anywhere with real cert titles, so this is
      // left blank rather than showing a misleading "Yes"/"No" bullet.
      certifications: '',
      projects: '',
      languages: '',
    };

    res.json({ resume: suggested, isSaved: false });
  } catch (err) {
    console.error('getMyResume error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const RESUME_FIELDS = ['name', 'address', 'phone', 'email', 'linkedin', 'summary', 'skills', 'experience', 'education', 'certifications', 'projects', 'languages'];

const updateMyResume = async (req, res) => {
  try {
    const updates = {};
    for (const field of RESUME_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    const resume = await Resume.findOneAndUpdate(
      { alumni_id: req.user.id },
      { $set: updates },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.json({ resume });
  } catch (err) {
    console.error('updateMyResume error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { changePassword, updatePassword, updateAvatar, sendInquiry, completeOnboarding, submitTracerStudy, getMyTracerResponse, getTracerFormConfig, getHomeSummary, getMyEmployment, updateMyEmployment, getSuggestedAlumni, getCareerRecommendations, searchJobs, getSavedJobs, toggleSavedJob, getJobAlertsPref, updateJobAlertsPref, getMyResume, updateMyResume };
