import React from "react";

const strategicDirections = [
  ["S", "Sustainable student support programs", "to improve access to quality education to become globally competitive."],
  ["O", "Outstanding international reputation and visibility", "through Academic and Research Exchanges."],
  ["A", "Assurance of quality and excellence", "through accreditation, assessment, and certification with global standards."],
  ["R", "Rigorous Development Programs", "for executives, faculty, staff, and students."],
  ["H", "Highly responsive and innovative Research Development and Extension programs.", ""],
  ["I", "Investment on modern Infrastructures, facilities and equipment", "to ensure inclusive and responsive delivery of services to clients and stakeholders."],
  ["G", "Good governance, management, and accountability", "characterized by Truth Service and Unity."],
  ["H", "Harness active partnerships and collaboration", "to local and international community."],
  ["E", "Enhanced Production", "through Sustainable Income Generating Projects."],
  ["R", "Responsive, Innovative and Industry-based Curricula and Instruction.", ""],
];

const roadmaps = [
  "Roadmap A - Resource Management Development Plan",
  "Roadmap B - Instructional Quality and Relevance Development Plan",
  "Roadmap C - Research and Community Extension Service Development Plan",
  "Roadmap D - Quality Assurance Development Plan",
  "Roadmap E - Information and Communication Technology Development Plan",
  "Roadmap F - Internationalization Plan",
  "Roadmap G - Technology Development and Commercialization Plan",
];

export default function TsuLandingView() {
  return (
    <section className="content view tsu-landing-view active-view">
      <article className="tsu-document">
        <h2>Vision</h2>
        <p>A globally competitive university recognized for excellence in sciences and emerging technologies.</p>

        <h2>Mission</h2>
        <p>
          TSU shall develop highly competitive and empowered human resources fostering responsive global education,
          future-proof research culture, inclusive and relevant extension programs, and sustainable production projects.
        </p>

        <h2>Core Values</h2>
        <p><strong>T</strong>-ruth in words, action and character</p>
        <p><strong>S</strong>-ervice with excellence and compassion</p>
        <p><strong>U</strong>-nity in diversity</p>

        <h3>Strategic Directions (SOAR HIGHER):</h3>
        <ul>
          {strategicDirections.map(([letter, lead, rest], index) => (
            <li key={`${letter}-${index}`}>
              <strong>{letter} - {lead}</strong>{rest ? ` ${rest}` : ""}
            </li>
          ))}
        </ul>

        <h3>Approved Roadmaps:</h3>
        <ul>
          {roadmaps.map((roadmap) => <li key={roadmap}>{roadmap}</li>)}
        </ul>
      </article>
    </section>
  );
}
