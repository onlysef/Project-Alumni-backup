import React, { useMemo, useState } from "react";
import alumniLogo from "../../assets/images/alumni-removebg.png";

const jobs = [
  { title: "Web Developer", company: "Tech Solutions Inc.", location: "Manila", setup: "Remote", type: "Full-time", match: 75, posted: "March 08, 2026", skills: ["React.js", "REST API", "Git"] },
  { title: "UI / UX Designer", company: "Digital Creative Studio", location: "Clark, Pampanga", setup: "On-site", type: "Full-time", match: 50, posted: "April 05, 2026", skills: ["Figma", "Prototyping", "UX Research"] },
];

const initialResume = {
  name: "Juan Dela Cruz",
  address: "Tarlac City, Tarlac",
  phone: "0912 345 6789",
  email: "jdelacruz@gmail.com",
  linkedin: "linkedin.com/in/juandelacruz",
  summary: "Detail-oriented software engineer with experience building responsive web applications and collaborating with cross-functional teams.",
  skills: "Python\nJava\nPHP and C++\nReact.js\nREST API\nGit",
  experience: "Software Engineer - Agritech Solutions, Tarlac City\nJune 2024 - Present\nBuilt responsive dashboard features for alumni and employer workflows.\nCollaborated with teammates to improve usability and data entry speed.",
  education: "BS Information Technology - Tarlac State University\n2023 - 2024",
  certifications: "Web Development Fundamentals\nDatabase Management Certificate",
  projects: "Alumni Career Portal\nCreated portal features for job matching, resume preview, and alumni recommendations.",
  languages: "English: Professional\nFilipino: Native",
};

export default function JobConnect() {
  const [search, setSearch] = useState("");
  const [setup, setSetup] = useState("All setups");
  const [saved, setSaved] = useState([]);
  const [resume, setResume] = useState(initialResume);
  const [draftResume, setDraftResume] = useState(initialResume);
  const [editingResume, setEditingResume] = useState(false);
  const [resumePreviewOpen, setResumePreviewOpen] = useState(false);

  const results = useMemo(() => jobs.filter(job => (
    setup === "All setups" || job.setup === setup
  ) && `${job.title} ${job.company} ${job.skills.join(" ")}`.toLowerCase().includes(search.toLowerCase())), [search, setup]);

  const toggleSave = (title) => setSaved(prev => prev.includes(title) ? prev.filter(item => item !== title) : [...prev, title]);
  const updateDraft = (key, value) => setDraftResume(prev => ({ ...prev, [key]: value }));
  const beginResumeEdit = () => { setDraftResume(resume); setEditingResume(true); };
  const cancelResumeEdit = () => { setDraftResume(resume); setEditingResume(false); };
  const saveResumeEdit = () => { setResume(draftResume); setEditingResume(false); };
  const exportResume = () => downloadResumeDoc(resume);
  const previewResume = editingResume ? draftResume : resume;

  return <div className="alumni-page-content job-connect-page">
    <section className="job-connect-hero">
      <div><span>Opportunities for TSU alumni</span><h1>Find your next opportunity</h1><p>Discover roles matched to your profile, experience, and career interests.</p></div>
      <button type="button">Job alerts: On</button>
    </section>

    <section className="job-search-bar">
      <label><span>Search</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search job title, company, or skill" /></label>
      <select value={setup} onChange={e => setSetup(e.target.value)}><option>All setups</option><option>Remote</option><option>Hybrid</option><option>On-site</option></select>
      <button type="button">Search Jobs</button>
    </section>

    <div className="job-stats"><div><strong>{jobs.length}</strong><span>Recommended jobs</span></div><div><strong>{saved.length}</strong><span>Saved jobs</span></div><div><strong>2</strong><span>Applications sent</span></div><div><strong>1</strong><span>Interview scheduled</span></div></div>

    <div className="job-connect-layout">
      <main>
        <div className="job-list-head"><div><span>Personalized matches</span><h2>Recommended for You</h2></div><b>{results.length} results</b></div>
        <div className="job-connect-list">
          {results.map(job => <JobCard key={job.title} job={job} saved={saved.includes(job.title)} onToggleSave={() => toggleSave(job.title)} />)}
        </div>
        {!results.length && <div className="job-empty"><b>No matching jobs found</b><span>Try another search or work setup.</span></div>}
        <a className="job-view-more" href="#">View More Job Postings</a>
      </main>

      <aside className="job-connect-side">
        <section className="application-tracker resume-creation">
          <div><span>Resume tools</span><h2>Resume Creation</h2></div>
          {editingResume ? (
            <ResumeEditor value={draftResume} onChange={updateDraft} />
          ) : (
            <ResumePreview resume={resume} />
          )}
          <div className="resume-actions">
            {editingResume ? (
              <>
                <button className="resume-preview-btn" type="button" onClick={() => setResumePreviewOpen(true)}><ResumePreviewIcon />Preview</button>
                <button className="resume-edit" type="button" onClick={cancelResumeEdit}><ResumeCloseIcon />Cancel</button>
                <button className="resume-export" type="button" onClick={saveResumeEdit}><ResumeCheckIcon />Save</button>
              </>
            ) : (
              <>
                <button className="resume-preview-btn" type="button" onClick={() => setResumePreviewOpen(true)}><ResumePreviewIcon />Preview</button>
                <button className="resume-edit" type="button" onClick={beginResumeEdit}><ResumeEditIcon />Edit</button>
                <button className="resume-export" type="button" onClick={exportResume}><ResumeExportIcon />Export</button>
              </>
            )}
          </div>
        </section>
        <section className="job-tip-card"><b>Resume tip</b><p>Keep your resume updated before exporting so employers see your latest skills, projects, and experience.</p></section>
      </aside>
    </div>
    {resumePreviewOpen && (
      <div className="resume-preview-overlay" role="dialog" aria-modal="true" aria-label="Resume preview">
        <div className="resume-preview-modal">
          <div className="resume-preview-modal-head">
            <div><span>Resume preview</span><h2>{previewResume.name}</h2></div>
            <button type="button" onClick={() => setResumePreviewOpen(false)} aria-label="Close preview"><ResumeCloseIcon /></button>
          </div>
          <ResumePreview resume={previewResume} mode="modal" />
        </div>
      </div>
    )}
  </div>;
}

function JobCard({ job, saved, onToggleSave }) {
  return <article className={`connect-job-card ${job.match === 50 ? "design-job" : ""}`}>
    <div className="connect-match-ribbon"><strong>{job.match}%</strong><span>Match</span></div>
    <div className="job-company-logo"><img src={alumniLogo} alt={`${job.company} logo`} /></div>
    <div className="connect-job-main">
      <span className="connect-posted">Posted: {job.posted}</span>
      <div className="connect-job-title"><div><h3>{job.title}</h3><p>{job.company}<br />{job.location} | {job.type}</p></div></div>
      <p className="connect-job-description">{job.match === 75 ? "We are looking for a Web Developer skilled in building responsive and dynamic web applications." : "Create user-centered designs and improve digital experiences."}</p>
      <div className="connect-card-buttons"><button className="apply-job">Apply now</button><button className="view-job">See details -&gt;</button><button className={`connect-save-icon${saved ? " saved" : ""}`} onClick={onToggleSave} aria-label="Save job">{saved ? "Saved" : "Save"}</button></div>
      <small className="job-partner">Partner with TSU - AAI</small>
    </div>
    <aside className="connect-skill-gap"><b>Skill Gap</b><div>{job.skills.map(skill => <span key={skill}>{skill}</span>)}</div><small>{job.match === 75 ? "These skills are highly requested by the employer based on your current profile." : "Employers prioritize candidates with these verified skills in their portfolio."}</small></aside>
  </article>;
}

function ResumePreview({ resume, mode = "card" }) {
  const lines = (value) => String(value || "").split("\n").map(line => line.trim()).filter(Boolean);
  const experienceLines = lines(resume.experience);
  return <div className={`resume-preview ${mode === "modal" ? "resume-preview-full" : ""}`} aria-label="Resume preview">
    <div className="resume-contact">
      <strong>{resume.name}</strong>
      <p>{[resume.address, resume.phone, resume.email, resume.linkedin].filter(Boolean).join(" | ")}</p>
    </div>
    <ResumeSection title="Professional Summary" show={resume.summary}><p>{resume.summary}</p></ResumeSection>
    <ResumeSection title="Key Skills" show={resume.skills}><ul>{lines(resume.skills).map(item => <li key={item}>{item}</li>)}</ul></ResumeSection>
    <ResumeSection title="Professional Experience" show={resume.experience}>
      {experienceLines[0] && <b className="resume-entry-title">{experienceLines[0]}</b>}
      {experienceLines[1] && <p className="resume-entry-meta">{experienceLines[1]}</p>}
      <ul>{experienceLines.slice(2).map(item => <li key={item}>{item}</li>)}</ul>
    </ResumeSection>
    <ResumeSection title="Education" show={resume.education}>{lines(resume.education).map(item => <p key={item}>{item}</p>)}</ResumeSection>
    <ResumeSection title="Certifications" show={resume.certifications}><ul>{lines(resume.certifications).map(item => <li key={item}>{item}</li>)}</ul></ResumeSection>
    <ResumeSection title="Projects" show={resume.projects}><ul>{lines(resume.projects).map(item => <li key={item}>{item}</li>)}</ul></ResumeSection>
    <ResumeSection title="Languages" show={resume.languages}><ul>{lines(resume.languages).map(item => <li key={item}>{item}</li>)}</ul></ResumeSection>
  </div>;
}

function ResumeEditor({ value, onChange }) {
  return <div className="resume-editor" aria-label="Resume editor">
    <label><span>Full name</span><input value={value.name} onChange={e => onChange("name", e.target.value)} /></label>
    <label><span>Address</span><input value={value.address} onChange={e => onChange("address", e.target.value)} /></label>
    <label><span>Phone</span><input value={value.phone} onChange={e => onChange("phone", e.target.value)} /></label>
    <label><span>Email</span><input value={value.email} onChange={e => onChange("email", e.target.value)} /></label>
    <label><span>LinkedIn</span><input value={value.linkedin} onChange={e => onChange("linkedin", e.target.value)} /></label>
    <label><span>Professional summary</span><textarea value={value.summary} onChange={e => onChange("summary", e.target.value)} /></label>
    <label><span>Key skills</span><textarea value={value.skills} onChange={e => onChange("skills", e.target.value)} /></label>
    <label><span>Professional experience</span><textarea value={value.experience} onChange={e => onChange("experience", e.target.value)} /></label>
    <label><span>Education</span><textarea value={value.education} onChange={e => onChange("education", e.target.value)} /></label>
    <label><span>Certifications</span><textarea value={value.certifications} onChange={e => onChange("certifications", e.target.value)} /></label>
    <label><span>Projects</span><textarea value={value.projects} onChange={e => onChange("projects", e.target.value)} /></label>
    <label><span>Languages</span><textarea value={value.languages} onChange={e => onChange("languages", e.target.value)} /></label>
  </div>;
}

function ResumeSection({ title, show = true, children }) {
  if (!show) return null;
  return <section className="resume-format-section"><h3>{title}</h3>{children}</section>;
}

function ResumeEditIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.4-10.4a2 2 0 0 0-2.8-2.8L5.2 17.2 4 20Z" /><path d="m14.4 8 1.6 1.6" /></svg>;
}

function ResumePreviewIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5" /></svg>;
}

function ResumeExportIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11" /><path d="m8 10 4 4 4-4" /><path d="M5 17v3h14v-3" /></svg>;
}

function ResumeCheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}

function ResumeCloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10" /><path d="M17 7 7 17" /></svg>;
}

function downloadResumeDoc(resume) {
  const lines = (value) => String(value || "").split("\n").map(line => line.trim()).filter(Boolean);
  const bulletList = (value) => `<ul>${lines(value).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const paragraphLines = (value) => lines(value).map(item => `<p>${escapeHtml(item)}</p>`).join("");
  const filename = `${resume.name || "resume"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resume";
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(resume.name || "Resume")}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #222; line-height: 1.45; margin: 40px; }
    h1 { font-size: 20px; margin: 0 0 14px; }
    h2 { font-size: 15px; margin: 22px 0 8px; }
    p { margin: 4px 0; font-size: 12px; }
    ul { margin: 6px 0 0 20px; padding: 0; }
    li { margin: 5px 0; font-size: 12px; }
    .contact { margin-bottom: 18px; }
  </style>
</head>
<body>
  <section class="contact">
    <h1>${escapeHtml(resume.name)}</h1>
    <p>${escapeHtml(resume.address)}</p>
    <p>${escapeHtml(resume.phone)}</p>
    <p>${escapeHtml(resume.email)}</p>
    <p>${escapeHtml(resume.linkedin)}</p>
  </section>
  <h2>Professional Summary</h2>
  <p>${escapeHtml(resume.summary)}</p>
  <h2>Key Skills</h2>
  ${bulletList(resume.skills)}
  <h2>Professional Experience</h2>
  ${bulletList(resume.experience)}
  <h2>Education</h2>
  ${paragraphLines(resume.education)}
  <h2>Certifications (Optional)</h2>
  ${bulletList(resume.certifications)}
  <h2>Projects (Optional)</h2>
  ${bulletList(resume.projects)}
  <h2>Languages (Optional)</h2>
  ${bulletList(resume.languages)}
</body>
</html>`;
  const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-resume.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
