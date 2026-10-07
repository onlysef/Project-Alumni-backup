// Backend mirror of frontend/src/constants/colleges.js — THAT file is the
// actual single source of truth for TSU's official college/course catalog;
// this copy exists only because the backend and frontend are separate
// Node packages with no shared import path. Keep these two files in sync
// by hand whenever a college/course is added, renamed, or retired.
//
// Used by utils/verifiedCount.js as the ONLY valid vocabulary for
// college/course matching in chatbot questions — not a DB-observed
// Mongo distinct() list. A distinct() scan reflects whatever text happens
// to be stored on existing User records, including old typos or
// inconsistent entries (e.g. "CSS" mistyped for "CCS" on a historical
// account) — treating those as if they were real, valid colleges would
// let the chatbot silently "recognize" and answer about a college that
// doesn't actually exist. The official catalog has no such risk.
const COLLEGE_CODES = ['CPAG', 'CCS', 'COS', 'CIT', 'COE', 'CBA', 'COED', 'CASS', 'CCJE', 'CAFA'];

const COLLEGE_NAMES = {
  CPAG: 'College of Public Administration and Governance',
  CCS:  'College of Computer Studies',
  COS:  'College of Science',
  CIT:  'College of Industrial Technology',
  COE:  'College of Engineering',
  CBA:  'College of Business and Accountancy',
  COED: 'College of Education',
  CASS: 'College of Arts and Social Sciences',
  CCJE: 'College of Criminal Justice Education',
  CAFA: 'College of Fine and Applied Arts',
};

// Mirrors TSU's program catalog. Majors use a "-XX" suffix, except BSIT,
// whose tracks live in User.track.
const COURSES_BY_COLLEGE = {
  CASS: ['ABComm', 'ABELS', 'ABPsych', 'BHS'],
  CAFA: ['BSArch', 'BFA-VC'],
  CBA:  ['BSA', 'BSAIS', 'BSEntrep', 'BSHM', 'BSBA-BE', 'BSBA-FM', 'BSBA-MM'],
  CCS:  ['BSIT', 'BSIS', 'BSCS', 'BSIM'],
  COE:  ['BSCE', 'BSEE', 'BSECE', 'BSIE', 'BSME'],
  CIT:  ['BIT-Auto', 'BIT-Elec', 'BIT-Mecha'],
  CCJE: ['BSCrim'],
  CPAG: ['BPA'],
  COED: ['BEEd', 'BSEd-Eng', 'BSEd-Fil', 'BSEd-Math', 'BSEd-SocStud', 'BSEd-Sci', 'BECEd', 'BTLEd-IA', 'BTVTEd-FSM', 'BPEd'],
  COS:  ['BSChem', 'BSN', 'BSEnvSci', 'BSMath', 'BSFT'],
};

const ALL_COURSES = Object.values(COURSES_BY_COLLEGE).flat();

// Reverse lookup (course code -> owning college code), derived from
// COURSES_BY_COLLEGE rather than hand-maintained separately — used by the
// chatbot's coordinator college-scoping (utils/queryPlanValidator.js,
// utils/verifiedCount.js) to determine which college a RESOLVED course
// belongs to, so a coordinator naming a course outside their own college
// can be refused rather than silently answered.
const COURSE_TO_COLLEGE = Object.fromEntries(
  Object.entries(COURSES_BY_COLLEGE).flatMap(([college, courses]) => courses.map((course) => [course, college]))
);

module.exports = { COLLEGE_CODES, COLLEGE_NAMES, COURSES_BY_COLLEGE, ALL_COURSES, COURSE_TO_COLLEGE };
