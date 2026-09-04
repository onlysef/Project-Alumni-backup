// The set of tracer-form question ids the TracerStudyResponse schema handles
// as named fields. Everything else in a submitted answers object is a
// custom/imported question and goes into extra_answers instead — see
// submitTracerStudy in alumniController.js. Shared with employmentController
// (getNotifyCandidates) so "which questions are new for this alumni" is
// computed the same way admin-side as it is on submit.
const FIXED_KEYS = new Set([
  'consent', // validated on frontend; not persisted
  'contactNumber', 'gender',
  'programsCompleted', 'professionalExam', 'professionalExamName',
  'employmentStatus', 'companyName', 'placeOfWork', 'occupationTitle', 'industryField',
  'presentEmploymentType', 'jobRelatedToDegree', 'yearsInCurrentJob',
  'reasonsNotEmployed',
  'furtherEducation', 'furtherEducationType',
  'pursuedTrainings', 'trainingType',
  'personalGrowthRatings',
  'promotedInJob', 'significantAccomplishments',
  'professionalCertifications', 'professionalDevelopmentActivities',
]);

module.exports = { FIXED_KEYS };
