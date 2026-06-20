import React from "react";
import { ICONS } from "./Icondata.js";

export default function SimpleIcon({ name, alt = "" }) {
  const src = ICONS[name];
  if (!src) return <span className="admin-svg-icon" aria-hidden="true" />;
  return (
    <img
      className={`admin-svg-icon ${name}`}
      src={src}
      alt={alt}
      aria-hidden={alt ? undefined : "true"}
      draggable="false"
    />
  );
}