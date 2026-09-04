import { useState } from "react";

// Comma-separated skills string, edited as removable chips + an "add"
// input. Originally the alumni's own Employment Details editor — shared
// here so admin/coordinator's Edit Alumni Record modal offers the identical
// editing experience when setting this on someone else's behalf.
export default function SkillsEditor({ value, onChange }) {
  const [draft, setDraft] = useState("");
  const skills = value.split(",").map((skill) => skill.trim()).filter(Boolean);
  const addSkill = () => {
    const skill = draft.trim().replace(/,+/g, "");
    if (!skill || skills.some((item) => item.toLowerCase() === skill.toLowerCase())) { setDraft(""); return; }
    onChange([...skills, skill].join(", "));
    setDraft("");
  };
  const removeSkill = (skill) => onChange(skills.filter((item) => item !== skill).join(", "));
  return <div className="skills-editor">
    <div className="skills-chip-list skills-edit-list">
      {skills.map((skill) => <span key={skill} className="skill-chip">{skill}<button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}>×</button></span>)}
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSkill(); } }} placeholder={skills.length ? "Add another skill" : "e.g. Python"} />
    </div>
    <button type="button" className="add-skill-button" onClick={addSkill}>+ Add skill</button>
  </div>;
}
