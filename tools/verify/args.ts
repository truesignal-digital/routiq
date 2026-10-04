import { DEFAULT_SLOT, assertSlot } from "./slot.js";

export type Lang = "fr" | "en";

export interface Viewport {
  width: number;
  height: number;
}

export interface DriveOptions {
  role: string;
  lang: Lang;
  video: boolean;
  strict: boolean;
  headed: boolean;
  viewport: Viewport;
}

export type Command =
  | { name: "help" }
  | { name: "status" }
  | { name: "up"; slot: number; reseed: boolean }
  | { name: "down"; slot: number }
  | { name: "doctor"; slot: number }
  | { name: "logs"; slot: number; service: "api" | "web" | "seed" | "all" }
  | { name: "login"; slot: number; options: DriveOptions }
  | { name: "drive"; slot: number; targets: string[]; options: DriveOptions }
  | { name: "api"; slot: number; method: string; path: string; role: string; body: string | undefined }
  | { name: "db"; slot: number; sql: string };

const BOOLEAN_FLAGS: Record<string, readonly string[]> = {
  up: ["reseed"],
  login: ["video", "strict", "headed"],
  drive: ["video", "strict", "headed"],
};
const VALUE_FLAGS: Record<string, readonly string[]> = {
  up: ["slot"],
  down: ["slot"],
  doctor: ["slot"],
  logs: ["slot"],
  login: ["slot", "role", "lang", "viewport"],
  drive: ["slot", "role", "lang", "viewport"],
  api: ["slot", "role", "json"],
  db: ["slot"],
  status: [],
};

export const COMMAND_NAMES = ["up", "doctor", "status", "login", "drive", "ui", "api", "db", "logs", "down"] as const;

interface Parsed {
  positionals: string[];
  values: Map<string, string>;
  flags: Set<string>;
}

function tokenize(command: string, tokens: readonly string[]): Parsed {
  const booleans = BOOLEAN_FLAGS[command] ?? [];
  const valued = VALUE_FLAGS[command] ?? [];
  const parsed: Parsed = { positionals: [], values: new Map(), flags: new Set() };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    if (token === "--") {
      parsed.positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (!token.startsWith("--") || token === "-") {
      parsed.positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const key = token.slice(2, eq === -1 ? undefined : eq);
    if (booleans.includes(key)) {
      if (eq !== -1) throw new Error(`--${key} takes no value`);
      parsed.flags.add(key);
    } else if (valued.includes(key)) {
      const value = eq === -1 ? tokens[(i += 1)] : token.slice(eq + 1);
      if (value === undefined || value === "") throw new Error(`--${key} needs a value`);
      parsed.values.set(key, value);
    } else {
      throw new Error(`unknown option --${key} for "${command}"`);
    }
  }
  return parsed;
}

export function parseSlot(raw: string | undefined, env: Readonly<Record<string, string | undefined>>): number {
  const text = raw ?? env["ROUTIQ_VERIFY_SLOT"];
  if (text === undefined || text === "") return DEFAULT_SLOT;
  if (!/^\d+$/.test(text)) throw new Error(`slot must be a whole number, got "${text}"`);
  const slot = Number(text);
  assertSlot(slot);
  return slot;
}

export function parseViewport(raw: string | undefined): Viewport {
  if (raw === undefined) return { width: 1440, height: 900 };
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(raw);
  if (!match) throw new Error(`--viewport must look like 1440x900, got "${raw}"`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseLang(raw: string | undefined): Lang {
  if (raw === undefined || raw === "fr") return "fr";
  if (raw === "en") return "en";
  throw new Error(`--lang must be fr or en, got "${raw}"`);
}

function driveOptions(parsed: Parsed): DriveOptions {
  return {
    role: parsed.values.get("role") ?? "admin",
    lang: parseLang(parsed.values.get("lang")),
    video: parsed.flags.has("video"),
    strict: parsed.flags.has("strict"),
    headed: parsed.flags.has("headed"),
    viewport: parseViewport(parsed.values.get("viewport")),
  };
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export function parseArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = {}): Command {
  const [first, ...rest] = argv;
  if (first === undefined || first === "help" || first === "--help" || first === "-h") return { name: "help" };
  const name = first === "ui" ? "drive" : first;
  if (!(name in VALUE_FLAGS)) throw new Error(`unknown command "${first}". Run pnpm verify --help`);
  if (rest.includes("--help") || rest.includes("-h")) return { name: "help" };
  const parsed = tokenize(name, rest);
  const slot = () => parseSlot(parsed.values.get("slot"), env);
  const noPositionals = () => {
    if (parsed.positionals.length > 0) throw new Error(`"${name}" takes no arguments, got "${parsed.positionals.join(" ")}"`);
  };

  switch (name) {
    case "status":
      noPositionals();
      return { name };
    case "up":
      noPositionals();
      return { name, slot: slot(), reseed: parsed.flags.has("reseed") };
    case "down":
    case "doctor":
      noPositionals();
      return { name, slot: slot() };
    case "logs": {
      const service = parsed.positionals[0] ?? "all";
      if (parsed.positionals.length > 1 || !["api", "web", "seed", "all"].includes(service)) {
        throw new Error(`logs takes one of api, web, seed, all`);
      }
      return { name, slot: slot(), service: service as "api" | "web" | "seed" | "all" };
    }
    case "login":
      noPositionals();
      return { name, slot: slot(), options: driveOptions(parsed) };
    case "drive":
      if (parsed.positionals.length === 0) throw new Error("drive needs a route (e.g. /finance/entries) or a script file");
      return { name, slot: slot(), targets: parsed.positionals, options: driveOptions(parsed) };
    case "api": {
      const [method, path, ...extra] = parsed.positionals;
      const upper = method?.toUpperCase();
      if (upper === undefined || !HTTP_METHODS.has(upper)) throw new Error("api needs a method: GET, POST, PUT, PATCH or DELETE");
      if (path === undefined || !path.startsWith("/")) throw new Error("api needs a path starting with /, e.g. /v1/me");
      if (extra.length > 0) throw new Error(`unexpected arguments: ${extra.join(" ")}`);
      return { name, slot: slot(), method: upper, path, role: parsed.values.get("role") ?? "admin", body: parsed.values.get("json") };
    }
    case "db": {
      if (parsed.positionals.length !== 1) throw new Error('db takes one quoted query: pnpm verify db "select ..."');
      return { name, slot: slot(), sql: parsed.positionals[0] ?? "" };
    }
    default:
      throw new Error(`unknown command "${first}"`);
  }
}
