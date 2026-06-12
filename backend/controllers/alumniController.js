const bcrypt          = require('bcryptjs');
const User            = require('../models/User');
const AlumniEmployment = require('../models/AlumniEmployment');

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

module.exports = { changePassword, completeOnboarding };
