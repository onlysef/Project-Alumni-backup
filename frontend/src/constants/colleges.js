// Single source of truth for colleges and courses.

export const COLLEGE_CODES = ["CPAG", "CCS", "COS", "CIT", "COE", "CBA", "COED", "CASS", "CCJE", "CAFA"];

export const COLLEGE_NAMES = {
  CPAG: "College of Public Administration and Governance",
  CCS:  "College of Computer Studies",
  COS:  "College of Science",
  CIT:  "College of Industrial Technology",
  COE:  "College of Engineering",
  CBA:  "College of Business and Accountancy",
  COED: "College of Education",
  CASS: "College of Arts and Social Sciences",
  CCJE: "College of Criminal Justice Education",
  CAFA: "College of Fine and Applied Arts",
};

// Mirrors TSU's program catalog. Majors use a "-XX" suffix, except BSIT, whose tracks live in User.track.
export const COURSES_BY_COLLEGE = {
  CASS: ["ABComm", "ABELS", "ABPsych", "BHS"],
  CAFA: ["BSArch", "BFA-VC"],
  CBA:  ["BSA", "BSAIS", "BSEntrep", "BSHM", "BSBA-BE", "BSBA-FM", "BSBA-MM"],
  // No longer offered, but existing alumni records still use it.
  CCS:  ["BSIT", "BSIS", "BSCS", "BSIM"],
  COE:  ["BSCE", "BSEE", "BSECE", "BSIE", "BSME"],
  CIT:  ["BIT-Auto", "BIT-Elec", "BIT-Mecha"],
  CCJE: ["BSCrim"],
  CPAG: ["BPA"],
  COED: ["BEEd", "BSEd-Eng", "BSEd-Fil", "BSEd-Math", "BSEd-SocStud", "BSEd-Sci", "BECEd", "BTLEd-IA", "BTVTEd-FSM", "BPEd"],
  COS:  ["BSChem", "BSN", "BSEnvSci", "BSMath", "BSFT"],
};
