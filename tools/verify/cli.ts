import { callApi } from "./api.js";
import { parseArgs, type Command } from "./args.js";
import { db, doctor, down, logs, status, up } from "./stack.js";

const HELP = `pnpm verify <command> [options]

Run ROUTIQ on an isolated slot (own compose project, volumes and ports), drive it
with a headless browser, and keep the evidence under .verify/.

Commands
  up [--slot N] [--reseed] [--built]
                               start postgres + storage (compose project routiq-verify-N),
                               the API (migrates at boot), the demo seed, and the web app;
                               --built builds it and serves the build (vite preview), so
                               load times match a deployed app instead of the dev server
  doctor [--slot N]            PASS/FAIL health checks; exits 1 on any failure
  status                       list slots that are up in this checkout
  login [--role R] [--lang en] log in through the UI and screenshot the landing page
  drive <target...> [--role R] [--lang en] [--reel] [--throttle phone] [--video] [--viewport 1440x900] [--strict] [--headed]
                               target: a route (/finance/entries), a flow (flow:<name> from
                               tools/verify/flows/) or a script file exporting a DriveScript
  ui <target...>               same as drive
  api <METHOD> <path> [--role R] [--json '{...}' | --json @file.json]
                               call the slot API as a seeded account; prints JSON
  db "<select ...>"            read-only SQL against the slot database
                               --reel records the screen and writes reel.mp4 when it ends
  reel [run-dir] [--before run-dir] [--title "..."]
                               replay a --reel drive as a short captioned reel.mp4 plus
                               reel-sheet.png; with --before, both runs play side by side,
                               synced at each shot, and the end card compares their counts.
                               Without run-dir: the newest drive run.
  logs [api|web|seed|all]      tail the slot's process logs
  down [--slot N]              stop this slot's processes; remove only routiq-verify-N
                               containers and volumes. Evidence stays.

Every command except status takes --slot N; without it the command uses slot 1
(or ROUTIQ_VERIFY_SLOT), so pass --slot whenever you brought up another slot.
Slots: N is 0-99. Slot N uses ports 24000+10N:
postgres +0, storage +1, api +2, web +3.
Roles: director (emilienne, the default), admin (boris), admin-yde (amadou), finance (nadege),
cashier (clarisse), technician (herve), driver (sali), driver-yde (patrice); role codes and
usernames work too.`;

async function main(command: Command): Promise<boolean> {
  switch (command.name) {
    case "help":
      process.stdout.write(`${HELP}\n`);
      return true;
    case "status":
      status();
      return true;
    case "up":
      await up(command.slot, command.reseed, command.built);
      return true;
    case "down":
      await down(command.slot);
      return true;
    case "doctor":
      return doctor(command.slot);
    case "logs":
      logs(command.slot, command.service);
      return true;
    case "login": {
      const { drive } = await import("./browser.js");
      return drive(command.slot, [], command.options, "login");
    }
    case "drive": {
      const { drive } = await import("./browser.js");
      return drive(command.slot, command.targets, command.options, "drive");
    }
    case "api":
      return callApi(command.slot, command.method, command.path, command.role, command.body);
    case "db":
      return db(command.slot, command.sql);
    case "reel": {
      const path = await import("node:path");
      const { buildReel, latestDriveRun } = await import("./reel.js");
      const initCwd = process.env["INIT_CWD"] ?? process.cwd();
      const after = command.after === undefined ? latestDriveRun() : path.resolve(initCwd, command.after);
      const before = command.before === undefined ? undefined : path.resolve(initCwd, command.before);
      const out = await buildReel(after, before, { title: command.title });
      process.stdout.write(`reel: ${out.mp4} (${out.seconds} s)\nsheet: ${out.sheet}\n`);
      return true;
    }
  }
}

try {
  const ok = await main(parseArgs(process.argv.slice(2), process.env));
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`verify: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
