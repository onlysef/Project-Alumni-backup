// One-time repair: backfills Graduate.reasonsNotEmployed for every row that
// already has a live TracerStudyResponse submission, from BEFORE that field
// existed on the Graduate schema (see Graduate.js's own comment on it, added
// alongside this script). Going forward, a NEW live submission already syncs
// this field automatically via alumniController.syncGraduateAndEmbedding —
// this script only closes the gap for already-submitted records.
//
// Run once: node scripts/backfillReasonsNotEmployed.js
require('dotenv').config();
const mongoose = require('mongoose');
const Graduate = require('../models/Graduate');
const TracerStudyResponse = require('../models/TracerStudyResponse');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const responses = await TracerStudyResponse.find({
    reasonsNotEmployed: { $exists: true, $not: { $size: 0 } },
  }).select('alumni_id reasonsNotEmployed').lean();
  console.log(`${responses.length} tracer submission(s) with at least one reasonsNotEmployed value.`);

  let updated = 0, skipped = 0;
  for (const r of responses) {
    const res = await Graduate.updateOne(
      { user_id: r.alumni_id },
      { $set: { reasonsNotEmployed: r.reasonsNotEmployed } }
    );
    if (res.matchedCount) updated++;
    else skipped++;
  }

  console.log(`Updated ${updated} Graduate row(s). Skipped ${skipped} (no matching Graduate row by user_id).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
