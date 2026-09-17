import { useState } from "react";
import { API, authHeaders } from "../../services/api.js";
import { classifySkill } from "../../utils/skillClassification.js";

// Comma-separated skills string, edited as removable chips + an "add"
// input, plus a "describe your skills" textarea that extracts recognized
// skill keywords from a full sentence instead of forcing one chip at a
// time. Originally the alumni's own Employment Details editor — shared
// here so admin/coordinator's Edit Alumni Record modal offers the identical
// editing experience when setting this on someone else's behalf.
// `extractEndpoint` lets each caller point at its own role's route
// (/alumni, /admin, /coordinator all expose the same handler).
export default function SkillsEditor({ value, onChange, extractEndpoint = "/alumni/skills/extract" }) {
  const [draft, setDraft] = useState("");
  const [sentence, setSentence] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const skills = value.split(",").map((skill) => skill.trim()).filter(Boolean);

  const addSkills = (newSkills) => {
    const merged = [...skills];
    newSkills.forEach((skill) => {
      if (skill && !merged.some((item) => item.toLowerCase() === skill.toLowerCase())) merged.push(skill);
    });
    onChange(merged.join(", "));
  };
  const addSkill = () => {
    const skill = draft.trim().replace(/,+/g, "");
    if (!skill) { setDraft(""); return; }
    addSkills([skill]);
    setDraft("");
  };
  const removeSkill = (skill) => onChange(skills.filter((item) => item !== skill).join(", "));

  const extractFromSentence = async () => {
    if (!sentence.trim() || extracting) return;
    setExtracting(true);
    setExtractError("");
    try {
      const res = await fetch(`${API}${extractEndpoint}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ text: sentence }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.skills?.length) {
        addSkills(data.skills);
        setSentence("");
      } else {
        setExtractError("No recognized skills found in that sentence, try adding one directly below instead.");
      }
    } catch {
      setExtractError("Couldn't process that sentence right now. Try adding a skill directly instead.");
    } finally {
      setExtracting(false);
    }
  };

  // Split for display only (soft/technical/other), so alumni and admins can
  // scan the two skill types separately instead of one flat mixed list.
  // Removing/adding still operates on the single comma-separated `value`.
  const softSkills = skills.filter((s) => classifySkill(s) === "soft");
  const hardSkills = skills.filter((s) => classifySkill(s) === "hard");
  const otherSkills = skills.filter((s) => classifySkill(s) === "other");
  const renderChip = (skill) => (
    <span key={skill} className="skill-chip">
      {skill}
      <button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}>×</button>
    </span>
  );

  return <div className="skills-editor">
    <div className="skills-sentence-input">
      <textarea
        value={sentence}
        onChange={(event) => setSentence(event.target.value)}
        placeholder="Or describe your skills in a sentence, e.g. &quot;I'm skilled in Python programming and enjoy customer service work&quot;"
        rows={2}
      />
      <button type="button" className="add-skill-button" onClick={extractFromSentence} disabled={extracting || !sentence.trim()}>
        {extracting ? "Extracting…" : "Extract skills"}
      </button>
      {extractError && <p className="skills-extract-error">{extractError}</p>}
    </div>

    {hardSkills.length > 0 && (
      <div className="skills-group">
        <span className="skills-group-label">Technical / Domain Skills</span>
        <div className="skills-chip-list">{hardSkills.map(renderChip)}</div>
      </div>
    )}
    {softSkills.length > 0 && (
      <div className="skills-group">
        <span className="skills-group-label">Soft Skills</span>
        <div className="skills-chip-list">{softSkills.map(renderChip)}</div>
      </div>
    )}
    {otherSkills.length > 0 && (
      <div className="skills-group">
        <span className="skills-group-label">Other</span>
        <div className="skills-chip-list">{otherSkills.map(renderChip)}</div>
      </div>
    )}

    <div className="skills-chip-list skills-edit-list">
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSkill(); } }} placeholder={skills.length ? "Add another skill" : "e.g. Python"} />
    </div>
    <button type="button" className="add-skill-button" onClick={addSkill}>+ Add skill</button>
  </div>;
}
