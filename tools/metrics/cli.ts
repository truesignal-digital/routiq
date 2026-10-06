import path from "node:path";
import { METRICS, handRaised, judge, measureWebBuild, raise, readCeilings, tighten, writeCeilings, type Ceilings, type MetricId } from "./metrics.js";
import { fileAtRef } from "../guards/scan.js";
import { REPO_ROOT } from "../verify/slot.js";

const HELP = `pnpm metrics [check | tighten | raise <metric> --reason "..."] [--dist apps/web/dist]

  check     measure the web build against tools/metrics/ceilings.json (default)
  tighten   lower ceilings to the measured values; sets ceilings that are missing
  raise     lift one ceiling to its measured value and record why in ceilings.json

Metrics:
${Object.entries(METRICS).map(([id, text]) => `  ${id}  ${text}`).join("\n")}`;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const command = args.find((arg) => !arg.startsWith("--") && arg !== flag("dist") && arg !== flag("reason")) ?? "check";
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;

try {
  if (command === "help" || args.includes("--help")) {
    process.stdout.write(`${HELP}\n`);
  } else {
    const dist = path.resolve(REPO_ROOT, flag("dist") ?? "apps/web/dist");
    const values = measureWebBuild(dist);
    const ceilings = readCeilings();
    if (command === "check") {
      let failed = false;
      const baseRef = process.env["GUARD_BASE_REF"] ?? "origin/develop";
      const [baseFile] = fileAtRef(baseRef, "tools/metrics/ceilings.json");
      const base = baseFile === undefined ? {} : (JSON.parse(baseFile.content) as Ceilings);
      for (const id of handRaised(ceilings, base)) {
        failed = true;
        process.stdout.write(`RAISED ${id}: ceiling ${ceilings[id]?.ceiling} B is above ${baseRef}'s ${base[id]?.ceiling} B with no raise record. Undo the edit; if the growth is worth it, run pnpm metrics raise ${id} --reason "..."\n`);
      }
      for (const verdict of judge(values, ceilings)) {
        const line = `${verdict.id} ${kb(verdict.value)} (${verdict.value} B)`;
        if (verdict.status === "unset") process.stdout.write(`UNSET ${line}; run pnpm metrics tighten to set its ceiling\n`);
        else if (verdict.status === "ok") process.stdout.write(`OK    ${line} at its ceiling\n`);
        else if (verdict.status === "stale") {
          failed = true;
          process.stdout.write(`TIGHT ${line} is below its ceiling ${verdict.ceiling} B; run pnpm metrics tighten to lock the gain in\n`);
        } else {
          failed = true;
          process.stdout.write(
            `OVER  ${line} is ${verdict.value - verdict.ceiling} B over ${verdict.ceiling} B. Shrink it, or if the growth is worth it: pnpm metrics raise ${verdict.id} --reason "..."\n`,
          );
        }
      }
      process.exitCode = failed ? 1 : 0;
    } else if (command === "tighten") {
      writeCeilings(tighten(values, ceilings));
      process.stdout.write("Ceilings match the build.\n");
    } else if (command === "raise") {
      const id = args[args.indexOf("raise") + 1] as MetricId;
      if (!(id in METRICS)) throw new Error(`unknown metric "${id}"`);
      const next = raise(values, ceilings, id, flag("reason") ?? "", new Date().toISOString().slice(0, 10));
      writeCeilings(next);
      process.stdout.write(`${id} ceiling raised to ${values[id]} B. The reason is in tools/metrics/ceilings.json for review.\n`);
    } else {
      throw new Error(`unknown command "${command}"\n${HELP}`);
    }
  }
} catch (error) {
  process.stderr.write(`metrics: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
