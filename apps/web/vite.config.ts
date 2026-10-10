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
    // Off CI, half the cores (#556). `pnpm test` runs the packages' suites side
    // by side and other checkouts often run theirs too; one worker per core each
    // starved these CPU-bound tests past their timeouts. Measured here: 7 workers
    // instead of 13 took 45 s instead of 40 s, with a third less CPU time and the
    // slowest form tests 30-40% faster. CI is one job on its own runner.
    ...(process.env.CI ? {} : { maxWorkers: "50%" }),
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
