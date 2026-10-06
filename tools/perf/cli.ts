import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { requireState } from "../verify/stack.js";
import { VERIFY_DIR } from "../verify/slot.js";
import {
  HISTORY_PATH,
  README_PATH,
  judge,
  raise,
  readCeilings,
  readHistory,
  renderReadme,
  tighten,
  writeCeilings,
  type Run,
} from "./perf.js";
import { measure } from "./run.js";

const HELP = `pnpm perf <command> [--slot N] [--runs 5]

The performance ledger: the built app on the pilot-phone profile, the app's own
journeys and vitals, against ceilings that only go down (tools/perf/ceilings.json).

Commands
  run [--record]         measure (needs pnpm verify up --slot N --built), compare with the
                         ceilings, exit 1 if any is over; --record appends the run to
                         docs/performance/history.jsonl and rewrites docs/performance/README.md
  tighten                lower the ceilings the last run beat, and add new metrics
  raise <metric> --reason "..."
                         lift one ceiling to the last run's value and record why
  report                 rewrite docs/performance/README.md from the history`;

const LAST = path.join(VERIFY_DIR, "perf", "last.json");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const VALUED = new Set(["--slot", "--runs", "--reason"]);
const [command = "help", ...rest] = args.filter((arg, i) => !arg.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));

function lastRun(): Run {
  if (!existsSync(LAST)) throw new Error("no run yet: pnpm perf run --slot N");
  return JSON.parse(readFileSync(LAST, "utf8")) as Run;
}

const fmt = (name: string, value: number) => (name.endsWith("_bytes") ? `${(value / 1024).toFixed(1)} kB` : name.endsWith(".requests") ? String(value) : `${Math.round(value)} ms`);

async function main(): Promise<number> {
  if (command === "help" || args.includes("--help")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (command === "run") {
    const state = requireState(Number(flag("slot") ?? process.env["ROUTIQ_VERIFY_SLOT"] ?? 1));
    const runs = Number(flag("runs") ?? 5);
    const run = await measure(state, runs, (line) => process.stdout.write(`${line}\n`));
    mkdirSync(path.dirname(LAST), { recursive: true });
    writeFileSync(LAST, `${JSON.stringify(run, null, 2)}\n`);
    let failed = false;
    for (const v of judge(run.metrics, readCeilings())) {
      if (v.status === "missing") {
        process.stdout.write(`GONE  ${v.name}: not measured this run (ceiling ${fmt(v.name, v.ceiling)})\n`);
        continue;
      }
      if (v.status === "new") {
        process.stdout.write(`NEW   ${v.name}: ${fmt(v.name, v.value)}\n`);
        continue;
      }
      if (v.status === "over") failed = true;
      const word = { ok: "OK   ", over: "OVER ", beaten: "BEAT " }[v.status];
      process.stdout.write(`${word} ${v.name}: ${fmt(v.name, v.value)} (ceiling ${fmt(v.name, v.ceiling)})\n`);
    }
    if (args.includes("--record")) {
      mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
      appendFileSync(HISTORY_PATH, `${JSON.stringify(run)}\n`);
      writeFileSync(README_PATH, renderReadme(readHistory(), readCeilings()));
      process.stdout.write(`recorded in ${path.relative(process.cwd(), HISTORY_PATH)}\n`);
    }
    return failed ? 1 : 0;
  }
  if (command === "tighten") {
    const { next, lowered } = tighten(lastRun().metrics, readCeilings());
    writeCeilings(next);
    writeFileSync(README_PATH, renderReadme(readHistory(), next));
    process.stdout.write(lowered.length > 0 ? `Lowered:\n${lowered.join("\n")}\n` : "No ceiling beaten; new metrics added if any.\n");
    return 0;
  }
  if (command === "raise") {
    const name = rest[0];
    if (name === undefined) throw new Error('raise <metric> --reason "..."');
    const next = raise(lastRun().metrics, readCeilings(), name, flag("reason") ?? "", new Date().toISOString().slice(0, 10));
    writeCeilings(next);
    writeFileSync(README_PATH, renderReadme(readHistory(), next));
    process.stdout.write(`${name} raised to ${next[name]?.ceiling}; the reason is in tools/perf/ceilings.json\n`);
    return 0;
  }
  if (command === "report") {
    writeFileSync(README_PATH, renderReadme(readHistory(), readCeilings()));
    process.stdout.write(`${path.relative(process.cwd(), README_PATH)} rewritten\n`);
    return 0;
  }
  throw new Error(`unknown command "${command}"\n${HELP}`);
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`perf: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
