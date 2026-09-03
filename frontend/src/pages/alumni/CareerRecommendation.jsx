import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API, authHeaders } from "../../services/api.js";
import { Modal } from "../../components/common/Primitives.jsx";

export default function CareerRecommendation() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nextStepLoading, setNextStepLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  function load() {
    setLoading(true);
    setError("");
    fetch(`${API}/alumni/career-recommendations`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        // The personalized "next step" sentence is a slow (~4s) AI call —
        // the main response above already comes back with a fast template
        // fallback for it so the career cards render immediately; this
        // fetches the personalized version in the background and swaps it
        // in once ready, without blocking anything the user is looking at.
        const topCareer = d?.careers?.[0];
        if (topCareer) {
          setNextStepLoading(true);
          const params = new URLSearchParams({ title: topCareer.title, match: topCareer.match });
          if (topCareer.missing) params.set("missing", topCareer.missing);
          fetch(`${API}/alumni/career-recommendations/next-step?${params}`, { headers: authHeaders() })
            .then((r) => r.json())
            .then((ns) => {
              if (ns?.nextStep) setData((prev) => (prev ? { ...prev, nextStep: ns.nextStep } : prev));
            })
            .catch(() => {})
            .finally(() => setNextStepLoading(false));
        }
      })
      .catch(() => setError("Could not load career recommendations right now."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const careers = data?.careers || [];
  const skillStrengths = data?.skillStrengths || [];

  return <div className="alumni-page-content career-reco-page">
    <section className="career-hero">
      <div><span>Personalized for your profile</span><h1>Your Career Recommendations</h1><p>These paths are based on your education, employment history, skills, and alumni tracer profile.</p></div>
      <div className="career-score">
        <div className="career-score-ring" style={{ "--pct": data?.profileCompleteness ?? 0 }}>
          <strong>{loading ? "…" : `${data?.profileCompleteness ?? 0}%`}</strong>
        </div>
        <span>Profile complete</span>
      </div>
    </section>

    <div className="career-layout">
      <main>
        <div className="career-section-title">
          <div><span>Best matches</span><h2>Recommended Career Paths</h2></div>
          <button type="button" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh matches"}</button>
        </div>

        {error && <div className="directory-empty"><b>{error}</b></div>}

        {!error && loading && <div className="directory-empty"><b>Loading recommendations…</b></div>}

        {!error && !loading && (
          <div className="career-card-list">
            {careers.map((career, index) => (
              <article className="career-card" key={career.title}>
                <div className="career-rank">0{index + 1}</div>
                <div className="career-card-body">
                  <div className="career-card-head"><h3>{career.title}</h3><span>{career.match}% match</span></div>
                  <div className="career-progress"><i style={{ width: `${career.match}%` }} /></div>
                  <p>{career.text}</p>
                  <div className="career-skill-tags">{career.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
                  {career.missing && <div className="career-gap"><b>Skill to develop:</b> {career.missing}</div>}
                </div>
                <button className="career-details" type="button" onClick={() => setSelected(career)}>View Path →</button>
              </article>
            ))}
          </div>
        )}
      </main>

      <aside className="career-side">
        <section className="skills-profile">
          <div className="career-side-head"><span>Based on your profile</span><h2>Your Skill Strengths</h2></div>
          {!loading && !data?.hasSkills && (
            <p style={{ margin: "0 0 12px", color: "#76656a", fontSize: 12 }}>Add your skills in your Alumni Profile to see your strengths here.</p>
          )}
          {skillStrengths.map((s) => <Skill key={s.name} name={s.name} value={s.value} matched={s.matched} />)}
          <div className="profile-tip"><b>Tip</b><p>Add certifications and recent projects to improve your recommendations.</p></div>
        </section>
        <section className="career-next">
          <h3>Suggested next step</h3>
          <p>{loading ? "Thinking about what would help most…" : (data?.nextStep || "Fill out your Alumni Profile to start getting career recommendations.")}</p>
          <button type="button" onClick={() => navigate("/alumni/dashboard?section=employment")}>Update Alumni Profile</button>
        </section>
      </aside>
    </div>

    {selected && (
      <Modal open onClose={() => setSelected(null)}>
        <section className="tracer-modal career-path-modal" role="dialog" aria-modal="true" aria-label="Career path details">
          <div className="modal-head">
            <h3>{selected.title}</h3>
            <button type="button" aria-label="Close" onClick={() => setSelected(null)}>×</button>
          </div>

          <div className="career-modal-body">
            <div className="career-modal-summary">
              <div className="career-modal-match">
                <div className="career-modal-match-ring" style={{ "--pct": selected.match }}>
                  <strong>{selected.match}%</strong>
                </div>
                <span>Overall match</span>
              </div>
              <div>
                <p>{selected.text}</p>
                {selected.industries?.length > 0 && (
                  <div className="career-modal-industries">
                    {selected.industries.map((i) => <span key={i}>{i}</span>)}
                  </div>
                )}
              </div>
            </div>

            <div className="career-modal-section">
              <h4>How this score is calculated</h4>
              <Skill name="Skills match (40%)" value={selected.breakdown.skills} />
              <Skill name="Education fit (20%)" value={selected.breakdown.education} />
              <Skill name="Experience level (30%)" value={selected.breakdown.experience} />
              <Skill name="Profile similarity (10%)" value={selected.breakdown.profileSimilarity} />
            </div>

            <div className="career-modal-section">
              <h4>
                Skills for this path
                <span className="career-modal-skill-count">{selected.allSkills.length - selected.missingCount}/{selected.allSkills.length} you have</span>
              </h4>
              <div className="career-skill-tags career-skill-tags-full">
                {selected.allSkills.map((s) => (
                  <span key={s.name} className={s.matched ? "skill-have" : "skill-missing"}>
                    {s.matched ? "✓" : "+"} {s.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="modal-actions coord-profile-actions">
            <button type="button" onClick={() => setSelected(null)}>Close</button>
          </div>
        </section>
      </Modal>
    )}
  </div>;
}

function Skill({ name, value, matched }) {
  return <div className="skill-meter">
    <div><span>{name}</span><b>{value}%</b></div>
    <i><em style={{ width: `${value}%` }} /></i>
    {matched?.length > 0 && <p className="skill-meter-list">{matched.join(", ")}</p>}
  </div>;
}
