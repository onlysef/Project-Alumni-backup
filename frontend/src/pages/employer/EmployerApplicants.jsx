import React, { useMemo, useState } from "react";
import Icon from "../../components/common/Icon";

const seedApplicants = [
  { id: 1, name: "Juan Dela Cruz", email: "j.delacruz@gmail.com", course: "BSIT", program: "CCS BSIT 2023 – 2024", date: "2026-04-10", position: "Web Developer", status: "New", age: 24, location: "Quezon City, Philippines", experience: "2 years", skills: ["Python", "Java", "PHP", "C++"], objective: "Motivated and detail-oriented Software Engineer with 2 years of experience in software development. Seeking to contribute technical skills and problem-solving abilities to a dynamic team, particularly in the field of Agritech solutions.", education: "Bachelor of Science in Information Technology (BSIT)", school: "College of Computer Studies (CCS)", academicYear: "2023–2024", jobHistory: [{ role: "Software Engineer", company: "Agritech Solutions" }, { role: "Junior Developer", company: "" }] },
  { id: 2, name: "Maria Suarez", email: "maria.suarez@gmail.com", course: "BSIT", program: "CCS BSIT 2023 – 2024", date: "2026-04-10", position: "UI / UX Designer", status: "Reviewed", age: 23, location: "Tarlac City, Philippines", experience: "2 years", skills: ["Figma", "Prototyping", "UI Design"], objective: "Creative UI/UX designer focused on accessible, user-centered digital experiences and thoughtful product design.", education: "Bachelor of Science in Information Technology (BSIT)", school: "College of Computer Studies (CCS)", academicYear: "2023–2024", jobHistory: [{ role: "Junior UI Designer", company: "Pixel House Studio" }, { role: "Design Intern", company: "TSU Creative Lab" }] },
  { id: 3, name: "Angela Reyes", email: "angela.reyes@gmail.com", course: "BSCS", program: "CCS BSCS 2022 – 2023", date: "2026-04-09", position: "Web Developer", status: "Shortlisted", age: 25, location: "Capas, Tarlac", experience: "3 years", skills: ["JavaScript", "Python", "SQL"], objective: "Software developer experienced in building reliable web applications and collaborating with cross-functional teams.", education: "Bachelor of Science in Computer Science (BSCS)", school: "College of Computer Studies (CCS)", academicYear: "2022–2023", jobHistory: [{ role: "Frontend Developer", company: "Northstar Digital" }, { role: "Web Developer", company: "Freelance" }] },
  { id: 4, name: "Paolo Santos", email: "paolo.santos@gmail.com", course: "BSIS", program: "CCS BSIS 2023 – 2024", date: "2026-04-08", position: "IT Support Specialist", status: "New", age: 24, location: "Concepcion, Tarlac", experience: "2 years", skills: ["Networking", "Hardware", "Windows"], objective: "Resourceful IT support specialist with hands-on experience maintaining devices, networks, and office systems.", education: "Bachelor of Science in Information Systems (BSIS)", school: "College of Computer Studies (CCS)", academicYear: "2023–2024", jobHistory: [{ role: "IT Support Technician", company: "Central Luzon Services" }, { role: "Technical Support Intern", company: "TSU MIS Office" }] },
];

function ApplicantPortrait() {
  return <div className="applicant-portrait" aria-hidden="true"><svg viewBox="0 0 88 88"><circle cx="44" cy="44" r="42" fill="#58b9e8"/><path d="M17 75c4-15 15-23 27-23s23 8 27 23c-8 7-17 11-27 11S25 82 17 75Z" fill="#27375a"/><path d="M32 50l12 10 12-10 8 8-7 25H31l-7-25 8-8Z" fill="#fff"/><path d="M32 50l12 10 12-10 5 5-8 18H35l-8-18 5-5Z" fill="#dfe6ee"/><path d="M31 28c1-12 8-19 19-17 8 2 11 9 9 20-1 9-7 19-15 19S31 39 31 28Z" fill="#f0a06a"/><path d="M29 31c-4-8 0-20 9-23 4-5 15-3 19 3 7 3 9 12 4 19l-4-9-5-5c-4 5-11 7-20 8l-3 7Z" fill="#202b45"/><path d="M36 72h16l3 13H33l3-13Z" fill="#e7af31"/></svg></div>;
}

function shortDate(value) {
  const [year, month, day] = value.split("-");
  return `${month}-${day}-${year}`;
}

export default function EmployerApplicants() {
  const [applicants, setApplicants] = useState(seedApplicants);
  const [position, setPosition] = useState("All");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [resumeApplicant, setResumeApplicant] = useState(null);

  const positions = [...new Set(applicants.map((item) => item.position))];
  const filtered = useMemo(() => applicants.filter((item) => {
    const query = search.trim().toLowerCase();
    return (position === "All" || item.position === position)
      && (status === "All" || item.status === status)
      && (!query || `${item.name} ${item.course} ${item.position} ${item.email}`.toLowerCase().includes(query));
  }), [applicants, position, status, search]);

  function removeApplicant(id) {
    setApplicants((current) => current.filter((item) => item.id !== id));
    setSelected(null);
  }

  return <div className="employer-page">
    <section className="applicant-overview">
      <div><span className="eyebrow">Talent pipeline</span><h2>Applicant list</h2><p>Review alumni applications and move promising candidates forward.</p></div>
      <div className="applicant-overview-stats">
        <div className="applicant-overview-stat"><strong>{applicants.length}</strong><span>Total applicants</span></div>
        <div className="applicant-overview-stat"><strong>{applicants.filter((item) => item.status === "New").length}</strong><span>New review</span></div>
        <div className="applicant-overview-stat"><strong>{applicants.filter((item) => item.status === "Shortlisted").length}</strong><span>Shortlisted</span></div>
      </div>
    </section>

    <section className="employer-toolbar applicants-toolbar" aria-label="Filter applicants">
      <select value={position} onChange={(event) => setPosition(event.target.value)} aria-label="Position"><option value="All">All positions</option>{positions.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Application status"><option value="All">All statuses</option><option>New</option><option>Reviewed</option><option>Shortlisted</option></select>
      <label className="employer-search"><span className="sr-only">Search applicants</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search applicant, course, or position"/><span>⌕</span></label>
    </section>

    <section className="employer-panel">
      <div className="employer-panel-heading"><div><span className="eyebrow">Applicant list</span><h2>Candidates</h2></div><span>{filtered.length} result{filtered.length === 1 ? "" : "s"}</span></div>
      <div className="employer-table-wrap"><table className="employer-table applicant-table">
        <thead><tr><th>Name</th><th>Course</th><th>Application date</th><th>Position</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{filtered.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.email}</small></td><td>{item.course}</td><td>{shortDate(item.date)}</td><td>{item.position}</td><td><span className={`employer-badge applicant-${item.status.toLowerCase()}`}>{item.status}</span></td><td><div className="employer-row-actions"><button type="button" aria-label={`View ${item.name}`} onClick={() => setSelected(item)}><Icon name="icon-view"/></button><button type="button" aria-label={`Delete ${item.name}`} onClick={() => removeApplicant(item.id)}><Icon name="icon-delete"/></button></div></td></tr>)}
        {!filtered.length && <tr><td colSpan="6"><div className="employer-empty">No applicants match your filters.</div></td></tr>}</tbody>
      </table></div>
    </section>

    {selected && <div className="employer-modal applicant-profile-layer" role="dialog" aria-modal="true" aria-labelledby="applicant-name"><button className="employer-modal-backdrop" aria-label="Close applicant profile" onClick={() => setSelected(null)}/><section className="employer-modal-card applicant-profile-card"><button className="employer-modal-close" type="button" onClick={() => setSelected(null)} aria-label="Close">×</button>
      <div className="applicant-profile-identity"><ApplicantPortrait/><div><h2 id="applicant-name">{selected.name}</h2><a href={`mailto:${selected.email}`}>{selected.email}</a><strong>{selected.program}</strong></div></div>
      <div className="applicant-profile-facts">
        <section><h3>Job history</h3><ul>{selected.jobHistory.map((job) => <li key={`${job.role}-${job.company}`}>{job.role}{job.company && <> at <span>{job.company}</span></>}</li>)}</ul></section>
        <section><h3>Experience</h3><p>{selected.experience}</p></section>
        <section><h3>Skills</h3><p>{selected.skills.join(", ")}</p></section>
      </div>
      <div className="applicant-profile-actions"><a className="employer-primary-btn" href={`mailto:${selected.email}?subject=${encodeURIComponent(`Application for ${selected.position}`)}`}>Send a mail</a><button className="employer-primary-btn" type="button" onClick={() => setResumeApplicant(selected)}>View resume</button></div>
    </section></div>}

    {resumeApplicant && <div className="employer-modal applicant-resume-layer" role="dialog" aria-modal="true" aria-labelledby="resume-name"><button className="employer-modal-backdrop" aria-label="Close resume" onClick={() => setResumeApplicant(null)}/><section className="applicant-resume-shell"><button className="employer-modal-close" type="button" onClick={() => setResumeApplicant(null)} aria-label="Close resume">×</button>
      <article className="applicant-resume-document">
        <header><h2 id="resume-name">{resumeApplicant.name}</h2><p><b>Email:</b> {resumeApplicant.email}</p><p><b>Age:</b> {resumeApplicant.age}</p><p><b>Location:</b> {resumeApplicant.location}</p></header>
        <section><h3>Objective</h3><p>{resumeApplicant.objective}</p></section>
        <section><h3>Education</h3><p><b>{resumeApplicant.education}</b><br/>{resumeApplicant.school}<br/><small>Academic year: {resumeApplicant.academicYear}</small></p></section>
        <section><h3>Work experience</h3>{resumeApplicant.jobHistory.map((job, index) => <div className="resume-job" key={`${job.role}-${job.company}`}><b>{job.role}</b>{job.company && <span>{job.company}</span>}<ul>{index === 0 ? <><li>Developed and maintained software applications related to business requirements</li><li>Collaborated with team members to improve system efficiency and performance</li><li>Assisted in debugging and optimizing code</li></> : <><li>Supported senior team members in coding and testing tasks</li><li>Helped build and maintain web and software applications</li><li>Participated in troubleshooting and fixing bugs</li></>}</ul></div>)}</section>
        <div className="resume-two-column"><section><h3>Skills</h3><ul>{resumeApplicant.skills.map((skill) => <li key={skill}>{skill}</li>)}<li>Problem-solving and debugging</li><li>Team collaboration and communication</li></ul></section><section><h3>Experience summary</h3><ul><li>{resumeApplicant.experience} of hands-on experience in software development</li><li>Fast learner and adaptable to new technologies</li><li>Interested in innovative technology solutions</li></ul></section></div>
        <section><h3>Additional information</h3><ul><li>Fast learner and adaptable to new technologies</li><li>Interested in innovative technology solutions and collaborative systems</li></ul></section>
      </article>
    </section></div>}
  </div>;
}
