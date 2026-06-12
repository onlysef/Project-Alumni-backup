import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const API = "http://localhost:5000/api";
const MAROON = "#7b1a2e";
const GOLD   = "#c49a2a";

const PROGRAMS = [
  "Bachelor of Science in Information Systems - Specialized in Business Analytics",
  "Bachelor of Science in Information Technology - Specialized in Network Administration",
  "Bachelor of Science in Information Technology - Specialized in Web and Mobile Application",
  "Bachelor of Science in Information Technology - Specialized in Technical Service Management",
  "Bachelor of Science in Computer Science",
  "Bachelor of Science in Information Technology",
  "Bachelor of Science in Information Systems",
  "Bachelor of Science in Information Management",
  "Master in Information Technology",
  "Master of Science in Information Technology",
];

const INDUSTRIES = [
  "Information Technology",
  "Education",
  "Virtual Assistance and Remote Services",
  "Customer Service and Support",
  "Engineering and Construction",
  "Marketing",
  "Healthcare",
  "Manufacturing",
  "Finance and Banking",
  "Human Resources",
  "Government and Public Administration",
  "Non-Profit/NGO",
  "Other",
];

const JOB_DURATION = [
  "Less than 6 months",
  "6 months to 1 year",
  "1 to 2 years",
  "2 to 3 years",
  "3 to 5 years",
  "More than 5 years",
];

const EMPLOYMENT_TYPES = [
  "Regular/Permanent",
  "Casual/Contractual",
  "Part-time",
  "Project-based",
  "Self-employed",
];

const REASONS_NOT_EMPLOYED = [
  "Pursuing further studies",
  "Skills do not match current job market demands",
  "Lack of work experience",
  "Geographical constraints",
  "Personal reasons (e.g., health issues, family obligations, gap year)",
  "Exploring different career paths",
  "Waiting for the right job opportunity",
  "Ineffective job search strategies or lack of networking",
  "Market Saturation (increased competition)",
  "Other",
];

const GROWTH_AREAS = [
  { key: "technicalSkills",        label: "Technical Skills" },
  { key: "problemSolvingSkills",   label: "Problem-Solving Skills" },
  { key: "communicationSkills",    label: "Communication Skills" },
  { key: "projectManagement",      label: "Project Management" },
  { key: "teamworkCollaboration",  label: "Teamwork and Collaboration" },
  { key: "adaptability",           label: "Adaptability" },
  { key: "workLifeBalance",        label: "Work-Life Balance" },
  { key: "criticalThinkingSkills", label: "Critical Thinking Skills" },
];

const RATINGS = ["Excellent", "Competent", "Satisfactory", "Beginner", "Non-Acceptable"];

const TOTAL_STEPS = 6;

const STEP_TITLES = [
  "Electronic Informed Consent",
  "Demographic Profile",
  "A. General Background",
  "B. Employment Data",
  "C. Personal Growth",
  "D. Professional Growth",
];

// ── Shared input styles ───────────────────────────────────────────────────────
const inp = {
  width: "100%", padding: "0.55rem 0.75rem", border: "1px solid #d1d5db",
  borderRadius: 6, fontSize: "0.9rem", boxSizing: "border-box", outline: "none",
  fontFamily: "inherit",
};
const lbl = {
  display: "block", fontSize: "0.85rem", fontWeight: 600,
  marginBottom: 4, color: "#374151",
};
const fld = { marginBottom: "1.1rem" };
const radioRow = { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" };

function RadioOpt({ name, value, checked, onChange, label }) {
  return (
    <label style={radioRow}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange}
        style={{ accentColor: MAROON, width: 16, height: 16, cursor: "pointer" }} />
      <span style={{ fontSize: "0.9rem", color: "#374151" }}>{label}</span>
    </label>
  );
}

function CheckOpt({ checked, onChange, label }) {
  return (
    <label style={{ ...radioRow, alignItems: "flex-start" }}>
      <input type="checkbox" checked={checked} onChange={onChange}
        style={{ accentColor: MAROON, width: 16, height: 16, marginTop: 2, cursor: "pointer", flexShrink: 0 }} />
      <span style={{ fontSize: "0.9rem", color: "#374151", lineHeight: 1.4 }}>{label}</span>
    </label>
  );
}

export default function TracerStudyForm() {
  const { user, token, firstLogin, tracerStudyCompleted, setTracerStudyDone } = useAuth();
  const navigate = useNavigate();

  if (firstLogin)            return <Navigate to="/alumni/onboarding" replace />;
  if (tracerStudyCompleted)  return <Navigate to="/alumni/dashboard"  replace />;

  const [step, setStep]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // Step 1
  const [consent, setConsent] = useState("");

  // Step 2
  const [contactNumber, setContactNumber] = useState("");
  const [gender, setGender]               = useState("");

  // Step 3
  const [programsCompleted, setProgramsCompleted]       = useState([]);
  const [professionalExam, setProfessionalExam]         = useState("");
  const [professionalExamName, setProfessionalExamName] = useState("");

  // Step 4
  const [employmentStatus, setEmploymentStatus]           = useState("");
  const [placeOfWork, setPlaceOfWork]                     = useState("");
  const [occupationTitle, setOccupationTitle]             = useState("");
  const [industryField, setIndustryField]                 = useState("");
  const [presentEmploymentType, setPresentEmploymentType] = useState("");
  const [jobRelatedToDegree, setJobRelatedToDegree]       = useState("");
  const [yearsInCurrentJob, setYearsInCurrentJob]         = useState("");
  const [reasonsNotEmployed, setReasonsNotEmployed]       = useState([]);

  // Step 5
  const [furtherEducation, setFurtherEducation]       = useState("");
  const [furtherEducationType, setFurtherEducationType] = useState("");
  const [pursuedTrainings, setPursuedTrainings]       = useState("");
  const [trainingType, setTrainingType]               = useState("");
  const [personalGrowthRatings, setPersonalGrowthRatings] = useState({
    technicalSkills: "", problemSolvingSkills: "", communicationSkills: "",
    projectManagement: "", teamworkCollaboration: "", adaptability: "",
    workLifeBalance: "", criticalThinkingSkills: "",
  });

  // Step 6
  const [promotedInJob, setPromotedInJob]                               = useState("");
  const [significantAccomplishments, setSignificantAccomplishments]     = useState("");
  const [professionalCertifications, setProfessionalCertifications]     = useState("");
  const [professionalDevelopmentActivities, setProfessionalDevelopmentActivities] = useState("");

  const isEmployed    = employmentStatus === "Yes";
  const notEmployed   = employmentStatus === "No" || employmentStatus === "Never Employed";
  const examTaken     = professionalExam === "Yes, I passed the examination" ||
                        professionalExam === "Yes, I failed the examination";

  function toggleProgram(p) {
    setProgramsCompleted(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  }

  function toggleReason(r) {
    setReasonsNotEmployed(prev =>
      prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]
    );
  }

  function setRating(key, val) {
    setPersonalGrowthRatings(prev => ({ ...prev, [key]: val }));
  }

  function validateStep() {
    switch (step) {
      case 1:
        if (consent !== "Agree") return "You must agree to participate to continue.";
        break;
      case 2:
        if (!gender) return "Please select your gender.";
        break;
      case 3:
        if (!programsCompleted.length) return "Please select at least one program you completed.";
        if (!professionalExam) return "Please answer the professional examination question.";
        if (examTaken && !professionalExamName.trim()) return "Please specify the examination you took.";
        break;
      case 4:
        if (!employmentStatus) return "Please indicate your employment status.";
        if (isEmployed) {
          if (!placeOfWork)           return "Please indicate your place of work.";
          if (!occupationTitle.trim()) return "Please enter your occupation title.";
          if (!industryField)         return "Please select your industry.";
          if (!presentEmploymentType) return "Please select your employment type.";
          if (!jobRelatedToDegree)    return "Please indicate if your job is related to your degree.";
          if (!yearsInCurrentJob)     return "Please select how long you've been in your current job.";
        }
        if (notEmployed && !reasonsNotEmployed.length)
          return "Please select at least one reason for not being employed.";
        break;
      case 5: {
        if (!furtherEducation) return "Please answer the further education question.";
        if (furtherEducation === "Yes" && !furtherEducationType.trim())
          return "Please specify the type of further education you pursued.";
        if (!pursuedTrainings) return "Please answer the trainings question.";
        if (pursuedTrainings === "Yes" && !trainingType.trim())
          return "Please specify the type of training you pursued.";
        const unrated = GROWTH_AREAS.filter(a => !personalGrowthRatings[a.key]);
        if (unrated.length) return `Please rate all personal growth areas (missing: ${unrated[0].label}).`;
        break;
      }
      case 6:
        if (!promotedInJob)                    return "Please answer the promotion question.";
        if (!significantAccomplishments)       return "Please answer the accomplishments question.";
        if (!professionalCertifications)       return "Please answer the certifications question.";
        if (!professionalDevelopmentActivities) return "Please answer the professional development question.";
        break;
    }
    return null;
  }

  function handleNext() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError("");
    setStep(s => s + 1);
    window.scrollTo(0, 0);
  }

  function handleBack() {
    setError("");
    setStep(s => s - 1);
    window.scrollTo(0, 0);
  }

  async function handleSubmit() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/alumni/tracer-study`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contactNumber, gender,
          programsCompleted, professionalExam,
          professionalExamName: examTaken ? professionalExamName : "",
          employmentStatus,
          placeOfWork:           isEmployed ? placeOfWork : "",
          occupationTitle:       isEmployed ? occupationTitle : "",
          industryField:         isEmployed ? industryField : "",
          presentEmploymentType: isEmployed ? presentEmploymentType : "",
          jobRelatedToDegree:    isEmployed ? jobRelatedToDegree : "",
          yearsInCurrentJob:     isEmployed ? yearsInCurrentJob : "",
          reasonsNotEmployed:    notEmployed ? reasonsNotEmployed : [],
          furtherEducation,
          furtherEducationType: furtherEducation === "Yes" ? furtherEducationType : "",
          pursuedTrainings,
          trainingType: pursuedTrainings === "Yes" ? trainingType : "",
          personalGrowthRatings,
          promotedInJob, significantAccomplishments,
          professionalCertifications, professionalDevelopmentActivities,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Submission failed. Please try again."); return; }
      setTracerStudyDone();
      navigate("/alumni/dashboard", { replace: true });
    } catch {
      setError("Could not connect to server.");
    } finally {
      setLoading(false);
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100vh", overflowY: "auto", background: "#f5f0f0", fontFamily: "sans-serif" }}>

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${MAROON} 0%, #9b2235 100%)`,
        padding: "20px 24px", color: "#fff",
      }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 2 }}>
            Tarlac State University · College of Computer Studies
          </div>
          <div style={{ fontWeight: 700, fontSize: 17, color: GOLD, letterSpacing: "0.01em" }}>
            TSU – CCS Graduate Tracer Study
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "12px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            {STEP_TITLES.map((title, i) => (
              <div key={i} style={{
                fontSize: 11, fontWeight: i + 1 === step ? 700 : 400,
                color: i + 1 <= step ? MAROON : "#9ca3af",
                flex: 1, textAlign: "center",
                display: i < 2 || window.innerWidth > 500 ? "block" : "none",
              }}>
                {i + 1 <= step ? "●" : "○"}
              </div>
            ))}
          </div>
          <div style={{ height: 4, background: "#e5e7eb", borderRadius: 99 }}>
            <div style={{
              height: "100%", borderRadius: 99,
              background: `linear-gradient(90deg, ${MAROON}, #9b2235)`,
              width: `${((step - 1) / (TOTAL_STEPS - 1)) * 100}%`,
              transition: "width 0.35s ease",
            }} />
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            Page {step} of {TOTAL_STEPS}
          </div>
        </div>
      </div>

      {/* Card */}
      <div style={{ maxWidth: 760, margin: "24px auto", padding: "0 16px 40px" }}>
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 2px 16px rgba(0,0,0,0.08)", overflow: "hidden" }}>

          {/* Section title bar */}
          <div style={{ background: `${MAROON}12`, borderLeft: `4px solid ${MAROON}`, padding: "14px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: MAROON, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {STEP_TITLES[step - 1]}
            </div>
          </div>

          <div style={{ padding: "24px 28px" }}>

            {error && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
                borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: "0.875rem",
              }}>
                {error}
              </div>
            )}

            {/* ── Step 1: Consent ─────────────────────────────────────── */}
            {step === 1 && (
              <div>
                <p style={{ fontSize: "0.9rem", color: "#374151", lineHeight: 1.7, marginBottom: 16 }}>
                  Dear Participant,
                </p>
                <p style={{ fontSize: "0.9rem", color: "#374151", lineHeight: 1.7, marginBottom: 16 }}>
                  We, the College of Computer Studies, are conducting a Graduate Tracer Study to
                  track the career progress and professional development of our graduates. This study
                  aims to gather valuable feedback on how our educational programs have impacted your
                  career path and job satisfaction. Your participation will help us enhance our
                  curriculum and better support future students. The study involves completing a brief
                  online survey, which will take about 10–15 minutes. Your responses will be kept
                  confidential and used only for research purposes.
                </p>
                <p style={{ fontSize: "0.9rem", color: "#374151", lineHeight: 1.7, marginBottom: 20 }}>
                  Thank you for your contribution!
                </p>
                <div style={{ background: "#f9f5f5", border: `1px solid ${MAROON}30`, borderRadius: 8, padding: "16px 20px", marginBottom: 20 }}>
                  <p style={{ fontSize: "0.85rem", color: "#555", lineHeight: 1.6, margin: "0 0 8px" }}>
                    <strong>Electronic Informed Consent:</strong> The purpose of this study is to trace the career
                    trajectories and professional development of our graduates. Participation is completely
                    voluntary. All information collected will be kept confidential and your responses will be
                    anonymized and aggregated.
                  </p>
                </div>
                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>
                    1. By clicking "Agree" below, you acknowledge that you have read and understand
                    the information provided above, and you voluntarily agree to participate in this study. *
                  </label>
                  <RadioOpt name="consent" value="Agree"    checked={consent === "Agree"}    onChange={() => setConsent("Agree")}    label="Agree" />
                  <RadioOpt name="consent" value="Disagree" checked={consent === "Disagree"} onChange={() => setConsent("Disagree")} label="Disagree" />
                </div>
              </div>
            )}

            {/* ── Step 2: Demographic Profile ─────────────────────────── */}
            {step === 2 && (
              <div>
                <div style={fld}>
                  <label style={lbl}>Contact Number</label>
                  <input
                    type="tel"
                    value={contactNumber}
                    onChange={e => setContactNumber(e.target.value)}
                    placeholder="e.g. 09xxxxxxxxx"
                    style={inp}
                  />
                </div>
                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>Gender *</label>
                  <RadioOpt name="gender" value="Male"   checked={gender === "Male"}   onChange={() => setGender("Male")}   label="Male" />
                  <RadioOpt name="gender" value="Female" checked={gender === "Female"} onChange={() => setGender("Female")} label="Female" />
                  <RadioOpt name="gender" value="Other"  checked={gender === "Other"}  onChange={() => setGender("Other")}  label="Other" />
                </div>
              </div>
            )}

            {/* ── Step 3: General Background ──────────────────────────── */}
            {step === 3 && (
              <div>
                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>
                    What is/are the program/s you completed at TSU-CCS? *
                  </label>
                  {PROGRAMS.map(p => (
                    <CheckOpt
                      key={p}
                      checked={programsCompleted.includes(p)}
                      onChange={() => toggleProgram(p)}
                      label={p}
                    />
                  ))}
                </div>

                <div style={fld}>
                  <label style={lbl}>Have you taken any professional examination?
                    <span style={{ fontWeight: 400, color: "#6b7280", fontSize: "0.8rem" }}> (e.g. PRC Board Exam, Civil Service)</span> *
                  </label>
                  <select value={professionalExam} onChange={e => setProfessionalExam(e.target.value)} style={inp}>
                    <option value="">Select your answer</option>
                    <option>Yes, I passed the examination</option>
                    <option>Yes, I failed the examination</option>
                    <option>No, I have not yet taken any examination</option>
                  </select>
                </div>

                {examTaken && (
                  <div style={fld}>
                    <label style={lbl}>What professional examination did you take? Please do not abbreviate. *</label>
                    <input
                      type="text"
                      value={professionalExamName}
                      onChange={e => setProfessionalExamName(e.target.value)}
                      placeholder="Enter your answer"
                      style={inp}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Step 4: Employment Data ─────────────────────────────── */}
            {step === 4 && (
              <div>
                <div style={fld}>
                  <label style={lbl}>Are you presently employed? *</label>
                  <select value={employmentStatus} onChange={e => setEmploymentStatus(e.target.value)} style={inp}>
                    <option value="">Select your answer</option>
                    <option>Yes</option>
                    <option>No</option>
                    <option>Never Employed</option>
                  </select>
                </div>

                {isEmployed && (
                  <>
                    <div style={fld}>
                      <label style={{ ...lbl, marginBottom: 10 }}>Where is your current place of work? *</label>
                      <RadioOpt name="placeOfWork" value="Local (within your home country)"     checked={placeOfWork === "Local (within your home country)"}     onChange={() => setPlaceOfWork("Local (within your home country)")}     label="Local (within your home country)" />
                      <RadioOpt name="placeOfWork" value="Abroad (outside your home country)"   checked={placeOfWork === "Abroad (outside your home country)"}   onChange={() => setPlaceOfWork("Abroad (outside your home country)")}   label="Abroad (outside your home country)" />
                    </div>

                    <div style={fld}>
                      <label style={lbl}>What is the title/name of your present occupation? *
                        <span style={{ fontWeight: 400, color: "#6b7280", fontSize: "0.8rem" }}> (e.g. Front-End Developer, Software Engineer)</span>
                      </label>
                      <input type="text" value={occupationTitle} onChange={e => setOccupationTitle(e.target.value)} placeholder="Enter your answer" style={inp} />
                    </div>

                    <div style={fld}>
                      <label style={{ ...lbl, marginBottom: 10 }}>
                        What is the primary field or industry of the company where you are currently employed? *
                      </label>
                      {INDUSTRIES.map(ind => (
                        <RadioOpt key={ind} name="industry" value={ind} checked={industryField === ind} onChange={() => setIndustryField(ind)} label={ind} />
                      ))}
                    </div>

                    <div style={fld}>
                      <label style={lbl}>What is your present employment type? *</label>
                      <select value={presentEmploymentType} onChange={e => setPresentEmploymentType(e.target.value)} style={inp}>
                        <option value="">Select your answer</option>
                        {EMPLOYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>

                    <div style={fld}>
                      <label style={{ ...lbl, marginBottom: 10 }}>Is your current job related to the field of study of your degree? *</label>
                      <RadioOpt name="jobRelated" value="Yes, it is directly related"   checked={jobRelatedToDegree === "Yes, it is directly related"}   onChange={() => setJobRelatedToDegree("Yes, it is directly related")}   label="Yes, it is directly related" />
                      <RadioOpt name="jobRelated" value="Yes, it is somewhat related"   checked={jobRelatedToDegree === "Yes, it is somewhat related"}   onChange={() => setJobRelatedToDegree("Yes, it is somewhat related")}   label="Yes, it is somewhat related" />
                      <RadioOpt name="jobRelated" value="No, it is not related"         checked={jobRelatedToDegree === "No, it is not related"}         onChange={() => setJobRelatedToDegree("No, it is not related")}         label="No, it is not related" />
                    </div>

                    <div style={fld}>
                      <label style={lbl}>How long have you been in your current job? *</label>
                      <select value={yearsInCurrentJob} onChange={e => setYearsInCurrentJob(e.target.value)} style={inp}>
                        <option value="">Select your answer</option>
                        {JOB_DURATION.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                  </>
                )}

                {notEmployed && (
                  <div style={fld}>
                    <label style={{ ...lbl, marginBottom: 10 }}>
                      If not currently employed or never been employed, please indicate the reason
                      <span style={{ fontWeight: 400 }}> (you may select more than one)</span>: *
                    </label>
                    {REASONS_NOT_EMPLOYED.map(r => (
                      <CheckOpt key={r} checked={reasonsNotEmployed.includes(r)} onChange={() => toggleReason(r)} label={r} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Step 5: Personal Growth ─────────────────────────────── */}
            {step === 5 && (
              <div>
                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>Have you pursued any further education after graduating? *</label>
                  <RadioOpt name="furtherEdu" value="Yes" checked={furtherEducation === "Yes"} onChange={() => setFurtherEducation("Yes")} label="Yes" />
                  <RadioOpt name="furtherEdu" value="No"  checked={furtherEducation === "No"}  onChange={() => setFurtherEducation("No")}  label="No" />
                </div>
                {furtherEducation === "Yes" && (
                  <div style={{ ...fld, marginLeft: 24 }}>
                    <label style={lbl}>If yes, please specify the type of education you have pursued. *</label>
                    <input type="text" value={furtherEducationType} onChange={e => setFurtherEducationType(e.target.value)} placeholder="Enter your answer" style={inp} />
                  </div>
                )}

                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>Have you pursued any trainings after graduating? *</label>
                  <RadioOpt name="trainings" value="Yes" checked={pursuedTrainings === "Yes"} onChange={() => setPursuedTrainings("Yes")} label="Yes" />
                  <RadioOpt name="trainings" value="No"  checked={pursuedTrainings === "No"}  onChange={() => setPursuedTrainings("No")}  label="No" />
                </div>
                {pursuedTrainings === "Yes" && (
                  <div style={{ ...fld, marginLeft: 24 }}>
                    <label style={lbl}>If yes, please specify the type of training you pursued. *</label>
                    <input type="text" value={trainingType} onChange={e => setTrainingType(e.target.value)} placeholder="Enter your answer" style={inp} />
                  </div>
                )}

                <div style={{ ...fld, marginTop: 8 }}>
                  <label style={{ ...lbl, marginBottom: 12 }}>
                    Please rate your personal growth in the following areas since graduation. *
                  </label>

                  {/* Rating grid */}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                      <thead>
                        <tr style={{ background: `${MAROON}0d` }}>
                          <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, color: "#374151", minWidth: 160 }}></th>
                          {RATINGS.map(r => (
                            <th key={r} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: MAROON, whiteSpace: "nowrap" }}>{r}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {GROWTH_AREAS.map((area, i) => (
                          <tr key={area.key} style={{ background: i % 2 === 0 ? "#fff" : "#fdf8f8" }}>
                            <td style={{ padding: "10px 12px", color: "#374151", fontWeight: 500 }}>{area.label}</td>
                            {RATINGS.map(r => (
                              <td key={r} style={{ textAlign: "center", padding: "10px 6px" }}>
                                <input
                                  type="radio"
                                  name={`growth_${area.key}`}
                                  value={r}
                                  checked={personalGrowthRatings[area.key] === r}
                                  onChange={() => setRating(area.key, r)}
                                  style={{ accentColor: MAROON, width: 16, height: 16, cursor: "pointer" }}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 6: Professional Growth ─────────────────────────── */}
            {step === 6 && (
              <div>
                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>Have you been promoted in your current job? *</label>
                  <RadioOpt name="promoted" value="Yes" checked={promotedInJob === "Yes"} onChange={() => setPromotedInJob("Yes")} label="Yes" />
                  <RadioOpt name="promoted" value="No"  checked={promotedInJob === "No"}  onChange={() => setPromotedInJob("No")}  label="No" />
                </div>

                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>
                    Have you achieved any significant accomplishments in your current job? *
                  </label>
                  <RadioOpt name="accomplishments" value="Yes, I have received significant awards or recognitions" checked={significantAccomplishments === "Yes, I have received significant awards or recognitions"} onChange={() => setSignificantAccomplishments("Yes, I have received significant awards or recognitions")} label="Yes, I have received significant awards or recognitions" />
                  <RadioOpt name="accomplishments" value="No, I have not yet achieved any significant awards or recognitions" checked={significantAccomplishments === "No, I have not yet achieved any significant awards or recognitions"} onChange={() => setSignificantAccomplishments("No, I have not yet achieved any significant awards or recognitions")} label="No, I have not yet achieved any significant awards or recognitions" />
                </div>

                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>Have you received any professional certifications since graduation? *</label>
                  <RadioOpt name="certs" value="Yes" checked={professionalCertifications === "Yes"} onChange={() => setProfessionalCertifications("Yes")} label="Yes" />
                  <RadioOpt name="certs" value="No"  checked={professionalCertifications === "No"}  onChange={() => setProfessionalCertifications("No")}  label="No" />
                </div>

                <div style={fld}>
                  <label style={{ ...lbl, marginBottom: 10 }}>
                    Have you participated in any professional development activities
                    <span style={{ fontWeight: 400, color: "#6b7280", fontSize: "0.82rem" }}> (e.g., workshops, conferences, seminars)</span>? *
                  </label>
                  <RadioOpt name="devActivities" value="Yes" checked={professionalDevelopmentActivities === "Yes"} onChange={() => setProfessionalDevelopmentActivities("Yes")} label="Yes" />
                  <RadioOpt name="devActivities" value="No"  checked={professionalDevelopmentActivities === "No"}  onChange={() => setProfessionalDevelopmentActivities("No")}  label="No" />
                </div>
              </div>
            )}

            {/* ── Navigation buttons ─────────────────────────────────── */}
            <div style={{ display: "flex", gap: 10, marginTop: 28, justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={handleBack}
                disabled={step === 1}
                style={{
                  padding: "9px 24px", borderRadius: 8, border: `1.5px solid ${MAROON}`,
                  background: "#fff", color: MAROON, fontWeight: 600, fontSize: "0.9rem",
                  cursor: step === 1 ? "not-allowed" : "pointer",
                  opacity: step === 1 ? 0.4 : 1, transition: "opacity 0.2s",
                }}
              >
                Back
              </button>

              {step < TOTAL_STEPS ? (
                <button
                  type="button"
                  onClick={handleNext}
                  style={{
                    padding: "9px 28px", borderRadius: 8, border: "none",
                    background: MAROON, color: "#fff", fontWeight: 600, fontSize: "0.9rem",
                    cursor: "pointer",
                  }}
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading}
                  style={{
                    padding: "9px 28px", borderRadius: 8, border: "none",
                    background: MAROON, color: "#fff", fontWeight: 600, fontSize: "0.9rem",
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? "Submitting…" : "Submit"}
                </button>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
