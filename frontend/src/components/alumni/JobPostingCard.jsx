import React, { useEffect, useRef, useState } from "react";
import { API, authHeaders } from "../../services/api.js";

// Shared between Job Connect's own list and the Announcements page's "Job
// Postings" preview, so both surfaces render the exact same card instead of
// two hand-maintained designs drifting apart from each other.

export function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max).trim()}…` : value;
}

export function formatSavedDate(iso) {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Careerjet's `date` field comes back as a raw server timestamp string
// (e.g. "Sat, 15 Aug 2026 05:23:51 GMT") — shown as-is before, which meant
// job cards displayed that literal string instead of a readable date. Falls
// back to the raw value if it's ever unparseable rather than showing
// "Invalid Date".
export function formatPostedDate(value) {
  if (!value) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Careerjet's description field has no real structural markup — only
// inline <b> keyword-highlight tags — but the original paragraph/bullet
// boundaries survive as runs of 2+ raw spaces once tags are stripped, so
// that's the only signal available to rebuild readable structure from.
export function splitDescriptionSegments(value) {
  const withoutInlineTags = String(value || "").replace(/<\/?(b|strong|em|i)>/gi, "");
  const withoutOtherTags = withoutInlineTags.replace(/<[^>]*>/g, " ");
  return withoutOtherTags
    .split(/\s{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export const SECTION_HEADER_PATTERN = /^(key responsibilities|responsibilities|duties|required qualifications(\s*&?\s*experience)?|minimum qualifications|qualifications|preferred qualifications|key competencies|competencies|core competencies|requirements?|about (the )?(role|company|us|team)|benefits|perks|what you.ll (do|need)|what we.re looking for|why join us|job description|role overview|overview|primary details|skills|technical skills|soft skills|nice to have|good to have|education|experience|job summary|position summary|summary)\s*[:&]?\s*$/i;

export function isHeaderSegment(segment) {
  return SECTION_HEADER_PATTERN.test(segment);
}

// Groups the flat segment list into intro paragraphs, then bullet lists
// under whichever section header preceded them (postings are consistently
// shaped: intro text, then Header, then its bullet items, repeat).
export function structureDescription(value) {
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
export function descriptionPreview(value, max) {
  const segments = splitDescriptionSegments(value);
  const intro = [];
  for (const segment of segments) {
    if (isHeaderSegment(segment)) break;
    intro.push(segment);
  }
  const text = (intro.length ? intro : segments).join(" ");
  return truncate(text, max);
}

export function BookmarkIcon({ filled }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" style={{ fill: filled ? "currentColor" : "none" }}><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" /></svg>;
}

export function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
}

// Skill-gap tips are personalized per job (see backend getJobSkillTip) and
// each costs a real ~4s LLM call — a results page can list 20+ jobs at
// once, so fetching this the moment every card mounts would fire that many
// calls in parallel for no reason (most never get scrolled to). Instead
// each card only asks for its tip once it actually scrolls into view, and
// the result is cached by job URL so it isn't re-fetched if the same job
// scrolls in and out of view again, or appears in more than one list (Job
// Connect and the Announcements "Job Postings" preview share this card).
const skillTipCache = new Map();

function useSkillTip(job) {
  const [tip, setTip] = useState(() => skillTipCache.get(job.url) ?? null);
  const ref = useRef(null);
  const fetchedRef = useRef(skillTipCache.has(job.url));

  useEffect(() => {
    if (fetchedRef.current || !job.skills?.length || !ref.current) return undefined;
    const el = ref.current;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || fetchedRef.current) return;
      fetchedRef.current = true;
      observer.disconnect();
      const matched = job.skills.filter((s) => s.matched).map((s) => s.name);
      const missing = job.skills.filter((s) => !s.matched).map((s) => s.name);
      const params = new URLSearchParams({ title: job.title, matched: matched.join(","), missing: missing.join(",") });
      fetch(`${API}/alumni/jobs/skill-tip?${params}`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
          if (!d?.tip) return;
          skillTipCache.set(job.url, d.tip);
          setTip(d.tip);
        })
        .catch(() => {});
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- job.url stably identifies which job this is; re-running on every new job.skills/title array reference would tear down and rebuild the observer for no reason.
  }, [job.url]);

  return { tip, ref };
}

export function JobCard({ job, saved, applied, onToggleSave, onViewDetails, onApply }) {
  const description = descriptionPreview(job.description, 220);
  const { tip: skillTip, ref: skillGapRef } = useSkillTip(job);
  const hasMatch = job.match !== null && job.match !== undefined;
  return <article className="connect-job-card">
    <div className={`job-match-panel${hasMatch ? "" : " job-match-panel--empty"}`}>
      {hasMatch ? (
        <div className="job-match-score"><strong>{job.match}%</strong><span>Match</span></div>
      ) : (
        <span>No match score</span>
      )}
    </div>
    <div className="connect-job-main">
      {job.posted && <span className="connect-posted">Posted: {formatPostedDate(job.posted)}</span>}
      {job.createdAt && <span className="connect-posted connect-saved-date">Saved {formatSavedDate(job.createdAt)}</span>}
      <div className="connect-job-title"><div><h3>{job.title}</h3><p>{job.company}<br />{[job.location, job.type].filter(Boolean).join(" | ")}</p></div>{applied && <span className="connect-applied-badge">{job.internal ? "✓ Applied" : "✓ Viewed"}</span>}</div>
      {description && <p className="connect-job-description">{description}</p>}
      <div className="connect-card-buttons">
        {job.internal ? (
          <button className={`apply-job${applied ? " already-applied" : ""}`} type="button" onClick={onApply}>{applied ? "Applied ✓" : "Apply now"}</button>
        ) : (
          // External (Careerjet) postings only ever open the listing in a new
          // tab — the system has no way to confirm the alumnus actually
          // completed an application there, so it can't honestly claim
          // "Applied" the way it can for internal/partner postings (which do
          // create a real, employer-visible application record).
          <a className={`apply-job${applied ? " already-applied" : ""}`} href={job.url} target="_blank" rel="noopener noreferrer" onClick={onApply}>{applied ? "Viewed ✓" : "Apply now"}</a>
        )}
        <button className="view-job" type="button" onClick={onViewDetails}>See details <ArrowIcon /></button>
        {onToggleSave && (
          <button className={`connect-save-icon${saved ? " saved" : ""}`} type="button" onClick={onToggleSave} aria-label={saved ? "Remove from saved jobs" : "Save job"}>
            <BookmarkIcon filled={saved} /><span>{saved ? "Saved" : "Save"}</span>
          </button>
        )}
      </div>
      <small className="job-partner">{job.internal ? "Posted by a TSU partner employer" : "via Careerjet"}</small>
    </div>
    {job.skills?.length > 0 && (() => {
      const sorted = [...job.skills].sort((a, b) => Number(b.matched) - Number(a.matched));
      const have = job.skills.filter(s => s.matched).length;
      return (
        <aside className="connect-skill-gap" ref={skillGapRef}>
          <b>Job Match</b>
          <span className="skill-match-ratio">{have} of {job.skills.length} skills matched</span>
          <div>{sorted.map(skill => <span key={skill.name} className={skill.matched ? "skill-have" : "skill-missing"}>{skill.name}</span>)}</div>
          <small>
            {skillTip || (have ? "The green skills are already on your profile — add the rest to raise your match." : "None of these are on your profile yet — adding them raises your match.")}
            {job.createdAt && " (based on your profile as of when you saved this job)"}
          </small>
        </aside>
      );
    })()}
  </article>;
}
