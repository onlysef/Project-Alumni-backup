const bcrypt               = require('bcryptjs');
const User                 = require('../models/User');
const AlumniEmployment     = require('../models/AlumniEmployment');
const TracerStudyResponse  = require('../models/TracerStudyResponse');
const { getTracerFormConfig } = require('./tracerFormConfigController');

// The set of keys that the TracerStudyResponse schema handles directly.
// Everything else in the submitted answers object goes into extra_answers.
const FIXED_KEYS = new Set([
  'consent', // validated on frontend; not persisted
  'contactNumber', 'gender',
  'programsCompleted', 'professionalExam', 'professionalExamName',
  'employmentStatus', 'placeOfWork', 'occupationTitle', 'industryField',
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
// Fields not present in the tracer form (company_name, salary_range, date_employed)
// are intentionally omitted so admin-entered values are preserved on re-submit.
function extractEmploymentFromTracer(answers) {
  const reasonsArr = Array.isArray(answers.reasonsNotEmployed)
    ? answers.reasonsNotEmployed
    : answers.reasonsNotEmployed ? [answers.reasonsNotEmployed] : [];

  return {
    employment_status:     mapEmploymentStatus(answers.employmentStatus),
    job_title:             answers.occupationTitle    || '',
    industry:              answers.industryField      || '',
    work_location:         answers.placeOfWork        || '',
    job_related_to_course: answers.jobRelatedToDegree === 'Yes',
    reason_unemployed:     reasonsArr.join('; '),
  };
}

// POST /api/alumni/change-password
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

    // Auto-sync employment record — only updates fields that come from the tracer form;
    // admin-entered fields (company_name, salary_range, date_employed) are preserved.
    const employmentUpdate = extractEmploymentFromTracer(body);
    await AlumniEmployment.findOneAndUpdate(
      { alumni_id: alumniId },
      { $set: { ...employmentUpdate, last_updated: new Date() } },
      { upsert: true, new: true }
    );

    await User.findByIdAndUpdate(alumniId, { tracerStudyCompleted: true });

    res.status(200).json({ message: 'Tracer study submitted successfully.' });
  } catch (err) {
    console.error('submitTracerStudy error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { changePassword, completeOnboarding, submitTracerStudy, getMyTracerResponse, getTracerFormConfig };
