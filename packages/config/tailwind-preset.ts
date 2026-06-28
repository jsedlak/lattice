import type { Config } from "tailwindcss";

/**
 * Shared Tailwind preset encoding the Lattice design system. Consumed by
 * apps/web and packages/ui via `presets: [latticePreset]`. Colors reference the
 * semantic CSS variables defined in globals.css (see @lattice/config/tokens
 * `cssVariables`), so theme swap is a `.dark` class toggle.
 */
const preset: Partial<Config> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-raised)",
        },
        raised: "var(--raised)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        foreground: "var(--foreground)",
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        faint: "var(--faint)",
        accent: {
          DEFAULT: "var(--accent)",
          active: "var(--accent-active)",
          foreground: "var(--accent-foreground)",
        },
        graph: {
          doc: "var(--graph-doc)",
          tag: "var(--graph-tag)",
          entity: "var(--graph-entity)",
          link: "var(--graph-link)",
          citation: "var(--graph-citation)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderColor: {
        DEFAULT: "var(--border)",
      },
      borderRadius: {
        lg: "0.625rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
        "slide-up": "slide-up 0.2s ease-out",
        "pulse-subtle": "pulse-subtle 1.4s ease-in-out infinite",
      },
    },
  },
};

export default preset;
