# Field telemetry is written outside the command pipeline

The web app reports what happens on users' devices to `POST /v1/telemetry`:
errors, the device and network it runs on, Core Web Vitals, and how long
journeys take, from a user's action to its result on screen. These events go
straight into `telemetry.events`. They do not pass through the command
pipeline, write no receipt and no audit event, and no tenant read serves them.
(Decided 2026-10-05.)

Every other write in ROUTIQ is a command (ARCHITECTURE.md §1, §5). Telemetry
is the second sanctioned exception, after sign-in sessions, for the same
reason: it is not a fact a tenant owns. Routing it through the pipeline would
write an audit event for every page load, need an idempotency key per
measurement, and make a failing beacon a failing command.

The rules that keep the exception narrow:

- **Its own schema.** `telemetry.events` lives outside `public`, so the tenant
  rules for business tables (row-level security, provenance, row versions)
  neither apply to it nor have to make exceptions for it.
- **Write-only for the runtime.** `routiq_app` may INSERT, and DELETE rows past
  retention, which needs SELECT on `received_at` alone. It cannot read an event
  back, so no code path can show one tenant's telemetry to anyone. Operators
  read it with the owner role through `pnpm observe`.
- **The server names the sender.** The workspace and role come from the
  session when there is one, never from the body. Events sent before sign-in
  or with an expired session are kept without a workspace.
- **Nothing personal.** No principal or person id, no value a user typed, no
  full URL: routes are templates (`/activities/:id`), error messages are
  capped at 500 characters and lose their query strings.
- **Kept 90 days.** The API deletes older events at boot and daily.
- **Bounded.** At most 50 events per request, 128 KB per body, 300 events per
  sender per minute. A rejected batch is answered and dropped; the client never
  retries a 400.
- **Provider-neutral.** It is a table in the database ROUTIQ already runs, so
  an on-prem box needs nothing new (§6a). Sentry stays optional for API
  failures.

The command ledger is the other half of observability and needs no exception:
`commands` already records every write's type, origin, outcome and failure
code, and now `duration_ms`, the server time to finalise its receipt.

Field numbers become ratchets only when there are enough of them:
`pnpm observe ratchet` holds a journey's p75 to its ceiling once a release has
at least the minimum number of samples, and reports "not enough data" below
it. Until pilot traffic grows, the lab (`pnpm verify`) stays the source for
performance, and the field is the source for errors, friction and the real
device profile.
