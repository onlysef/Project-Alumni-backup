import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API, authHeaders } from "../../services/api.js";
import { Modal } from "../../components/common/Primitives.jsx";

export default function CareerRecommendation() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  function load() {
    setLoading(true);
    setError("");
    fetch(`${API}/alumni/career-recommendations`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setError("Could not load career recommendations right now."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const careers = data?.careers || [];
  const skillStrengths = data?.skillStrengths || [];
  const topCareer = careers[0];

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
            <p style={{ margin: "0 0 12px", color: "#76656a", fontSize: 12 }}>Add your skills in Employment Details to see your strengths here.</p>
          )}
          {skillStrengths.map((s) => <Skill key={s.name} name={s.name} value={s.value} />)}
          <div className="profile-tip"><b>Tip</b><p>Add certifications and recent projects to improve your recommendations.</p></div>
        </section>
        <section className="career-next">
          <h3>Suggested next step</h3>
          <p>
            {topCareer?.missing
              ? `Complete a course in ${topCareer.missing} to qualify for more ${topCareer.title} roles.`
              : "Keep your Employment Details up to date to get sharper career matches."}
          </p>
          <button type="button" onClick={() => navigate("/alumni/dashboard?section=employment")}>Update Employment Details</button>
        </section>
      </aside>
    </div>

    {selected && (
      <Modal open onClose={() => setSelected(null)}>
        <section className="tracer-modal coord-alumni-profile" role="dialog" aria-modal="true" aria-label="Career path details">
          <div className="modal-head">
            <h3>{selected.title}</h3>
            <button type="button" aria-label="Close" onClick={() => setSelected(null)}>×</button>
          </div>
          <dl className="coord-profile-details">
            <div><dt>Match</dt><dd>{selected.match}%</dd></div>
            <div><dt>About this path</dt><dd>{selected.text}</dd></div>
            <div><dt>Relevant skills</dt><dd>{selected.skills.join(", ")}</dd></div>
            {selected.missing && <div><dt>Skill to develop</dt><dd>{selected.missing}</dd></div>}
          </dl>
          <div className="modal-actions coord-profile-actions">
            <button type="button" onClick={() => setSelected(null)}>Close</button>
          </div>
        </section>
      </Modal>
    )}
  </div>;
}

function Skill({ name, value }) { return <div className="skill-meter"><div><span>{name}</span><b>{value}%</b></div><i><em style={{ width: `${value}%` }} /></i></div>; }
