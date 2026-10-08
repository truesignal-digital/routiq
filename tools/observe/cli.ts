import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { slotPorts, slotDir } from "../verify/slot.js";
import {
  buildReport,
  connect,
  fieldSample,
  judgeField,
  parseWindow,
  readFieldCeilings,
  renderReport,
  writeFieldCeilings,
  type FieldCeiling,
} from "./observe.js";

const HELP = `pnpm observe <command> [--slot N | --database-url URL] [--since 7d]

What happened in the field: the command ledger (every write) and the web app's
telemetry (errors, devices, journeys, web vitals; ADR-0011). Read-only.

Commands
  report [--json] [--api-log path]   the full picture; on a slot, server route
                                     timings come from the slot's API log
  ratchet [check]                    field ceilings (tools/observe/field-ceilings.json):
                                     a journey or vital's p75 in the newest release may
                                     not rise above its ceiling once it has minSamples
  ratchet tighten                    lower ceilings with at least 10% slack to the p75
  ratchet add <journey|vital> <name> [--min-samples 200]
                                     set a ceiling at the current p75 + 10%; needs
                                     enough samples

Connection: --database-url (owner role; set it for the demo box), else
OBSERVE_DATABASE_URL, else the verify slot (--slot N, default 1).`;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const VALUED = new Set(["--slot", "--database-url", "--since", "--api-log", "--min-samples"]);
const positionals = args.filter((arg, i) => !arg.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));

function databaseUrl(): { url: string; apiLog: string | undefined; lab: boolean } {
  const explicit = flag("database-url") ?? process.env["OBSERVE_DATABASE_URL"];
  if (explicit !== undefined) return { url: explicit, apiLog: flag("api-log"), lab: false };
  const slot = Number(flag("slot") ?? process.env["ROUTIQ_VERIFY_SLOT"] ?? 1);
  const statePath = path.join(slotDir(slot), "state.json");
  if (!existsSync(statePath)) throw new Error(`slot ${slot} is not up; pass --database-url or run pnpm verify up --slot ${slot}`);
  const state = JSON.parse(readFileSync(statePath, "utf8")) as { logs?: { api?: string } };
  return { url: `postgres://routiq:routiq@127.0.0.1:${slotPorts(slot).postgres}/routiq_dev`, apiLog: flag("api-log") ?? state.logs?.api, lab: true };
}

async function main(): Promise<number> {
  const [command = "help", sub, ...rest] = positionals;
  if (command === "help" || args.includes("--help")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const window = parseWindow(flag("since") ?? "7d");
  const { url, apiLog, lab } = databaseUrl();
  // A slot's numbers come from a laptop driving a headless browser; a field ceiling set from them would gate real users on lab noise.
  if (command === "ratchet" && (sub === "add" || sub === "tighten") && lab) {
    throw new Error(`ratchet ${sub} reads field data; pass --database-url for a real box. A verify slot is the lab.`);
  }
  const client = await connect(url);
  try {
    if (command === "report") {
      const report = await buildReport(client, window, apiLog);
      process.stdout.write(args.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : `${renderReport(report)}\n`);
      return 0;
    }
    if (command === "ratchet") {
      const ceilings = readFieldCeilings();
      if (sub === "add") {
        const [kind, name] = rest;
        if ((kind !== "journey" && kind !== "vital") || name === undefined) throw new Error("ratchet add <journey|vital> <name>");
        const minSamples = Number(flag("min-samples") ?? 200);
        const sample = await fieldSample(client, window, { kind, name });
        if (sample === undefined || sample.n < minSamples) throw new Error(`${kind} ${name}: ${sample?.n ?? 0} samples in the newest release, need ${minSamples}`);
        const next: FieldCeiling = { kind, name, p75: Math.ceil(sample.p75 * 1.1), minSamples };
        writeFieldCeilings([...ceilings.filter((c) => !(c.kind === kind && c.name === name)), next]);
        process.stdout.write(`${kind} ${name}: ceiling ${next.p75} (p75 ${Math.round(sample.p75)} in ${sample.release}, n=${sample.n})\n`);
        return 0;
      }
      if (ceilings.length === 0) {
        process.stdout.write("No field ceilings yet. Add one with pnpm observe ratchet add journey <name> once a release has enough samples.\n");
        return 0;
      }
      let failed = false;
      const next: FieldCeiling[] = [];
      for (const ceiling of ceilings) {
        const verdict = judgeField(ceiling, await fieldSample(client, window, ceiling));
        const label = `${ceiling.kind} ${ceiling.name}`;
        if (verdict.status === "thin") {
          process.stdout.write(`THIN  ${label}: ${verdict.n} of ${ceiling.minSamples} samples in ${verdict.release ?? "any release"}; not enforced\n`);
          next.push(ceiling);
        } else {
          const p75 = Math.round(verdict.p75);
          if (verdict.status === "over") failed = true;
          const word = { ok: "OK   ", over: "OVER ", slack: "SLACK" }[verdict.status];
          process.stdout.write(`${word} ${label}: p75 ${p75} vs ceiling ${ceiling.p75} (${verdict.release}, n=${verdict.n})\n`);
          next.push(sub === "tighten" && verdict.status === "slack" ? { ...ceiling, p75: Math.ceil(verdict.p75 * 1.1) } : ceiling);
        }
      }
      if (sub === "tighten") writeFieldCeilings(next);
      return failed ? 1 : 0;
    }
    throw new Error(`unknown command "${command}"\n${HELP}`);
  } finally {
    await client.end();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`observe: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
