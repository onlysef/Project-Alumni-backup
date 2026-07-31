const User = require('../models/User');
const AlumniEmployment = require('../models/AlumniEmployment');
const Notification = require('../models/Notification');
const JobAlertSeen = require('../models/JobAlertSeen');
const careerjetService = require('./careerjetService');
const { ALL_SKILL_KEYWORDS, skillLabel, textContainsSkill } = require('../utils/skillMatching');

// Same scoring approach as alumniController.searchJobs: Careerjet gives no
// structured skill tags, so "does this posting ask for a skill this alumnus
// has" is read off the shared keyword vocabulary against title+description.
function scoreJob(job, userSkillsText) {
  const jobText = `${job.title || ''} ${job.description || ''}`;
  const jobSkillKeywords = ALL_SKILL_KEYWORDS.filter((kw) => textContainsSkill(jobText, kw)).slice(0, 6);
  if (!jobSkillKeywords.length) return null;
  const matchedCount = jobSkillKeywords.filter((kw) => textContainsSkill(userSkillsText, kw)).length;
  return Math.round((matchedCount / jobSkillKeywords.length) * 100);
}

// Checks one alumnus against fresh Careerjet postings for their profile and
// notifies them if there's a genuinely new match they haven't been told
// about before. Exported separately from runJobAlerts so it can be run for
// a single alumnus on demand (e.g. manual testing) without sweeping everyone.
async function checkAlumniJobAlert(alumniId) {
  const employment = await AlumniEmployment.findOne({ alumni_id: alumniId }).lean();
  const userSkillsText = employment?.skills || '';
  const firstUserSkill = userSkillsText.split(/[,;\n]/)[0]?.trim() || '';
  const keywords = employment?.job_title?.trim() || firstUserSkill;
  if (!keywords) return { notified: false, reason: 'no profile keywords' };

  const referrerUrl = `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/alumni/job-connect`;

  let data;
  try {
    data = await careerjetService.searchJobs({
      keywords,
      location: '',
      page: 1,
      pagesize: 15,
      sort: 'date', // freshest first — alerts care about what's new, not best-ranked
      userIp: '127.0.0.1',
      userAgent: 'AlumniPortal-JobAlertBot/1.0',
      referrerUrl,
    });
  } catch (err) {
    console.error(`Job alert Careerjet call failed for alumni ${alumniId}:`, err.message);
    return { notified: false, reason: 'careerjet error' };
  }

  const jobs = data.jobs || [];
  if (!jobs.length) return { notified: false, reason: 'no results' };

  const already = await JobAlertSeen.find({ alumni_id: alumniId, url: { $in: jobs.map((j) => j.url) } }).select('url').lean();
  const seenUrls = new Set(already.map((s) => s.url));

  const newMatches = [];
  for (const job of jobs) {
    if (seenUrls.has(job.url)) continue;
    const match = scoreJob(job, userSkillsText);
    if (match && match > 0) newMatches.push({ ...job, match });
  }

  // Mark every fetched listing as seen regardless of outcome, so unmatched
  // ones don't get re-scored (or re-considered for notification) forever.
  await JobAlertSeen.insertMany(
    jobs.map((j) => ({ alumni_id: alumniId, url: j.url })),
    { ordered: false },
  ).catch(() => {});

  if (!newMatches.length) return { notified: false, reason: 'no new matches' };

  newMatches.sort((a, b) => b.match - a.match);
  const top = newMatches[0];

  await Notification.create({
    user_id: alumniId,
    title: newMatches.length === 1 ? 'New job match found' : `${newMatches.length} new job matches found`,
    message: newMatches.length === 1
      ? `"${top.title}" at ${top.company || 'a company'} is a ${top.match}% match for your profile.`
      : `Including "${top.title}" at ${top.company || 'a company'} (${top.match}% match). Check Job Connect for the rest.`,
    type: 'job_alert',
  });

  return { notified: true, count: newMatches.length, top: { title: top.title, company: top.company, match: top.match } };
}

// Sweeps every alumnus who's opted into job alerts. Failures for one
// alumnus (bad profile data, a flaky Careerjet call) are logged and
// skipped rather than aborting the whole run.
async function runJobAlerts() {
  const alumni = await User.find({ role: 'alumni', status: 'active', jobAlertsEnabled: true }).select('_id').lean();
  let notifiedCount = 0;
  for (const alum of alumni) {
    try {
      const result = await checkAlumniJobAlert(alum._id);
      if (result.notified) notifiedCount += 1;
    } catch (err) {
      console.error(`Job alert sweep failed for alumni ${alum._id}:`, err.message);
    }
  }
  console.log(`Job alert sweep done: ${alumni.length} alumni checked, ${notifiedCount} notified.`);
  return { checked: alumni.length, notified: notifiedCount };
}

module.exports = { runJobAlerts, checkAlumniJobAlert };
