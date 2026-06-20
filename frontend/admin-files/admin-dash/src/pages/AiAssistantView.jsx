import React from "react";

export default function AiAssistantView({ active }) {
  return (
    <section className={`content view aiassistant-view${active ? " active-view" : ""}`}>
      <div className="admin-card">
        <h3>AI Assistant</h3>
        <p style={{ padding: "16px 18px", color: "var(--muted)" }}>
          AI Assistant features are coming soon.
        </p>
      </div>
    </section>
  );
}