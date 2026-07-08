const mongoose = require('mongoose');

// One document per Excel row from an ingested tracer-study file.
// `data` holds the raw row; normalized fields are extracted for fast aggregation.
const GraduateSchema = new mongoose.Schema(
  {
    fileId:    { type: mongoose.Schema.Types.ObjectId, ref: 'ImportedFile', required: true, index: true },
    rowIndex:  { type: Number },
    data:      { type: mongoose.Schema.Types.Mixed, required: true },

    // ─── Identity ──────────────────────────────────────────────────────────────
    name:          { type: String, trim: true, default: null },
    email:         { type: String, trim: true, default: null },
    gender:        { type: String, trim: true, default: null },

    // ─── Academic ─────────────────────────────────────────────────────────────
    program:       { type: String, trim: true, index: true, default: null },
    yearGraduated: { type: Number, index: true, default: null },

    // ─── Employment ───────────────────────────────────────────────────────────
    employmentStatus: { type: String, trim: true, index: true, default: null }, // Yes / No / Employed / Unemployed
    employmentType:   { type: String, trim: true, index: true, default: null }, // Regular/Permanent / Contractual
    workLocation:     { type: String, trim: true, default: null },
    jobTitle:         { type: String, trim: true, index: true, default: null },
    industry:         { type: String, trim: true, index: true, default: null },
    jobRelated:       { type: String, trim: true, default: null },
    yearsInJob:       { type: String, trim: true, default: null },

    // ─── Post-graduation ──────────────────────────────────────────────────────
    tookExam:         { type: String, trim: true, default: null },
    furtherEducation: { type: String, trim: true, default: null },
    furtherTraining:  { type: String, trim: true, default: null },
    hasPromotion:     { type: String, trim: true, default: null },

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
GraduateSchema.index({ industry: 1 });
GraduateSchema.index({ yearGraduated: 1, employmentStatus: 1 });

module.exports = mongoose.model('Graduate', GraduateSchema);
