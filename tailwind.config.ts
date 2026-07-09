import type { Config } from "tailwindcss";

/**
 * Copied from the Lattice web monorepo (packages/config/tailwind-preset.ts)
 * and inlined — src-desktop is maintained separately and has no @lattice/*
 * dependencies. Colors reference the semantic CSS variables defined in
 * src/styles/globals.css; theme swap is a `.dark` class toggle.
 */
const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Centered dialogs: a CSS animation REPLACES the element's transform
        // while it runs, so these keyframes must carry the -50%,-50% centering
        // themselves — animating bare translateY would fling the dialog to
        // the bottom-right for the duration, then snap back.
        "dialog-in": {
          from: {
            opacity: "0",
            transform: "translate(-50%, calc(-50% - 1.5rem)) scale(0.97)",
          },
          to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "dialog-out": {
          from: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
          to: {
            opacity: "0",
            transform: "translate(-50%, calc(-50% - 0.75rem)) scale(0.98)",
          },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
        "fade-out": "fade-out 0.15s ease-in forwards",
        "slide-up": "slide-up 0.2s ease-out",
        // Drop in from above with a soft settle (iOS/Vaul-style ease-out).
        "dialog-in": "dialog-in 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
        "dialog-out": "dialog-out 0.15s ease-in forwards",
        "pulse-subtle": "pulse-subtle 1.4s ease-in-out infinite",
      },
    },
  },
};

export default config;
