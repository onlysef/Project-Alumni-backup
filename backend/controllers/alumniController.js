const bcrypt               = require('bcryptjs');
const jwt                  = require('jsonwebtoken');
const { HfInference }       = require('@huggingface/inference');
const User                 = require('../models/User');
const AlumniEmployment     = require('../models/AlumniEmployment');
const TracerStudyResponse  = require('../models/TracerStudyResponse');
const TracerFormConfig     = require('../models/TracerFormConfig');
const Graduate             = require('../models/Graduate');
const EmbeddingDocument    = require('../models/EmbeddingDocument');
const Announcement         = require('../models/Announcement');
const SavedJob              = require('../models/SavedJob');
const Resume                = require('../models/Resume');
const JobApplication        = require('../models/JobApplication');
const Job                   = require('../models/Job');
const Event                = require('../models/Event');
const Notification         = require('../models/Notification');
const { getTracerFormConfig } = require('./tracerFormConfigController');
const { getEmbedding }        = require('../services/embeddingService');
const careerjetService         = require('../services/careerjetService');
const { tracerRowToText }     = require('../utils/fileParser');
const { sendInquiryEmail }    = require('../utils/emailService');
const { getResumeForAlumnus } = require('../utils/resumeBuilder');
const answerCache             = require('../services/answerCache');
const { SKILL_BUCKETS, skillLabel, ALL_SKILL_KEYWORDS, textContainsSkill } = require('../utils/skillMatching');

// The set of keys that the TracerStudyResponse schema handles directly.
// Everything else in the submitted answers object goes into extra_answers.
const { FIXED_KEYS } = require('../utils/tracerFixedKeys');

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
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { password: hashed, $inc: { tokenVersion: 1 } },
      { new: true, select: 'role college tokenVersion' }
    );
    // The temp password this replaces is now dead everywhere, including
    // this request's own session — issue a fresh token carrying the bumped
    // version so onboarding can continue past this step without a re-login.
    const token = jwt.sign(
      { id: user._id, role: user.role, college: user.college || '', tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({ message: 'Password changed successfully.', token });
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
    const user = await User.findById(req.user.id).select('password role college tokenVersion');
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) return res.status(400).json({ message: 'Current password is incorrect.' });

    user.password = await bcrypt.hash(newPassword, 10);
    // Invalidate every OTHER session on this account (e.g. a device the
    // owner no longer trusts) — but this request's own session must not be
    // logged out by the very action it just took, so a fresh token carrying
    // the bumped version is issued back to the caller in the same response.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    const token = jwt.sign(
      { id: user._id, role: user.role, college: user.college || '', tokenVersion: user.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({ message: 'Password updated successfully.', token });
  } catch (err) {
    console.error('updatePassword error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /api/alumni/avatar
// Frontend sends this straight from FileReader.readAsDataURL(), so a
// legitimate upload always looks like "data:image/<type>;base64,<data>" —
// anything else is either not an image or not a data URI at all.
const AVATAR_DATA_URI_RE = /^data:image\/(png|jpe?g|gif|webp);base64,([a-zA-Z0-9+/]+=*)$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB decoded

const updateAvatar = async (req, res) => {
  try {
    const { avatarUrl } = req.body;
    if (typeof avatarUrl !== 'string') return res.status(400).json({ message: 'avatarUrl is required.' });

    const match = avatarUrl.match(AVATAR_DATA_URI_RE);
    if (!match) return res.status(400).json({ message: 'Avatar must be a PNG, JPEG, GIF, or WEBP image.' });

    const decodedSize = Buffer.byteLength(match[2], 'base64');
    if (decodedSize > MAX_AVATAR_BYTES) {
      return res.status(400).json({ message: 'Avatar image must be smaller than 2MB.' });
    }

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
    if (!response) return res.json({ submitted: false, data: null, newQuestionsCount: null });

    // Convert extra_answers Map to plain object if needed
    if (response.extra_answers instanceof Map) {
      const obj = {};
      for (const [k, v] of response.extra_answers) obj[k] = v;
      response.extra_answers = obj;
    }

    // How many of this alumni's college's current custom/imported questions
    // they haven't answered yet, PLUS any existing questions an admin has
    // explicitly flagged for re-answering (pendingUpdateQuestionIds) — lets
    // the frontend gate login routing to the "new questions" view (see
    // ProtectedRoute) instead of only computing this after the alumni is
    // already on the tracer-study page.
    const alumniUser = await User.findById(req.user.id).select('college').lean();
    const cfg = alumniUser?.college ? await TracerFormConfig.findOne({ college: alumniUser.college }).lean() : null;
    const answeredKeys = new Set(Object.keys(response.extra_answers || {}));
    const pendingIds   = new Set(response.pendingUpdateQuestionIds || []);
    let newQuestionsCount = 0;
    (cfg?.config?.pages || []).forEach((p) => (p.questions || []).forEach((q) => {
      if (q.type === 'static_text') return;
      if (pendingIds.has(q.id)) { newQuestionsCount++; return; }
      if (!FIXED_KEYS.has(q.id) && !answeredKeys.has(q.id)) newQuestionsCount++;
    }));

    res.json({ submitted: true, data: response, newQuestionsCount });
  } catch (err) {
    console.error('getMyTracerResponse error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Shared core of submitTracerStudy — accepts an explicit alumniId/college so
// it can be reused by the admin's own "Edit Record -> tracer data" endpoint
// (updateAlumniTracerData below), which needs every downstream effect a real
// alumni submission gets (AlumniEmployment sync, course/track sync, AI
// chatbot Graduate/embedding sync) since an admin correction should stay
// consistent everywhere the alumni's own submission would.
async function saveTracerAnswers(alumniId, college, body) {
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
          // Any admin-flagged "please update this" questions are addressed
          // by this submit (the whole answers object is saved, including
          // whatever was shown for those ids) — clear the flag so the
          // alumni isn't routed back to the same screen on next login.
          pendingUpdateQuestionIds: [],
        },
      },
      { upsert: true, new: true }
    );

    // Auto-sync employment record from tracer answers.
    // Extra custom questions (company name, work location) are resolved by label matching.
    const employmentUpdate = extractEmploymentFromTracer(body);
    const extraFields      = await resolveExtraEmploymentFields(extra_answers, college);
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

    // Update User.course, track, and graduationYear from tracer answers.
    // The tracer study's own answer is the real source of truth for course,
    // so it always wins here regardless of whatever value the account
    // started with (admin guess or the alumnus's own signup choice).
    // College itself is intentionally left untouched — it isn't an actual
    // tracer-form question, and it's required up front at account creation
    // for college-scoping to work at all.
    const userUpdates = { tracerStudyCompleted: true };
    const currentUser = await User.findById(alumniId).select('course track graduationYear').lean();
    const mapped = mapProgramToCourse(body.programsCompleted);
    if (mapped) userUpdates.course = mapped;
    // Sync track from programsCompleted (BSIT only)
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
    // permanently invisible to it. Fired without awaiting: getEmbedding() is
    // an external Hugging Face API call that can take several seconds (longer
    // on a cold model), and awaiting it here made every tracer save — the
    // alumni's own submit AND an admin/coordinator's Edit Alumni Record save —
    // hang on that call before the response could return. A sync failure or
    // slow response here must never delay or fail the actual tracer save.
    syncGraduateAndEmbedding(alumniId, updatedUser, body, userUpdates, currentUser)
      .catch((syncErr) => console.error('AI chatbot Graduate sync failed (non-blocking):', syncErr.message));
}

async function syncGraduateAndEmbedding(alumniId, updatedUser, body, userUpdates, currentUser) {
  if (!updatedUser?.email) return;

  const graduatePatch = {
    user_id:          alumniId,
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
    companyName:      body.companyName || null,
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

  // Matches an existing row by user_id (already linked) OR by email
  // (a bulk-imported row that predates this account, or a legacy
  // record from before user_id existed) — either way, $set below
  // stamps user_id onto it going forward.
  const graduateDoc = await Graduate.findOneAndUpdate(
    { $or: [{ user_id: alumniId }, { email: graduatePatch.email }] },
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
    company:            graduatePatch.companyName,
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
  // This alumnus's Graduate/EmbeddingDocument data just changed — any
  // AC assistant answer cached before this point may now be stale.
  answerCache.bumpDataVersion();
}

// POST /api/alumni/tracer-study
// Accepts a flat answers object. Upserts the TracerStudyResponse so alumni can
// re-submit to update their answers. Also auto-syncs the AlumniEmployment record.
const submitTracerStudy = async (req, res) => {
  try {
    await saveTracerAnswers(req.user.id, req.user.college, req.body);
    res.status(200).json({ message: 'Tracer study submitted successfully.' });
  } catch (err) {
    console.error('submitTracerStudy error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/admin/employment/:id/tracer — admin editing an alumni's full
// tracer study record (not just the AlumniEmployment slice updateEmploymentRecord
// covers). Reuses the exact same save path as the alumni's own submit, so an
// admin correction gets the same downstream sync (AlumniEmployment, course/
// track, AI chatbot Graduate/embeddings) a real resubmission would.
const updateAlumniTracerData = async (req, res) => {
  try {
    const emp = await AlumniEmployment.findById(req.params.id).select('alumni_id').lean();
    if (!emp) return res.status(404).json({ message: 'Employment record not found.' });

    const alumniUser = await User.findById(emp.alumni_id).select('college').lean();
    if (!alumniUser) return res.status(404).json({ message: 'Alumni not found.' });
    // Set by the coordinator route middleware — a coordinator can only edit
    // the tracer record of an alumnus from their own college.
    if (req.forcedCollege && (alumniUser.college || '') !== req.forcedCollege) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    await saveTracerAnswers(emp.alumni_id, alumniUser.college || '', req.body);
    res.json({ message: 'Alumni record updated.' });
  } catch (err) {
    console.error('updateAlumniTracerData error:', err);
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
// PROFILE_COMPLETENESS_FIELDS is the single checklist the Alumni Profile
// bar and the Career Recommendations ring both score against, so the two
// widgets can never disagree. Only fields the alumnus can actually edit on
// their own Employment Details form are counted.
function computeProfileCompleteness(emp) {
  if (!emp) return 0;
  const filled = [
    emp.employment_status && emp.employment_status !== 'Not Yet Updated',
    emp.company_name && emp.company_name !== 'N/A',
    !!emp.job_title,
    !!emp.industry,
    !!emp.work_location,
    !!emp.skills,
    !!emp.experience,
  ].filter(Boolean).length;
  return Math.round((filled / 7) * 100);
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

  // textContainsSkill normalizes away punctuation/spacing before comparing
  // (the same helper Job Connect uses against job postings) — a plain
  // exact-string .includes() here meant "React.js" and "ReactJS" never
  // matched each other, so real overlap almost never triggered in practice.
  const mySkills = parseSkillList(myEmp?.skills);
  const theirSkillsText = theirEmp?.skills || '';
  if (mySkills.length && theirSkillsText.trim()) {
    const overlap = mySkills.filter((s) => textContainsSkill(theirSkillsText, s)).length;
    if (overlap > 0) {
      score += Math.round((overlap / mySkills.length) * 10);
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
    const [emp, user, tracer] = await Promise.all([
      AlumniEmployment.findOne({ alumni_id: req.user.id }).lean(),
      User.findById(req.user.id).select('email').lean(),
      TracerStudyResponse.findOne({ alumni_id: req.user.id }).select('contactNumber').lean(),
    ]);
    // Contact Email/Number aren't asked for on this form from scratch —
    // they already exist elsewhere (the account's own login email; the
    // tracer study's own "Contact Number" question) — so the field starts
    // pre-filled with that instead of blank, and only overrides once the
    // alumnus actually edits and saves a different value here.
    const employment = emp ? {
      ...emp,
      contact_email:  emp.contact_email  || user?.email || '',
      contact_number: emp.contact_number || tracer?.contactNumber || '',
    } : null;
    res.json({ employment });
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
      contact_email, contact_number, facebook, linkedin,
    } = req.body;

    const trimmedEmail = typeof contact_email === 'string' ? contact_email.trim() : '';
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ message: 'Please enter a valid contact email address.' });
    }

    const updates = {
      employment_status: employment_status || 'Not Yet Updated',
      company_name:      company_name || 'N/A',
      job_title:         job_title || null,
      industry:          industry || null,
      work_location:     work_location || null,
      salary_range:      salary_range || '',
      skills:            skills || '',
      experience:        experience || '',
      contact_email:     trimmedEmail,
      contact_number:    typeof contact_number === 'string' ? contact_number.trim() : '',
      facebook:          typeof facebook === 'string' ? facebook.trim() : '',
      linkedin:          typeof linkedin === 'string' ? linkedin.trim() : '',
      last_updated:      new Date(),
    };
    // Every other field above always lands in `updates`, so clearing one in
    // the form correctly overwrites it back to blank/null. date_employed
    // used to be skipped entirely whenever it was falsy — indistinguishable
    // from the alumnus never having touched it at all — so clearing an
    // already-set date silently left the stale value in the database and
    // reappeared as soon as the page reloaded. 'date_employed' in req.body
    // tells an explicit clear (frontend now sends null, not undefined —
    // JSON.stringify drops undefined-valued keys entirely) apart from a
    // caller that never mentioned this field.
    if (date_employed) updates.date_employed = new Date(date_employed);
    else if ('date_employed' in req.body) updates.date_employed = null;

    const emp = await AlumniEmployment.findOneAndUpdate(
      { alumni_id: req.user.id },
      { $set: updates },
      { upsert: true, new: true }
    );

    // job_title/skills just changed — see bustRecommendedJobsCache's own
    // comment for why the recommended-jobs cache has to drop this
    // alumnus's entry now instead of waiting out its TTL.
    bustRecommendedJobsCache(req.user.id);

    // Employment Details is part of the alumnus profile. Keep the submitted
    // tracer response and the normalized Graduate profile in step with it so
    // admin/coordinator views, analytics, and recommendations do not continue
    // showing the older employment information.
    const tracerEmploymentStatus = updates.employment_status === 'Unemployed' ? 'No' : 'Yes';
    const tracerPatch = {
      employmentStatus: tracerEmploymentStatus,
      companyName: updates.employment_status === 'Unemployed' ? '' : updates.company_name,
      placeOfWork: updates.employment_status === 'Unemployed' ? '' : updates.work_location,
      occupationTitle: updates.employment_status === 'Unemployed' ? '' : updates.job_title,
      industryField: updates.employment_status === 'Unemployed' ? '' : updates.industry,
    };
    await TracerStudyResponse.updateOne(
      { alumni_id: req.user.id },
      { $set: tracerPatch }
    );

    try {
      const profileUser = await User.findById(req.user.id).select('email').lean();
      if (profileUser?.email) {
        const graduate = await Graduate.findOne({
          $or: [{ user_id: req.user.id }, { email: profileUser.email.toLowerCase().trim() }],
        });
        if (graduate) {
          // Backfills user_id onto a row that was only ever matched by email.
          graduate.user_id = req.user.id;
          graduate.employmentStatus = tracerPatch.employmentStatus;
          graduate.workLocation = tracerPatch.placeOfWork || null;
          graduate.jobTitle = tracerPatch.occupationTitle || null;
          graduate.companyName = tracerPatch.companyName || null;
          graduate.industry = tracerPatch.industryField || null;
          graduate.data = {
            ...(graduate.data || {}),
            employmentStatus: tracerPatch.employmentStatus,
            companyName: tracerPatch.companyName,
            placeOfWork: tracerPatch.placeOfWork,
            occupationTitle: tracerPatch.occupationTitle,
            industryField: tracerPatch.industryField,
            skills: updates.skills,
            experience: updates.experience,
          };
          await graduate.save();
          answerCache.bumpDataVersion();
        }
      }
    } catch (syncErr) {
      console.error('Employment profile sync failed (non-blocking):', syncErr.message);
    }

    res.json({ employment: emp });
  } catch (err) {
    console.error('updateMyEmployment error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Home's "Recommended jobs" card used to count the employer-posted internal
// Job model — but alumni have no route to browse those at all (Job is only
// wired into the employer/admin routers), so it was always disconnected
// from what "Browse jobs" (Job Connect, now Careerjet-backed) actually
// shows. This counts real Careerjet matches instead, the same way Job
// Connect's own "Recommended for You" does. Home polls every 30s, so the
// result is cached per alumnus for a while rather than hitting Careerjet
// on every poll.
// Shared with searchJobs's own default "Recommended for You" view — Home
// used to compute this with a different pagesize/sort than Job Connect
// itself, so the two numbers could legitimately disagree even though they
// claim to mean the same thing. Same pool size, same Careerjet sort, same
// scoring function now, so they can't drift apart again.
const RECOMMENDED_POOL_SIZE = 50;

function scoreCareerjetJobs(rawJobs, { userSkillsText, location, typeLabel }) {
  return rawJobs.map((job) => {
    const jobText = `${job.title || ''} ${job.description || ''}`;
    const jobSkillKeywords = ALL_SKILL_KEYWORDS.filter((kw) => textContainsSkill(jobText, kw)).slice(0, 6);
    const skills = jobSkillKeywords.map((kw) => ({ name: skillLabel(kw), matched: textContainsSkill(userSkillsText, kw) }));
    const matchedCount = skills.filter((s) => s.matched).length;
    return {
      title: job.title,
      company: job.company || 'Company not listed',
      location: job.locations || location || 'Philippines',
      type: typeLabel || '',
      posted: job.date || '',
      url: job.url,
      description: job.description || '',
      salary: job.salary || '',
      match: skills.length ? Math.round((matchedCount / skills.length) * 100) : null,
      skills,
    };
  });
}

// Same shape/scoring as scoreCareerjetJobs, for jobs posted by TSU partner
// employers through the internal Job model instead of pulled from
// Careerjet. `internal: true` + a synthetic "url" (Job has no real external
// posting to link to) is what JobCard uses to render "Apply now" as an
// in-app application instead of an outbound link.
function scoreInternalJobs(rawJobs, { userSkillsText }) {
  return rawJobs.map((job) => {
    const jobText = `${job.title || ''} ${job.description || ''}`;
    const jobSkillKeywords = ALL_SKILL_KEYWORDS.filter((kw) => textContainsSkill(jobText, kw)).slice(0, 6);
    const skills = jobSkillKeywords.map((kw) => ({ name: skillLabel(kw), matched: textContainsSkill(userSkillsText, kw) }));
    const matchedCount = skills.filter((s) => s.matched).length;
    return {
      title: job.title,
      company: job.partnershipId?.name || 'Company not listed',
      companyLogo: job.postedBy?.avatarUrl || '',
      location: job.location || 'Philippines',
      type: job.jobType || '',
      posted: job.createdAt || '',
      url: `internal:${job._id}`,
      description: job.description || '',
      salary: '',
      match: skills.length ? Math.round((matchedCount / skills.length) * 100) : null,
      skills,
      internal: true,
    };
  });
}

// Highest match first; within the same score, the more recently posted
// listing wins so a fresh posting doesn't get buried behind an old one.
function sortJobsByMatchThenDate(jobs) {
  return jobs.sort((a, b) => {
    const matchDiff = (b.match ?? -1) - (a.match ?? -1);
    if (matchDiff !== 0) return matchDiff;
    return new Date(b.posted || 0) - new Date(a.posted || 0);
  });
}

const recommendedJobsCache = new Map(); // alumniId -> { jobs, expiresAt }
const RECOMMENDED_COUNT_TTL_MS = 20 * 60 * 1000;

// The cache key is scored against job_title/skills — updateMyEmployment
// changing either of those used to leave the OLD score/keyword cached for
// up to 20 minutes, so Home's "Recommended jobs" and Job Connect's default
// list kept showing jobs (and match %) computed against the alumnus's
// previous profile even though Employment Details itself already reflected
// the new one. Called from updateMyEmployment right after a save.
function bustRecommendedJobsCache(alumniId) {
  recommendedJobsCache.delete(String(alumniId));
}

// Shared by Home's "Recommended jobs" count AND its "What needs your
// attention" recent-updates feed — both need the same Careerjet-backed,
// per-alumnus scored job list, so this fetches (and caches) it once instead
// of hitting Careerjet twice on every Home load/30s poll. Previously the
// updates feed queried the internal employer-posted `Job` model instead
// (see routes/employer.js) — but alumni have no route to browse those at
// all, Job Connect is 100% Careerjet-backed, so a "New Job" update built
// from that model pointed at a listing that could never actually be found
// on the page it linked to.
async function getRecommendedJobsForAlumni(alumniId, employment) {
  const cacheKey = String(alumniId);
  const cached = recommendedJobsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.jobs;

  const userSkillsText = employment?.skills || '';
  const firstUserSkill = userSkillsText.split(/[,;\n]/)[0]?.trim() || '';
  const keywords = employment?.job_title?.trim() || firstUserSkill;
  if (!keywords) {
    recommendedJobsCache.set(cacheKey, { jobs: [], expiresAt: Date.now() + RECOMMENDED_COUNT_TTL_MS });
    return [];
  }

  try {
    const referrerUrl = `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/alumni/job-connect`;
    const data = await careerjetService.searchJobs({
      keywords, location: '', page: 1, pagesize: RECOMMENDED_POOL_SIZE, sort: 'date',
      userIp: '127.0.0.1', userAgent: 'AlumniPortal-HomeSummary/1.0', referrerUrl,
    });
    const jobs = scoreCareerjetJobs(data.jobs || [], { userSkillsText, location: '', typeLabel: '' })
      .filter((j) => (j.match ?? 0) > 0);
    recommendedJobsCache.set(cacheKey, { jobs, expiresAt: Date.now() + RECOMMENDED_COUNT_TTL_MS });
    return jobs;
  } catch (err) {
    console.error('getRecommendedJobsForAlumni Careerjet error:', err.message);
    return cached ? cached.jobs : [];
  }
}

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

    const [announcementsCount, recentEventsCount, employment, networkMatchesCount, similarAlumni, recentAnnouncements, recentEvents] = await Promise.all([
      Announcement.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Event.countDocuments(recentEventsFilter),
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
      Event.find(upcomingEventsFilter).sort({ event_datetime: 1 }).limit(6).select('title location createdAt event_datetime').lean(),
    ]);

    // Careerjet results are already sorted freshest-first (sort: 'date' in
    // getRecommendedJobsForAlumni) — same list backs both the count card and
    // the first few entries of the recent-updates feed below. Careerjet's
    // `posted` timestamp reflects when a listing was fetched, which is
    // effectively "now" on almost every call — mixed unfiltered into the
    // recentUpdates merge below (newest-first, capped to 6), that would let
    // Jobs claim every single slot and bury real campus News/Events that
    // are just as relevant but dated days or weeks ago. Capped to 2 here so
    // the feed stays a genuine mix instead of an all-jobs list.
    const recommendedJobs = await getRecommendedJobsForAlumni(alumniId, employment);
    const recommendedJobsCount = recommendedJobs.length;
    const recentJobs = recommendedJobs.slice(0, 2);

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
      ...recentJobs.map((j) => ({ kind: 'Job', title: j.title, subtitle: j.location || 'Open position', createdAt: j.posted, section: 'jobconnect' })),
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
// Backs the Alumni Network directory — this used to be 8 hardcoded
// fake profiles with no backend behind them at all.
const getSuggestedAlumni = async (req, res) => {
  try {
    const { course, year, search } = req.query;
    const limit = Math.min(600, Math.max(1, parseInt(req.query.limit, 10) || 60));

    const match = { role: 'alumni', status: 'active', _id: { $ne: req.user.id } };
    if (course && course !== 'All') match.course = course;
    if (year && year !== 'All') match.graduationYear = Number(year);

    const [me, myEmp, users, allCourses, allYears] = await Promise.all([
      User.findById(req.user.id).select('course graduationYear').lean(),
      AlumniEmployment.findOne({ alumni_id: req.user.id }).lean(),
      User.find(match, 'firstName lastName email course graduationYear avatarUrl').sort({ lastName: 1 }).lean(),
      User.distinct('course', { role: 'alumni', status: 'active', course: { $nin: [null, ''] } }),
      User.distinct('graduationYear', { role: 'alumni', status: 'active', graduationYear: { $ne: null } }),
    ]);

    const ids = users.map((u) => u._id);
    const empRecords = ids.length
      ? await AlumniEmployment.find(
          { alumni_id: { $in: ids } },
          'alumni_id job_title company_name industry work_location skills facebook linkedin'
        ).lean()
      : [];
    const empMap = new Map(empRecords.map((e) => [String(e.alumni_id), e]));

    let results = users.map((u) => {
      const emp = empMap.get(String(u._id));
      const { score, reason } = computeMatchScore(me, u, myEmp, emp);
      return {
        _id: u._id,
        name: `${u.firstName} ${u.lastName}`,
        email: u.email || '',
        avatarUrl: u.avatarUrl || '',
        role: cleanEmploymentValue(emp?.job_title) || 'Not yet updated',
        company: cleanEmploymentValue(emp?.company_name) || 'Not yet updated',
        industry: cleanEmploymentValue(emp?.industry),
        location: cleanEmploymentValue(emp?.work_location),
        skills: cleanEmploymentValue(emp?.skills),
        facebook: cleanEmploymentValue(emp?.facebook),
        linkedin: cleanEmploymentValue(emp?.linkedin),
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
// Same shared model/provider config as services/ragService.js — no
// hardcoded provider fallback so HF can auto-route across whichever
// providers are actually live for HF_CHAT_MODEL.
const CAREER_CHAT_MODEL = process.env.HF_CHAT_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

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
      provider: process.env.HF_PROVIDER || undefined, // empty/unset = let HF auto-route
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

// Job Connect's "Skill Gap" card used to show one of two fixed sentences
// ("Highlighted skills are already on your profile — the rest are worth
// adding." / "These skills are requested for this role but aren't on your
// profile yet.") for every job, regardless of which specific skills were
// actually missing. This asks the chat model for a sentence naming the
// actual gap for THIS posting instead, falling back to those same two
// templates if the call fails.
async function generateSkillGapTip({ jobTitle, matchedSkills, missingSkills }) {
  try {
    const prompt = `Job posting: "${jobTitle}".
Skills this alumnus already has that the posting asks for: ${matchedSkills.length ? matchedSkills.join(', ') : 'none'}.
Skills the posting asks for that they don't have yet: ${missingSkills.length ? missingSkills.join(', ') : 'none — they cover everything listed'}.
Write ONE short, specific, encouraging sentence (max 20 words) telling this alumnus what to focus on to be a stronger fit for this specific job. No preamble, no quotes, just the sentence.`;

    const completion = await hf.chatCompletion({
      model: CAREER_CHAT_MODEL,
      provider: process.env.HF_PROVIDER || undefined, // empty/unset = let HF auto-route
      messages: [
        { role: 'system', content: 'You are a concise, encouraging career advisor for a university alumni portal.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 50,
    });

    const text = completion.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
    return text || null;
  } catch (err) {
    console.error('generateSkillGapTip failed, using template fallback:', err.message);
    return null;
  }
}

// GET /api/alumni/jobs/skill-tip?title=&matched=&missing=
// Lazily generates the personalized skill-gap sentence for one job card —
// the frontend only calls this once a card actually scrolls into view (see
// JobPostingCard.jsx), so a results page with 20+ jobs never fires 20+ of
// these ~4s LLM calls at once just because they're all rendered in the DOM.
const getJobSkillTip = async (req, res) => {
  try {
    const { title } = req.query;
    if (!title) return res.status(400).json({ message: 'title is required.' });
    const matchedSkills = String(req.query.matched || '').split(',').map((s) => s.trim()).filter(Boolean);
    const missingSkills = String(req.query.missing || '').split(',').map((s) => s.trim()).filter(Boolean);

    const tip = await generateSkillGapTip({ jobTitle: title, matchedSkills, missingSkills });
    res.json({ tip });
  } catch (err) {
    console.error('getJobSkillTip error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

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

// A user's profile text (course/role/industry/skills) only changes when they
// edit their Employment Details, but this page was calling the Hugging Face
// embedding API on every single visit regardless — the slowest part of the
// whole response. Cached per user and only recomputed when profileText
// actually differs from last time, so re-opening/refreshing the page with an
// unchanged profile skips the network call entirely.
const userProfileEmbeddingCache = new Map(); // userId -> { profileText, embedding }
async function getProfileEmbeddingCached(userId, profileText) {
  const key = String(userId);
  const cached = userProfileEmbeddingCache.get(key);
  if (cached && cached.profileText === profileText) return cached.embedding;
  const embedding = await getEmbedding(profileText);
  userProfileEmbeddingCache.set(key, { profileText, embedding });
  return embedding;
}

// Caps how long a request waits on the (already-guaranteed-not-to-reject)
// embedding lookup — on a cache miss the HF call keeps running in the
// background and still populates userProfileEmbeddingCache/careerEmbeddingsCache
// for the next request, but this request itself falls back to the neutral
// CS score rather than sitting on a slow/cold external API call.
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(fallback); }
    }, ms);
    promise.then((value) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(value); }
    });
  });
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

    // S = Sr*40% + Er*20% + Xr*30% + CS*10%. Sr/Er/Xr are pure sync
    // computation — only CS needs the embedding call.
    const rankCareers = (cosineScores) => CAREER_PATHS
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

    const profileText = [
      userCourse && `Course: ${userCourse}.`,
      userJobTitle && `Current role: ${userJobTitle}.`,
      userIndustry && `Industry: ${userIndustry}.`,
      userSkillsText && `Skills: ${userSkillsText}.`,
    ].filter(Boolean).join(' ') || 'No profile information provided yet.';

    // CS (cosine similarity) is only the embedding-dependent piece of the
    // formula — Sr, Er, and Xr don't need the Hugging Face API at all, so if
    // it fails (network/HF down), CS just falls back to a neutral 0.5
    // instead of the whole recommendation failing.
    const embeddingResult = await withTimeout(
      Promise.all([getProfileEmbeddingCached(req.user.id, profileText), getCareerEmbeddings()])
        .then(([profileEmbedding, careerEmbeddings]) =>
          careerEmbeddings.map((vec) => normalizeCosine(cosineSimilarity(profileEmbedding, vec))))
        .catch((embedErr) => {
          console.error('career recommendation embedding failed, CS defaults to neutral:', embedErr.message);
          return null;
        }),
      3000,
      null
    );

    const careers = rankCareers(embeddingResult);
    const topCareer = careers[0];
    // The personalized "next step" sentence is a separate, much slower
    // Hugging Face chat completion (~4s vs ~1s for the embeddings above) —
    // it used to be awaited right here, making the whole page wait on it
    // even though the career cards themselves were already done. It's now
    // fetched lazily by the frontend via GET .../career-recommendations/next-step
    // (see getCareerNextStep below) so the cards render immediately; this
    // template line is what the panel shows until that call resolves (and
    // what it falls back to if the call fails).
    const nextStep = topCareer
      ? (topCareer.missing
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

// GET /api/alumni/career-recommendations/next-step?title=&match=&missing=
// Lazily generates the personalized "next step" sentence for the top career
// getCareerRecommendations already picked (passed back via query params, so
// this skips redoing the embedding call) — split out so the slow ~4s LLM
// call never blocks the career cards themselves. Falls back client-side to
// the template nextStep already returned above if this fails or is slow.
const getCareerNextStep = async (req, res) => {
  try {
    const { title, match, missing } = req.query;
    if (!title) return res.status(400).json({ message: 'title is required.' });

    const [me, employment] = await Promise.all([
      User.findById(req.user.id).select('course').lean(),
      AlumniEmployment.findOne({ alumni_id: req.user.id }).lean(),
    ]);

    const nextStep = await generateNextStepSuggestion({
      topCareer: { title, match: Number(match) || 0, missing: missing || null },
      userCourse: me?.course || '',
      userJobTitle: cleanEmploymentValue(employment?.job_title),
      userSkillsText: employment?.skills || '',
    });

    res.json({ nextStep });
  } catch (err) {
    console.error('getCareerNextStep error:', err);
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

const EDUCATION_LEVELS = {
  'high-school': /high school|secondary school|senior high/i,
  vocational: /vocational|technical (?:course|certificate)|tesda/i,
  bachelor: /bachelor(?:'s)?|college degree|undergraduate degree|b\.?(?:s|a|sc)\.?/i,
  master: /master(?:'s)?|postgraduate degree|mba\b|m\.?(?:s|a)\.?/i,
  doctorate: /doctorate|ph\.?d\.?|doctoral degree/i,
};

function isSameArea(jobLocation, profileLocation) {
  const job = String(jobLocation || '').toLowerCase();
  const profile = String(profileLocation || '').toLowerCase().trim();
  if (!job || !profile) return false;
  if (job.includes(profile) || profile.includes(job)) return true;
  const profileParts = profile.split(/[,/\-]/).map((part) => part.trim()).filter((part) => part.length >= 4);
  return profileParts.some((part) => job.includes(part));
}

const searchJobs = async (req, res) => {
  try {
    const { keywords = '', location = '', type = '', proximity = '', education = '', page = 1, pagesize = 20, sort = 'relevance' } = req.query;

    const employment = await AlumniEmployment.findOne({ alumni_id: req.user.id }).lean();
    const userSkillsText = employment?.skills || '';
    const profileLocation = String(employment?.work_location || '').trim();
    const requestedLocation = String(location || '').trim();
    const effectiveLocation = requestedLocation || (proximity === 'nearby' ? profileLocation : '');

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

    // For the default "Recommended for You" view, ask Careerjet to sort by
    // date rather than its own relevance score (otherwise a brand-new
    // posting ranked lower for relevance would never make it into the pool
    // at all), and use the same pool size Home's recommended-jobs count
    // uses so the two numbers can't disagree. A real search (explicit
    // keywords) keeps relevance sorting and the caller's own pagesize,
    // since that's an actual search, not the recommendation feed.
    // The plain "Recommended for You" view (no explicit search, no
    // location/type filters) is exactly what Home already computes and
    // caches per-alumnus — reusing it here means this page and Home can
    // never show two different job lists, and it skips a duplicate Careerjet
    // round-trip on every visit within the cache window instead of hitting
    // the external API fresh every single time.
    if (!hasExplicitSearch && !location && !type) {
      const jobs = await getRecommendedJobsForAlumni(req.user.id, employment);
      sortJobsByMatchThenDate(jobs);
      return res.json({ jobs, total: jobs.length, page: 1, pages: 1, hasProfile: !!profileKeywords });
    }

    const careerjetSort = hasExplicitSearch ? sort : 'date';
    const effectivePagesize = hasExplicitSearch ? pagesize : RECOMMENDED_POOL_SIZE;

    let data;
    try {
      data = await careerjetService.searchJobs({
        keywords: baseKeywords,
        location: effectiveLocation,
        contracttype: CONTRACT_TYPE_BY_TYPE[type] || '',
        contractperiod: CONTRACT_PERIOD_BY_TYPE[type] || '',
        page,
        pagesize: effectivePagesize,
        sort: careerjetSort,
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

    let jobs = scoreCareerjetJobs(data.jobs || [], { userSkillsText, location: effectiveLocation, typeLabel });
    if (proximity === 'nearby' && profileLocation) jobs = jobs.filter((job) => isSameArea(job.location, profileLocation));
    if (proximity === 'far' && profileLocation) jobs = jobs.filter((job) => !isSameArea(job.location, profileLocation));
    if (EDUCATION_LEVELS[education]) jobs = jobs.filter((job) => EDUCATION_LEVELS[education].test(job.description));

    // "Recommended for You" only makes sense as jobs with an actual match —
    // a real search (user typed something) still shows everything Careerjet
    // returned, just ranked best-match-first.
    sortJobsByMatchThenDate(jobs);
    const finalJobs = hasExplicitSearch ? jobs : jobs.filter((j) => (j.match ?? 0) > 0);

    res.json({
      jobs: finalJobs,
      total: finalJobs.length,
      page: data.page || Number(page),
      pages: data.pages ?? 1,
      hasProfile: !!profileKeywords,
      profileLocation,
    });
  } catch (err) {
    console.error('searchJobs error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/alumni/jobs/partner-postings — jobs posted by TSU partner
// employers through the Employer portal (routes/employer.js postJob), not
// pulled from Careerjet. Shown as a separate section on Job Connect since
// "Apply now" here logs an in-app application instead of opening an
// external link.
const getPartnerJobPostings = async (req, res) => {
  try {
    const employment = await AlumniEmployment.findOne({ alumni_id: req.user.id }).lean();
    const userSkillsText = employment?.skills || '';

    const rawJobs = await Job.find({ status: 'open' })
      .populate('partnershipId', 'name')
      .populate('postedBy', 'avatarUrl')
      .sort({ createdAt: -1 })
      .lean();

    const jobs = scoreInternalJobs(rawJobs, { userSkillsText });
    sortJobsByMatchThenDate(jobs);
    res.json({ jobs });
  } catch (err) {
    console.error('getPartnerJobPostings error:', err);
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

    try {
      await SavedJob.create({
        alumni_id: req.user.id, title, company, location, type, posted, url, description, salary, match, skills,
      });
    } catch (err) {
      // Backstop for a race between the existence check above and this
      // create (fast double-click, or a retried request after a slow
      // network) — the unique(alumni_id, url) index is the real guarantee.
      // Without this catch the losing request fell through to the generic
      // 500 below, and the frontend's toggleSave() silently swallows fetch
      // errors — the alumnus got no feedback at all and the button's state
      // could disagree with what's actually saved until the next reload.
      // The job WAS saved (by the other request), so report that truthfully
      // instead of an error.
      if (err.code === 11000) return res.json({ saved: true });
      throw err;
    }
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
    const { resume, isSaved } = await getResumeForAlumnus(req.user.id);
    // Job Connect's resume tool always needs something to render into its
    // editable fields, even for a brand-new alumnus with an empty profile —
    // only the employer-facing view (getApplicantResume) treats "nothing on
    // file at all" as null.
    res.json({ resume: resume || {}, isSaved });
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

const RESUME_FILE_DATA_URI_RE = /^data:(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document);base64,([a-zA-Z0-9+/]+=*)$/;
const MAX_RESUME_FILE_BYTES = 4 * 1024 * 1024; // 4MB decoded

// PUT /api/alumni/resume/file — attach an uploaded resume file (PDF/DOC/DOCX)
const updateMyResumeFile = async (req, res) => {
  try {
    const { fileData, fileName } = req.body;
    if (typeof fileData !== 'string' || typeof fileName !== 'string' || !fileName.trim()) {
      return res.status(400).json({ message: 'A file and file name are required.' });
    }
    const match = fileData.match(RESUME_FILE_DATA_URI_RE);
    if (!match) return res.status(400).json({ message: 'Resume file must be a PDF, DOC, or DOCX.' });
    if (Buffer.byteLength(match[2], 'base64') > MAX_RESUME_FILE_BYTES) {
      return res.status(400).json({ message: 'Resume file must be smaller than 4MB.' });
    }
    const resume = await Resume.findOneAndUpdate(
      { alumni_id: req.user.id },
      { $set: { fileData, fileName: fileName.trim().slice(0, 160), fileType: match[1] } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.json({ resume: { fileName: resume.fileName, fileType: resume.fileType } });
  } catch (err) {
    console.error('updateMyResumeFile error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/alumni/resume — clear the saved resume entirely so the tool
// returns to the "create or upload" state. logApplication/getResumeForAlumnus
// then fall back to the profile-derived suggestion (isSaved: false) again.
const deleteMyResume = async (req, res) => {
  try {
    await Resume.deleteOne({ alumni_id: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteMyResume error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/alumni/resume/file — remove the uploaded file, keeping any
// field-built resume intact.
const deleteMyResumeFile = async (req, res) => {
  try {
    await Resume.updateOne(
      { alumni_id: req.user.id },
      { $set: { fileData: '', fileName: '', fileType: '' } },
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteMyResumeFile error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const getApplications = async (req, res) => {
  try {
    const applications = await JobApplication.find({ alumni_id: req.user.id }).sort({ appliedAt: -1 }).lean();
    res.json({ applications });
  } catch (err) {
    console.error('getApplications error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Fired the moment "Apply now" is clicked — upsert (not create) so
// re-clicking Apply on the same listing never duplicates it or resets a
// status the alumnus already updated.
const logApplication = async (req, res) => {
  try {
    const { url, title, company, location, type, posted, description, salary, match, skills } = req.body;
    if (!url || !title) {
      return res.status(400).json({ message: 'Job url and title are required.' });
    }

    // Gate applying on a minimum skill match — the alumnus has to close the
    // gap on their profile first. Skipped for a job already applied to (so a
    // repeat click can't strand an existing application) and for jobs with
    // no computed match at all.
    const alreadyLogged = await JobApplication.exists({ alumni_id: req.user.id, url });
    if (!alreadyLogged && typeof match === 'number' && match < 50) {
      return res.status(400).json({ message: 'You need at least a 50% skill match to apply. Add the missing skills to your profile first.' });
    }

    // "internal:<jobId>" is how partner-postings (scoreInternalJobs) tag a
    // job with no real external URL — recovering the real Job's _id here is
    // what lets the employer who posted it actually see this application.
    const internalMatch = /^internal:([a-f0-9]{24})$/.exec(url);
    const job_id = internalMatch ? internalMatch[1] : null;

    // alreadyLogged (checked above) also tells a brand-new application apart
    // from a repeat "Apply now" click on one already logged — only the
    // former should notify the employer, otherwise re-opening the same job
    // page would spam them.
    const alreadyApplied = alreadyLogged;

    const application = await JobApplication.findOneAndUpdate(
      { alumni_id: req.user.id, url },
      { $setOnInsert: {
        alumni_id: req.user.id, job_id, title, company, location, type, posted, url, description, salary, match, skills,
        status: 'Applied', appliedAt: new Date(),
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Employers otherwise have no way to know a new candidate showed up
    // short of manually revisiting the Applicants page — nothing about
    // applying to an internal (partner-posted) job ever notified them.
    if (!alreadyApplied && job_id) {
      const job = await Job.findById(job_id).select('postedBy title');
      if (job) {
        const alumnus = await User.findById(req.user.id).select('firstName lastName');
        await Notification.create({
          user_id: job.postedBy,
          title:   'New Applicant',
          message: `${alumnus.firstName} ${alumnus.lastName} applied for ${job.title}.`,
          is_read: false,
          type:    'application',
        });
      }
    }

    res.json({ application });
  } catch (err) {
    console.error('logApplication error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

const APPLICATION_STATUSES = ['Applied', 'Interview Scheduled', 'Offer Received', 'Rejected', 'Withdrawn'];

const updateApplicationStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }

    const application = await JobApplication.findOneAndUpdate(
      { _id: req.params.id, alumni_id: req.user.id },
      { status },
      { new: true },
    );
    if (!application) {
      return res.status(404).json({ message: 'Application not found.' });
    }
    res.json({ application });
  } catch (err) {
    console.error('updateApplicationStatus error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/alumni/applications/:id — the alumnus cancels a logged
// application entirely (removes it from their tracker). logApplication
// upserts by url, so a cancelled job can be applied to again later.
const deleteApplication = async (req, res) => {
  try {
    const deleted = await JobApplication.findOneAndDelete({ _id: req.params.id, alumni_id: req.user.id });
    if (!deleted) {
      return res.status(404).json({ message: 'Application not found.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteApplication error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { changePassword, updatePassword, updateAvatar, sendInquiry, completeOnboarding, submitTracerStudy, updateAlumniTracerData, getMyTracerResponse, getTracerFormConfig, getHomeSummary, getMyEmployment, updateMyEmployment, getSuggestedAlumni, getCareerRecommendations, getCareerNextStep, searchJobs, getPartnerJobPostings, getJobSkillTip, getSavedJobs, toggleSavedJob, getJobAlertsPref, updateJobAlertsPref, getMyResume, updateMyResume, deleteMyResume, updateMyResumeFile, deleteMyResumeFile, getApplications, logApplication, updateApplicationStatus, deleteApplication };
