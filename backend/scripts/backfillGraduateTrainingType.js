// One-time backfill: populate the new Graduate.trainingType field (added so
// "what trainings did alumni attend" can list actual training names instead
// of just a Yes/No pursued-or-not breakdown) for every EXISTING Graduate
// row, sourced from TracerStudyResponse.trainingType — the field is only
// synced going forward on new submitTracerStudy writes (see
// alumniController.js's syncGraduateAndEmbedding), so rows that predate this
// field need a one-time catch-up. Bulk-imported rows with no linked user_id
// have no TracerStudyResponse to backfill from and are left untouched.
//
// Updates by EMAIL (updateMany), not by a single row's own _id — a person
// can have more than one Graduate document (duplicate bulk imports over
// time), and aggregationService.js's shared DEDUP stage always picks the
// NEWEST one by createdAt, which is not necessarily the specific row this
// script would otherwise have touched. Backfilling only that one row left
// the value invisible to every real query whenever a newer, still-blank
// duplicate existed — caught live: 45 rows backfilled this way, but only 21
// survived DEDUP in the actual chatbot answer. Setting it on every row
// sharing that email makes DEDUP's choice irrelevant.
//
// Run once: node scripts/backfillGraduateTrainingType.js
require('dotenv').config();
const mongoose = require('mongoose');
const Graduate = require('../models/Graduate');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const User = require('../models/User');
const answerCache = require('../services/answerCache');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const responses = await TracerStudyResponse.find({ trainingType: { $nin: [null, ''] } })
    .select('alumni_id trainingType').lean();
  console.log(`${responses.length} TracerStudyResponse row(s) with a real trainingType.`);

  const users = await User.find({ _id: { $in: responses.map(r => r.alumni_id) } })
    .select('email').lean();
  const emailByUserId = new Map(users.map(u => [String(u._id), (u.email || '').toLowerCase().trim()]));

  let updated = 0;
  for (const r of responses) {
    const email = emailByUserId.get(String(r.alumni_id));
    if (!email) continue;
    const result = await Graduate.updateMany(
      { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, trainingType: null },
      { $set: { trainingType: r.trainingType } }
    );
    updated += result.modifiedCount;
  }

  if (updated > 0) answerCache.bumpDataVersion();
  console.log(`Backfilled trainingType on ${updated} Graduate row(s) (including duplicates).`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
