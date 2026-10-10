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
import { compare, measure } from "./run.js";

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
  compare --before A --after B [--record]
                         before and after on two built slots, runs alternating so the
                         machine's load lands on both alike; prints medians and the change;
                         --record appends the before run then the after run to the
                         history (a fair "previous → today" pair); tighten reads the after
  report                 rewrite docs/performance/README.md from the history`;

const LAST = path.join(VERIFY_DIR, "perf", "last.json");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const VALUED = new Set(["--slot", "--runs", "--reason", "--before", "--after"]);
const [command = "help", ...rest] = args.filter((arg, i) => !arg.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));

function lastRun(): Run {
  if (!existsSync(LAST)) throw new Error("no run yet: pnpm perf run --slot N");
  const run = JSON.parse(readFileSync(LAST, "utf8")) as Run;
  // A median over fewer runs than asked for is not a number to set a ceiling from.
  if ((run.incomplete?.length ?? 0) > 0) throw new Error(`the last run is missing data (${run.incomplete?.join(", ")}); run it again`);
  return run;
}

function record(run: Run): void {
  mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  appendFileSync(HISTORY_PATH, `${JSON.stringify(run)}\n`);
  writeFileSync(README_PATH, renderReadme(readHistory(), readCeilings()));
  process.stdout.write(`recorded in ${path.relative(process.cwd(), HISTORY_PATH)}\n`);
}

const fmt = (name: string, value: number) => (name.endsWith("_bytes") ? `${(value / 1024).toFixed(1)} kB` : name.endsWith(".requests") || name.endsWith(".shifts") ? String(value) : `${Math.round(value)} ms`);

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
    // A metric that stops being measured would otherwise pass forever: a renamed journey, telemetry off, a dropped batch.
    let trustworthy = true;
    for (const name of run.incomplete ?? []) {
      failed = true;
      trustworthy = false;
      process.stdout.write(`GAPS  ${name}: some runs did not produce it\n`);
    }
    for (const v of judge(run.metrics, readCeilings())) {
      if (v.status === "missing") {
        failed = true;
        trustworthy = false;
        process.stdout.write(`GONE  ${v.name}: not measured this run (ceiling ${fmt(v.name, v.ceiling)}); if the screen is gone, delete its ceilings from tools/perf/ceilings.json\n`);
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
    if (args.includes("--record") && !trustworthy) {
      process.stdout.write("not recorded: the run is missing data (GONE or GAPS above)\n");
    } else if (args.includes("--record")) {
      record(run);
    }
    return failed ? 1 : 0;
  }
  if (command === "compare") {
    const before = requireState(Number(flag("before")));
    const after = requireState(Number(flag("after")));
    const result = await compare(before, after, Number(flag("runs") ?? 7), (line) => process.stdout.write(`${line}\n`));
    const names = [...new Set([...Object.keys(result.before.metrics), ...Object.keys(result.after.metrics)])].sort();
    process.stdout.write(`\n| Metric | Before (${result.before.commit}) | After (${result.after.commit}) | Change |\n|---|---|---|---|\n`);
    for (const name of names) {
      const a = result.before.metrics[name]?.value;
      const b = result.after.metrics[name]?.value;
      const change = a === undefined || b === undefined || a === 0 ? "–" : `${b <= a ? "−" : "+"}${Math.abs(Math.round(((b - a) / a) * 100))}%`;
      process.stdout.write(`| \`${name}\` | ${a === undefined ? "–" : fmt(name, a)} | ${b === undefined ? "–" : fmt(name, b)} | ${change} |\n`);
    }
    for (const gap of [...(result.before.incomplete ?? []), ...(result.after.incomplete ?? [])]) process.stdout.write(`GAPS  ${gap}\n`);
    const complete = (result.before.incomplete?.length ?? 0) + (result.after.incomplete?.length ?? 0) === 0;
    // The after run is the one to keep: measured side by side with the before, so the machine's load is the same.
    mkdirSync(path.dirname(LAST), { recursive: true });
    writeFileSync(LAST, `${JSON.stringify(result.after, null, 2)}\n`);
    // Both halves, before then after: in the ledger, "previous" and "today" are then a pair measured under the same load.
    if (args.includes("--record")) {
      if (complete) {
        record(result.before);
        record(result.after);
      } else process.stdout.write("not recorded: the run is missing data (GAPS above)\n");
    }
    return complete ? 0 : 1;
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
