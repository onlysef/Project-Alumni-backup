const mongoose = require('mongoose');

const tracerStudyResponseSchema = new mongoose.Schema({
  alumni_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Demographic
  contactNumber: { type: String, default: '' },
  gender: { type: String, default: '' },

  // General Background
  programsCompleted:    { type: [String], default: [] },
  professionalExam:     { type: String, default: '' },
  professionalExamName: { type: String, default: '' },

  // Employment Data
  employmentStatus: { type: String, default: '' }, // Yes / No / Never Employed

  // — if employed —
  companyName:            { type: String, default: '' },
  placeOfWork:            { type: String, default: '' },
  occupationTitle:        { type: String, default: '' },
  industryField:          { type: String, default: '' },
  presentEmploymentType:  { type: String, default: '' },
  jobRelatedToDegree:     { type: String, default: '' },
  yearsInCurrentJob:      { type: String, default: '' },

  // — if not employed —
  reasonsNotEmployed: { type: [String], default: [] },

  // Personal Growth (C)
  furtherEducation:     { type: String, default: '' },
  furtherEducationType: { type: String, default: '' },
  pursuedTrainings:     { type: String, default: '' },
  trainingType:         { type: String, default: '' },

  personalGrowthRatings: {
    technicalSkills:       { type: String, default: '' },
    problemSolvingSkills:  { type: String, default: '' },
    communicationSkills:   { type: String, default: '' },
    projectManagement:     { type: String, default: '' },
    teamworkCollaboration: { type: String, default: '' },
    adaptability:          { type: String, default: '' },
    workLifeBalance:       { type: String, default: '' },
    criticalThinkingSkills:{ type: String, default: '' },
  },

  // Professional Growth (D)
  promotedInJob:                    { type: String, default: '' },
  significantAccomplishments:       { type: String, default: '' },
  professionalCertifications:       { type: String, default: '' },
  professionalDevelopmentActivities:{ type: String, default: '' },

  submittedAt: { type: Date, default: Date.now },

  // Holds answers for any custom questions the admin adds beyond the fixed schema
  extra_answers: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('TracerStudyResponse', tracerStudyResponseSchema);
