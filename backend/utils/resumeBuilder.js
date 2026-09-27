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

// Builds every field that has a live source elsewhere in the alumnus's own
// profile (identity, Employment Details, tracer study) — used both for the
// no-resume-saved-yet suggestion AND to keep an already-saved Resume in sync
// with later profile edits (see getResumeForAlumnus below). Certifications/
// Projects/Languages have no equivalent field anywhere else in the profile,
// so they're intentionally left out here — they only ever come from what the
// alumnus typed directly into the Resume editor.
function deriveFromProfile(user, employment, tracer) {
  // middleInitial is free-text (User.js has no format/period stripping on
  // it) — some accounts already have it saved WITH a trailing period (e.g.
  // "A."), so unconditionally appending one here produced "Rain A.. Thora"
  // instead of "Rain A. Thora". Strip any period already there first, same
  // defensive fix AccountsView.jsx applies when deriving a display value.
  const cleanMiddleInitial = (user.middleInitial || '').replace(/\.+$/, '');
  const fullName = [user.firstName, cleanMiddleInitial ? `${cleanMiddleInitial}.` : '', user.lastName].filter(Boolean).join(' ');

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

  return {
    name: fullName,
    // .contact_email is the Employment Details "Contact Email" field, kept
    // deliberately separate from the alumnus's private login email (the form
    // itself says so: "Your login email stays private") — that's the field
    // meant to be shown externally, so it's the right source for a resume.
    // Falls back to the login email only if they haven't set one, so the
    // resume isn't left with a blank email.
    email:    employment?.contact_email  || user.email || '',
    phone:    employment?.contact_number || tracer?.contactNumber || '',
    address:  employment?.work_location  || '',
    linkedin: employment?.linkedin       || '',
    summary,
    skills:     skillsList.join('\n'),
    experience: experienceLines.join('\n'),
    education:  educationLines.join('\n'),
  };
}

// Returns the alumnus's saved Resume if they have one, otherwise a
// suggestion built from their actual profile (skills, education,
// employment) instead of a blank form — same fallback the alumni's own
// Job Connect resume tool shows, now also used by the employer's "View
// resume" so a candidate who never explicitly hit Save doesn't look like
// they have nothing on file when their profile clearly isn't empty.
async function getResumeForAlumnus(alumniId) {
  const [existing, user, employment, tracer] = await Promise.all([
    Resume.findOne({ alumni_id: alumniId }).lean(),
    User.findById(alumniId).select('firstName middleInitial lastName email course graduationYear').lean(),
    AlumniEmployment.findOne({ alumni_id: alumniId }).lean(),
    TracerStudyResponse.findOne({ alumni_id: alumniId }).lean(),
  ]);
  if (!user) return { resume: existing || null, isSaved: !!existing };

  const derived = deriveFromProfile(user, employment, tracer);

  if (existing) {
    // A saved Resume used to be a frozen snapshot forever — editing anything
    // in Employment Details (work location, job title, company, contact
    // info, skills...) never touched it again, so it kept showing whatever
    // was true the day it was first saved. Every field with a live source
    // elsewhere in the profile is refreshed here on every read instead;
    // Certifications/Projects/Languages have no such source (nothing in
    // Employment Details maps to them), so those three alone stay exactly
    // as the alumnus last typed them into the Resume editor.
    return {
      resume: {
        ...existing,
        ...derived,
      },
      isSaved: true,
    };
  }

  // Nothing at all on file for this alumnus — genuinely nothing to show,
  // as opposed to "hasn't clicked Save yet but has a real profile".
  const suggested = { ...derived, certifications: '', projects: '', languages: '' };
  const isEmpty = !suggested.summary && !suggested.skills && !suggested.experience && !suggested.education;
  return { resume: isEmpty ? null : suggested, isSaved: false };
}

module.exports = { getResumeForAlumnus, formatEmploymentDuration };
