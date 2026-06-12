const bcrypt               = require('bcryptjs');
const User                 = require('../models/User');
const AlumniEmployment     = require('../models/AlumniEmployment');
const TracerStudyResponse  = require('../models/TracerStudyResponse');

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

// POST /api/alumni/tracer-study
const submitTracerStudy = async (req, res) => {
  try {
    const alumniId = req.user.id;

    const existing = await TracerStudyResponse.findOne({ alumni_id: alumniId });
    if (existing) {
      return res.status(400).json({ message: 'Tracer study already submitted.' });
    }

    const {
      contactNumber, gender,
      programsCompleted, professionalExam, professionalExamName,
      employmentStatus, placeOfWork, occupationTitle, industryField,
      presentEmploymentType, jobRelatedToDegree, yearsInCurrentJob,
      reasonsNotEmployed,
      furtherEducation, furtherEducationType,
      pursuedTrainings, trainingType,
      personalGrowthRatings,
      promotedInJob, significantAccomplishments,
      professionalCertifications, professionalDevelopmentActivities,
    } = req.body;

    await TracerStudyResponse.create({
      alumni_id: alumniId,
      contactNumber:    contactNumber    || '',
      gender:           gender           || '',
      programsCompleted:    programsCompleted    || [],
      professionalExam:     professionalExam     || '',
      professionalExamName: professionalExamName || '',
      employmentStatus:     employmentStatus     || '',
      placeOfWork:           placeOfWork           || '',
      occupationTitle:       occupationTitle       || '',
      industryField:         industryField         || '',
      presentEmploymentType: presentEmploymentType || '',
      jobRelatedToDegree:    jobRelatedToDegree    || '',
      yearsInCurrentJob:     yearsInCurrentJob     || '',
      reasonsNotEmployed:    reasonsNotEmployed    || [],
      furtherEducation:      furtherEducation      || '',
      furtherEducationType:  furtherEducationType  || '',
      pursuedTrainings:      pursuedTrainings      || '',
      trainingType:          trainingType          || '',
      personalGrowthRatings: personalGrowthRatings || {},
      promotedInJob:                    promotedInJob                    || '',
      significantAccomplishments:       significantAccomplishments       || '',
      professionalCertifications:       professionalCertifications       || '',
      professionalDevelopmentActivities:professionalDevelopmentActivities|| '',
    });

    await User.findByIdAndUpdate(alumniId, { tracerStudyCompleted: true });

    res.status(201).json({ message: 'Tracer study submitted successfully.' });
  } catch (err) {
    console.error('submitTracerStudy error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = { changePassword, completeOnboarding, submitTracerStudy };
