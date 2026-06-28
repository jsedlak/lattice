import type { UserConfig } from "vitest/config";

/**
 * Shared Vitest defaults. Packages spread this into their own config and add
 * an environment (`node` for logic packages, `jsdom` for React/UI).
 */
export const vitestBase: UserConfig["test"] = {
  globals: true,
  passWithNoTests: true,
  coverage: {
    provider: "v8",
    reporter: ["text", "html"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.config.*",
      "**/*.d.ts",
      "**/index.ts",
    ],
  },
};
