import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useOutletContext } from "react-router-dom";
import { jsPDF } from "jspdf";
import jobConnectLogo from "../../assets/images/jobconnect-logo.png";
import { apiFetch } from "../../services/api.js";
import { JobCard, ArrowIcon, formatSavedDate, formatPostedDate, descriptionPreview, structureDescription, SKILL_CHIP_LIMIT } from "../../components/alumni/JobPostingCard.jsx";
import { classifySkill } from "../../utils/skillClassification.js";

// Every field below used to be an editable, SAVEABLE default (see
// useState(EMPTY_RESUME) further down) — a brand-new alumnus with no
// employment/tracer data yet saw this fake identity sitting in the actual
// form fields, and clicking Save without editing anything persisted it as
// their real resume, shown to real employers on every job application. The
// ResumeEditor's <input>/<textarea> elements already carry the exact same
// example text as HTML `placeholder` attributes (grey hint text that is
// never part of the submitted value) — so this fake data was pure
// duplication with none of the safety, and the real default is now
// genuinely empty.
const EMPTY_RESUME = {
  name: "", address: "", phone: "", email: "", linkedin: "", avatarUrl: "", summary: "",
  // Unlike every other field here, "experience" is a list of entries (see
  // resumeBuilder.deriveFromProfile on the backend) — it's built from the
  // alumnus's current job + Work History in Employment Details, never
  // hand-typed here, so it's never a free-text string like the rest.
  skills: "", experience: [], education: "", certifications: "", projects: "", languages: "",
};

const RESUME_FIELDS = ["name", "address", "phone", "email", "linkedin", "avatarUrl", "summary", "skills", "experience", "education", "certifications", "projects", "languages"];

// A search box full of pure symbols ("***¥€$") is never a real job title,
// company, or skill — same "at least one letter/digit" allow-list used for
// Skills/Work-History free-text elsewhere in this app. Careerjet/the
// internal search still technically "succeeds" on garbage input (matches
// nothing meaningful and falls back to generic recommended postings), which
// reads as if the search silently ignored what was typed rather than
// rejecting it outright.
const HAS_ALNUM_RE = /[a-zA-Z0-9À-ÖØ-öø-ÿ]/;

export default function JobConnect() {
  const { showToast } = useOutletContext() || {};
  const [search, setSearch] = useState("");
  const [jobType, setJobType] = useState("");
  const [location, setLocation] = useState("");
  const [proximity, setProximity] = useState("");
  const [education, setEducation] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [resume, setResume] = useState(EMPTY_RESUME);
  const [draftResume, setDraftResume] = useState(EMPTY_RESUME);
  const [resumeSaved, setResumeSaved] = useState(false);
  const [resumeFile, setResumeFile] = useState(null); // { fileName } once an uploaded file is on record
  const [resumeFileBusy, setResumeFileBusy] = useState(false);
  const resumeFileInputRef = useRef(null);
  const [editingResume, setEditingResume] = useState(false);
  const [resumePreviewOpen, setResumePreviewOpen] = useState(false);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [hasProfile, setHasProfile] = useState(true);
  const [detailsJob, setDetailsJob] = useState(null);
  const [confirmJob, setConfirmJob] = useState(null);

  const [partnerJobs, setPartnerJobs] = useState([]);
  const [partnerJobsLoading, setPartnerJobsLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState("all"); // "all" | "partner" | "careerjet"

  const [view, setView] = useState("recommended"); // "recommended" | "saved" | "applications"
  const [savedJobs, setSavedJobs] = useState([]);
  const savedUrls = new Set(savedJobs.map(j => j.url));

  const [applications, setApplications] = useState([]);
  const appliedUrls = new Set(applications.map(a => a.url));

  const [jobAlertsEnabled, setJobAlertsEnabled] = useState(true);

  function runSearch(keywords = search, type = jobType, filters = {}) {
    const nextLocation = filters.location ?? location;
    if (keywords.trim() && !HAS_ALNUM_RE.test(keywords)) {
      setError("Please enter a real job title, company, or skill — not just symbols.");
      setJobs([]);
      return;
    }
    if (nextLocation.trim() && !HAS_ALNUM_RE.test(nextLocation)) {
      setError("Please enter a real city or province — not just symbols.");
      setJobs([]);
      return;
    }
    setLoading(true);
    setError("");
    const nextProximity = filters.proximity ?? proximity;
    const nextEducation = filters.education ?? education;
    apiFetch("/alumni/jobs/search", { params: { keywords, type, location: nextLocation, proximity: nextProximity, education: nextEducation } })
      .then((d) => { setJobs(d.jobs || []); setUnavailable(!!d.unavailable); setHasProfile(d.hasProfile !== false); setProfileLocation(d.profileLocation || ""); })
      .catch(() => setError("Could not load job listings right now."))
      .finally(() => setLoading(false));
  }

  function loadSavedJobs() {
    apiFetch("/alumni/jobs/saved").then((d) => setSavedJobs(d.jobs || [])).catch(() => {});
  }

  function loadPartnerJobs() {
    setPartnerJobsLoading(true);
    apiFetch("/alumni/jobs/partner-postings")
      .then((d) => setPartnerJobs(d.jobs || []))
      .catch(() => {})
      .finally(() => setPartnerJobsLoading(false));
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
    // getMyResume sends `resume: resume || {}` — a brand-new alumnus with
    // no saved resume AND no employment/tracer data to suggest from gets
    // back `{}`, which is truthy, so a bare `!d.resume` check doesn't catch
    // it. Checking for actual keys is what makes that case correctly leave
    // the (now genuinely empty) default state alone instead of treating an
    // empty object as "loaded data."
    apiFetch("/alumni/resume").then((d) => {
      setResumeSaved(!!d.isSaved);
      setResumeFile(d.resume?.fileName ? { fileName: d.resume.fileName } : null);
      if (!d.resume || Object.keys(d.resume).length === 0) return;
      const loaded = { ...EMPTY_RESUME };
      RESUME_FIELDS.forEach((key) => { if (d.resume[key] !== undefined) loaded[key] = d.resume[key]; });
      setResume(loaded);
      setDraftResume(loaded);
    }).catch(() => {});
  }

  function loadApplications() {
    apiFetch("/alumni/applications").then((d) => setApplications(d.applications || [])).catch(() => {});
  }

  // Fired the moment "Apply now" is clicked (card and details modal both) —
  // fire-and-forget alongside the actual navigation to Careerjet, so it
  // never blocks or interferes with the external link opening. Internal
  // (TSU partner) postings have no external tab opening to signal "yes,
  // that worked" the way Careerjet applies do, so this needs its own
  // explicit confirmation — shown once per job, not on a repeat click of
  // something already applied to.
  function logApply(job) {
    const alreadyApplied = appliedUrls.has(job.url);
    apiFetch("/alumni/applications", { method: "POST", body: job })
      .then((d) => {
        if (!d.application) return;
        setApplications((prev) => prev.some((a) => a.url === job.url) ? prev : [d.application, ...prev]);
        if (!alreadyApplied) showToast?.(job.internal ? `Applied to ${job.title}.` : `Marked ${job.title} as viewed. Finish applying on the employer's site.`);
      })
      .catch(() => showToast?.("Could not log your application. Please try again."));
  }

  function updateApplicationStatus(id, status) {
    setApplications((prev) => prev.map((a) => (a._id === id ? { ...a, status } : a)));
    apiFetch(`/alumni/applications/${id}/status`, { method: "PATCH", body: { status } }).catch(() => loadApplications());
  }

  function confirmApply() {
    if (!confirmJob) return;
    logApply(confirmJob);
    setConfirmJob(null);
  }

  function cancelApplication(app) {
    if (!window.confirm(`Cancel your application to ${app.title}? This removes it from your tracker.`)) return;
    setApplications((prev) => prev.filter((a) => a._id !== app._id));
    apiFetch(`/alumni/applications/${app._id}`, { method: "DELETE" })
      .then(() => showToast?.("Application cancelled."))
      .catch(() => { showToast?.("Could not cancel. Please try again."); loadApplications(); });
  }

  useEffect(() => { runSearch(search, jobType); loadSavedJobs(); loadPartnerJobs(); loadJobAlertsPref(); loadResume(); loadApplications(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Careerjet + TSU partner postings shown as one ranked list instead of two
  // stacked sections — partner postings used to end up buried below dozens
  // of Careerjet results with no way to jump straight to them.
  const combinedJobs = useMemo(() => {
    const tagged = [
      ...partnerJobs.map((j) => ({ ...j, source: "partner" })),
      ...jobs.map((j) => ({ ...j, source: "careerjet" })),
    ];
    return tagged.sort((a, b) => {
      const matchDiff = (b.match ?? -1) - (a.match ?? -1);
      if (matchDiff !== 0) return matchDiff;
      return new Date(b.posted || 0) - new Date(a.posted || 0);
    });
  }, [jobs, partnerJobs]);
  const recommendedResults = sourceFilter === "all" ? combinedJobs : combinedJobs.filter((j) => j.source === sourceFilter);
  const recommendedLoading = loading || partnerJobsLoading;

  const results = view === "saved" ? savedJobs : view === "applications" ? applications : recommendedResults;
  const descriptionBlocks = detailsJob ? structureDescription(detailsJob.description) : [];

  function toggleSave(job) {
    const wasSaved = savedUrls.has(job.url);
    apiFetch("/alumni/jobs/saved/toggle", { method: "POST", body: job })
      .then(() => setSavedJobs(prev => wasSaved ? prev.filter(j => j.url !== job.url) : [{ ...job, createdAt: new Date().toISOString() }, ...prev]))
      // A failed save used to be completely silent — the button's state
      // could disagree with what's actually saved server-side until the
      // next reload, with no indication anything went wrong.
      .catch(() => showToast?.("Could not update saved jobs. Please try again."));
  }

  const updateDraft = (key, value) => setDraftResume(prev => ({ ...prev, [key]: value }));
  const beginResumeEdit = () => { setDraftResume(resume); setEditingResume(true); };
  const cancelResumeEdit = () => { setDraftResume(resume); setEditingResume(false); };
  const saveResumeEdit = () => {
    setResume(draftResume);
    setEditingResume(false);
    setResumeSaved(true);
    apiFetch("/alumni/resume", { method: "PUT", body: draftResume }).catch(() => {});
  };
  const previewResume = editingResume ? draftResume : resume;

  function handleResumeFilePick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const okTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!okTypes.includes(file.type)) { showToast?.("Upload a PDF, DOC, or DOCX file."); return; }
    if (file.size > 4 * 1024 * 1024) { showToast?.("Resume file must be smaller than 4MB."); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      setResumeFileBusy(true);
      apiFetch("/alumni/resume/file", { method: "PUT", body: { fileData: e.target.result, fileName: file.name } })
        .then((d) => {
          setResumeFile({ fileName: d.resume?.fileName || file.name });
          setResumeSaved(true);
          showToast?.("Resume file uploaded.");
        })
        .catch((err) => showToast?.(err?.message || "Could not upload the file."))
        .finally(() => setResumeFileBusy(false));
    };
    reader.readAsDataURL(file);
  }

  function removeResumeFile() {
    if (!window.confirm("Remove your uploaded resume file?")) return;
    setResumeFileBusy(true);
    apiFetch("/alumni/resume/file", { method: "DELETE" })
      .then(() => { setResumeFile(null); showToast?.("Resume file removed."); })
      .catch(() => showToast?.("Could not remove the file."))
      .finally(() => setResumeFileBusy(false));
  }

  function deleteResume() {
    if (!window.confirm("Delete your saved resume and start over? This can't be undone.")) return;
    setResumeFileBusy(true);
    apiFetch("/alumni/resume", { method: "DELETE" })
      .then(() => {
        setResumeSaved(false);
        setResumeFile(null);
        setResume(EMPTY_RESUME);
        setDraftResume(EMPTY_RESUME);
        showToast?.("Resume deleted.");
      })
      .catch(() => showToast?.("Could not delete the resume."))
      .finally(() => setResumeFileBusy(false));
  }

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

  // A resume missing basic contact details or any skills isn't something an
  // employer can actually act on — export is blocked until these are filled
  // in, rather than letting an unusably-thin file go out.
  function validateResumeForExport(value) {
    const missing = [];
    if (!value.phone?.trim())    missing.push("Phone");
    if (!value.address?.trim())  missing.push("Address");
    if (!String(value.skills || "").trim()) missing.push("Key Skills");
    if (!missing.length) return "";
    return `Please fill in the following before exporting your resume: ${missing.join(", ")}.`;
  }

  function exportResumeAs(format) {
    setExportMenuOpen(false);
    const error = validateResumeForExport(resume);
    if (error) { showToast?.(error); return; }
    if (format === "pdf") downloadResumePdf(resume);
    else downloadResumeDoc(resume);
  }

  return <div className="alumni-page-content job-connect-page">
    <section className="job-connect-hero">
      <img className="job-connect-hero-logo" src={jobConnectLogo} alt="JobConnect" />
      <div className="job-connect-hero-copy"><span>Opportunities for TSU alumni</span><h1>Find your next opportunity</h1><p>Discover roles matched to your profile, experience, and career interests.</p></div>
      <button type="button" className={`job-alerts-toggle${jobAlertsEnabled ? " on" : ""}`} onClick={toggleJobAlerts}>Job alerts: {jobAlertsEnabled ? "On" : "Off"}</button>
    </section>

    <section className="job-search-bar">
      <label><SearchIcon /><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && runSearch()} placeholder="Search job title, company, or skill" /></label>
      <label className="job-location-filter"><span>⌖</span><input value={location} onChange={e => setLocation(e.target.value)} onKeyDown={e => e.key === "Enter" && runSearch()} placeholder="City or province" /></label>
      <select value={proximity} onChange={e => { const value = e.target.value; setProximity(value); runSearch(search, jobType, { proximity: value }); }} aria-label="Distance from profile location">
        <option value="">Any distance</option>
        <option value="nearby">Nearby my profile location</option>
        <option value="far">Far from my profile location</option>
      </select>
      <select value={education} onChange={e => { const value = e.target.value; setEducation(value); runSearch(search, jobType, { education: value }); }} aria-label="Educational attainment required">
        <option value="">Any educational attainment</option>
        <option value="high-school">High school</option>
        <option value="vocational">Vocational / Technical</option>
        <option value="bachelor">Bachelor's degree</option>
        <option value="master">Master's degree</option>
        <option value="doctorate">Doctorate</option>
      </select>
      <select value={jobType} onChange={e => { const value = e.target.value; setJobType(value); runSearch(search, value); }}>
        <option value="">All types</option>
        <option value="full-time">Full-time</option>
        <option value="part-time">Part-time</option>
        <option value="permanent">Permanent</option>
        <option value="contract">Contract</option>
        <option value="temporary">Temporary</option>
        <option value="internship">Internship/Training</option>
        <option value="volunteer">Volunteer</option>
      </select>
      <button type="button" onClick={() => runSearch()} disabled={loading}>{loading ? "Searching…" : "Search Jobs"}</button>
    </section>
    {(proximity || location) && <p className="job-filter-note">{proximity && !profileLocation ? "Add your location in Alumni Profile to use the nearby/far filter. " : ""}{profileLocation && proximity ? `Distance is based on your saved profile location: ${profileLocation}. ` : ""}{location ? `Searching jobs in ${location}.` : ""}</p>}

    <div className="job-stats">
      <div className="job-stat-clickable" onClick={() => setView("recommended")}><strong>{jobs.length}</strong><span>Recommended jobs</span></div>
      <div className="job-stat-clickable" onClick={() => setView("saved")}><strong>{savedJobs.length}</strong><span>Saved jobs</span></div>
    </div>

    <div className="job-connect-layout">
      <main>
        <div className="job-list-head">
          <div>
            <span>{view === "saved" ? "Your bookmarks" : view === "applications" ? "Your progress" : "Personalized matches"}</span>
            <h2>{view === "saved" ? "Saved Jobs" : view === "applications" ? "Your Applications" : "Recommended for You"}</h2>
          </div>
          {view !== "recommended" ? (
            <button type="button" className="job-view-toggle" onClick={() => setView("recommended")}>Back to Recommended</button>
          ) : (
            <b>{results.length} results</b>
          )}
        </div>

        {view === "recommended" && (
          <div className="job-source-filter" role="tablist" aria-label="Filter by job source">
            <button type="button" role="tab" aria-selected={sourceFilter === "all"} className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>All Jobs ({combinedJobs.length})</button>
            <button type="button" role="tab" aria-selected={sourceFilter === "partner"} className={sourceFilter === "partner" ? "active" : ""} onClick={() => setSourceFilter("partner")}>TSU Partner Companies ({partnerJobs.length})</button>
            <button type="button" role="tab" aria-selected={sourceFilter === "careerjet"} className={sourceFilter === "careerjet" ? "active" : ""} onClick={() => setSourceFilter("careerjet")}>Careerjet ({jobs.length})</button>
          </div>
        )}

        {view === "recommended" && error && <div className="job-empty"><b>{error}</b><span>{error.startsWith("Please enter") ? "Update your search and try again." : "Try searching again in a moment."}</span></div>}
        {view === "recommended" && !error && unavailable && sourceFilter !== "partner" && <div className="job-empty"><b>Job search is temporarily unavailable</b><span>Careerjet isn't configured or didn't respond — please try again later.</span></div>}
        {view === "recommended" && !error && recommendedLoading && <div className="job-empty"><b>Loading jobs…</b><span>Fetching recommended postings.</span></div>}
        {view === "recommended" && !error && !recommendedLoading && !results.length && !search.trim() && !hasProfile && (
          <div className="job-empty"><b>Complete your Employment Details</b><span>Add your job title and skills so we can recommend jobs that actually match you.</span></div>
        )}
        {view === "recommended" && !error && !recommendedLoading && !results.length && (search.trim() || hasProfile) && (
          <div className="job-empty"><b>No matching jobs found</b><span>Try another search, employment type, or source filter.</span></div>
        )}
        {view === "saved" && !results.length && (
          <div className="job-empty"><b>No saved jobs yet</b><span>Click "Save" on a job to bookmark it here.</span></div>
        )}
        {view === "applications" && !results.length && (
          <div className="job-empty"><b>No applications yet</b><span>Clicking "Apply now" on a job logs it here automatically.</span></div>
        )}

        {((view === "recommended" && !error && !recommendedLoading) || view === "saved") && !!results.length && (
          <div className="job-connect-list">
            {results.map(job => <JobCard key={job.url || job.title} job={job} saved={savedUrls.has(job.url)} applied={appliedUrls.has(job.url)} onToggleSave={() => toggleSave(job)} onViewDetails={() => setDetailsJob(job)} onApply={() => job.internal ? setConfirmJob(job) : logApply(job)} />)}
          </div>
        )}
        {view === "applications" && !!results.length && (
          <div className="job-connect-list">
            {results.map(app => <ApplicationCard key={app._id || app.url} app={app} onStatusChange={(status) => updateApplicationStatus(app._id, status)} onViewDetails={() => setDetailsJob(app)} onCancel={() => cancelApplication(app)} />)}
          </div>
        )}
      </main>

      <aside className="job-connect-side">
        <section className="application-tracker resume-creation">
          <div><span>Resume tools</span><h2>Resume Creation</h2></div>
          <input ref={resumeFileInputRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={handleResumeFilePick} />
          {resumeFile ? (
            <div className="resume-file-card">
              <ResumeFileIcon />
              <div><b>{resumeFile.fileName}</b><span>Uploaded resume — employers see this file.</span></div>
            </div>
          ) : resumeSaved ? (
            <ResumePreview resume={resume} />
          ) : (
            <div className="resume-empty">
              <b>No resume yet</b>
              <p>Create a resume from your alumni profile, or upload a PDF/DOC/DOCX file. Employers see it on every application.</p>
            </div>
          )}
          <div className={`resume-actions${resumeFile ? " resume-actions--two" : !resumeSaved ? " resume-actions--stack" : ""}`}>
            {resumeFile ? (
              <>
                <button className="resume-edit" type="button" disabled={resumeFileBusy} onClick={() => resumeFileInputRef.current?.click()}><ResumeEditIcon />{resumeFileBusy ? "Working…" : "Replace file"}</button>
                <button className="resume-edit" type="button" disabled={resumeFileBusy} onClick={removeResumeFile}><ResumeCloseIcon />Remove file</button>
              </>
            ) : !resumeSaved ? (
              <>
                <button className="resume-edit" type="button" onClick={beginResumeEdit}><ResumeEditIcon />Create a resume</button>
                <button className="resume-export" type="button" disabled={resumeFileBusy} onClick={() => resumeFileInputRef.current?.click()}><ResumeExportIcon />{resumeFileBusy ? "Uploading…" : "Upload a resume"}</button>
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
          {!editingResume && !resumeFile && resumeSaved && (
            <div className="resume-secondary-links">
              <button type="button" disabled={resumeFileBusy} onClick={() => resumeFileInputRef.current?.click()}>{resumeFileBusy ? "Working…" : "Upload a file instead"}</button>
              <button type="button" className="danger" disabled={resumeFileBusy} onClick={deleteResume}>Delete resume</button>
            </div>
          )}
          {!editingResume && resumeFile && (
            <button type="button" className="resume-upload-link danger" disabled={resumeFileBusy} onClick={deleteResume}>Delete resume &amp; start over</button>
          )}
        </section>
        <section className="job-tip-card"><b>Resume tip</b><p>Keep your resume updated before exporting so employers see your latest skills, projects, and experience.</p></section>
      </aside>
    </div>
    {resumePreviewOpen && ReactDOM.createPortal(
      <div className="resume-preview-overlay" role="dialog" aria-modal="true" aria-label="Resume preview">
        <div className="resume-preview-modal">
          <div className="resume-preview-modal-head">
            <div><span>Resume preview</span><h2>{previewResume.name}</h2></div>
            <button type="button" onClick={() => setResumePreviewOpen(false)} aria-label="Close preview"><ResumeCloseIcon /></button>
          </div>
          <ResumePreview resume={previewResume} mode="modal" />
        </div>
      </div>,
      document.body
    )}
    {/* Editing used to happen inline in the narrow sidebar card — cramped
        inputs, tiny font, and nothing like what the resume would actually
        look like. Editing now happens in the same width/point-of-view as
        the preview modal (reusing .resume-preview-modal), so filling in a
        field looks and feels like editing the real document instead of a
        squeezed side form. */}
    {editingResume && ReactDOM.createPortal(
      <div className="resume-preview-overlay" role="dialog" aria-modal="true" aria-label="Resume editor">
        <div className="resume-preview-modal resume-editor-modal">
          <div className="resume-preview-modal-head">
            <div><span>Resume tools</span><h2>Resume Creation</h2></div>
            <button type="button" onClick={cancelResumeEdit} aria-label="Close editor"><ResumeCloseIcon /></button>
          </div>
          <ResumeEditor value={draftResume} onChange={updateDraft} />
          <div className="resume-editor-modal-actions">
            <button className="resume-preview-btn" type="button" onClick={() => setResumePreviewOpen(true)}><ResumePreviewIcon />Preview</button>
            <button className="resume-edit" type="button" onClick={cancelResumeEdit}><ResumeCloseIcon />Cancel</button>
            <button className="resume-export" type="button" onClick={saveResumeEdit}><ResumeCheckIcon />Save</button>
          </div>
        </div>
      </div>,
      document.body
    )}
    {/* Rendered via a portal straight onto <body> — nested inside the page's
        own scroll container, these used to inherit whatever scroll position
        an ancestor happened to be at instead of staying fixed to the actual
        browser viewport the alumnus is looking at. */}
    {detailsJob && ReactDOM.createPortal(
      <div className="resume-preview-overlay" role="dialog" aria-modal="true" aria-label="Job details">
        <div className="resume-preview-modal job-details-modal">
          <div className="resume-preview-modal-head">
            <div><span>{detailsJob.company}</span><h2>{detailsJob.title}</h2></div>
            <button type="button" onClick={() => setDetailsJob(null)} aria-label="Close details"><ResumeCloseIcon /></button>
          </div>
          <div className="job-details-body">
            <p className="job-details-meta">
              {[detailsJob.location, detailsJob.type, detailsJob.posted && `Posted ${formatPostedDate(detailsJob.posted)}`].filter(Boolean).join(" · ")}
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
                <b>Job Match</b>
                <span className="skill-match-ratio">{detailsJob.skills.filter(s => s.matched).length} of {detailsJob.skills.length} skills matched</span>
                <div>{[...detailsJob.skills].sort((a, b) => Number(b.matched) - Number(a.matched)).map(skill => <span key={skill.name} className={skill.matched ? "skill-have" : "skill-missing"}>{skill.name}</span>)}</div>
              </div>
            )}
          </div>
          {/* Kept outside the scrollable .job-details-body so the primary
              action is always visible on screen, never something the alumnus
              has to scroll a long description to find. */}
          <div className="job-details-footer">
            <a className="apply-job job-details-apply" href={detailsJob.url} target="_blank" rel="noopener noreferrer" onClick={() => logApply(detailsJob)}>Apply now on Careerjet <ArrowIcon /></a>
          </div>
        </div>
      </div>,
      document.body
    )}
    {confirmJob && ReactDOM.createPortal(
      <div className="resume-preview-overlay" role="dialog" aria-modal="true" aria-label="Confirm application">
        <div className="resume-preview-modal apply-confirm-modal">
          <div className="resume-preview-modal-head">
            <div><span>Confirm application</span><h2>{confirmJob.title}</h2></div>
            <button type="button" onClick={() => setConfirmJob(null)} aria-label="Close"><ResumeCloseIcon /></button>
          </div>
          <div className="apply-confirm-body">
            <p className="apply-confirm-meta">
              {confirmJob.company}{[confirmJob.location, confirmJob.type].filter(Boolean).length ? ` · ${[confirmJob.location, confirmJob.type].filter(Boolean).join(" · ")}` : ""}
              {typeof confirmJob.match === "number" ? ` · ${confirmJob.match}% match` : ""}
            </p>
            <p className="apply-confirm-note">This resume will be sent to the employer. Update it under Resume tools first if anything is out of date.</p>
            <div className="apply-confirm-resume">
              {resumeFile
                ? <div className="resume-file-card"><ResumeFileIcon /><div><b>{resumeFile.fileName}</b><span>Your uploaded resume file.</span></div></div>
                : <ResumePreview resume={resume} />}
            </div>
          </div>
          <div className="resume-actions apply-confirm-actions">
            <button className="resume-edit" type="button" onClick={() => setConfirmJob(null)}><ResumeCloseIcon />Cancel</button>
            <button className="resume-export" type="button" onClick={confirmApply}><ResumeCheckIcon />Confirm application</button>
          </div>
        </div>
      </div>,
      document.body
    )}
  </div>;
}


const APPLICATION_STATUSES = ["Applied", "Interview Scheduled", "Offer Received", "Rejected", "Withdrawn"];

function ApplicationCard({ app, onStatusChange, onViewDetails, onCancel }) {
  const description = descriptionPreview(app.description, 220);
  const hasMatch = app.match !== null && app.match !== undefined;
  return <article className="connect-job-card">
    <div className={`job-match-panel${hasMatch ? "" : " job-match-panel--empty"}`}>
      {hasMatch ? (
        <div className="job-match-score"><strong>{app.match}%</strong><span>Match</span></div>
      ) : (
        <span>No match score</span>
      )}
    </div>
    <div className="connect-job-main">
      <span className="connect-posted">Applied {formatSavedDate(app.appliedAt || app.createdAt)}</span>
      <div className="connect-job-title">
        <div><h3>{app.title}</h3><p>{app.company}<br />{[app.location, app.type].filter(Boolean).join(" | ")}</p></div>
        <select className="application-status-select" value={app.status} onChange={e => onStatusChange(e.target.value)} aria-label="Application status">
          {APPLICATION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {description && <p className="connect-job-description">{description}</p>}
      <div className="connect-card-buttons">
        <a className="apply-job" href={app.url} target="_blank" rel="noopener noreferrer">View posting</a>
        <button className="view-job" type="button" onClick={onViewDetails}>See details <ArrowIcon /></button>
        <button className="cancel-application" type="button" onClick={onCancel}>Cancel application</button>
      </div>
      <small className="job-partner">via Careerjet</small>
    </div>
    {app.skills?.length > 0 && (() => {
      const sorted = [...app.skills].sort((a, b) => Number(b.matched) - Number(a.matched));
      const shown = sorted.slice(0, SKILL_CHIP_LIMIT);
      const hidden = sorted.length - shown.length;
      return (
        <aside className="connect-skill-gap">
          <b>Job Match</b>
          <span className="skill-match-ratio">{app.skills.filter(s => s.matched).length} of {app.skills.length} skills matched</span>
          <div>
            {shown.map(skill => <span key={skill.name} className={skill.matched ? "skill-have" : "skill-missing"}>{skill.name}</span>)}
            {hidden > 0 && <span className="skill-more">+{hidden} more</span>}
          </div>
          <small>Based on your profile as of when you applied.</small>
        </aside>
      );
    })()}
  </article>;
}

// Exported so the employer side (EmployerApplicants.jsx's resume viewer)
// renders an applicant's resume with the exact same component instead of
// its own separately hand-rolled markup — the two had drifted apart (no
// skill chips/columns, no section accent styling on the employer side)
// even though they're displaying the same underlying resume data.
// Splits a flat skills list the same way Employment Details' own profile
// view already does (see AlumniEmploymentDetails.jsx's skillGroups) —
// Technical/Domain first, then Soft, then anything classifySkill can't
// place in either.
function splitSkills(skillsValue) {
  const skillLines = String(skillsValue || "").split("\n").map((line) => line.trim()).filter(Boolean);
  return [
    ["Technical Skills", skillLines.filter((s) => classifySkill(s) === "hard")],
    ["Soft Skills", skillLines.filter((s) => classifySkill(s) === "soft")],
    ["Other", skillLines.filter((s) => classifySkill(s) === "other")],
  ].filter(([, items]) => items.length);
}

export function ResumePreview({ resume, mode = "card" }) {
  const lines = (value) => String(value || "").split("\n").map(line => line.trim()).filter(Boolean);
  const skillGroups = splitSkills(resume.skills);
  const experience = Array.isArray(resume.experience) ? resume.experience : [];
  return <div className={`resume-preview ${mode === "modal" ? "resume-preview-full" : ""}`} aria-label="Resume preview">
    <div className="resume-contact">
      {resume.avatarUrl && <div className="resume-photo"><img src={resume.avatarUrl} alt="" /></div>}
      <div className="resume-contact-text">
        <strong>{resume.name}</strong>
        <p>{[resume.address, resume.phone, resume.email, resume.linkedin].filter(Boolean).join(" | ")}</p>
      </div>
    </div>
    <ResumeSection title="Professional Summary" show={resume.summary}><p>{resume.summary}</p></ResumeSection>
    <ResumeSection title="Key Skills" show={skillGroups.length}>
      <div className="resume-skills-columns">
        {skillGroups.map(([groupLabel, items]) => (
          <div className="resume-skills-col" key={groupLabel}>
            <h4>{groupLabel}</h4>
            <ul className="resume-skills-list">{items.map(item => <li key={item}>{item}</li>)}</ul>
          </div>
        ))}
      </div>
    </ResumeSection>
    <ResumeSection title="Professional Experience" show={experience.length}>
      {experience.map((entry, i) => (
        <div className="resume-entry" key={i}>
          <b className="resume-entry-title">{[entry.title, entry.company].filter(Boolean).join(" - ")}{entry.employment_type ? ` (${entry.employment_type})` : ""}</b>
          {entry.meta && <p className="resume-entry-meta">{entry.meta}</p>}
          {entry.description && <ul>{lines(entry.description).map((item, j) => <li key={j}>{item}</li>)}</ul>}
        </div>
      ))}
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
    {/* Professional experience is no longer typed here — it's built from
        the current job + Work History entries in Employment Details (same
        auto-sync as name/email/phone above it), so an editable textarea
        here would just get silently overwritten on the next load. */}
    <div className="resume-experience-note">
      <span>Professional experience</span>
      <p>Pulled automatically from your current job and Work History — update those under Employment Details.</p>
    </div>
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

function ResumeFileIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>;
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

  const skillGroups = splitSkills(resume.skills);
  const skillsHtml = `<div class="skills-columns">${skillGroups.map(([groupLabel, items]) => `
    <div class="skills-col"><h4>${escapeHtml(groupLabel)}</h4><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
  `).join("")}</div>`;

  // Mirrors ResumePreview: each entry is its own title/meta/bullet block
  // instead of one flattened list — a bare bullet list loses which company
  // a bullet point actually belongs to once there's more than one job.
  const experience = Array.isArray(resume.experience) ? resume.experience : [];
  const experienceHtml = experience.map((entry) => {
    const titleLine = [entry.title, entry.company].filter(Boolean).join(" - ") + (entry.employment_type ? ` (${entry.employment_type})` : "");
    return `
      <div class="entry">
        <p class="entry-title">${escapeHtml(titleLine)}</p>
        ${entry.meta ? `<p class="entry-meta">${escapeHtml(entry.meta)}</p>` : ""}
        ${entry.description ? bulletList(entry.description) : ""}
      </div>
    `;
  }).join("");

  // Mirrors ResumeSection's `show` prop — an empty field's heading doesn't
  // get printed at all, same as the on-screen preview.
  const section = (title, show, bodyHtml) => (show ? `<div class="section"><h2>${escapeHtml(title)}</h2>${bodyHtml}</div>` : "");
  const contactLine = [resume.address, resume.phone, resume.email, resume.linkedin].filter(Boolean).join(" | ");
  const photoHtml = resume.avatarUrl ? `<img class="photo" src="${resume.avatarUrl}" alt="">` : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(resume.name || "Resume")}</title>
  <style>
    body { font-family: "Times New Roman", Times, serif; color: #252124; line-height: 1.5; margin: 40px; }
    h1 { margin: 0; color: #161315; font-size: 24px; font-weight: 700; }
    h2 { margin: 0 0 8px; padding-bottom: 5px; border-bottom: 1px solid #e6dee1; color: #242024; font-size: 15px; font-weight: 700; }
    h4 { margin: 0 0 4px; color: #4a1420; font-size: 12px; font-weight: 700; }
    p { margin: 4px 0; color: #4d474a; font-size: 13px; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 4px 0; color: #4d474a; font-size: 13px; line-height: 1.5; }
    .contact { display: flex; align-items: center; gap: 18px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #d9d1d4; }
    .contact-text { flex: 1 1 auto; text-align: center; }
    .contact p { margin: 4px 0 0; }
    .photo { flex: 0 0 auto; width: 84px; height: 84px; border-radius: 50%; object-fit: cover; }
    .section { margin-top: 18px; }
    .entry { margin-bottom: 12px; }
    .entry:last-child { margin-bottom: 0; }
    .entry-title { margin: 0 0 2px; color: #242024; font-size: 13px; font-weight: 700; }
    .entry-meta { margin: 0 0 6px; color: #6f6267; font-size: 11.5px; font-style: italic; }
    .skills-columns { display: flex; flex-wrap: wrap; gap: 18px; }
    .skills-col { flex: 1 1 160px; }
    @media print { body { margin: 0.5in; } }
  </style>
</head>
<body>
  <section class="contact">
    ${photoHtml}
    <div class="contact-text">
      <h1>${escapeHtml(resume.name)}</h1>
      <p>${escapeHtml(contactLine)}</p>
    </div>
  </section>
  ${section("Professional Summary", resume.summary, `<p>${escapeHtml(resume.summary)}</p>`)}
  ${section("Key Skills", skillGroups.length, skillsHtml)}
  ${section("Professional Experience", experience.length, experienceHtml)}
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
// jsPDF's addImage needs an explicit format string it won't infer for you —
// derived from the data: URI's MIME type. GIF isn't one of jsPDF's
// supported embed formats, so a GIF avatar (AlumniEmploymentDetails.jsx's
// uploader accepts one) falls through to null and the photo is silently
// skipped rather than throwing and failing the whole export.
function pdfImageFormat(dataUri) {
  const match = /^data:image\/(png|jpeg|jpg|webp)/i.exec(dataUri || "");
  if (!match) return null;
  const type = match[1].toLowerCase();
  return type === "png" ? "PNG" : type === "webp" ? "WEBP" : "JPEG";
}

function downloadResumePdf(resume) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const FONT = "times";
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

  function paragraph(text, width = contentWidth, x = marginX) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(11);
    doc.setTextColor(77, 71, 74);
    doc.splitTextToSize(text, width).forEach((line) => {
      ensureSpace(15);
      doc.text(line, x, y);
      y += 15;
    });
  }

  function bullets(items, width = contentWidth, x = marginX) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(11);
    doc.setTextColor(77, 71, 74);
    items.forEach((item) => {
      doc.splitTextToSize(item, width - 14).forEach((line, i) => {
        ensureSpace(15);
        doc.text(i === 0 ? `•  ${line}` : `    ${line}`, x, y);
        y += 15;
      });
    });
  }

  function sectionHeading(title) {
    ensureSpace(26);
    doc.setFont(FONT, "bold");
    doc.setFontSize(13);
    doc.setTextColor(36, 32, 36);
    doc.text(title, marginX, y);
    y += 4;
    doc.setDrawColor(230, 222, 225);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 15;
  }

  function section(title, show, renderBody) {
    if (!show) return;
    sectionHeading(title);
    renderBody();
    y += 8;
  }

  const lines = (value) => String(value || "").split("\n").map((l) => l.trim()).filter(Boolean);

  // Photo on the side (left) with name + contact centered in whatever width
  // remains next to it — same layout as the HTML/Word export and the
  // in-app preview's .resume-contact flex row.
  const photoSize = 64;
  const photoFormat = resume.avatarUrl ? pdfImageFormat(resume.avatarUrl) : null;
  const hasPhoto = !!photoFormat;
  const textX = hasPhoto ? marginX + photoSize + 18 : marginX;
  const textWidth = pageWidth - marginX - textX;
  const textCenterX = textX + textWidth / 2;

  doc.setFont(FONT, "normal");
  doc.setFontSize(10.5);
  const contactLine = [resume.address, resume.phone, resume.email, resume.linkedin].filter(Boolean).join("   |   ");
  const contactWrapped = doc.splitTextToSize(contactLine, textWidth);
  const textBlockHeight = 24 + contactWrapped.length * 13;
  const headerHeight = hasPhoto ? Math.max(photoSize, textBlockHeight) : textBlockHeight;
  const headerTop = y;

  if (hasPhoto) {
    try { doc.addImage(resume.avatarUrl, photoFormat, marginX, headerTop, photoSize, photoSize); } catch { /* corrupt/unreadable image data — rest of the resume still generates */ }
  }

  doc.setFont(FONT, "bold");
  doc.setFontSize(21);
  doc.setTextColor(22, 19, 21);
  doc.text(resume.name || "", textCenterX, headerTop + 18, { align: "center" });

  doc.setFont(FONT, "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(77, 71, 74);
  doc.text(contactWrapped, textCenterX, headerTop + 40, { align: "center" });

  y = headerTop + headerHeight + 16;
  doc.setDrawColor(217, 209, 212);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 18;

  section("Professional Summary", resume.summary, () => paragraph(resume.summary));

  const skillGroups = splitSkills(resume.skills);
  section("Key Skills", skillGroups.length, () => {
    const colWidth = (contentWidth - 18 * (skillGroups.length - 1)) / skillGroups.length;
    const colTop = y;
    let maxColBottom = y;
    skillGroups.forEach(([groupLabel, items], i) => {
      const colX = marginX + i * (colWidth + 18);
      y = colTop;
      doc.setFont(FONT, "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(74, 20, 32);
      doc.text(groupLabel, colX, y);
      y += 14;
      bullets(items, colWidth, colX);
      maxColBottom = Math.max(maxColBottom, y);
    });
    y = maxColBottom;
  });

  const experience = Array.isArray(resume.experience) ? resume.experience : [];
  section("Professional Experience", experience.length, () => {
    experience.forEach((entry, i) => {
      if (i > 0) y += 6;
      const titleLine = [entry.title, entry.company].filter(Boolean).join(" - ") + (entry.employment_type ? ` (${entry.employment_type})` : "");
      ensureSpace(15);
      doc.setFont(FONT, "bold");
      doc.setFontSize(11.5);
      doc.setTextColor(36, 32, 36);
      doc.text(titleLine, marginX, y);
      y += 14;
      if (entry.meta) {
        ensureSpace(15);
        doc.setFont(FONT, "italic");
        doc.setFontSize(10);
        doc.setTextColor(111, 98, 103);
        doc.text(entry.meta, marginX, y);
        y += 15;
      }
      bullets(lines(entry.description));
    });
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
