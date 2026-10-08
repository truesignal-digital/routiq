---
name: verify-routiq
description: "Run the real ROUTIQ app (Postgres, S3 storage, Fastify API, Vite web) on an isolated slot and drive it like a user with a headless browser, capturing screenshots, console errors, failed requests, API responses and read-only DB rows as evidence. Use to prove a UI, command or read change works in the running app, to reproduce a bug, or before claiming a feature is done. CLI: pnpm verify."
---

# Verify ROUTIQ

`pnpm verify` (`tools/verify/`) starts a private copy of the stack on a numbered slot, seeds the Transports Ngwa demo workspace, and drives the web app with Playwright. Evidence lands in `.verify/` at the checkout root and survives teardown. The feature map in [`features/README.md`](features/README.md) says how to reach and prove each feature.

Never touch the owner's dev stack: Postgres on 5435 with volume `routiq_pgdata`, the API on 3001, web on 5173, the demo box on 8080. The CLI refuses those ports and only ever removes `routiq-verify-N` compose projects.

## Launch

```bash
pnpm install --frozen-lockfile      # once per checkout
pnpm verify up                       # slot 1; pick another with --slot N (0-99) or ROUTIQ_VERIFY_SLOT
```

`up` needs Docker running. It:

1. writes `.verify/slots/N/compose.yml` and starts compose project `routiq-verify-N`: Postgres 17 and RustFS storage (the digest `docker-compose.yml` pins), each with its own volume, published on loopback only;
2. starts the API from this checkout (`apps/api/src/boot.ts`, which migrates, creates the `artifacts` bucket and serves) with S3 wired in, so uploads work;
3. runs `apps/api/scripts/seed-demo.ts`;
4. starts Vite with a generated config that spreads `apps/web/vite.config.ts` and points the dev server and the `/v1` proxy at the slot.

Slot N owns ports 24000+10N: Postgres +0, storage +1, API +2, web +3. Slot 1 is web `http://127.0.0.1:24013`, API `http://127.0.0.1:24012`. Ready means `up` printed `web up, proxying /v1 to the slot API`; it takes about 15 s warm. PIDs, ports and log paths are in `.verify/slots/N/state.json`.

- `pnpm verify up --built` builds the web app and serves the build with `vite preview` (same port, same `/v1` proxy), so load times match a deployed app. `pnpm perf` needs it; the dev server's unbundled cold load says nothing about users. Rebuild by `down` then `up --built` after web changes.
- Already up: `up` says so and does nothing. `pnpm verify up --reseed` resets the demo workspace (`seed-demo --reset`) on a running slot; do this between runs that mutate data.
- A port in use means another checkout holds that slot. Pick another `--slot`; never kill its processes.
- Two checkouts can run at once on different slots. Code changes in this checkout reload in the web app (Vite HMR); API changes need `down` then `up`.

Teardown is `pnpm verify down` (see Cleanup).

## Doctor

```bash
pnpm verify doctor [--slot N]
```

Read-only. One PASS/FAIL line per check, exit 1 on any failure: containers healthy, database reachable, migrations applied (rows in `drizzle.__drizzle_migrations` = entries in `apps/api/drizzle/meta/_journal.json`), API `/health` with the port held by this slot's own process group, storage live, web serves the app, web proxies `/v1` to this slot (`GET /v1/me` → 401), and every seeded account logs in. Run it before the first drive and again after anything surprising. `pnpm verify status` lists slots that are up; `pnpm verify logs [api|web|seed]` tails their logs.

## Drive

```bash
pnpm verify login --role admin --lang en                 # log in through the UI, screenshot home
pnpm verify drive /assets /finance/entries --role director # visit routes in-app, one screenshot each (alias: ui)
pnpm verify drive flow:vehicle-workspace --role admin --lang en --video
pnpm verify drive path/to/script.ts --role finance         # your own DriveScript
pnpm verify api GET /v1/me --role finance                  # API as a seeded account, JSON out
pnpm verify api POST /v1/commands/approve-entry --role finance --json @body.json
pnpm verify db "select entry_number, status from financial_entries order by 1"
```

Options for `login` and `drive`: `--role` (default `director`), `--lang fr|en` (default `fr`), `--reel` (records the screen and builds `reel.mp4`, see Reel), `--throttle phone` (CPU 4x slower and slow 4G: 150 ms RTT, 1.6 Mbps down, like the pilot users' phones; applied after sign-in, because the dev server's unbundled cold load says nothing about a built app's), `--video` (records `drive.webm`), `--viewport 360x740` (phone; the sidebar becomes a sheet), `--strict` (fail on console errors), `--headed`.

Every drive logs in through the real form (Workspace `transports-ngwa`, Username, PIN code, "Se connecter"). Seeded accounts, from `apps/api/scripts/seed-demo.ts`:

| `--role` | User | PIN | Role | Branches |
|---|---|---|---|---|
| `director` | emilienne | 111111 | DIRECTOR (Direction) | all |
| `admin` (`manager`) | boris | 222222 | ADMIN (Administrateur) | all |
| `admin-yde` | amadou | 555555 | ADMIN | YDE only |
| `finance` | nadege | 777777 | FINANCE | all |
| `cashier` | clarisse | 888888 | CASHIER (Caissier / Caissière) | DLA only |
| `technician` | herve | 666666 | TECHNICIAN (Technicien) | all |
| `driver` (`field`) | sali | 333333 | DRIVER (Chauffeur) | all |
| `driver-yde` | patrice | 444444 | DRIVER | YDE only (sees no trucks) |

Role codes and usernames work too (`--role FINANCE`, `--role boris`). Who may do what: `docs/reference/roles-and-access.md`.

**Language.** The app starts in French. A choice made on More is stored per device in `localStorage["routiq-language"]` and survives full loads (#127). `--lang en` switches through the UI (Plus → English) after login, so every run starts from a clean browser and proves the switch. Navigate by clicking or with `ctx.nav(route)`; `page.goto` is fine for deep links now that the choice persists.

**Flows** are committed DriveScripts in `tools/verify/flows/`, run as `flow:<name>`. Each drives one feature by clicks and ends with a read-only API cross-check:

| Flow | Proves | Mutates |
|---|---|---|
| `home` | dashboard cards match `GET /v1/dashboard` | no |
| `switch-user` | sign out, sign in as the cashier, role from `GET /v1/me` | no |
| `vehicle-workspace` | trucks list → VH003 → every tab the role sees | no |
| `edit-details` | Details → Edit details → make and model saved | yes |
| `add-note` | VH003 → Add note: empty submit shows the error summary and sends nothing, its link focuses the field, then the note lands in `GET /v1/assets/:id/history` (#290). Desktop or `--viewport 390x844` | yes |
| `assigned-driver` | VH003 → All actions → Change assigned driver → Details and History say assigned driver, never custodian (#91) | yes |
| `work-order` | create a work order from a problem, complete it with a 55,000 XAF cost | yes |
| `finance-entry` | entries list → drawer → Open full screen → detail | no |
| `approve-entry` | approvals queue → ⋯ → Approve (one tap) → entry POSTED | yes |
| `approve-from-panel` | approvals queue → entry number → record panel (receipt, history) → Approve → entry POSTED, row gone | yes |
| `repaired-awaiting-release` | as the technician: VH003 red → Complete work → amber "Repair done — waiting for release to service", no release button; as the Administrateur: amber with Release to service → release → green (#92) | yes |
| `record-and-approve-expense` | as the cashier, record a 150,000 XAF expense → sign in as Finance → approve it; after each command the entry's history holds that command's audit event (#153). Run with `--role cashier` | yes |
| `reverse-entry` | detail → Cancel entry, reason Wrong details → Record again pre-filled → new entry; original REVERSED with its reason | yes |
| `trips` | trips list → a closed trip's detail | no |
| `overview-tab` | VH003 opens on Overview; To do first and open, collapses to its count, stays collapsed after a reload (#90) | no (device preference only) |
| `attach-receipt` | upload a PNG receipt through storage → evidence SUPPLIED | yes |
| `settings` | Branches, Users, People (sidebar row or name menu) against their reads | no |
| `phone-overflow` | every demo account, every list route plus an open and a closed trip at 390 × 844 in fr and en: no sideways scroll, no control past the right edge, trip number on one line (#183, #395) | no |
| `phone-list-rows` | every module list at 390 px: rows at least 60 px, no card border, no stray " · –"; entries → Filters → pick a status → "Filters (1)" and the rows match `GET /v1/finance/entries?status=POSTED` (#300). Run with `--viewport 390x844` | no |
| `form-fits-viewport` | entry detail → Edit (Sali's pending entry), Reject (pending, as Finance), Reverse (posted, as Finance) at 1440 × 900, 1366 × 768 and 390 × 844 in fr and en: the form's surface, title and submit stay inside the window and the submit is not covered (#470) | no |
| `scoped-header` | Douala picked, light and dark, on Home scrolled under the header: header background opaque, `::before` tint at primary 5% covering it at z-index -10, controls win the hit test, header pixels unchanged by scrolling; then all branches: plain header (#57). Checks the run's `--lang` and `--viewport` | no |

A DriveScript is a default export `async (ctx) => {}`; see `DriveContext` in `tools/verify/browser.ts`. `ctx` gives `page` (Playwright), `nav`, `shot(label, { caption, highlight })`, `quiet()` (waits for `/v1` traffic to settle), `t(fr, en)` for labels, `log(line)`, `apiGet(path)` as the logged-in user, plus `account`, `lang` and `state`. `caption` is one English sentence saying what the frame proves; `highlight` is a locator the shot outlines, and the reel zooms into it. Copy a flow as a starting point; `approve-from-panel` uses both. Prefer roles and accessible names (`getByRole("button", { name, exact: true })`), scope to a `dialog` or `row` when a name repeats, and look record numbers up through `apiGet` instead of hardcoding them.

`api` prints the status and pretty JSON and never prints the token. Commands take `{ "version": 1, "envelope": { "commandId": "<uuid>", "idempotencyKey": "<unique>", "origin": "HUMAN_UI", "expectedVersion": <n> }, "payload": { ... } }`. Quote paths with `?` in zsh: `pnpm verify api GET '/v1/finance/entries?status=POSTED'`.

`db` runs as the database owner, so row-level security does not hide rows. It refuses anything but one SELECT, WITH, TABLE, VALUES, SHOW or EXPLAIN statement (no writes, no `INTO`, no `FOR UPDATE`, no side-effect functions) and runs the session with `default_transaction_read_only=on`.

## Evidence

Each `drive`, `login` and `api` run writes a new directory, printed on stdout: `.verify/<UTC time>-<command>-s<slot>/`.

- `NN-<label>.png`: full-page screenshots, one per route or `shot()`; `failed-<step>.png` when a step fails.
- `frames/NN-<label>.png`: the same moment at viewport size, for the contact sheet.
- `cast/` with `--reel`: every painted frame as a JPEG and `index.json` with their times.
- `console-errors.txt`: `console.error` and uncaught errors, message plus first app frame.
- `failed-requests.txt`: responses with status 400 or higher and network failures. Requests the app cancels itself (`net::ERR_ABORTED` on navigation) are counted on stdout, not listed.
- `summary.json`: slot, commit, account, language, each step with PASS/FAIL and URL, the shots with their captions, times and highlight boxes, and `metrics`: API requests, console errors, failed requests, layout shifts and CLS since the last full load, DOM nodes at the end.
- `drive.webm` with `--video`.
- `request.json` and `response.json` for `api`.
- `up` writes `api.log`, `web.log`, `seed.log` and `compose.log` to its own run directory.

Proof standards:

- Drive the real user path: log in, click through the UI. Do not inject state, call hidden app methods or write to Postgres to create a result. Arranging a precondition through a real command (`pnpm verify api POST /v1/commands/...`) is fine; say so.
- Capture the action and the resulting state, not only the final screen.
- Cross-check side effects with a read: `apiGet` inside the flow, or `pnpm verify api GET ...` and `pnpm verify db "select ..."` after. A toast is not proof.
- Open the screenshots you cite. Report console errors and failed requests even when the drive passes.
- For PR evidence build a reel (below). The long narrated walkthrough (the `review-video` kit) is only for when the owner asks; `--video` here is raw evidence, not a walkthrough.

## Reel

```bash
pnpm verify drive flow:approve-from-panel --role finance --lang en --reel   # records the screen, writes reel.mp4 at the end
pnpm verify reel .verify/<after-run> --before /path/to/base-checkout/.verify/<before-run> --title "What changed (#NN)"
```

A reel is the PR evidence: a 1080p mp4 of the real flow, usually 10 to 25 seconds, plus `reel-sheet.png`, a contact sheet of every shot. `--reel` records every frame the page paints (Chrome screencast, `cast/` in the run directory) and marks each `shot()` as a beat. The reel replays the recording in the app's own fonts and colours (read from `apps/web/src/styles.css`): it plays up to each shot, holds there while the caption shows and the camera eases into the highlight, then moves on, and it ends on the run's counts. Idle stretches longer than 0.6 s play at 0.6 s; the clock above each pane always shows real seconds.

With `--before`, both runs play side by side, synced at each shot (`reel-compare.mp4`), and the end card shows each count before and after. A before run that failed stops at the first screen it never reached, with the reason in red ("Stopped at 31.2 s: couldn't click within 30 s"), and its counts are shown without a win/loss verdict. To get a before run: `git worktree add --detach <dir> origin/develop`, `pnpm install` there, `pnpm verify up --slot <other>` from it, then drive the same flow file by its absolute path from that checkout with `--reel`. The base checkout's `tools/verify` must already record casts; for an older base, copy this checkout's `tools/verify/*.ts` over it first. Remove the extra worktree and `down` its slot afterwards.

Before uploading, open `reel-sheet.png` and pull a few frames out of the mp4 (`ffmpeg -ss 5 -i reel.mp4 -frames:v 1 check.png`) to check the captions match what's on screen. Needs `ffmpeg` on the machine.

## Observe

Drives send real telemetry, and every command lands in the ledger, so a slot is a small field:

```bash
pnpm observe report --slot N            # ledger, refusals, write lag, approval wait, client errors, devices, journeys, vitals, server routes
pnpm observe report --slot N --json     # the same for scripts
```

Use it to read a change's effect on journeys (`command:<name>`, `route:<template>`, `app:usable`) and on server time, and to check a drive caused no client errors. Lab percentiles from a handful of drives are anecdotes; say n when you quote them.

## Cleanup

```bash
pnpm verify down [--slot N]
```

Stops the API and web process groups recorded in the state file (by PID, never by name), runs `docker compose -p routiq-verify-N down -v --remove-orphans`, which removes that slot's containers and its two volumes and nothing else, and deletes `.verify/slots/N/`. It refuses any project name that is not `routiq-verify-N`. Evidence and logs under `.verify/` stay; delete old run directories by hand when you no longer need them. Run `down` after every failed `up` too, so a half-started slot doesn't hold its ports. If `down` warns that a port is still in use, that process was not started by this slot; leave it alone and report it.

Keep the map honest with `/maintain-verification-skill`. The pure parts of the CLI have tests: `pnpm --filter @routiq/tools exec vitest run verify`.
