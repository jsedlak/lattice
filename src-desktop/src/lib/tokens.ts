/**
 * COPIED VERBATIM (minus this header) from the Lattice web monorepo:
 * packages/config/tokens.ts. src-desktop is maintained separately; keep the
 * values visually in sync with the web app when the palette changes.
 */

/** Raw palette from the mockup. */
export const palette = {
  // Brand / accent
  accent: "#3a6df0",
  accentActive: "#5b8cff",

  // Graph taxonomy (dark, light) — also used as the consistent concept colors
  // everywhere: editor decorations, preview chips, graph nodes, citations.
  doc: { base: "#3a6df0", light: "#5b8cff" },
  tag: { base: "#1f9d68", light: "#46c08a" },
  entity: { base: "#b9701f", light: "#e0a35a" },
  link: { base: "#8b54c4", light: "#bb8ce0" },
  citation: { base: "#d23f6b", light: "#e87b9b" },

  // Dark surfaces
  dark: {
    bg: "#0d0e11",
    surface: "#101216",
    surfaceRaised: "#15171b",
    raised: "#1a1c20",
    raisedAlt: "#1b1e23",
    border: "#22262d",
    borderStrong: "#262a31",
    borderStronger: "#363c45",
    text: "#e7e8ea",
    muted: "#a4aab3",
    mutedAlt: "#8a909a",
    faint: "#6e747e",
  },

  // Light surfaces
  light: {
    bg: "#fbfbfa",
    surface: "#f5f5f3",
    surfaceRaised: "#f0f0ee",
    raised: "#ffffff",
    raisedAlt: "#eeeeec",
    border: "#e4e4e0",
    borderStrong: "#d3d3cd",
    borderStronger: "#c4c4bd",
    text: "#1b1e23",
    muted: "#565b63",
    mutedAlt: "#6e747e",
    faint: "#8a909a",
  },
} as const;

export type GraphConcept = "doc" | "tag" | "entity" | "link" | "citation";

/**
 * Concrete graph colors for a given theme — for Cytoscape and any canvas/SVG
 * surface that cannot resolve CSS variables.
 */
export function graphColors(theme: "dark" | "light") {
  const k = theme === "dark" ? "base" : "light";
  return {
    doc: palette.doc[k === "base" ? "light" : "base"], // brighter node on dark bg
    tag: theme === "dark" ? palette.tag.light : palette.tag.base,
    entity: theme === "dark" ? palette.entity.light : palette.entity.base,
    link: theme === "dark" ? palette.link.light : palette.link.base,
    citation: theme === "dark" ? palette.citation.light : palette.citation.base,
  } satisfies Record<GraphConcept, string>;
}
