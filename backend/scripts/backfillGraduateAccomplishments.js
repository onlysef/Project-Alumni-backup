// One-time backfill: populate the new Graduate.significantAccomplishments
// field (added so "what significant accomplishments have alumni reported"
// has real Yes/No data to answer from) for every EXISTING Graduate row,
// sourced from TracerStudyResponse.significantAccomplishments — the field is
// only synced going forward on new submitTracerStudy writes (see
// alumniController.js's syncGraduateAndEmbedding), so rows that predate this
// field need a one-time catch-up.
//
// Updates by EMAIL (updateMany), not by a single row's own _id — see
// backfillGraduateTrainingType.js's own comment for why: a person can have
// more than one Graduate document, and aggregationService.js's shared
// DEDUP stage always picks the NEWEST one by createdAt, which may not be
// the specific row a by-_id backfill would touch. Setting it on every row
// sharing that email makes DEDUP's choice irrelevant.
//
// Run once: node scripts/backfillGraduateAccomplishments.js
require('dotenv').config();
const mongoose = require('mongoose');
const Graduate = require('../models/Graduate');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const User = require('../models/User');
const answerCache = require('../services/answerCache');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const responses = await TracerStudyResponse.find({ significantAccomplishments: { $nin: [null, ''] } })
    .select('alumni_id significantAccomplishments').lean();
  console.log(`${responses.length} TracerStudyResponse row(s) with a real significantAccomplishments answer.`);

  const users = await User.find({ _id: { $in: responses.map(r => r.alumni_id) } })
    .select('email').lean();
  const emailByUserId = new Map(users.map(u => [String(u._id), (u.email || '').toLowerCase().trim()]));

  let updated = 0;
  for (const r of responses) {
    const email = emailByUserId.get(String(r.alumni_id));
    if (!email) continue;
    const result = await Graduate.updateMany(
      { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }, significantAccomplishments: null },
      { $set: { significantAccomplishments: r.significantAccomplishments } }
    );
    updated += result.modifiedCount;
  }

  if (updated > 0) answerCache.bumpDataVersion();
  console.log(`Backfilled significantAccomplishments on ${updated} Graduate row(s) (including duplicates).`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
