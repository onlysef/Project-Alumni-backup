const Job             = require('../models/Job');
const Partnership     = require('../models/Partnership');
const User            = require('../models/User');
const JobApplication  = require('../models/JobApplication');
const Interview       = require('../models/Interview');
const Notification    = require('../models/Notification');
const { sendApplicantMessageEmail, sendInterviewInvitationEmail } = require('../utils/emailService');
const { getResumeForAlumnus } = require('../utils/resumeBuilder');

// Every employer account linked to the same partnershipId (company) shares
// one workspace — jobs, applicants, and interviews posted/scheduled by any
// coworker on that company are visible and manageable by all of them, not
// just whoever personally clicked "Post" or "Schedule". `postedBy`/
// `employer_id` are still recorded on each row for attribution, just no
// longer used as the access-control boundary.
async function getEmployerPartnershipId(userId) {
  const employer = await User.findById(userId).select('partnershipId').lean();
  return employer?.partnershipId || null;
}

async function getCompanyJobIds(partnershipId) {
  return Job.find({ partnershipId }).distinct('_id');
}

// POST /api/employer/jobs  — employer posts a job
const postJob = async (req, res) => {
  try {
    const { title, description, jobType, location } = req.body;
    if (!title) return res.status(400).json({ message: 'title is required.' });

    // partnershipId always comes from the employer's own linked account, never
    // from the request body — a free-choice field here let any employer post
    // a job under any partner company's name, since nothing actually tied an
    // employer account to one specific company.
    const employer = await User.findById(req.user.id).select('partnershipId').lean();
    if (!employer?.partnershipId) {
      return res.status(403).json({ message: 'Your account isn\'t linked to a partner company yet. Contact the admin office to get this set up.' });
    }
    // getActivePartnerships already hides an Archived partnership from the
    // frontend (which disables "Create post" as a result) — re-checked here
    // too so a direct API call can't bypass that and post under a company
    // the admin office has since archived.
    const partnership = await Partnership.findById(employer.partnershipId).select('status').lean();
    if (!partnership || partnership.status === 'Archived') {
      return res.status(403).json({ message: 'Your linked partner company is archived. Contact the admin office to reactivate it before posting.' });
    }

    let job = await Job.create({
      title, description, partnershipId: employer.partnershipId, jobType, location,
      postedBy: req.user.id,
    });
    // Without this, the just-created job's partnershipId is a bare ObjectId
    // string (not { _id, name }) until the next full list refetch — the
    // "Partnership" field would show blank in the details view immediately
    // after creating a post.
    job = await job.populate('partnershipId', 'name');
    res.status(201).json({ job });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/employer/jobs  — every job posted under this employer's company,
// not just the ones this specific account posted.
const getMyJobs = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    if (!partnershipId) return res.json({ jobs: [] });
    const jobs = await Job.find({ partnershipId })
      .populate('partnershipId', 'name')
      .sort({ createdAt: -1 });
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/employer/partnerships  — the employer's own linked company, if any
// (used to show "posting as <company>" and to gate job creation client-side;
// this used to return every active partnership system-wide, letting any
// employer post under any company's name).
const getActivePartnerships = async (req, res) => {
  try {
    const employer = await User.findById(req.user.id).select('partnershipId').lean();
    if (!employer?.partnershipId) return res.json({ partnerships: [] });
    const partnership = await Partnership.findOne(
      { _id: employer.partnershipId, status: { $ne: 'Archived' } },
      'name type'
    );
    res.json({ partnerships: partnership ? [partnership] : [] });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/employer/jobs/:id  — any employer account on the same company
// can edit the post's content, not just whoever originally posted it.
const updateJob = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const job = partnershipId ? await Job.findOne({ _id: req.params.id, partnershipId }) : null;
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    // partnershipId is intentionally not editable here — same reasoning as
    // postJob, it's tied to the account, not a per-post choice.
    const { title, description, jobType, location } = req.body;
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ message: 'Title is required.' });
      job.title = title.trim();
    }
    if (description !== undefined) job.description = description;
    if (jobType !== undefined) job.jobType = jobType;
    if (location !== undefined) job.location = location;
    const titleChanged = title !== undefined;
    await job.save();
    await job.populate('partnershipId', 'name');

    // Existing applications snapshot the job title at apply-time — for
    // Careerjet listings that's the only copy that will ever exist, but for
    // an internal posting we do have a live source of truth, so keep it in
    // sync instead of leaving the Applicants list/Appointments scheduler
    // showing a stale position name after the employer renames the post.
    if (titleChanged) {
      await JobApplication.updateMany({ job_id: job._id }, { title: job.title });
    }

    res.json({ job });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/employer/jobs/:id/close  — any employer account on the same
// company can close a job, not just whoever originally posted it.
const closeJob = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const job = partnershipId ? await Job.findOne({ _id: req.params.id, partnershipId }) : null;
    if (!job) return res.status(404).json({ message: 'Job not found.' });
    job.status = 'closed';
    await job.save();
    await job.populate('partnershipId', 'name');
    res.json({ job });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/employer/jobs/:id  — any employer account on the same company
// can delete a job, not just whoever originally posted it.
const deleteJob = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const job = partnershipId ? await Job.findOne({ _id: req.params.id, partnershipId }) : null;
    if (!job) return res.status(404).json({ message: 'Job not found.' });

    // Deleting a job with real applicants used to silently orphan them —
    // JobApplication.job_id would point at nothing, they'd vanish from the
    // Applicants list with no way to message/review them again, and any
    // scheduled Interview would keep showing a position that no longer
    // exists. Closing (not deleting) is the safe path once candidates exist.
    const applicantCount = await JobApplication.countDocuments({ job_id: job._id });
    if (applicantCount > 0) {
      return res.status(409).json({
        message: `This post has ${applicantCount} applicant${applicantCount === 1 ? '' : 's'}. Close it instead of deleting so you don't lose access to their applications.`,
      });
    }

    await job.deleteOne();
    res.json({ message: 'Job deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/employer/applicants  — every application against any job posted
// under this employer's company (never another company's — job_id is
// filtered to the company's own job ids below, same check as closeJob/deleteJob).
const getApplicants = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    const applications = await JobApplication.find({ job_id: { $in: myJobIds } })
      .populate('alumni_id', 'firstName lastName email course college graduationYear avatarUrl')
      .sort({ appliedAt: -1 })
      .lean();
    // alumni_id can come back null if that account was since deleted —
    // skip rather than show a blank row.
    const applicants = applications.filter((a) => a.alumni_id);
    res.json({ applicants });
  } catch (err) {
    console.error('getApplicants error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/employer/applicants/:id/status  — employer moves a candidate
// through their own review pipeline (New/Reviewed/Shortlisted/Rejected) —
// separate from the alumnus's own self-reported `status` field.
const updateApplicantStatus = async (req, res) => {
  try {
    const { employerStatus } = req.body;
    const VALID = ['New', 'Reviewed', 'Shortlisted', 'Rejected'];
    if (!VALID.includes(employerStatus)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    const application = await JobApplication.findOne({ _id: req.params.id, job_id: { $in: myJobIds } });
    if (!application) return res.status(404).json({ message: 'Application not found.' });

    const wasAlreadyRejected = application.status === 'Rejected';
    application.employerStatus = employerStatus;

    // The alumnus's own self-reported `status` has no equivalent for most of
    // the employer's internal pipeline (Reviewed/Shortlisted aren't
    // meaningful to surface on their side), but "Rejected" is the one
    // outcome they actually need to know about — without this their own Job
    // Connect tracker just keeps showing "Applied" forever with no signal
    // anything happened, and any interview already scheduled would still
    // show as "Upcoming" for a candidate who's already been turned down.
    if (employerStatus === 'Rejected' && !wasAlreadyRejected) {
      application.status = 'Rejected';
      await Promise.allSettled([
        Notification.create({
          user_id: application.alumni_id,
          title:   'Application Update',
          message: `Your application for ${application.title} was not selected to move forward.`,
          is_read: false,
          type:    'application',
        }),
        Interview.updateMany({ application_id: application._id, status: 'Upcoming' }, { status: 'Cancelled' }),
      ]);
    }

    await application.save();
    res.json({ application });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/employer/applicants/:id/resume  — the applicant's resume,
// fetched lazily (only when the employer actually opens "View resume")
// rather than joined onto every row of the list above. Falls back to a
// profile-derived resume (same as the alumnus's own Job Connect tool shows)
// when they haven't explicitly saved one — a candidate with a real,
// complete profile shouldn't look like they have nothing on file just
// because they never clicked Save.
const getApplicantResume = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    const application = await JobApplication.findOne({ _id: req.params.id, job_id: { $in: myJobIds } }).lean();
    if (!application) return res.status(404).json({ message: 'Application not found.' });
    const { resume, isSaved } = await getResumeForAlumnus(application.alumni_id);
    res.json({ resume, isSaved });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/employer/applicants/:id/message  — "Send a mail" on an
// applicant's profile, sent for real through the backend instead of a
// mailto: link (which does nothing if the browser has no default mail
// client configured).
const messageApplicant = async (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ message: 'Subject and message are required.' });
    }

    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    const application = await JobApplication.findOne({ _id: req.params.id, job_id: { $in: myJobIds } })
      .populate('alumni_id', 'firstName lastName email')
      .lean();
    if (!application?.alumni_id) return res.status(404).json({ message: 'Application not found.' });

    const [employer, partnership] = await Promise.all([
      User.findById(req.user.id).select('email partnershipId').lean(),
      Job.findById(application.job_id).select('partnershipId').populate('partnershipId', 'name').lean(),
    ]);
    const companyName = partnership?.partnershipId?.name || 'A TSU partner employer';

    await sendApplicantMessageEmail(
      application.alumni_id.email,
      application.alumni_id.firstName,
      companyName,
      employer.email,
      subject.trim(),
      message.trim(),
    );
    res.json({ message: 'Message sent.' });
  } catch (err) {
    console.error('messageApplicant error:', err);
    res.status(500).json({ message: 'Failed to send message.' });
  }
};

// ============ INTERVIEWS ============
// The employer's own interview scheduler (Appointments page) — distinct from
// the coordinator/alumni office-visit Appointment model: no staff, no
// office-hours rules, always tied to one specific JobApplication.

function formatInterviewWhen(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dateLabel = new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${dateLabel} · ${h12}:${String(mi).padStart(2, '0')} ${ampm}`;
}

// An "Upcoming" interview whose date/time has passed is stale — sweep it to
// "Completed" so the list reflects reality without the employer having to
// manually close out every past interview (same pattern as the coordinator
// appointment system's expireStalePendingAppointments).
async function expirePastInterviews(jobIds) {
  const now = Date.now();
  const upcoming = await Interview.find({ job_id: { $in: jobIds }, status: 'Upcoming' }).select('_id date time');
  const staleIds = upcoming.filter((i) => {
    const [y, mo, d] = i.date.split('-').map(Number);
    const [h, mi] = (i.time || '00:00').split(':').map(Number);
    return new Date(y, mo - 1, d, h, mi).getTime() < now;
  }).map((i) => i._id);
  if (staleIds.length) await Interview.updateMany({ _id: { $in: staleIds } }, { status: 'Completed' });
}

// GET /api/employer/interviews  — every interview scheduled by any employer
// account on this company, not just the ones this account scheduled.
const getInterviews = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    await expirePastInterviews(myJobIds);
    const interviews = await Interview.find({ job_id: { $in: myJobIds } }).sort({ date: -1, time: -1 });
    res.json({ interviews });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/employer/interviews — schedules the interview and emails the
// invite in one step, since "Send invitation" implies both.
const scheduleInterview = async (req, res) => {
  try {
    const { application_id, date, time, mode, location } = req.body;
    if (!application_id || !date || !time || !location) {
      return res.status(400).json({ message: 'Applicant, date, time, and location are required.' });
    }

    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    const application = await JobApplication.findOne({ _id: application_id, job_id: { $in: myJobIds } })
      .populate('alumni_id', 'firstName lastName email');
    if (!application?.alumni_id) return res.status(404).json({ message: 'Applicant not found.' });

    const [employer, job] = await Promise.all([
      User.findById(req.user.id).select('email').lean(),
      Job.findById(application.job_id).populate('partnershipId', 'name').lean(),
    ]);
    const companyName = job?.partnershipId?.name || 'A TSU partner employer';
    const alumniName  = `${application.alumni_id.firstName} ${application.alumni_id.lastName}`;

    const interview = await Interview.create({
      employer_id:    req.user.id,
      application_id: application._id,
      alumni_id:      application.alumni_id._id,
      alumni_name:    alumniName,
      job_id:         application.job_id,
      position:       application.title,
      date, time,
      mode:           mode === 'Online' ? 'Online' : 'Face-to-face',
      location:       location.trim(),
      status:         'Upcoming',
    });

    application.status = 'Interview Scheduled';
    await application.save();

    const whenLabel = formatInterviewWhen(date, time);
    await Promise.allSettled([
      sendInterviewInvitationEmail(
        application.alumni_id.email, application.alumni_id.firstName, companyName,
        application.title, whenLabel, interview.mode, interview.location, employer.email,
      ),
      Notification.create({
        user_id: application.alumni_id._id,
        title:   'Interview Invitation',
        message: `${companyName} invited you to an interview for ${application.title} on ${whenLabel}.`,
        is_read: false,
        type:    'interview',
      }),
    ]);

    res.status(201).json({ message: 'Interview scheduled and invitation sent.', interview });
  } catch (err) {
    console.error('scheduleInterview error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/employer/interviews/:id — reschedule; only while still
// "Upcoming" (mirrors the coordinator system restricting edits to actionable
// states). Applicant/position aren't editable — they're tied to the
// application this interview was created for, same reasoning as postJob's
// non-editable partnershipId.
const updateInterview = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    const interview = await Interview.findOne({ _id: req.params.id, job_id: { $in: myJobIds }, status: 'Upcoming' });
    if (!interview) return res.status(404).json({ message: 'Interview not found or no longer editable.' });

    const { date, time, mode, location } = req.body;
    if (date     !== undefined) interview.date     = date;
    if (time     !== undefined) interview.time     = time;
    if (mode     !== undefined) interview.mode     = mode === 'Online' ? 'Online' : 'Face-to-face';
    if (location !== undefined) interview.location = location.trim();
    await interview.save();
    res.json({ message: 'Appointment updated.', interview });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/employer/interviews/:id/cancel
const cancelInterview = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    const interview = await Interview.findOneAndUpdate(
      { _id: req.params.id, job_id: { $in: myJobIds }, status: 'Upcoming' },
      { status: 'Cancelled' },
      { new: true },
    );
    if (!interview) return res.status(404).json({ message: 'Interview not found or already resolved.' });
    res.json({ message: 'Interview cancelled.', interview });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// DELETE /api/employer/interviews/:id
const deleteInterview = async (req, res) => {
  try {
    const partnershipId = await getEmployerPartnershipId(req.user.id);
    const myJobIds = partnershipId ? await getCompanyJobIds(partnershipId) : [];
    const interview = await Interview.findOneAndDelete({ _id: req.params.id, job_id: { $in: myJobIds } });
    if (!interview) return res.status(404).json({ message: 'Interview not found.' });
    res.json({ message: 'Interview deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/admin/jobs  — admin sees all jobs
const getAllJobs = async (req, res) => {
  try {
    const jobs = await Job.find()
      .populate('partnershipId', 'name')
      .populate('postedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ jobs });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  postJob, getMyJobs, getActivePartnerships, updateJob, closeJob, deleteJob, getAllJobs,
  getApplicants, updateApplicantStatus, getApplicantResume, messageApplicant,
  getInterviews, scheduleInterview, updateInterview, cancelInterview, deleteInterview,
};
