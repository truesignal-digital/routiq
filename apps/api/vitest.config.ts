import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["src/test/global-setup.ts"],
    // The API refuses to start without it (see payload-fingerprint.ts). A fixed
    // value keeps fingerprints stable across a run; the tests that care about
    // key separation pass their own keys explicitly.
    env: { COMMAND_PAYLOAD_HMAC_KEY: "test-command-payload-hmac-key-0123456789" },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Off CI, half the cores (#556). `pnpm test` runs the packages' suites side
    // by side and other checkouts often run theirs too, so one worker per core
    // each starved the shared test database. Measured here: 7 workers instead of
    // 13 ran the suite in 27 s instead of 31 s, on less than half the CPU time.
    // CI is one job on its own runner.
    ...(process.env.CI ? {} : { maxWorkers: "50%" }),
  },
});
