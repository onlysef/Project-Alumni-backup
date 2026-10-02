// One-time repair: removes TracerStudyResponse AND Graduate rows that no
// longer belong to a real alumnus — either the linked User account was
// deleted outright (a gap that predates deleteUser()'s own cascades for both
// collections, or came from a deletion path that bypassed it — e.g. the
// Graduate side only matches by user_id OR email, so a row whose stored
// email doesn't exactly match the account's real email silently survives
// that cascade), or the account's role was changed away from 'alumni' before
// updateUser() grew the matching TracerStudyResponse cascade (see the
// conversation that added it). All of these are already invisible to the
// Tracer Dashboard (its own role==='alumni' + user-exists guard excludes
// orphaned TracerStudyResponse rows) and to the AC chatbot
// (aggregationService.js's LIVE_SUBMISSION_ONLY filter excludes a Graduate
// row with no matching TracerStudyResponse, and the role-change cascade
// already deletes Graduate rows for a still-existing account) — this doesn't
// change any visible stat, it just stops dead rows from sitting in the
// collections forever.
//
// Run once: node scripts/cleanupOrphanedTracerResponses.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Graduate = require('../models/Graduate');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const EmbeddingDocument = require('../models/EmbeddingDocument');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const responses = await TracerStudyResponse.find({}).select('alumni_id').lean();
  console.log(`${responses.length} tracer submission(s) on file.`);

  const toDelete = [];
  for (const r of responses) {
    const user = await User.findById(r.alumni_id).select('role').lean();
    if (!user) {
      toDelete.push({ id: r._id, reason: 'user account no longer exists' });
    } else if (user.role !== 'alumni') {
      toDelete.push({ id: r._id, reason: `account role is now '${user.role}', not alumni` });
    }
  }

  if (!toDelete.length) {
    console.log('No orphaned tracer responses found.');
  } else {
    console.log(`Removing ${toDelete.length} orphaned tracer response(s):`);
    toDelete.forEach(({ id, reason }) => console.log(`  - ${id}: ${reason}`));
    await TracerStudyResponse.deleteMany({ _id: { $in: toDelete.map(t => t.id) } });
  }

  // Same sweep for Graduate rows whose linked account no longer exists —
  // role-change orphans are already covered by updateUser()'s own cascade,
  // so only a deleted-account gap is possible here.
  const grads = await Graduate.find({ user_id: { $ne: null } }).select('user_id').lean();
  const orphanedGrads = [];
  for (const g of grads) {
    const user = await User.findById(g.user_id).select('_id').lean();
    if (!user) orphanedGrads.push(g._id);
  }

  if (!orphanedGrads.length) {
    console.log('No orphaned Graduate rows found.');
  } else {
    console.log(`Removing ${orphanedGrads.length} orphaned Graduate row(s): ${orphanedGrads.join(', ')}`);
    await Graduate.deleteMany({ _id: { $in: orphanedGrads } });
    await EmbeddingDocument.deleteMany({ source_type: 'imported_file', 'metadata.graduate_id': { $in: orphanedGrads.map(String) } });
  }

  console.log('Done.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
