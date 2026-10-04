import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import net from "node:net";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(cmd: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): RunResult {
  const result: SpawnSyncReturns<string> = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Starts a detached process group writing to a log file; returns its pid (= process group id). */
export function startDetached(cmd: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; logFile: string }): number {
  const fd = openSync(options.logFile, "a");
  try {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ["ignore", fd, fd] });
    if (child.pid === undefined) throw new Error(`could not start ${cmd}`);
    child.unref();
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stops the whole process group this tool started. Never matches by process name. */
export async function stopGroup(pid: number): Promise<"stopped" | "not-running"> {
  if (!isAlive(pid)) return "not-running";
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // already gone
      }
    }
  };
  signal("SIGTERM");
  for (let i = 0; i < 50 && isAlive(pid); i += 1) await sleep(100);
  if (isAlive(pid)) signal("SIGKILL");
  return "stopped";
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "0.0.0.0", exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export async function portInUse(port: number): Promise<boolean> {
  return (await canConnect(port)) || !(await canListen(port));
}

/** The pid listening on a TCP port, via lsof; undefined when nothing listens or lsof is missing. */
export function listenerPid(port: number): number | undefined {
  try {
    const out = run("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]).stdout.trim().split("\n")[0];
    return out ? Number(out) : undefined;
  } catch {
    return undefined;
  }
}

export function processGroupOf(pid: number): number | undefined {
  const out = run("ps", ["-o", "pgid=", "-p", String(pid)]).stdout.trim();
  return out ? Number(out) : undefined;
}

export async function waitFor(check: () => Promise<boolean>, timeoutMs: number, abort?: () => string | undefined): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reason = abort?.();
    if (reason !== undefined) throw new Error(reason);
    if (await check().catch(() => false)) return;
    await sleep(500);
  }
  throw new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`);
}

export async function httpStatus(url: string, init?: RequestInit): Promise<number> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  await res.arrayBuffer();
  return res.status;
}
