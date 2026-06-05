import React from "react";
import { ICONS } from "./iconData.js";

/*
 * Icons are now rendered as <img> elements whose src is an inline
 * base64 data-URI (Lucide-style SVGs, MIT licensed). The data-URIs are
 * generated in iconData.js and keyed by the original icon-1..icon-27 ids.
 *
 * Note: an <img> renders the SVG's own colors, so it can't inherit
 * currentColor the way the previous inline <svg> did. Each icon is baked
 * with a stroke tint that suits the surface it sits on (white on the
 * maroon sidebar/buttons, maroon elsewhere).
 */

export default function Icon({ name, alt = "" }) {
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
