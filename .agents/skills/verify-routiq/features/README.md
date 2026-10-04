# ROUTIQ verification map

This directory is the maintained source for verifying what a ROUTIQ user can do. Read this index before driving the app, then use the matching feature file as the recipe. Routes come from `apps/web/src/router.tsx`, labels from `apps/web/src/i18n/locales/` and the trucking overlay in `apps/web/src/i18n/presets/`, data from `apps/api/scripts/seed-demo.ts`.

## Baseline preconditions

- A slot started by this run: `pnpm verify up --slot N`, then `pnpm verify doctor --slot N` all PASS.
- The demo workspace `transports-ngwa` as seeded: branches DLA (Douala), YDE, BAF; trucks VH001 and VH003 in service, trailer TR001; VH003 grounded by a safety-critical brake problem with an approved work order; two expenses pending approval; three trips.
- After any recipe that mutates data, `pnpm verify up --slot N --reseed` before the next run that needs the seed state.
- Never drive an instance that was not started by this run.

## Driving conventions

- Drive through `pnpm verify drive` (routes, `flow:<name>`, or a DriveScript). Every drive logs in through the form.
- French is the default. Pass `--lang en` for English; after that navigate only by clicks or `ctx.nav()` (#127).
- The demo workspace uses the trucking vocabulary: the sidebar says Camions/Trucks and Trajets/Trips, not Actifs/Assets or Activités/Activities.
- Prefer roles and accessible names. Use `exact: true` when one name is a prefix of another, and scope to `getByRole("dialog")` or a `row` when a name repeats on the page.
- Look record numbers (entry numbers, trip numbers, work-order references) up through the API. Entry numbers are assigned in seed order, which varies between reseeds.
- Restore seeded data after a mutation with `--reseed`. Cleanup never removes evidence.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof is a screenshot with the app chrome visible (sidebar with the signed-in user, breadcrumb).
- Mutation proof includes a read-only second view of the stored value: `apiGet` in the flow, `pnpm verify api GET ...` or `pnpm verify db "select ..."`.
- Record the feature file, role, language and entry point with every artifact.
- Report an unreachable path with the command you ran and the unmet precondition (role, module, seed state).
- Do not report a skipped entry point as verified through a different one.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with pnpm verify` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command or handle and the observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Sign in and switch roles](./sign-in-and-roles.md): PIN sign-in, the seven seeded roles, sign out and sign in as someone else.
- [Language](./language.md): French by default, English through More, held in memory.
- [Home dashboard](./home-dashboard.md): KPI cards per role, chart, recent entries.
- [Vehicle workspace](./vehicle-workspace.md): trucks list, VH003's Now, Maintenance, Money, Trips, Documents, History and Details tabs, editing details.
- [Maintenance and work orders](./maintenance-work-orders.md): problems, opening a work order, completing it with a cost.
- [Finance entries and reversal](./finance-entries.md): entries list, drawer, full-screen detail, reversal chain.
- [Finance approvals](./finance-approvals.md): the approvals queue, approve and reject.
- [Trips](./trips.md): trips list, trip detail, recording and closing a trip.
- [Documents and uploads](./documents-and-uploads.md): vehicle documents, receipt upload through object storage.
- [Settings](./settings.md): branches, users and roles, people.
