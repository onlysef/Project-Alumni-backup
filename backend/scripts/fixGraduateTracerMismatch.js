// One-time repair: a handful of Graduate rows have an employmentStatus (and
// potentially other tracer-derived fields) that CONTRADICTS the alumnus's own
// real TracerStudyResponse submission — traced to bulk-imported Graduate rows
// that were never reconciled against a later (or earlier) live submission.
// Found via a live discrepancy report: the AC chatbot's employment count
// disagreed with the Admin Dashboard's "Employed Alumni" tile by a few
// records, because the chatbot reads Graduate (bulk-import + live data mixed)
// while the dashboard reads AlumniEmployment (kept in sync from
// TracerStudyResponse only, so it always reflects the real submission).
//
// This treats TracerStudyResponse as authoritative (same convention the live
// submitTracerStudy -> syncGraduateAndEmbedding hook in alumniController.js
// already follows) and re-applies that same full field mapping to just the
// Graduate rows found to disagree — mirrors backfillMissingGraduateFromTracer.js's
// approach (which does the equivalent repair for MISSING rows), but for rows
// that exist and are simply wrong.
//
// Run once: node scripts/fixGraduateTracerMismatch.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Graduate = require('../models/Graduate');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const EmbeddingDocument = require('../models/EmbeddingDocument');
const { getEmbedding } = require('../services/embeddingService');
const { tracerRowToText } = require('../utils/fileParser');
const answerCache = require('../services/answerCache');

// Coarse employment-status bucket, matching the categories every aggregation/
// dashboard function in this app already folds raw status strings into
// (Yes/Self-Employed/Never Employed/No) — used only to decide whether a
// Graduate row's status actually disagrees with the real submission, not as
// the value written back (the real fix always writes the tracer's own raw
// string, same as syncGraduateAndEmbedding does for a live submission).
function bucket(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('self')) return 'self';
  if (s.includes('never')) return 'never';
  if (s === 'no' || s.includes('unemploy')) return 'unemployed';
  if (s.startsWith('yes') || s.includes('employ')) return 'employed';
  return 'other';
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const tracerResponses = await TracerStudyResponse.find({}).lean();
  console.log(`${tracerResponses.length} tracer submission(s) on file.`);

  let checked = 0;
  let fixed = 0;
  let skipped = 0;

  for (const body of tracerResponses) {
    const user = await User.findById(body.alumni_id).select('firstName lastName email graduationYear').lean();
    if (!user?.email) { skipped++; continue; }

    const email = user.email.toLowerCase().trim();
    const grad = await Graduate.findOne({ $or: [{ user_id: body.alumni_id }, { email }] });
    if (!grad) continue; // handled by backfillMissingGraduateFromTracer.js, not this script

    checked++;
    if (bucket(grad.employmentStatus) === bucket(body.employmentStatus)) continue; // already agrees

    console.log(`Mismatch: ${grad.name || email} — Graduate.employmentStatus="${grad.employmentStatus}" vs real tracer submission="${body.employmentStatus}"`);

    // Same full field mapping syncGraduateAndEmbedding() applies for a live
    // submission — the real tracer response wins over whatever the stale
    // bulk-import row currently holds, for every tracer-derived field, not
    // just employmentStatus (a bad import row has no reason to be trusted
    // for the OTHER fields either, once one field is known to be wrong).
    const graduatePatch = {
      user_id:          body.alumni_id,
      name:             `${user.firstName} ${user.lastName}`.trim(),
      email,
      contact:          body.contactNumber || null,
      gender:           body.gender || null,
      program:          Array.isArray(body.programsCompleted) ? body.programsCompleted.join(';') : null,
      yearGraduated:    user.graduationYear ?? null,
      employmentStatus: body.employmentStatus || null,
      employmentType:   body.presentEmploymentType || null,
      workLocation:     body.placeOfWork || null,
      jobTitle:         body.occupationTitle || null,
      companyName:      body.companyName || null,
      industry:         body.industryField || null,
      jobRelated:       body.jobRelatedToDegree || null,
      yearsInJob:       body.yearsInCurrentJob || null,
      tookExam:         body.professionalExam || null,
      furtherEducation: body.furtherEducation || null,
      furtherTraining:  body.pursuedTrainings || null,
      hasPromotion:     body.promotedInJob || null,
      competencies: {
        technicalSkills:   body.personalGrowthRatings?.technicalSkills || null,
        communication:     body.personalGrowthRatings?.communicationSkills || null,
        problemSolving:    body.personalGrowthRatings?.problemSolvingSkills || null,
        projectManagement: body.personalGrowthRatings?.projectManagement || null,
        teamwork:          body.personalGrowthRatings?.teamworkCollaboration || null,
        adaptability:      body.personalGrowthRatings?.adaptability || null,
        workLifeBalance:   body.personalGrowthRatings?.workLifeBalance || null,
        criticalThinking:  body.personalGrowthRatings?.criticalThinkingSkills || null,
      },
      data: body,
    };

    const graduateDoc = await Graduate.findOneAndUpdate(
      { _id: grad._id },
      { $set: graduatePatch },
      { new: true }
    );

    const text = tracerRowToText({
      full_name:         graduatePatch.name,
      contact:            graduatePatch.contact,
      email:              graduatePatch.email,
      sex:                graduatePatch.gender,
      program:            graduatePatch.program,
      date_graduated:     graduatePatch.yearGraduated,
      employment_status:  graduatePatch.employmentStatus,
      employment_type:    graduatePatch.employmentType,
      job_title:          graduatePatch.jobTitle,
      company:            graduatePatch.companyName,
      industry:           graduatePatch.industry,
      work_location:      graduatePatch.workLocation,
      relevance:          graduatePatch.jobRelated,
      job_duration:       graduatePatch.yearsInJob,
      board_exam:         graduatePatch.tookExam,
      further_studies:    graduatePatch.furtherEducation,
      trainings:          graduatePatch.furtherTraining,
      promoted:           graduatePatch.hasPromotion,
    }, graduatePatch.yearGraduated);

    const embedding = await getEmbedding(text);
    await EmbeddingDocument.deleteMany({ source_type: 'imported_file', 'metadata.graduate_id': String(graduateDoc._id) });
    await EmbeddingDocument.create({
      source_type: 'imported_file',
      file_id:     null,
      content:     text,
      metadata:    { sheet_type: 'tracer', source: 'fix_graduate_tracer_mismatch', graduate_id: String(graduateDoc._id) },
      embedding,
      chunk_index: 0,
    });

    console.log(`  -> corrected to "${graduatePatch.employmentStatus}" and refreshed embedding.`);
    fixed++;
  }

  if (fixed > 0) answerCache.bumpDataVersion();

  console.log(`Done. Checked ${checked} record(s) with both a Graduate row and a tracer submission, fixed ${fixed}, skipped ${skipped} (no linked user).`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
