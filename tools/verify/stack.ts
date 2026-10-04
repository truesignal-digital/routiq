import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEMO_ACCOUNTS, DEMO_WORKSPACE } from "./accounts.js";
import { isAlive, httpStatus, listenerPid, portInUse, processGroupOf, run, startDetached, stopGroup, waitFor } from "./proc.js";
import { renderCompose, renderViteConfig, storageImageFrom } from "./render.js";
import {
  PROTECTED_VOLUME,
  REPO_ROOT,
  VERIFY_DIR,
  assertVerifyProject,
  projectName,
  runDirName,
  slotDir,
  slotPorts,
  type SlotPorts,
} from "./slot.js";
import { checkReadOnlySql } from "./sql.js";

const API_DIR = path.join(REPO_ROOT, "apps/api");
const WEB_DIR = path.join(REPO_ROOT, "apps/web");

export interface SlotState {
  slot: number;
  project: string;
  ports: SlotPorts;
  urls: { web: string; api: string; storage: string };
  composeFile: string;
  viteConfig: string;
  runDir: string;
  logs: { api: string; web: string; seed: string; compose: string };
  pids: { api: number; web: number };
  commandPayloadHmacKey: string;
  storage: { accessKey: string; secretKey: string };
  commit: string;
  startedAt: string;
}

const statePath = (slot: number) => path.join(slotDir(slot), "state.json");

export function readState(slot: number): SlotState | undefined {
  const file = statePath(slot);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as SlotState;
}

export function requireState(slot: number): SlotState {
  const state = readState(slot);
  if (state === undefined) throw new Error(`slot ${slot} is not up in this checkout. Run: pnpm verify up --slot ${slot}`);
  return state;
}

export function newRunDir(command: string, slot: number): string {
  mkdirSync(VERIFY_DIR, { recursive: true });
  const base = path.join(VERIFY_DIR, runDirName(command, slot, new Date()));
  // mkdir without recursive fails on an existing dir, so two runs in the same second never share one.
  for (let n = 1; ; n += 1) {
    const dir = n === 1 ? base : `${base}-${n}`;
    try {
      mkdirSync(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

function compose(state: Pick<SlotState, "project" | "composeFile">, args: readonly string[]) {
  assertVerifyProject(state.project);
  return run("docker", ["compose", "-p", state.project, "-f", state.composeFile, ...args], { cwd: REPO_ROOT });
}

function apiEnv(state: SlotState): NodeJS.ProcessEnv {
  const pg = (user: string) => `postgres://${user}:${user}@127.0.0.1:${state.ports.postgres}/routiq_dev`;
  return {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: pg("routiq_app"),
    AUTH_DATABASE_URL: pg("routiq"),
    MIGRATION_DATABASE_URL: pg("routiq"),
    PORT: String(state.ports.api),
    COMMAND_PAYLOAD_HMAC_KEY: state.commandPayloadHmacKey,
    S3_ENDPOINT: state.urls.storage,
    S3_PUBLIC_ENDPOINT: state.urls.storage,
    S3_REGION: "us-east-1",
    S3_BUCKET: "artifacts",
    S3_ACCESS_KEY_ID: state.storage.accessKey,
    S3_SECRET_ACCESS_KEY: state.storage.secretKey,
    SENTRY_DSN: "",
  };
}

function bin(dir: string, name: string): string {
  const file = path.join(dir, "node_modules/.bin", name);
  if (!existsSync(file)) throw new Error(`${file} is missing. Run pnpm install first.`);
  return file;
}

function tail(file: string, lines = 30): string {
  if (!existsSync(file)) return "(no log)";
  return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}

function say(line: string) {
  process.stdout.write(`${line}\n`);
}

function seed(state: SlotState, reset: boolean): void {
  const args = ["scripts/seed-demo.ts", ...(reset ? ["--reset"] : [])];
  const result = run(bin(API_DIR, "tsx"), args, { cwd: API_DIR, env: apiEnv(state) });
  writeFileSync(state.logs.seed, `${result.stdout}\n${result.stderr}`, { flag: "a" });
  if (result.code !== 0) throw new Error(`seed-demo failed (exit ${result.code}). Log: ${state.logs.seed}\n${tail(state.logs.seed)}`);
}

export async function up(slot: number, reseed: boolean): Promise<void> {
  const existing = readState(slot);
  if (existing !== undefined && isAlive(existing.pids.api) && isAlive(existing.pids.web)) {
    if (reseed) {
      say(`slot ${slot} is up; reseeding the demo workspace (seed-demo --reset)`);
      seed(existing, true);
      say(`reseeded. Log: ${existing.logs.seed}`);
    } else {
      say(`slot ${slot} is already up. Web ${existing.urls.web}  API ${existing.urls.api}`);
    }
    return;
  }
  if (existing !== undefined) {
    throw new Error(`slot ${slot} has a stale state file (a process died). Run: pnpm verify down --slot ${slot}, then up again`);
  }

  if (run("docker", ["info", "--format", "{{.ServerVersion}}"]).code !== 0) throw new Error("docker is not answering; start Docker Desktop");
  const ports = slotPorts(slot);
  for (const [service, port] of Object.entries(ports)) {
    if (await portInUse(port)) {
      throw new Error(`port ${port} (${service}, slot ${slot}) is in use, probably by another checkout's slot ${slot}. Pick another --slot.`);
    }
  }

  const project = projectName(slot);
  const dir = slotDir(slot);
  mkdirSync(dir, { recursive: true });
  const runDir = newRunDir("up", slot);
  const state: SlotState = {
    slot,
    project,
    ports,
    urls: {
      web: `http://127.0.0.1:${ports.web}`,
      api: `http://127.0.0.1:${ports.api}`,
      storage: `http://127.0.0.1:${ports.storage}`,
    },
    composeFile: path.join(dir, "compose.yml"),
    viteConfig: path.join(dir, "vite.config.mjs"),
    runDir,
    logs: {
      api: path.join(runDir, "api.log"),
      web: path.join(runDir, "web.log"),
      seed: path.join(runDir, "seed.log"),
      compose: path.join(runDir, "compose.log"),
    },
    pids: { api: 0, web: 0 },
    commandPayloadHmacKey: randomBytes(32).toString("hex"),
    storage: { accessKey: `verify-${slot}`, secretKey: randomBytes(18).toString("hex") },
    commit: run("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT }).stdout.trim(),
    startedAt: new Date().toISOString(),
  };

  const storageImage = storageImageFrom(readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8"));
  writeFileSync(state.composeFile, renderCompose(project, ports, storageImage, state.storage));
  writeFileSync(
    state.viteConfig,
    renderViteConfig(path.join(WEB_DIR, "vite.config.ts"), WEB_DIR, path.join(dir, "vite-cache"), ports),
  );
  const save = () => writeFileSync(statePath(slot), `${JSON.stringify(state, null, 2)}\n`);
  save();

  say(`slot ${slot}: compose project ${project}, ports postgres ${ports.postgres}, storage ${ports.storage}, api ${ports.api}, web ${ports.web}`);
  const composeUp = compose(state, ["up", "-d", "--wait"]);
  writeFileSync(state.logs.compose, `${composeUp.stdout}\n${composeUp.stderr}`);
  if (composeUp.code !== 0) throw new Error(`docker compose up failed. Log: ${state.logs.compose}\n${tail(state.logs.compose)}`);
  say("containers healthy: postgres, storage");

  state.pids.api = startDetached(bin(API_DIR, "tsx"), ["src/boot.ts"], { cwd: API_DIR, env: apiEnv(state), logFile: state.logs.api });
  save();
  await waitFor(
    async () => (await httpStatus(`${state.urls.api}/health`)) === 200,
    120_000,
    () => (isAlive(state.pids.api) ? undefined : `API exited during boot. Log: ${state.logs.api}\n${tail(state.logs.api)}`),
  ).catch((error: unknown) => {
    throw new Error(`API did not answer /health: ${error instanceof Error ? error.message : String(error)}\nLog: ${state.logs.api}`);
  });
  say(`api up (migrated at boot): ${state.urls.api}  pid ${state.pids.api}`);

  seed(state, false);
  say(`demo workspace seeded: ${DEMO_WORKSPACE}. Log: ${state.logs.seed}`);

  state.pids.web = startDetached(bin(WEB_DIR, "vite"), ["--config", state.viteConfig], {
    cwd: WEB_DIR,
    env: { ...process.env, BROWSER: "none" },
    logFile: state.logs.web,
  });
  save();
  await waitFor(
    async () => (await httpStatus(`${state.urls.web}/`)) === 200 && (await httpStatus(`${state.urls.web}/v1/me`)) === 401,
    90_000,
    () => (isAlive(state.pids.web) ? undefined : `web exited during start. Log: ${state.logs.web}\n${tail(state.logs.web)}`),
  );
  say(`web up, proxying /v1 to the slot API: ${state.urls.web}  pid ${state.pids.web}`);
  say(`logs: ${runDir}`);
  say(`next: pnpm verify doctor --slot ${slot}`);
}

export async function down(slot: number): Promise<void> {
  const state = readState(slot);
  const project = projectName(slot);
  assertVerifyProject(project);
  if (state !== undefined) {
    for (const [name, pid] of Object.entries(state.pids)) {
      if (pid > 0) say(`${name} (pid ${pid}): ${await stopGroup(pid)}`);
    }
  } else {
    say(`no state file for slot ${slot} in this checkout; removing compose project ${project} only`);
  }

  const volumes = run("docker", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`]).stdout.trim().split("\n").filter(Boolean);
  if (volumes.includes(PROTECTED_VOLUME)) throw new Error(`refusing: ${PROTECTED_VOLUME} is labelled as part of ${project}`);
  const args = ["compose", "-p", project, ...(state ? ["-f", state.composeFile] : []), "down", "-v", "--remove-orphans"];
  const result = run("docker", args, { cwd: REPO_ROOT });
  if (result.code !== 0) throw new Error(`docker compose down failed:\n${result.stderr}`);
  say(`removed compose project ${project}${volumes.length ? ` and volumes ${volumes.join(", ")}` : ""}`);

  for (const port of Object.values(slotPorts(slot))) {
    if (await portInUse(port)) say(`WARN port ${port} is still in use (pid ${listenerPid(port) ?? "?"}); not started by this slot's state, left alone`);
  }
  const dir = slotDir(slot);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  if (state) say(`evidence and logs kept: ${state.runDir}`);
  say(`all runs: ${VERIFY_DIR}`);
}

interface Check {
  label: string;
  run: () => Promise<string>;
}

export async function doctor(slot: number): Promise<boolean> {
  const state = requireState(slot);
  const psql = (sql: string) =>
    compose(state, ["exec", "-T", "postgres", "psql", "-U", "routiq", "-d", "routiq_dev", "-At", "-c", sql]);
  const owned = (port: number, pid: number) => {
    const listener = listenerPid(port);
    if (listener === undefined) throw new Error(`nothing listens on ${port}`);
    const group = processGroupOf(listener);
    if (group !== pid) throw new Error(`port ${port} is held by pid ${listener} (group ${group ?? "?"}), not this slot's process group ${pid}`);
    return `port ${port} held by our process group ${pid}`;
  };
  const checks: Check[] = [
    {
      label: "containers healthy",
      run: async () => {
        const out = compose(state, ["ps", "--format", "{{.Service}}={{.Health}}"]).stdout.trim();
        const bad = out.split("\n").filter((line) => !line.endsWith("=healthy"));
        if (out === "" || bad.length > 0) throw new Error(out || "no containers");
        return out.replace(/\n/g, ", ");
      },
    },
    {
      label: "database reachable",
      run: async () => {
        const res = psql("select current_database()");
        if (res.code !== 0) throw new Error(res.stderr.trim());
        return `${res.stdout.trim()} on 127.0.0.1:${state.ports.postgres}`;
      },
    },
    {
      label: "migrations applied",
      run: async () => {
        const journal = JSON.parse(readFileSync(path.join(API_DIR, "drizzle/meta/_journal.json"), "utf8")) as { entries: unknown[] };
        const res = psql("select count(*) from drizzle.__drizzle_migrations");
        if (res.code !== 0) throw new Error(res.stderr.trim());
        const applied = Number(res.stdout.trim());
        if (applied !== journal.entries.length) throw new Error(`${applied} applied, ${journal.entries.length} in the journal`);
        return `${applied}/${journal.entries.length}`;
      },
    },
    {
      label: "api /health",
      run: async () => {
        const status = await httpStatus(`${state.urls.api}/health`);
        if (status !== 200) throw new Error(`status ${status}`);
        return `${state.urls.api}/health 200; ${owned(state.ports.api, state.pids.api)}`;
      },
    },
    {
      label: "storage live",
      run: async () => {
        const status = await httpStatus(`${state.urls.storage}/health/live`);
        if (status !== 200) throw new Error(`status ${status}`);
        return `${state.urls.storage}/health/live 200`;
      },
    },
    {
      label: "web serves the app",
      run: async () => {
        const res = await fetch(`${state.urls.web}/`, { signal: AbortSignal.timeout(5000) });
        const html = await res.text();
        if (res.status !== 200 || !html.includes('id="root"')) throw new Error(`status ${res.status}`);
        return `${state.urls.web}/ 200; ${owned(state.ports.web, state.pids.web)}`;
      },
    },
    {
      label: "web proxies /v1 to this slot",
      run: async () => {
        const status = await httpStatus(`${state.urls.web}/v1/me`);
        if (status !== 401) throw new Error(`GET /v1/me without a token answered ${status}, expected 401`);
        return "GET /v1/me → 401 (reached the API)";
      },
    },
    ...DEMO_ACCOUNTS.map((account) => ({
      label: `login ${account.username} (${account.role})`,
      run: async () => {
        const res = await fetch(`${state.urls.web}/v1/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceSlug: DEMO_WORKSPACE, username: account.username, pin: account.pin }),
          signal: AbortSignal.timeout(5000),
        });
        const body = (await res.json()) as { token?: unknown };
        if (res.status !== 200 || typeof body.token !== "string") throw new Error(`status ${res.status} ${JSON.stringify(body)}`);
        return "token issued";
      },
    })),
  ];

  let ok = true;
  say(`doctor slot ${slot} (${state.project}, commit ${state.commit})`);
  for (const check of checks) {
    try {
      say(`PASS  ${check.label}: ${await check.run()}`);
    } catch (error) {
      ok = false;
      say(`FAIL  ${check.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  say(ok ? "doctor: all checks passed" : `doctor: FAILED. Logs: ${state.runDir}`);
  return ok;
}

export function status(): void {
  const root = path.join(VERIFY_DIR, "slots");
  const slots = existsSync(root) ? readdirSync(root).filter((name) => /^\d+$/.test(name)) : [];
  if (slots.length === 0) {
    say("no verify slots are up in this checkout");
    return;
  }
  for (const name of slots) {
    const state = readState(Number(name));
    if (state === undefined) continue;
    const alive = `api ${isAlive(state.pids.api) ? "running" : "dead"}, web ${isAlive(state.pids.web) ? "running" : "dead"}`;
    say(`slot ${state.slot}: ${state.urls.web}  api ${state.urls.api}  (${alive}; commit ${state.commit}; since ${state.startedAt})`);
  }
}

export function logs(slot: number, service: "api" | "web" | "seed" | "all"): void {
  const state = requireState(slot);
  const names = service === "all" ? (["api", "web", "seed"] as const) : [service];
  for (const name of names) {
    say(`==> ${state.logs[name]} <==`);
    say(tail(state.logs[name], 60));
  }
}

export function db(slot: number, sql: string): boolean {
  const verdict = checkReadOnlySql(sql);
  if (!verdict.ok) throw new Error(`refused: ${verdict.reason}`);
  const state = requireState(slot);
  const result = compose(state, [
    "exec",
    "-T",
    "-e",
    "PGOPTIONS=-c default_transaction_read_only=on",
    "postgres",
    "psql",
    "-U",
    "routiq",
    "-d",
    "routiq_dev",
    "-v",
    "ON_ERROR_STOP=1",
    "-P",
    "pager=off",
    "-c",
    verdict.sql,
  ]);
  process.stdout.write(result.stdout);
  if (result.code !== 0) process.stderr.write(result.stderr);
  return result.code === 0;
}
