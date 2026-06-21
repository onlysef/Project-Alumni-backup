import React from "react";
import alumniLogo from "../logo/alumni-removebg.png";

export default function AboutView({ active }) {
  return (
    <section className={`content view about-view${active ? " active-view" : ""}`}>
      <div className="about-section">
        <div className="about-content">
          <div className="about-title">
            <h2>Tarlac State University Alumni Association, Inc.</h2>
          </div>
          <p>
            To promote the general welfare of the alumni community and to build a stronger linkage with the university, the Tarlac State University Alumni Association Incorporated was established.
          </p>
          <p>
            The President of the Alumni Association sits as an ex officio member of the Board of Regents by virtue of the Republic Act No. 8292: An Act Providing for the Uniform Composition and Powers of the Governing Boards, the Manner of Appointment and Term of Office of the President of Chartered State Universities and Colleges, and for other Purposes.
          </p>
        </div>
        <div className="about-image">
          <img src={alumniLogo} alt="Alumni Association Logo" />
        </div>
      </div>
    </section>
  );
}