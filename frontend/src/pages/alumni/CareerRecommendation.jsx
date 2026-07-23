import React from "react";

const careers = [
  { title: "Full-Stack Developer", match: 92, text: "Build complete web applications using modern frontend and backend technologies.", skills: ["React", "Node.js", "Databases"], missing: "Cloud deployment" },
  { title: "Software Engineer", match: 86, text: "Design, develop, and maintain reliable software systems for growing organizations.", skills: ["Java", "Python", "Git"], missing: "System design" },
  { title: "Data Analyst", match: 78, text: "Turn raw business data into useful reports, dashboards, and actionable insights.", skills: ["SQL", "Python", "Excel"], missing: "Power BI" },
];

export default function CareerRecommendation() {
  return <div className="alumni-page-content career-reco-page">
    <section className="career-hero"><div><span>Personalized for your profile</span><h1>Your Career Recommendations</h1><p>These paths are based on your education, employment history, skills, and alumni tracer profile.</p></div><div className="career-score"><strong>92%</strong><span>Profile complete</span></div></section>

    <div className="career-layout"><main><div className="career-section-title"><div><span>Best matches</span><h2>Recommended Career Paths</h2></div><button type="button">Refresh matches</button></div><div className="career-card-list">{careers.map((career, index) => <article className="career-card" key={career.title}><div className="career-rank">0{index + 1}</div><div className="career-card-body"><div className="career-card-head"><h3>{career.title}</h3><span>{career.match}% match</span></div><div className="career-progress"><i style={{ width: `${career.match}%` }} /></div><p>{career.text}</p><div className="career-skill-tags">{career.skills.map(skill => <span key={skill}>{skill}</span>)}</div><div className="career-gap"><b>Skill to develop:</b> {career.missing}</div></div><button className="career-details" type="button">View Path →</button></article>)}</div></main>

      <aside className="career-side"><section className="skills-profile"><div className="career-side-head"><span>Based on your profile</span><h2>Your Skill Strengths</h2></div><Skill name="Programming" value={90} /><Skill name="Web Development" value={84} /><Skill name="Database Management" value={76} /><Skill name="Communication" value={72} /><div className="profile-tip"><b>Tip</b><p>Add certifications and recent projects to improve your recommendations.</p></div></section><section className="career-next"><h3>Suggested next step</h3><p>Complete a cloud deployment course to qualify for more Full-Stack Developer roles.</p><button type="button">Explore Learning Resources</button></section></aside>
    </div>
  </div>;
}

function Skill({ name, value }) { return <div className="skill-meter"><div><span>{name}</span><b>{value}%</b></div><i><em style={{ width: `${value}%` }} /></i></div>; }
