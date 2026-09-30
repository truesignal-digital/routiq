import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3001",
    },
  },
  test: {
    // jsdom interaction tests take under a second alone but 5-8 s when every
    // file runs in parallel on a CI runner; the 5 s default made them flaky
    // (#67). Still short enough to catch a hung test.
    testTimeout: 15_000,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
