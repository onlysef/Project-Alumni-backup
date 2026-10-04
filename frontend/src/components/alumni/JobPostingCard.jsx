import React, { useEffect, useRef, useState } from "react";
import { API, authHeaders } from "../../services/api.js";

export const SKILL_CHIP_LIMIT = 12;

export function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max).trim()}…` : value;
}

export function formatSavedDate(iso) {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Careerjet dates are raw server strings; fall back to the raw value if unparseable.
export function formatPostedDate(value) {
  if (!value) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Careerjet descriptions: runs of 2+ spaces mark the original paragraph/bullet breaks.
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

// Tips are slow LLM calls: fetch only once the card scrolls into view, cached by job URL.
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
          // External postings can't confirm an application, so they're never marked Applied.
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
      const shown = sorted.slice(0, SKILL_CHIP_LIMIT);
      const hidden = sorted.length - shown.length;
      const have = job.skills.filter(s => s.matched).length;
      return (
        <aside className="connect-skill-gap" ref={skillGapRef}>
          <b>Job Match</b>
          <span className="skill-match-ratio">{have} of {job.skills.length} skills matched</span>
          <div>
            {shown.map(skill => <span key={skill.name} className={skill.matched ? "skill-have" : "skill-missing"}>{skill.name}</span>)}
            {hidden > 0 && <span className="skill-more">+{hidden} more</span>}
          </div>
          <small>
            {skillTip || (have ? "The green skills are already on your profile — add the rest to raise your match." : "None of these are on your profile yet — adding them raises your match.")}
            {job.createdAt && " (based on your profile as of when you saved this job)"}
          </small>
        </aside>
      );
    })()}
  </article>;
}
