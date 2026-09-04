// Single source of truth for the college/course vocabulary — was previously
// duplicated near-identically across EmploymentView.jsx, AccountsView.jsx,
// and AlumniSignUpView.jsx, which meant a course added/edited in one place
// silently drifted out of sync with the others.

export const COLLEGE_CODES = ["CPAG", "CCS", "COS", "CIT", "COE", "CBA", "COED", "CASS", "CCJE", "CAFA"];

// Mirrors TSU's actual baccalaureate program catalog (per-college), one
// short code per program. Where a single degree title covers several named
// majors/specializations (e.g. CCS's BSIT, COED's secondary ed majors), the
// code stays one degree + a "-XX" suffix per major rather than inventing a
// separate track field for every college — CCS's BSIT is the one exception
// that already has its own dedicated User.track enum (TSM/WMA/NA) predating
// this list, so its three specializations share the single "BSIT" code here
// instead of getting their own "-XX" suffixes like everyone else's majors do.
export const COURSES_BY_COLLEGE = {
  CASS: ["ABComm", "ABELS", "ABPsych", "BHS"],
  CAFA: ["BSArch", "BFA-VC"],
  CBA:  ["BSA", "BSAIS", "BSEntrep", "BSHM", "BSBA-BE", "BSBA-FM", "BSBA-MM"],
  // BSIM (Information Management) isn't part of the current official
  // catalog anymore, but real existing alumni records still use it — kept
  // here so those records stay filterable/selectable instead of silently
  // falling off every course dropdown.
  CCS:  ["BSIT", "BSIS", "BSCS", "BSIM"],
  COE:  ["BSCE", "BSEE", "BSECE", "BSIE", "BSME"],
  CIT:  ["BIT-Auto", "BIT-Elec", "BIT-Mecha"],
  CCJE: ["BSCrim"],
  CPAG: ["BPA"],
  COED: ["BEEd", "BSEd-Eng", "BSEd-Fil", "BSEd-Math", "BSEd-SocStud", "BSEd-Sci", "BECEd", "BTLEd-IA", "BTVTEd-FSM", "BPEd"],
  COS:  ["BSChem", "BSN", "BSEnvSci", "BSMath", "BSFT"],
};
