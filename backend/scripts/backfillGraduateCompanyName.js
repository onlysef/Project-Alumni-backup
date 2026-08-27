// One-time backfill: populate the new Graduate.companyName field (added so
// company-based questions like "who works at Sutherland?" can be combined
// with other filters through the normal filters/stablePipeline system) for
// every EXISTING Graduate row, sourced from AlumniEmployment.company_name —
// the field is only synced going forward on new submitTracerStudy/
// updateMyEmployment writes (see those controllers), so rows that predate
// this field need a one-time catch-up.
//
// Run once: node scripts/backfillGraduateCompanyName.js
require('dotenv').config();
const mongoose = require('mongoose');
const Graduate = require('../models/Graduate');
const AlumniEmployment = require('../models/AlumniEmployment');
const answerCache = require('../services/answerCache');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const linked = await Graduate.find({ user_id: { $ne: null }, companyName: null })
    .select('_id user_id').lean();
  console.log(`${linked.length} Graduate row(s) with a linked user but no companyName yet.`);

  const employments = await AlumniEmployment.find({
    alumni_id: { $in: linked.map(g => g.user_id) },
    company_name: { $nin: [null, '', 'N/A'] },
  }).select('alumni_id company_name').lean();
  const companyByAlumniId = new Map(employments.map(e => [String(e.alumni_id), e.company_name]));

  let updated = 0;
  for (const grad of linked) {
    const company = companyByAlumniId.get(String(grad.user_id));
    if (!company) continue;
    await Graduate.updateOne({ _id: grad._id }, { $set: { companyName: company } });
    updated++;
  }

  if (updated > 0) answerCache.bumpDataVersion();
  console.log(`Backfilled companyName for ${updated} Graduate row(s).`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
