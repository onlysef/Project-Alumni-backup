// One-time repair: some tracer study submissions never got their Graduate
// record created because the auto-sync in submitTracerStudy (alumniController.js)
// silently failed for them (wrapped in try/catch, non-blocking by design) —
// found via a live bug report where the AC chatbot answered "0" for a job
// title that a real tracer submission clearly had. This mirrors the exact
// same graduatePatch/RAG-chunk logic submitTracerStudy uses, but only for
// alumni_ids that have a TracerStudyResponse and NO matching Graduate row.
//
// Run once: node scripts/backfillMissingGraduateFromTracer.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Graduate = require('../models/Graduate');
const TracerStudyResponse = require('../models/TracerStudyResponse');
const EmbeddingDocument = require('../models/EmbeddingDocument');
const { getEmbedding } = require('../services/embeddingService');
const { tracerRowToText } = require('../utils/fileParser');
const answerCache = require('../services/answerCache');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const tracerIds = await TracerStudyResponse.distinct('alumni_id');
  const gradUserIds = new Set(
    (await Graduate.find({ user_id: { $ne: null } }).select('user_id').lean()).map(g => String(g.user_id))
  );
  const missingIds = tracerIds.filter(id => !gradUserIds.has(String(id)));
  console.log(`${missingIds.length} tracer submission(s) with no Graduate row.`);

  let created = 0;
  let skipped = 0;

  for (const alumniId of missingIds) {
    const [user, body] = await Promise.all([
      User.findById(alumniId).select('firstName lastName email course graduationYear').lean(),
      TracerStudyResponse.findOne({ alumni_id: alumniId }).lean(),
    ]);
    if (!user?.email || !body) { skipped++; continue; }

    const graduatePatch = {
      user_id:          alumniId,
      name:             `${user.firstName} ${user.lastName}`.trim(),
      email:            user.email.toLowerCase().trim(),
      contact:          body.contactNumber || null,
      gender:           body.gender || null,
      program:          Array.isArray(body.programsCompleted) ? body.programsCompleted.join(';') : null,
      yearGraduated:    user.graduationYear ?? null,
      employmentStatus: body.employmentStatus || null,
      employmentType:   body.presentEmploymentType || null,
      workLocation:     body.placeOfWork || null,
      jobTitle:         body.occupationTitle || null,
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
      { $or: [{ user_id: alumniId }, { email: graduatePatch.email }] },
      { $set: graduatePatch },
      { upsert: true, new: true }
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
      metadata:    { sheet_type: 'tracer', source: 'backfill_missing_graduate', graduate_id: String(graduateDoc._id) },
      embedding,
      chunk_index: 0,
    });

    console.log(`Created Graduate row for ${graduatePatch.name} (${graduatePatch.email}) — jobTitle: ${graduatePatch.jobTitle || '(none)'}`);
    created++;
  }

  if (created > 0) answerCache.bumpDataVersion();

  console.log(`Done. Created ${created} Graduate row(s), skipped ${skipped}.`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
