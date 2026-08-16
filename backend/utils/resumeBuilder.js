const User = require('../models/User');
const AlumniEmployment = require('../models/AlumniEmployment');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const Resume = require('../models/Resume');

// Same shape Resume.js/RESUME_FIELDS uses, minus alumni_id — no date_employed
// on file just falls back to whatever free-text years_in_current_job says.
function formatEmploymentDuration(employment) {
  if (employment?.date_employed) {
    const start = new Date(employment.date_employed);
    if (!Number.isNaN(start.getTime())) {
      const startLabel = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const stillThere = employment.employment_status === 'Employed' || employment.employment_status === 'Self-employed';
      return stillThere ? `${startLabel} - Present` : startLabel;
    }
  }
  return employment?.years_in_current_job || '';
}

// Returns the alumnus's saved Resume if they have one, otherwise a
// suggestion built from their actual profile (skills, education,
// employment) instead of a blank form — same fallback the alumni's own
// Job Connect resume tool shows, now also used by the employer's "View
// resume" so a candidate who never explicitly hit Save doesn't look like
// they have nothing on file when their profile clearly isn't empty.
async function getResumeForAlumnus(alumniId) {
  const existing = await Resume.findOne({ alumni_id: alumniId }).lean();
  if (existing) return { resume: existing, isSaved: true };

  const [user, employment, tracer] = await Promise.all([
    User.findById(alumniId).select('firstName middleInitial lastName email course graduationYear').lean(),
    AlumniEmployment.findOne({ alumni_id: alumniId }).lean(),
    TracerStudyResponse.findOne({ alumni_id: alumniId }).lean(),
  ]);
  if (!user) return { resume: null, isSaved: false };

  const fullName = [user.firstName, user.middleInitial ? `${user.middleInitial}.` : '', user.lastName].filter(Boolean).join(' ');

  const experienceLines = [];
  if (employment?.job_title) {
    const titleLine = [employment.job_title, employment.company_name].filter((v) => v && v !== 'N/A').join(' - ');
    experienceLines.push(employment.employment_type ? `${titleLine} (${employment.employment_type})` : titleLine);
    const meta = formatEmploymentDuration(employment);
    if (meta) experienceLines.push(meta);
  }

  const educationLines = [];
  if (user.course) educationLines.push(`${user.course} - Tarlac State University`);
  if (user.graduationYear) educationLines.push(`Batch ${user.graduationYear}`);

  const skillsList = (employment?.skills || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const topSkills = skillsList.slice(0, 3);
  const jobTitleArticle = employment?.job_title && /^[aeiou]/i.test(employment.job_title) ? 'an' : 'a';
  const summaryLead = [
    user.course ? `${user.course} graduate of Tarlac State University` : null,
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
    email: user.email || '',
    linkedin: '',
    summary,
    skills: skillsList.join('\n'),
    experience: experienceLines.join('\n'),
    education: educationLines.join('\n'),
    certifications: '',
    projects: '',
    languages: '',
  };

  // Nothing at all on file for this alumnus — genuinely nothing to show,
  // as opposed to "hasn't clicked Save yet but has a real profile".
  const isEmpty = !suggested.summary && !suggested.skills && !suggested.experience && !suggested.education;
  return { resume: isEmpty ? null : suggested, isSaved: false };
}

module.exports = { getResumeForAlumnus, formatEmploymentDuration };
