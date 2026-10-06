/** Set by `define` in vite.config.ts: ROUTIQ_VERSION, the git short sha, or "dev". */
declare const __ROUTIQ_VERSION__: string;

interface ImportMetaEnv {
  /** "off" turns field telemetry off for a build. */
  readonly VITE_TELEMETRY?: string;
}
