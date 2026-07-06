import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// Tauri v2 dev server contract: fixed port, no clearing, ignore src-tauri.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  worker: { format: "es" },
  build: {
    // WKWebView (macOS) / WebKitGTK (Linux) — both track Safari.
    target: "safari15",
    sourcemap: false,
  },
});
