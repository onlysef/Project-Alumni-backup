const mongoose = require('mongoose');
const { getCollegeScopeEmails } = require('../utils/collegeScope');

// One document per Excel row from an ingested tracer-study file, OR one per
// live alumni portal tracer submission (fileId is null for the latter —
// those are upserted by email from alumniController.submitTracerStudy so the
// AI chatbot's stats/RAG stay in sync with real submissions automatically).
// `data` holds the raw row; normalized fields are extracted for fast aggregation.
const GraduateSchema = new mongoose.Schema(
  {
    fileId:    { type: mongoose.Schema.Types.ObjectId, ref: 'ImportedFile', default: null },
    rowIndex:  { type: Number },
    data:      { type: mongoose.Schema.Types.Mixed, required: true },

    // Real FK to the matching User account, when one exists — nullable,
    // because plenty of Graduate rows are historical bulk-import data with
    // no registered account at all (and may never get one). Set directly by
    // submitTracerStudy/updateMyEmployment (an authenticated session, not a
    // guess) whenever a live alumni action touches this record; backfilled
    // for older rows by scripts/backfillGraduateUserId.js. Correlation used
    // to be by email string alone, which silently desyncs if a User's email
    // is ever edited without the matching Graduate row being updated too.
    user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    // ─── Identity ──────────────────────────────────────────────────────────────
    name:          { type: String, trim: true, default: null },
    email:         { type: String, trim: true, default: null },
    contact:       { type: String, trim: true, default: null },
    gender:        { type: String, trim: true, default: null },

    // ─── Academic ─────────────────────────────────────────────────────────────
    program:       { type: String, trim: true, default: null },
    yearGraduated: { type: Number, default: null },

    // ─── Employment ───────────────────────────────────────────────────────────
    employmentStatus: { type: String, trim: true, index: true, default: null }, // Yes / No / Employed / Unemployed
    employmentType:   { type: String, trim: true, index: true, default: null }, // Regular/Permanent / Contractual
    workLocation:     { type: String, trim: true, default: null },
    jobTitle:         { type: String, trim: true, index: true, default: null },
    industry:         { type: String, trim: true, index: true, default: null },
    // Synced from AlumniEmployment.company_name / TracerStudyResponse.companyName
    // — added so company-based questions ("who works at Sutherland?") can be
    // combined with other filters (course, gender, employment status) through
    // the same filters/stablePipeline system every other field already uses,
    // instead of the isolated queryByCompany() lookup that couldn't be
    // combined with anything or resolved by a multi-turn follow-up.
    companyName:      { type: String, trim: true, index: true, default: null },
    jobRelated:       { type: String, trim: true, default: null },
    yearsInJob:       { type: String, trim: true, default: null },

    // ─── Post-graduation ──────────────────────────────────────────────────────
    tookExam:         { type: String, trim: true, default: null },
    furtherEducation: { type: String, trim: true, default: null },
    furtherTraining:  { type: String, trim: true, default: null }, // Yes / No — whether they pursued any
    // The actual training/seminar name or type ("Web Development Bootcamp")
    // — a SEPARATE tracer-study question from furtherTraining above (which
    // only ever captures Yes/No). Without this, "what trainings did alumni
    // attend" had no real data to answer from at all, even with correct
    // topic routing — see queryFurtherTrainingTypes()'s own comment.
    trainingType:     { type: String, trim: true, index: true, default: null },
    hasPromotion:     { type: String, trim: true, default: null },
    // Yes/No tracer-study question ("Have you achieved any significant
    // accomplishments in your current job?") — despite the name, this is
    // NOT a free-text description of the accomplishment itself (no such
    // field exists anywhere in the tracer form). Never synced anywhere the
    // chatbot could see until now (same missing-sync gap trainingType had),
    // so "what are alumni's significant accomplishments" had no real data
    // to answer from at all.
    significantAccomplishments: { type: String, trim: true, default: null },

    // ─── Competency self-ratings ──────────────────────────────────────────────
    competencies: {
      technicalSkills:   { type: String, default: null },
      communication:     { type: String, default: null },
      problemSolving:    { type: String, default: null },
      projectManagement: { type: String, default: null },
      teamwork:          { type: String, default: null },
      adaptability:      { type: String, default: null },
      workLifeBalance:   { type: String, default: null },
      criticalThinking:  { type: String, default: null },
    },
  },
  { timestamps: true }
);

GraduateSchema.index({ fileId: 1, rowIndex: 1 });
GraduateSchema.index({ program: 1, employmentStatus: 1 });
GraduateSchema.index({ yearGraduated: 1, employmentStatus: 1 });
// Person-name lookups (queryPersonLookup/queryNames in aggregationService.js)
// still filter/sort in Node after this, since stored names aren't in one
// consistent format ("Bryan Canlapan" vs "Canlapan, Bryan T.") — but this at
// least lets Mongo narrow the DEDUP/$sort work by name instead of a full
// collection scan as the dataset grows.
GraduateSchema.index({ name: 1 });
// The collegeScope hook below matches on email via a case-insensitive
// regex — a plain index still helps Mongo narrow that scan instead of a
// full collection scan, even though the regex itself can't use a collation.
GraduateSchema.index({ email: 1 });
// aggregationService.js's shared DEDUP stage ({ $sort: { createdAt: -1 } },
// used by nearly every AC chatbot query via stablePipeline()) had nothing to
// use but an in-memory sort — this lets Mongo use the index directly for the
// (common) case where the preceding $match has no filter narrowing it down.
GraduateSchema.index({ createdAt: -1 });

// Enforces the AC AI Assistant's college scope (see utils/collegeScope.js)
// at the single point every query — however it was built — ultimately goes
// through: the driver call itself. Matches case-insensitively since ingested
// emails and User account emails aren't guaranteed to share the same case.
// `emails` is null when no scope was ever established (admin / non-chat
// queries) — skip entirely. An EMPTY array is a real, active scope (a
// coordinator whose college has zero alumni accounts) and must still
// apply — `$in: []`/`$in: [<no patterns>]` naturally matches nothing,
// which is the correct "you have no data" outcome, not "show everything."
GraduateSchema.pre('aggregate', function () {
  const emails = getCollegeScopeEmails();
  if (!emails) return;
  this.pipeline().unshift({
    $match: { $expr: { $in: [{ $toLower: { $ifNull: ['$email', ''] } }, emails] } },
  });
});

// /^find/ alone misses countDocuments() (hasData() uses it) — Mongoose fires
// a separate 'countDocuments' hook for that method, not a find* one.
GraduateSchema.pre(/^find|^countDocuments$/, function () {
  const emails = getCollegeScopeEmails();
  if (!emails) return;
  const patterns = emails.map(e => new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
  this.where({ email: { $in: patterns } });
});

module.exports = mongoose.model('Graduate', GraduateSchema);
