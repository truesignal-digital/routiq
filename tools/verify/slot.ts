import { fileURLToPath } from "node:url";
import path from "node:path";

/** The owner's dev stack and the demo box. A verify slot must never bind or target these. */
export const RESERVED_PORTS: ReadonlySet<number> = new Set([3001, 5173, 5435, 8080, 9000]);

/** The owner's dev database volume. Nothing in tools/verify may name it in a destructive call. */
export const PROTECTED_VOLUME = "routiq_pgdata";

export const MIN_SLOT = 0;
export const MAX_SLOT = 99;
export const DEFAULT_SLOT = 1;
const PORT_BASE = 24_000;
const PORTS_PER_SLOT = 10;

export interface SlotPorts {
  postgres: number;
  storage: number;
  api: number;
  web: number;
}

export function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < MIN_SLOT || slot > MAX_SLOT) {
    throw new Error(`slot must be an integer from ${MIN_SLOT} to ${MAX_SLOT}, got ${String(slot)}`);
  }
}

/** Slot N owns ports 24000+10N .. 24000+10N+3, so two slots never share a port. */
export function slotPorts(slot: number): SlotPorts {
  assertSlot(slot);
  const base = PORT_BASE + slot * PORTS_PER_SLOT;
  const ports = { postgres: base, storage: base + 1, api: base + 2, web: base + 3 };
  for (const port of Object.values(ports)) {
    if (RESERVED_PORTS.has(port)) throw new Error(`slot ${slot} would use reserved port ${port}`);
  }
  return ports;
}

export function projectName(slot: number): string {
  assertSlot(slot);
  return `routiq-verify-${slot}`;
}

const PROJECT_PATTERN = /^routiq-verify-\d{1,2}$/;

/** Guard for every `docker compose down -v`: only verify projects may lose their volumes. */
export function assertVerifyProject(name: string): void {
  if (!PROJECT_PATTERN.test(name)) {
    throw new Error(`refusing to touch compose project "${name}": not a routiq-verify-N project`);
  }
}

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const VERIFY_DIR = path.join(REPO_ROOT, ".verify");

export function slotDir(slot: number): string {
  assertSlot(slot);
  return path.join(VERIFY_DIR, "slots", String(slot));
}

/** One directory per run, named so `ls .verify` sorts by time. */
export function runDirName(command: string, slot: number, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  return `${stamp}-${command}-s${slot}`;
}
