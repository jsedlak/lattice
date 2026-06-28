import latticePreset from "@lattice/config/tailwind-preset";
import type { Config } from "tailwindcss";

const config: Config = {
  presets: [latticePreset as Partial<Config>],
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    // Scan the shared UI package so its utility classes are generated.
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
