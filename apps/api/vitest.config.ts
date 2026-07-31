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
  },
});
