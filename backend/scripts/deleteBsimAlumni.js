// One-time removal: hard-deletes every alumni User account whose course is
// "BSIM", plus every record cascaded by adminController.js's own
// deleteUser() for a single-account delete (AlumniEmployment,
// TracerStudyResponse, Appointment, AttendanceLog, EventFeedback,
// EventInterested, ActivityLog, EmploymentActivity, Notification, SavedJob,
// JobApplication, JobAlertSeen, Resume, Interview, Graduate +
// imported_file embeddings) — same logic, just looped over every matching
// user instead of one id from a request param.
//
// Also closes a gap that already exists in deleteUser() itself (not
// introduced here): EmbeddingDocument rows with source_type 'tracer' /
// 'employment' / 'user' (live-submission RAG chunks, tagged by
// `source_id` — see EmbeddingDocument.js's own comment) are tied directly
// to the User/TracerStudyResponse/AlumniEmployment documents being
// deleted, so their ids are captured BEFORE the cascade runs and those
// embedding rows are removed too.
//
// Run once: node scripts/deleteBsimAlumni.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const AlumniEmployment = require('../models/AlumniEmployment');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const EmploymentActivity = require('../models/EmploymentActivity');
const Appointment = require('../models/Appointment');
const ActivityLog = require('../models/ActivityLog');
const AttendanceLog = require('../models/AttendanceLog');
const EventFeedback = require('../models/EventFeedback');
const EventInterested = require('../models/EventInterested');
const Notification = require('../models/Notification');
const Graduate = require('../models/Graduate');
const EmbeddingDocument = require('../models/EmbeddingDocument');
const SavedJob = require('../models/SavedJob');
const JobApplication = require('../models/JobApplication');
const JobAlertSeen = require('../models/JobAlertSeen');
const Resume = require('../models/Resume');
const Interview = require('../models/Interview');
const Job = require('../models/Job');

const COURSE = 'BSIM';

async function deleteOneAlumnus(user) {
  const userId = user._id;

  // Capture every live-collection document id BEFORE deleting it, so the
  // matching 'tracer'/'employment'/'user' EmbeddingDocument rows (tagged by
  // source_id) can still be found afterward.
  const [tracerDoc, employmentDoc] = await Promise.all([
    TracerStudyResponse.findOne({ alumni_id: userId }).select('_id').lean(),
    AlumniEmployment.findOne({ alumni_id: userId }).select('_id').lean(),
  ]);
  const sourceIds = [userId, tracerDoc?._id, employmentDoc?._id].filter(Boolean);

  await User.findByIdAndDelete(userId);

  const cascadeResults = await Promise.allSettled([
    AlumniEmployment.deleteOne({ alumni_id: userId }),
    TracerStudyResponse.deleteOne({ alumni_id: userId }),
    Appointment.deleteMany({ alumni_id: userId }),
    AttendanceLog.deleteMany({ alumni_id: userId }),
    EventFeedback.deleteMany({ alumni_id: userId }),
    EventInterested.deleteMany({ alumni_id: userId }),
    ActivityLog.deleteMany({ user_id: userId }),
    EmploymentActivity.deleteMany({ user_id: userId }),
    Notification.deleteMany({ user_id: userId }),
    SavedJob.deleteMany({ alumni_id: userId }),
    JobApplication.deleteMany({ alumni_id: userId }),
    JobAlertSeen.deleteMany({ alumni_id: userId }),
    Resume.deleteOne({ alumni_id: userId }),
    Interview.deleteMany({ $or: [{ alumni_id: userId }, { employer_id: userId }] }),
    Job.updateMany({ postedBy: userId, status: 'open' }, { status: 'closed' }),
    EmbeddingDocument.deleteMany({ source_type: { $in: ['tracer', 'employment', 'user'] }, source_id: { $in: sourceIds } }),
    (async () => {
      if (!user.email) return;
      const graduates = await Graduate.find({
        $or: [
          { user_id: userId },
          { $expr: { $eq: [{ $toLower: { $ifNull: ['$email', ''] } }, user.email.toLowerCase().trim()] } },
        ],
      }).select('_id').lean();
      if (graduates.length) {
        await Graduate.deleteMany({ _id: { $in: graduates.map((g) => g._id) } });
        await EmbeddingDocument.deleteMany({ source_type: 'imported_file', 'metadata.graduate_id': { $in: graduates.map((g) => String(g._id)) } });
      }
    })(),
  ]);
  cascadeResults.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`  cascade[${i}] error for ${userId}:`, r.reason);
  });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const users = await User.find({ course: COURSE }).select('_id name email course').lean();
  if (!users.length) {
    console.log(`No users found with course "${COURSE}". Nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`Deleting ${users.length} user(s) with course "${COURSE}":`);
  users.forEach((u) => console.log(`  - ${u._id}: ${u.name || '(no name)'} <${u.email || 'no email'}>`));

  for (const u of users) {
    await deleteOneAlumnus(u);
    console.log(`  done: ${u._id}`);
  }

  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
