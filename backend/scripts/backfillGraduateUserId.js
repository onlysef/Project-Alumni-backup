// One-time backfill: link existing Graduate rows to their matching User
// account via user_id, the same way submitTracerStudy/updateMyEmployment now
// do for every new write. Matches case-insensitively since ingested emails
// and User account emails aren't guaranteed to share the same case.
//
// Run once: node scripts/backfillGraduateUserId.js
require('dotenv').config();
const mongoose = require('mongoose');
const Graduate = require('../models/Graduate');
const User = require('../models/User');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const unlinked = await Graduate.find({ user_id: null, email: { $ne: null } })
    .select('_id email')
    .lean();
  console.log(`${unlinked.length} Graduate row(s) with no user_id yet.`);

  let matched = 0;
  let skipped = 0;
  for (const grad of unlinked) {
    const email = (grad.email || '').trim();
    if (!email) { skipped++; continue; }
    const user = await User.findOne({
      $expr: { $eq: [{ $toLower: '$email' }, email.toLowerCase()] },
    }).select('_id').lean();
    if (!user) { skipped++; continue; }
    await Graduate.updateOne({ _id: grad._id }, { $set: { user_id: user._id } });
    matched++;
  }

  console.log(`Linked ${matched} record(s). ${skipped} had no matching User account (expected for pure historical import rows).`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
