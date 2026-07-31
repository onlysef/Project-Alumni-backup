import React, { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import alumniLogo from "../../assets/images/alumni-removebg.png";
import { apiFetch } from "../../services/api.js";

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

const RESUME_FIELDS = ["name", "address", "phone", "email", "linkedin", "summary", "skills", "experience", "education", "certifications", "projects", "languages"];

export default function JobConnect() {
  const [search, setSearch] = useState("");
  const [jobType, setJobType] = useState("");
  const [resume, setResume] = useState(initialResume);
  const [draftResume, setDraftResume] = useState(initialResume);
  const [editingResume, setEditingResume] = useState(false);
  const [resumePreviewOpen, setResumePreviewOpen] = useState(false);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [hasProfile, setHasProfile] = useState(true);
  const [detailsJob, setDetailsJob] = useState(null);

  const [view, setView] = useState("recommended"); // "recommended" | "saved"
  const [savedJobs, setSavedJobs] = useState([]);
  const savedUrls = new Set(savedJobs.map(j => j.url));

  const [jobAlertsEnabled, setJobAlertsEnabled] = useState(true);

  function runSearch(keywords, type) {
    setLoading(true);
    setError("");
    apiFetch("/alumni/jobs/search", { params: { keywords, type } })
      .then((d) => { setJobs(d.jobs || []); setUnavailable(!!d.unavailable); setHasProfile(d.hasProfile !== false); })
      .catch(() => setError("Could not load job listings right now."))
      .finally(() => setLoading(false));
  }

  function loadSavedJobs() {
    apiFetch("/alumni/jobs/saved").then((d) => setSavedJobs(d.jobs || [])).catch(() => {});
  }

  function loadJobAlertsPref() {
    apiFetch("/alumni/job-alerts").then((d) => setJobAlertsEnabled(d.enabled !== false)).catch(() => {});
  }

  function toggleJobAlerts() {
    const next = !jobAlertsEnabled;
    setJobAlertsEnabled(next);
    apiFetch("/alumni/job-alerts", { method: "PUT", body: { enabled: next } }).catch(() => setJobAlertsEnabled(!next));
  }

  function loadResume() {
    // The backend always returns something here — either a previously
    // saved resume, or profile-derived suggested defaults (see
    // getMyResume) — this guard only matters if the request itself fails,
    // in which case the hardcoded initialResume state stays as-is.
    apiFetch("/alumni/resume").then((d) => {
      if (!d.resume) return;
      const loaded = { ...initialResume };
      RESUME_FIELDS.forEach((key) => { if (d.resume[key] !== undefined) loaded[key] = d.resume[key]; });
      setResume(loaded);
      setDraftResume(loaded);
    }).catch(() => {});
  }

  useEffect(() => { runSearch(search, jobType); loadSavedJobs(); loadJobAlertsPref(); loadResume(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const results = view === "saved" ? savedJobs : jobs;
  const descriptionBlocks = detailsJob ? structureDescription(detailsJob.description) : [];

  function toggleSave(job) {
    const wasSaved = savedUrls.has(job.url);
    apiFetch("/alumni/jobs/saved/toggle", { method: "POST", body: job })
      .then(() => setSavedJobs(prev => wasSaved ? prev.filter(j => j.url !== job.url) : [{ ...job, createdAt: new Date().toISOString() }, ...prev]))
      .catch(() => {});
  }

  const updateDraft = (key, value) => setDraftResume(prev => ({ ...prev, [key]: value }));
  const beginResumeEdit = () => { setDraftResume(resume); setEditingResume(true); };
  const cancelResumeEdit = () => { setDraftResume(resume); setEditingResume(false); };
  const saveResumeEdit = () => {
    setResume(draftResume);
    setEditingResume(false);
    apiFetch("/alumni/resume", { method: "PUT", body: draftResume }).catch(() => {});
  };
  const previewResume = editingResume ? draftResume : resume;

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const closeOnOutside = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportMenuOpen(false); };
    const closeOnEscape = (e) => { if (e.key === "Escape") setExportMenuOpen(false); };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [exportMenuOpen]);

  function exportResumeAs(format) {
    setExportMenuOpen(false);
    if (format === "pdf") downloadResumePdf(resume);
    else downloadResumeDoc(resume);
  }

  return <div className="alumni-page-content job-connect-page">
    <section className="job-connect-hero">
      <div><span>Opportunities for TSU alumni</span><h1>Find your next opportunity</h1><p>Discover roles matched to your profile, experience, and career interests.</p></div>
      <button type="button" className={`job-alerts-toggle${jobAlertsEnabled ? " on" : ""}`} onClick={toggleJobAlerts}>Job alerts: {jobAlertsEnabled ? "On" : "Off"}</button>
    </section>

    <section className="job-search-bar">
      <label><SearchIcon /><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && runSearch(search, jobType)} placeholder="Search job title, company, or skill" /></label>
      <select value={jobType} onChange={e => { setJobType(e.target.value); runSearch(search, e.target.value); }}>
        <option value="">All types</option>
        <option value="full-time">Full-time</option>
        <option value="part-time">Part-time</option>
        <option value="permanent">Permanent</option>
        <option value="contract">Contract</option>
        <option value="temporary">Temporary</option>
        <option value="internship">Internship/Training</option>
        <option value="volunteer">Volunteer</option>
      </select>
      <button type="button" onClick={() => runSearch(search, jobType)} disabled={loading}>{loading ? "Searching…" : "Search Jobs"}</button>
    </section>

    <div className="job-stats">
      <div><strong>{jobs.length}</strong><span>Recommended jobs</span></div>
      <div className="job-stat-clickable" onClick={() => setView("saved")}><strong>{savedJobs.length}</strong><span>Saved jobs</span></div>
      <div><strong>2</strong><span>Applications sent</span></div>
      <div><strong>1</strong><span>Interview scheduled</span></div>
    </div>

    <div className="job-connect-layout">
      <main>
        <div className="job-list-head">
          <div><span>{view === "saved" ? "Your bookmarks" : "Personalized matches"}</span><h2>{view === "saved" ? "Saved Jobs" : "Recommended for You"}</h2></div>
          {view === "saved" ? (
            <button type="button" className="job-view-toggle" onClick={() => setView("recommended")}>Back to Recommended</button>
          ) : (
            <b>{results.length} results</b>
          )}
        </div>

        {view === "recommended" && error && <div className="job-empty"><b>{error}</b><span>Try searching again in a moment.</span></div>}
        {view === "recommended" && !error && unavailable && <div className="job-empty"><b>Job search is temporarily unavailable</b><span>Careerjet isn't configured or didn't respond — please try again later.</span></div>}
        {view === "recommended" && !error && loading && <div className="job-empty"><b>Loading jobs…</b><span>Fetching the latest postings from Careerjet.</span></div>}
        {view === "recommended" && !error && !loading && !unavailable && !results.length && !search.trim() && !hasProfile && (
          <div className="job-empty"><b>Complete your Employment Details</b><span>Add your job title and skills so we can recommend jobs that actually match you.</span></div>
        )}
        {view === "recommended" && !error && !loading && !unavailable && !results.length && (search.trim() || hasProfile) && (
          <div className="job-empty"><b>No matching jobs found</b><span>Try another search or employment type.</span></div>
        )}
        {view === "saved" && !results.length && (
          <div className="job-empty"><b>No saved jobs yet</b><span>Click "Save" on a job to bookmark it here.</span></div>
        )}

        {((view === "recommended" && !error && !loading && !unavailable) || view === "saved") && !!results.length && (
          <div className="job-connect-list">
            {results.map(job => <JobCard key={job.url || job.title} job={job} saved={savedUrls.has(job.url)} onToggleSave={() => toggleSave(job)} onViewDetails={() => setDetailsJob(job)} />)}
          </div>
        )}
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
                <div className="resume-export-wrap" ref={exportRef}>
                  <button className="resume-export" type="button" onClick={() => setExportMenuOpen(o => !o)}><ResumeExportIcon />Export</button>
                  {exportMenuOpen && (
                    <div className="resume-export-menu">
                      <button type="button" onClick={() => exportResumeAs("doc")}>Word (.doc)</button>
                      <button type="button" onClick={() => exportResumeAs("pdf")}>PDF</button>
                    </div>
                  )}
                </div>
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
    {detailsJob && (
      <div className="resume-preview-overlay" role="dialog" aria-modal="true" aria-label="Job details">
        <div className="resume-preview-modal job-details-modal">
          <div className="resume-preview-modal-head">
            <div><span>{detailsJob.company}</span><h2>{detailsJob.title}</h2></div>
            <button type="button" onClick={() => setDetailsJob(null)} aria-label="Close details"><ResumeCloseIcon /></button>
          </div>
          <div className="job-details-body">
            <p className="job-details-meta">
              {[detailsJob.location, detailsJob.type, detailsJob.posted && `Posted ${detailsJob.posted}`].filter(Boolean).join(" · ")}
            </p>
            {detailsJob.match !== null && detailsJob.match !== undefined && (
              <p className="job-details-match"><strong>{detailsJob.match}%</strong> match to your profile</p>
            )}
            {descriptionBlocks.length ? (
              <div className="job-details-description">
                {descriptionBlocks.map((block, i) => {
                  if (block.type === "header") return <h4 key={i}>{block.text}</h4>;
                  if (block.type === "list") return <ul key={i}>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>;
                  return <p key={i}>{block.text}</p>;
                })}
              </div>
            ) : (
              <p className="job-details-description">Careerjet didn't provide a longer description for this listing — use "Apply now" to view the full posting.</p>
            )}
            {detailsJob.skills?.length > 0 && (
              <div className="job-details-skills">
                <b>Skill Gap</b>
                <div>{detailsJob.skills.map(skill => <span key={skill.name} className={skill.matched ? "skill-have" : "skill-missing"}>{skill.name}</span>)}</div>
              </div>
            )}
            <a className="apply-job job-details-apply" href={detailsJob.url} target="_blank" rel="noopener noreferrer">Apply now on Careerjet <ArrowIcon /></a>
          </div>
        </div>
      </div>
    )}
  </div>;
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max).trim()}…` : value;
}

function formatSavedDate(iso) {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Careerjet's description field has no real structural markup — only
// inline <b> keyword-highlight tags — but the original paragraph/bullet
// boundaries survive as runs of 2+ raw spaces once tags are stripped, so
// that's the only signal available to rebuild readable structure from.
function splitDescriptionSegments(value) {
  const withoutInlineTags = String(value || "").replace(/<\/?(b|strong|em|i)>/gi, "");
  const withoutOtherTags = withoutInlineTags.replace(/<[^>]*>/g, " ");
  return withoutOtherTags
    .split(/\s{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const SECTION_HEADER_PATTERN = /^(key responsibilities|responsibilities|duties|required qualifications(\s*&?\s*experience)?|minimum qualifications|qualifications|preferred qualifications|key competencies|competencies|core competencies|requirements?|about (the )?(role|company|us|team)|benefits|perks|what you.ll (do|need)|what we.re looking for|why join us|job description|role overview|overview|primary details|skills|technical skills|soft skills|nice to have|good to have|education|experience|job summary|position summary|summary)\s*[:&]?\s*$/i;

function isHeaderSegment(segment) {
  return SECTION_HEADER_PATTERN.test(segment);
}

// Groups the flat segment list into intro paragraphs, then bullet lists
// under whichever section header preceded them (postings are consistently
// shaped: intro text, then Header, then its bullet items, repeat).
function structureDescription(value) {
  const segments = splitDescriptionSegments(value);
  const blocks = [];
  let currentList = null;
  let sawHeader = false;
  for (const segment of segments) {
    if (isHeaderSegment(segment)) {
      sawHeader = true;
      currentList = null;
      blocks.push({ type: "header", text: segment.replace(/[:&]\s*$/, "").trim() });
      continue;
    }
    if (sawHeader) {
      if (!currentList) {
        currentList = { type: "list", items: [] };
        blocks.push(currentList);
      }
      currentList.items.push(segment);
    } else {
      blocks.push({ type: "para", text: segment });
    }
  }
  return blocks;
}

// Compact card preview: just the intro prose before the first section
// header (if any), truncated — avoids gluing unrelated bullet items
// together the way a naive whitespace-collapse would.
function descriptionPreview(value, max) {
  const segments = splitDescriptionSegments(value);
  const intro = [];
  for (const segment of segments) {
    if (isHeaderSegment(segment)) break;
    intro.push(segment);
  }
  const text = (intro.length ? intro : segments).join(" ");
  return truncate(text, max);
}

function JobCard({ job, saved, onToggleSave, onViewDetails }) {
  const description = descriptionPreview(job.description, 220);
  return <article className="connect-job-card">
    {job.match !== null && job.match !== undefined && (
      <div className="connect-match-ribbon"><strong>{job.match}%</strong><span>Match</span></div>
    )}
    <div className="job-company-logo"><img src={alumniLogo} alt={`${job.company} logo`} /></div>
    <div className="connect-job-main">
      {job.posted && <span className="connect-posted">Posted: {job.posted}</span>}
      {job.createdAt && <span className="connect-posted connect-saved-date">Saved {formatSavedDate(job.createdAt)}</span>}
      <div className="connect-job-title"><div><h3>{job.title}</h3><p>{job.company}<br />{[job.location, job.type].filter(Boolean).join(" | ")}</p></div></div>
      {description && <p className="connect-job-description">{description}</p>}
      <div className="connect-card-buttons">
        <a className="apply-job" href={job.url} target="_blank" rel="noopener noreferrer">Apply now</a>
        <button className="view-job" type="button" onClick={onViewDetails}>See details <ArrowIcon /></button>
        <button className={`connect-save-icon${saved ? " saved" : ""}`} type="button" onClick={onToggleSave} aria-label={saved ? "Remove from saved jobs" : "Save job"}>
          <BookmarkIcon filled={saved} /><span>{saved ? "Saved" : "Save"}</span>
        </button>
      </div>
      <small className="job-partner">via Careerjet</small>
    </div>
    {job.skills?.length > 0 && (
      <aside className="connect-skill-gap">
        <b>Skill Gap</b>
        <div>{job.skills.map(skill => <span key={skill.name} className={skill.matched ? "skill-have" : "skill-missing"}>{skill.name}</span>)}</div>
        <small>
          {job.skills.some(s => s.matched) ? "Highlighted skills are already on your profile — the rest are worth adding." : "These skills are requested for this role but aren't on your profile yet."}
          {job.createdAt && " (based on your profile as of when you saved this job)"}
        </small>
      </aside>
    )}
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
    <label><span>Full name</span><input value={value.name} onChange={e => onChange("name", e.target.value)} placeholder="Juan Dela Cruz" /></label>
    <label><span>Address</span><input value={value.address} onChange={e => onChange("address", e.target.value)} placeholder="Tarlac City, Tarlac" /></label>
    <label><span>Phone</span><input value={value.phone} onChange={e => onChange("phone", e.target.value)} placeholder="0912 345 6789" /></label>
    <label><span>Email</span><input value={value.email} onChange={e => onChange("email", e.target.value)} placeholder="juandelacruz@gmail.com" /></label>
    <label><span>LinkedIn</span><input value={value.linkedin} onChange={e => onChange("linkedin", e.target.value)} placeholder="linkedin.com/in/juandelacruz" /></label>
    <label><span>Professional summary</span><textarea value={value.summary} onChange={e => onChange("summary", e.target.value)} placeholder="1-2 sentences on who you are professionally and what you're looking for." /></label>
    <label><span>Key skills</span><textarea value={value.skills} onChange={e => onChange("skills", e.target.value)} placeholder={"One skill per line, e.g.\nReact.js\nSQL\nProject Management"} /></label>
    <label><span>Professional experience</span><textarea value={value.experience} onChange={e => onChange("experience", e.target.value)} placeholder={"Job Title - Company, Location\nMonth Year - Present\nWhat you did or accomplished in this role."} /></label>
    <label><span>Education</span><textarea value={value.education} onChange={e => onChange("education", e.target.value)} placeholder={"BS Information Technology - Tarlac State University\nBatch 2024"} /></label>
    <label><span>Certifications</span><textarea value={value.certifications} onChange={e => onChange("certifications", e.target.value)} placeholder={"One certification per line, e.g.\nAWS Certified Cloud Practitioner\nTOEIC Certificate"} /></label>
    <label><span>Projects</span><textarea value={value.projects} onChange={e => onChange("projects", e.target.value)} placeholder={"Project Name\nWhat it does and your role in it."} /></label>
    <label><span>Languages</span><textarea value={value.languages} onChange={e => onChange("languages", e.target.value)} placeholder={"English: Professional\nFilipino: Native"} /></label>
  </div>;
}

function ResumeSection({ title, show = true, children }) {
  if (!show) return null;
  return <section className="resume-format-section"><h3>{title}</h3>{children}</section>;
}

function BookmarkIcon({ filled }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" style={{ fill: filled ? "currentColor" : "none" }}><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" /></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.35-4.35" /></svg>;
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

function resumeFilename(resume) {
  return `${resume.name || "resume"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resume";
}

// Shared by both export formats so the .doc and the printed PDF stay
// visually identical to each other (and to ResumePreview) instead of
// drifting apart into two hand-maintained templates.
function buildResumeHtml(resume) {
  const lines = (value) => String(value || "").split("\n").map(line => line.trim()).filter(Boolean);
  const bulletList = (value) => `<ul>${lines(value).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const paragraphLines = (value) => lines(value).map(item => `<p>${escapeHtml(item)}</p>`).join("");

  // Mirrors ResumePreview: the first line of "experience" is the job
  // title/company, the second is the date range, and only the rest are
  // actual bullet points — flattening all of it into one bullet list (like
  // the other free-text fields do) loses that structure.
  const experienceLines = lines(resume.experience);
  const experienceHtml = `
    ${experienceLines[0] ? `<p class="entry-title">${escapeHtml(experienceLines[0])}</p>` : ""}
    ${experienceLines[1] ? `<p class="entry-meta">${escapeHtml(experienceLines[1])}</p>` : ""}
    <ul>${experienceLines.slice(2).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;

  // Mirrors ResumeSection's `show` prop — an empty field's heading doesn't
  // get printed at all, same as the on-screen preview.
  const section = (title, show, bodyHtml) => (show ? `<div class="section"><h2>${escapeHtml(title)}</h2>${bodyHtml}</div>` : "");
  const contactLine = [resume.address, resume.phone, resume.email, resume.linkedin].filter(Boolean).join(" | ");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(resume.name || "Resume")}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #252124; line-height: 1.5; margin: 40px; }
    h1 { margin: 0; color: #161315; font-size: 22px; font-weight: 900; }
    h2 { margin: 0 0 8px; padding-bottom: 5px; border-bottom: 1px solid #e6dee1; color: #242024; font-size: 14px; font-weight: 900; }
    p { margin: 4px 0; color: #4d474a; font-size: 12px; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 5px 0; color: #4d474a; font-size: 12px; line-height: 1.45; }
    .contact { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #d9d1d4; }
    .contact p { margin: 4px 0 0; }
    .section { margin-top: 18px; }
    .entry-title { margin: 0 0 2px; color: #242024; font-size: 13px; font-weight: 800; }
    .entry-meta { margin: 0 0 6px; color: #6f6267; font-size: 11px; font-style: italic; }
    @media print { body { margin: 0.5in; } }
  </style>
</head>
<body>
  <section class="contact">
    <h1>${escapeHtml(resume.name)}</h1>
    <p>${escapeHtml(contactLine)}</p>
  </section>
  ${section("Professional Summary", resume.summary, `<p>${escapeHtml(resume.summary)}</p>`)}
  ${section("Key Skills", resume.skills, bulletList(resume.skills))}
  ${section("Professional Experience", resume.experience, experienceHtml)}
  ${section("Education", resume.education, paragraphLines(resume.education))}
  ${section("Certifications", resume.certifications, bulletList(resume.certifications))}
  ${section("Projects", resume.projects, bulletList(resume.projects))}
  ${section("Languages", resume.languages, bulletList(resume.languages))}
</body>
</html>`;
}

function downloadResumeDoc(resume) {
  const html = buildResumeHtml(resume);
  const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${resumeFilename(resume)}-resume.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Built directly with jsPDF's text APIs (not an HTML-to-canvas rasterization)
// so the output is a real, crisp, selectable-text PDF — and downloads in one
// click via doc.save(), same as the Word export, instead of routing through
// the browser's print dialog.
function downloadResumePdf(resume) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 56;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  let y = 56;

  function ensureSpace(need) {
    if (y + need > pageHeight - 56) {
      doc.addPage();
      y = 56;
    }
  }

  function paragraph(text) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(77, 71, 74);
    doc.splitTextToSize(text, contentWidth).forEach((line) => {
      ensureSpace(14);
      doc.text(line, marginX, y);
      y += 14;
    });
  }

  function bullets(items) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(77, 71, 74);
    items.forEach((item) => {
      doc.splitTextToSize(item, contentWidth - 14).forEach((line, i) => {
        ensureSpace(14);
        doc.text(i === 0 ? `•  ${line}` : `    ${line}`, marginX, y);
        y += 14;
      });
    });
  }

  function sectionHeading(title) {
    ensureSpace(26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(36, 32, 36);
    doc.text(title, marginX, y);
    y += 4;
    doc.setDrawColor(230, 222, 225);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 14;
  }

  function section(title, show, renderBody) {
    if (!show) return;
    sectionHeading(title);
    renderBody();
    y += 8;
  }

  const lines = (value) => String(value || "").split("\n").map((l) => l.trim()).filter(Boolean);

  // Name + contact line
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(22, 19, 21);
  doc.text(resume.name || "", marginX, y);
  y += 22;

  const contactLine = [resume.address, resume.phone, resume.email, resume.linkedin].filter(Boolean).join("   |   ");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(77, 71, 74);
  const contactWrapped = doc.splitTextToSize(contactLine, contentWidth);
  doc.text(contactWrapped, marginX, y);
  y += contactWrapped.length * 13 + 8;

  doc.setDrawColor(217, 209, 212);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 18;

  section("Professional Summary", resume.summary, () => paragraph(resume.summary));
  section("Key Skills", resume.skills, () => bullets(lines(resume.skills)));
  section("Professional Experience", resume.experience, () => {
    const expLines = lines(resume.experience);
    if (expLines[0]) {
      ensureSpace(14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(36, 32, 36);
      doc.text(expLines[0], marginX, y);
      y += 13;
    }
    if (expLines[1]) {
      ensureSpace(14);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9.5);
      doc.setTextColor(111, 98, 103);
      doc.text(expLines[1], marginX, y);
      y += 14;
    }
    bullets(expLines.slice(2));
  });
  section("Education", resume.education, () => lines(resume.education).forEach((l) => paragraph(l)));
  section("Certifications", resume.certifications, () => bullets(lines(resume.certifications)));
  section("Projects", resume.projects, () => bullets(lines(resume.projects)));
  section("Languages", resume.languages, () => bullets(lines(resume.languages)));

  doc.save(`${resumeFilename(resume)}-resume.pdf`);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
