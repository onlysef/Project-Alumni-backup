import React, { useMemo, useState } from "react";

const alumni = [
  { name: "Maria Santos", role: "UI/UX Designer", company: "PixelCraft Studio", course: "BSIT", year: "2024", color: "gold" },
  { name: "Joshua Reyes", role: "Software Engineer", company: "Tech Solutions Inc.", course: "BSCS", year: "2023", color: "blue" },
  { name: "Angela Cruz", role: "Systems Analyst", company: "Northpoint Systems", course: "BSIS", year: "2024", color: "pink" },
  { name: "Carlo Mendoza", role: "Web Developer", company: "Cloudline Digital", course: "BSIT", year: "2022", color: "green" },
  { name: "Patricia Lim", role: "Data Analyst", company: "InsightWorks", course: "BSCS", year: "2023", color: "purple" },
  { name: "Miguel Ramos", role: "IT Support Specialist", company: "GlobalServe PH", course: "BSIS", year: "2022", color: "orange" },
  { name: "Nicole Garcia", role: "Product Designer", company: "BrightLabs", course: "BSIT", year: "2024", color: "rose" },
  { name: "Daniel Flores", role: "Junior Developer", company: "Agritech Solutions", course: "BSCS", year: "2023", color: "navy" },
];

export default function SuggestedAlumni() {
  const [course, setCourse] = useState("All");
  const [year, setYear] = useState("All");
  const [search, setSearch] = useState("");
  const results = useMemo(() => alumni.filter(person => (course === "All" || person.course === course) && (year === "All" || person.year === year) && `${person.name} ${person.role} ${person.company}`.toLowerCase().includes(search.toLowerCase())), [course, year, search]);

  return <div className="alumni-page-content suggested-page">
    <section className="directory-toolbar"><div className="directory-filters"><span>Filter by</span><select value={course} onChange={e => setCourse(e.target.value)}><option>All</option><option>BSIT</option><option>BSCS</option><option>BSIS</option></select><select value={year} onChange={e => setYear(e.target.value)}><option>All</option><option>2024</option><option>2023</option><option>2022</option></select></div><label className="directory-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search alumni, role, or company" /></label></section>
    <div className="directory-heading"><div><span>Alumni network</span><h2>Suggested Alumni</h2></div><strong>{results.length} profiles</strong></div>
    {results.length ? <div className="alumni-directory-grid">{results.map(person => <article className="alumni-person-card" key={person.name}><div className={`directory-avatar ${person.color}`}>{person.name.split(" ").map(word => word[0]).join("")}</div><div className="person-info"><h3>{person.name}</h3><strong>{person.role}</strong><p>{person.company}</p><span>{person.course} · Class of {person.year}</span></div><button type="button">View Profile</button></article>)}</div> : <div className="directory-empty"><b>No alumni found</b><span>Try changing your filters or search terms.</span></div>}
  </div>;
}
