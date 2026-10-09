import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

function appVersion(): string {
  if (process.env.ROUTIQ_VERSION) return process.env.ROUTIQ_VERSION;
  try {
    const cwd = fileURLToPath(new URL(".", import.meta.url));
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "dev";
  } catch {
    return "dev";
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // In index.html, not in the JS: a version baked into one file renames it, every file
      // importing it gets renamed in turn, and the gzip totals then move with each commit.
      name: "routiq-version",
      transformIndexHtml: () => [{ tag: "meta", attrs: { name: "routiq-version", content: appVersion() }, injectTo: "head" }],
    },
  ],
  // /assets/* is the app's truck routes; built files must not share it (#124).
  build: { assetsDir: "static" },
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
