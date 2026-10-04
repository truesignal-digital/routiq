# Control-adapter contract

The repro run does not know how to start or drive ROUTIQ by itself. It uses one control adapter: the `verify-routiq` skill and its CLI, `pnpm verify` (`tools/verify/`). The feature map at `.agents/skills/verify-routiq/features/` says how to reach and drive each feature.

If the skill, the feature map, or a required capability is absent or broken, repro and fix work fails closed.

## Required capabilities and how pnpm verify provides them

| Capability | Command | Returns |
|---|---|---|
| Bring up | `pnpm verify up --slot N` | Slot ports, compose project `routiq-verify-N`, PIDs and log paths in `.verify/slots/N/state.json` |
| Confirm the right app | `pnpm verify doctor --slot N` | PASS/FAIL per check: database, migrations, API health, web, seeded logins |
| Drive the real UI | `pnpm verify drive <route | flow:name | script.ts> [--slot N] [--role R] [--lang en] [--video]` | Screenshots, console errors, failed requests, final URL, in a printed evidence directory |
| Drive mapped features and states | The feature file's `Driving it with pnpm verify` section, run as `pnpm verify drive <script.ts> --slot N` | Same as above, one screenshot per step |
| Inspect state, read-only | `pnpm verify api GET <path> --role R`, `pnpm verify db "select ..."` | JSON body and status; query rows. `db` refuses anything but a single read statement |
| Screenshot | Every `drive` step writes `NN-<label>.png` | Path printed on stdout |
| Recording | `pnpm verify drive ... --video` | A `.webm` of the whole drive in the evidence directory |
| Cleanup | `pnpm verify down --slot N` | Stops the processes it started and removes only that slot's containers and volumes. Evidence under `.verify/` stays |

## Rules for driving

- Prefer roles and accessible names (`getByRole("button", { name: "Approve", exact: true })`) and route paths. Never use generated CSS classes, child indexes or DOM position.
- Do not set internal state, call hidden app methods, write directly to Postgres, or inject DOM changes to create the symptom. Arranging a precondition through a real command (`pnpm verify api POST /v1/commands/<name> ...`) is allowed; the repro itself must come from UI interaction.
- The app is French by default and stores a language chosen on More per device (#127). Each drive starts with empty storage; `drive --lang en` switches through the UI for you.
- Use the same slot inputs (commit, seed, role, language) for the baseline and the patched build.
- Bound retries. Surface startup failures as failures.
- Keep tokens out of logs and evidence. `pnpm verify api` prints response bodies, never the bearer token.

## Environment translation

Before declaring an environment block, restate the defect without platform-specific nouns and ask whether the same behavior can be tested safely here. A low-end Android phone may translate to a 360 x 740 viewport (`--viewport 360x740`); an offline report may translate to stopping the API mid-flow. Label translated attempts as translated evidence. Do not call it an exact repro when the missing environment is part of the defect.

## Setup check

Before the first unattended run on a machine, run one harmless adapter check:

1. `pnpm verify up --slot N`
2. `pnpm verify doctor --slot N`
3. Read one feature file.
4. `pnpm verify drive <its route> --role <its role> --lang en --video`
5. `pnpm verify api GET /v1/me --role <its role>`
6. Open the printed screenshot and video.
7. `pnpm verify down --slot N`, then check the evidence is still there.

Enable unattended repro runs only when all seven steps succeed.
