import React from "react";

export function CollegePill({ college }) {
  return <span className="college-pill">{college || "—"}</span>;
}

export function CoursePill({ course }) {
  const cls = String(course || "empty").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <span className={`coord-course-pill ${cls}`}>{course || "—"}</span>;
}

// TracerStudyResponse stores the raw form answer ("Yes"/"No"/"Never
// Employed"), not the Employment page's labels, so map both here.
const STATUS = {
  "Yes":            { label: "Employed",       cls: "employed" },
  "No":             { label: "Not Employed",   cls: "unemployed" },
  "Never Employed": { label: "Never Employed", cls: "never-employed" },
};

export function EmploymentStatusPill({ status }) {
  const s = STATUS[status] || { label: status || "Not Answered", cls: "not-yet-updated" };
  return <span className={`status-badge ${s.cls}`}>{s.label}</span>;
}
