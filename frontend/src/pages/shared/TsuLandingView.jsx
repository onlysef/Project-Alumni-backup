import React from "react";
import tsuLogo from "../../assets/images/tsu_logo-removebg.png";

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
        <header className="tsu-hero">
          <div className="tsu-hero-copy">
            <span className="tsu-eyebrow">Truth · Service · Unity</span>
            <h1>Tarlac State University</h1>
            <p>
              A premier state university committed to academic excellence, responsive innovation,
              and meaningful service to the community.
            </p>
          </div>
          <div className="tsu-seal-wrap">
            <img src={tsuLogo} alt="Tarlac State University seal" />
          </div>
        </header>

        <div className="tsu-content-grid">
          <section className="tsu-info-card">
            <span>Our aspiration</span>
            <h2>Vision</h2>
            <p>A globally competitive university recognized for excellence in sciences and emerging technologies.</p>
          </section>

          <section className="tsu-info-card">
            <span>Our purpose</span>
            <h2>Mission</h2>
            <p>
              TSU shall develop highly competitive and empowered human resources fostering responsive global education,
              future-proof research culture, inclusive and relevant extension programs, and sustainable production projects.
            </p>
          </section>

          <section className="tsu-info-card tsu-values-card">
            <span>What guides us</span>
            <h2>Core Values</h2>
            <div className="tsu-values">
              <p><strong>T</strong><span><b>Truth</b> in words, action and character</span></p>
              <p><strong>S</strong><span><b>Service</b> with excellence and compassion</span></p>
              <p><strong>U</strong><span><b>Unity</b> in diversity</span></p>
            </div>
          </section>
        </div>

        <section className="tsu-list-card">
          <div className="tsu-section-heading"><span>Institutional priorities</span><h2>Strategic Directions <small>SOAR HIGHER</small></h2></div>
          <ul className="tsu-strategic-list">
            {strategicDirections.map(([letter, lead, rest], index) => (
              <li key={`${letter}-${index}`}>
                <i>{letter}</i>
                <p><strong>{lead}</strong>{rest ? ` ${rest}` : ""}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="tsu-list-card tsu-roadmap-card">
          <div className="tsu-section-heading"><span>Development framework</span><h2>Approved Roadmaps</h2></div>
          <ol>
            {roadmaps.map((roadmap, index) => <li key={roadmap}><i>{String(index + 1).padStart(2, "0")}</i><span>{roadmap}</span></li>)}
          </ol>
        </section>
      </article>
    </section>
  );
}
