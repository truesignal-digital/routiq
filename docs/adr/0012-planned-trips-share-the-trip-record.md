# Planned trips are the same trip record, one status earlier

A dispatcher books a trip before it starts: "Thursday, Douala to Yaoundé, 30 t
of cement". The booking is **the trip record itself** (`activities`) in a new
first status, PLANNED. Starting it on the day turns that same row into the
running trip that drivers and the office record today. There is no booking
table. (Owner decisions 2026-10-08, #332 and #344; mockup:
`docs/design/consistency/scheduling.html`.)

```
PLANNED ──start──▶ OPEN ──close──▶ CLOSED
   │                 ▲   ◀─reopen──┘
   └──cancel──▶ CANCELLED
                    └ ─ ─▶ OPEN  (offline replay of a start only, flagged; §5)
```

| Status | fr | en | Meaning |
|---|---|---|---|
| `PLANNED` | Planifié | Planned | Booked for a date; nothing has happened yet |
| `OPEN` | En cours | In progress | Started: a vehicle carries it |
| `CLOSED` | Clôturé | Closed | Ended and closed, as today |
| `CANCELLED` | Annulé | Cancelled | Called off before it started; kept with its reason |

Cancellation is allowed from PLANNED only. A started trip is never cancelled;
it is closed, with whatever it lacks recorded as completeness gaps (§3.4
invariant 6). **There is no DELIVERED status**: delivery is a recorded fact
(below) and does not change the status.

## Context

- The status column allows `OPEN` and `CLOSED` only
  (`apps/api/src/db/schema.ts:781`), and it is a TypeScript enum with no
  database CHECK behind it.
- `create-activity.v1` requires an actual start and a carrier
  (`packages/contracts/src/commands/create-activity.ts:31-33`) and opens the
  PRIMARY segment at once (`apps/api/src/commands/create-activity.ts:146`).
- `planned_start_at` and `planned_end_at` already exist and are nullable
  (`schema.ts:798`); `started_at` is nullable in the database too
  (`schema.ts:801`), although every writer sets it.
- Commands that touch a trip refuse only `CLOSED`
  (`activity-legs.ts:56`, `activity-legs.ts:287`, `activity-close.ts:79`,
  `substitute-asset.ts:69`). With two new statuses that check is wrong.
- A driver closes or swaps the vehicle only on trips they recorded
  (`assertOwnRecord`, `apps/api/src/commands/own-records.ts:12`). A trip the
  office booked has the office as author.
- The trips list filters and sorts on `started_at`
  (`apps/api/src/reads/activities.ts:238`).
- There is no offline outbox yet (#45). `COMMAND_QUEUEABILITY`
  (`packages/contracts/src/commands/queueability.ts:10`) is the declaration it
  will read.

## Decision

### 1. Schema and migration

One migration (the next free number in `apps/api/drizzle` at merge time):

- **Status.** The Drizzle enum becomes `PLANNED | OPEN | CLOSED | CANCELLED`.
  The database gains `CHECK (status IN ('PLANNED','OPEN','CLOSED','CANCELLED'))`.
  The column default stays `OPEN`, so `create-activity.v1` and the sheet
  commands write what they write today.
- **Dates.**
  `CHECK ((status IN ('PLANNED','CANCELLED')) = (started_at IS NULL))`: a
  planned or cancelled trip has no actual start; a started one always has one.
  `CHECK (status <> 'PLANNED' OR planned_start_at IS NOT NULL)`.
  `CHECK (planned_end_at IS NULL OR planned_end_at > planned_start_at)`.
- **Planned assignment**, nullable, with composite tenant FKs:
  `planned_asset_id → assets`, `planned_driver_person_id → persons`.
  They are the plan, not the facts. Segments and crew rows stay facts and are
  written only at start.
- **Planned route**: `planned_origin_place_id` / `planned_origin_text` and
  `planned_destination_place_id` / `planned_destination_text`. They resolve
  places the way legs do (`apps/api/src/commands/places.ts`). They pre-fill the
  first leg; they are not a leg.
- **Price**: `agreed_price_minor bigint` and `amount_to_collect_minor bigint`,
  both nullable and `>= 0`, with `price_currency char(3) NOT NULL DEFAULT 'XAF'`
  (exponent 0). A booking never writes a financial entry or a posting.
  Revenue is still recorded with `record-revenue`; the agreed price only
  pre-fills it.
- **Cancellation**: `cancelled_at`, `cancelled_by_command_id`,
  `cancellation_reason` (`CUSTOMER_CANCELLED | NO_VEHICLE_OR_DRIVER |
  BOOKED_TWICE | OTHER`) and `cancellation_note` (required for OTHER). Add
  `CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL))`.
  The columns stay filled if a late offline start revives the trip (section 5),
  so the history is kept.
- **Discrepancies**: `discrepancy_codes text[] NOT NULL DEFAULT '{}'`, written
  only by `start-planned-trip` (section 5). They are permanent facts, like
  `completeness_codes`.
- **Indexes**: `(workspace_id, branch_id, planned_start_at) WHERE status IN ('PLANNED','OPEN')`,
  `(workspace_id, planned_asset_id)` and `(workspace_id, planned_driver_person_id)`.
- **New table `trip_deliveries`** (section 6).

**Existing rows need no backfill.** Every row is OPEN or CLOSED, and every
writer has set `started_at`, so the new CHECKs hold. If a row breaks one, the
migration fails as a whole and the row has to be looked at; nothing is guessed.

### 2. What each status requires

| Field | `plan-trip` (PLANNED) | `start-planned-trip` (→ OPEN) |
|---|---|---|
| Branch, trip type, preset | Required | Taken from the plan |
| `plannedStartAt` | Required | Kept |
| `plannedEndAt` | Optional, after the start | Kept |
| Customer, client reference, cargo (`description`), route | Optional on the server; the preset's form may require them | Kept |
| Agreed price, amount to collect | Optional, integer XAF `>= 0` | Kept |
| Vehicle | Optional | **Required**: the carrier that actually left (pre-filled from the plan) |
| Driver | Optional | Crew optional, as in `create-activity.v1`; a missing crew warns at close (`ACTIVITY_MISSING_CREW`) |
| `startedAt` | Absent (CHECK) | **Required**, set once |
| Start reading | Absent | Optional; a missing one warns at close (`ACTIVITY_MISSING_START_READING`) |

The trip number is allocated by `plan-trip` from the planned start's business
date (`nextActivityNumber`, `apps/api/src/commands/numbering.ts:53`) and never
changes, including when the trip is rescheduled into another year.

### 3. Commands

All are v1 and owned by the new **SCHEDULING** module, except
`record-delivery`, which belongs to ACTIVITIES because a delivery happens on
any running trip, booked or not. Every one runs the normal pipeline (§5.3) with
the tenant, actor and branch derived by the server.

| Command | Roles | Approval | Rules |
|---|---|---|---|
| `plan-trip` | DIRECTOR, ADMIN | Auto | Creates a PLANNED trip with client-generated ids. Vehicle and driver may wait. A named vehicle must be operational (ASSET_NOT_OPERATIONAL through `operationalAssetId`); a named driver must be eligible (DRIVER_INELIGIBLE). Collisions warn (section 4) |
| `assign-trip` | DIRECTOR, ADMIN | Auto | PLANNED only. Sets or clears the planned vehicle and driver; the payload carries both, and `null` clears one. `expectedVersion` required. A plain edit (ADR-0008 level 1) with before and after on the audit event |
| `reschedule-trip` | DIRECTOR, ADMIN | Auto | PLANNED only. New planned start and optional end. `expectedVersion` required. Level 1 edit. Collisions are checked again |
| `update-planned-trip` | DIRECTOR, ADMIN | Auto | PLANNED only. Customer, client reference, cargo, route, agreed price, amount to collect. `expectedVersion` required. Level 1 edit: no money has been posted, so no approval |
| `cancel-planned-trip` | DIRECTOR, ADMIN | Auto, reason required | PLANNED only, otherwise INVALID_STATE_TRANSITION. `expectedVersion` required. The trip stays with its reason, visible in the customer's history |
| `start-planned-trip` | DIRECTOR, ADMIN, DRIVER (own) | Auto | PLANNED → OPEN in one transaction. Sets `started_at` once, opens the PRIMARY segment on the vehicle in the payload, and writes the start reading and crew rows, all with client ids, the way `create-activity.v1` does. Never creates a leg or a posting. No `expectedVersion`: it is a fact, and section 5 settles races |
| `record-delivery` | DIRECTOR, ADMIN, DRIVER (own) | Auto | OPEN trips only (as for legs). Section 6 |

`update-planned-trip` is a sixth command, beyond the five in #334. Without it,
a mistyped price could only be fixed by cancelling and booking again.

**Roles.** ADMIN starts trips as well as the driver, because a driver may have
no App Access (ADR-0010) and the office then starts the trip for them. The
mockup's "Direction: read only" is not adopted. Direction keeps every
operational command, as it does for `create-activity`.

**Who counts as a driver's own trip.** For DRIVER, `assertOwnRecord` on a
trip also passes when the caller's Person (`persons.membership_id`) is the
trip's planned driver or a DRIVER crew member. Without this, a driver could
not close or swap the vehicle on a trip the office booked.

**Driver eligibility** is the rule ADR-0010 sets for the Assigned Driver: an
active Person with the Chauffeur Fonction (`persons.default_role = 'DRIVER'`
today). Otherwise DRIVER_INELIGIBLE, with `reason` set to `INACTIVE` or
`NOT_A_DRIVER`. Cross-branch drivers are allowed; the trip's branch governs
(`schema.ts:699`).

**Existing commands change their guard** from "refuse CLOSED" to "require
OPEN": `record-movement-leg`, `record-meter-reading` on a trip,
`substitute-asset` and `close-activity` refuse PLANNED and CANCELLED with
INVALID_STATE_TRANSITION. `reopen-activity` already requires CLOSED. Money is
unchanged: an entry may name a trip in any status. A fuel advance paid before
departure is real, and so is a cancellation fee.

**Compatibility.** `create-activity.v1`, both sheet commands and
`close-activity.v1` are not changed. They still create or close a trip
directly, so an operator without Scheduling records exactly as today. Nothing
is renamed, so no v2 is needed.

### 4. Collisions: double-booking warns, grounding warns, disposal blocks

A trip's **booked window** is `[planned_start_at, planned_end_at)` while
PLANNED. If there is no planned end, the window closes at the end of the
planned start's business day (workspace time zone,
`apps/api/src/reads/business-date.ts`). While OPEN, the window starts at
`started_at` and ends at the later of `planned_end_at` and now, unless
`ended_at` is already set (a sheet saved open): then it ends at `ended_at`, as
for a CLOSED trip (#653).

| Situation | Outcome | Code |
|---|---|---|
| Vehicle is SOLD, RETIRED or WRITTEN_OFF | **Block** (§3.4 invariant 2) | `ASSET_NOT_OPERATIONAL` (existing) |
| Driver inactive or not a Chauffeur | **Block** | `DRIVER_INELIGIBLE` (new error) |
| Vehicle in another PLANNED or OPEN trip whose window overlaps | Warn | `VEHICLE_DOUBLE_BOOKED`, metadata `tripIds` |
| Driver in another PLANNED or OPEN trip whose window overlaps | Warn | `DRIVER_DOUBLE_BOOKED`, metadata `tripIds` |
| Vehicle Grounded (open availability interval), only with MAINTENANCE on | Warn | `VEHICLE_GROUNDED` |

The new codes join `COMMAND_WARNING_CODES` and `COMMAND_ERROR_CODES`
(`packages/contracts/src/errors.ts`), with fr and en messages. The warnings
come back on the command result. The planning read (section 7)
recomputes them on every read, so the board marks a conflict until someone
resolves it. Nothing about a conflict is stored.

A start counts as a booking for the vehicle (#577): `create-activity` and
`start-planned-trip`, live or replayed offline, return `VEHICLE_DOUBLE_BOOKED`
with `tripIds` when the started trip's vehicle is on another PLANNED trip
whose window overlaps, or another OPEN trip, and the start still commits. The same
starts return `DRIVER_DOUBLE_BOOKED` with `tripIds` when a DRIVER in the crew is
on another such trip, and `VEHICLE_GROUNDED` under the rule above (#653). While two OPEN trips
hold the same vehicle, the vehicle's attention read lists each one as
`VEHICLE_DOUBLE_BOOKED`, recomputed like the board, until one is closed.

Double-booking is a warning because two short local trips in one day are
normal, and the dispatcher knows things the system does not (warn, don't
block). Grounding is a warning because a truck grounded today may be released
before Thursday, and the release, not the booking, is the safety gate.

### 5. Offline: facts queue, decisions wait for the server

| Command | Queueable | Why |
|---|---|---|
| `plan-trip` | Yes | Creates a new record with client ids that nobody else can have touched, like `create-work-order`. Collisions come back as warnings |
| `assign-trip`, `reschedule-trip`, `update-planned-trip` | No | Edits against the version on screen; a late replay would overwrite someone else's change or fail on the version (same reasoning as `update-asset-details`) |
| `cancel-planned-trip` | No | A decision, like `cancel-work-order` |
| `start-planned-trip` | Yes | The truck left. The server does not get to reject that |
| `record-delivery` | Yes | The goods were handed over |

These are entries in `COMMAND_QUEUEABILITY`. Nothing queues until the outbox
(#45) exists, and this ADR does not claim it does.

**When an offline start meets a changed trip.** Only `origin: OFFLINE_SYNC`
gets this latitude, following the `BRANCH_INACTIVE_AT_COMMIT` precedent
(`apps/api/src/commands/branch-authorization.ts:98`). A live start against a
cancelled or already started trip is refused, because the person can see the
current state; a live start on a reassigned PLANNED trip goes ahead with a
warning (table below).

| Trip state when the start arrives | Live start | Offline replay |
|---|---|---|
| PLANNED, as the device saw it | Starts | Starts |
| PLANNED, with a vehicle or driver other than the plan (the office reassigned it, or the yard swapped on the day) | Starts with the vehicle and crew in the payload; warns `TRIP_STARTED_OFF_PLAN` | Same |
| CANCELLED | Refused: INVALID_STATE_TRANSITION | **Starts.** The trip goes CANCELLED → OPEN and keeps its cancellation columns. `TRIP_STARTED_AFTER_CANCELLATION` goes on the result and into `discrepancy_codes` |
| Already OPEN (started by someone else) | Refused: INVALID_STATE_TRANSITION | Refused the same way; the device keeps the rejected command for export (§6), and the office records the second vehicle's trip by hand |
| CLOSED | Refused | Refused |

The cancelled trip is revived rather than replaced by a new one because the
driver's next offline commands (legs, fuel, delivery, close) already name this
trip's id. A new trip would make every one of them fail. The revival is the
only way a CANCELLED trip leaves that status.

**Own-trip rule on replay.** A live DRIVER start needs the driver to be the
planned driver now. On an offline replay it is enough that the driver was the
planned driver at any point, as the trip's audit events show. Otherwise a
reassignment made while the driver was on the road would turn their real trip
into OWN_RECORDS_ONLY.

### 6. Delivery is a fact, not a status

`record-delivery.v1` appends one row to `trip_deliveries`:

```
trip_deliveries (id, workspace_id, activity_id, movement_leg_id NULL,
                 delivered_at timestamptz NOT NULL, received_by text NOT NULL,
                 note text NULL, superseded_by_id NULL,
                 created_by_command_id, created_at)
```

- Composite tenant FKs to the trip and, optionally, to the leg (the stage)
  where the goods were handed over.
- The optional photo of the signed delivery note is a source artifact linked
  through `envelope.sourceArtifactIds` (`command_source_artifacts`), the way
  receipts are. There is no photo column.
- **Append-only.** A correction is a new row whose `superseded_by_id` points
  back at it, like meter readings. A trip with several drops has several rows.
  "Delivered" on the trip means the latest row that has not been superseded.
- The trip stays OPEN. It is closed through the existing flow: the arrival
  reading (`record-meter-reading`), then `close-activity`. A "delivered, not invoiced" queue, if the receivables ADR
  (#380) needs one, is a filter on this table, not a status.

### 7. Reads

**Existing reads keep their meaning.** `/v1/activities`, its summary, the
vehicle's recent trips, Home and nav counts return OPEN and CLOSED trips
unless asked otherwise. `/v1/activities` accepts `status=PLANNED` and
`status=CANCELLED` explicitly. Old clients therefore never meet a trip with no
start date.

**`GET /v1/planning`** (#336). Module SCHEDULING and ACTIVITIES; roles
DIRECTOR, ADMIN, FINANCE and TECHNICIAN; branch scope enforced per record.
Query: `from`, `to` (business dates, at most 42 days so a month grid fits) and
optional `branchId`, `assetId`, `personId`, `customer` and `includeCancelled`.
No paging: the range is the bound. Order: window start, then trip number, then
id. It returns:

- `trips`: PLANNED, OPEN and CLOSED trips whose window overlaps the range, with
  number, status, preset, type, customer, cargo, planned and actual dates,
  route labels, vehicle (planned, or the actual carrier once started), driver,
  `conflicts` (the section 4 warning codes, recomputed), `discrepancyCodes`,
  `plannedBy` (name, at), `lastChange` (kind, by, at, taken from the latest
  assign or reschedule audit event), `deliveredAt`, and the price fields under
  the rule below.
- `vehicles`: the operational vehicles in scope, each with `blocks` (Grounded
  intervals overlapping the range, with the work-order number) when
  MAINTENANCE is on.
- `drivers`: eligible drivers in scope, for the by-driver view.
- `days`: per business day, `planned`, `toAssign` and `conflicts` counts.
- `summary`: `planned`, `toAssign`, `conflicts`, `vehiclesBooked` /
  `vehiclesTotal`, and `plannedRevenueMinor` (the agreed prices of PLANNED trips
  in the range; CANCELLED, OPEN and CLOSED trips are not summed) for roles that
  may see prices.

**`GET /v1/my-schedule`** (#344). Module SCHEDULING; any role whose App Access
belongs to a Person. Same trip shape, filtered to trips where that Person is
the planned driver or a DRIVER crew member. No vehicles, drivers or summary
money. The "Changed" badge comes from `lastChange`; the device remembers which
cards the driver has opened. That is screen state, not a command.

**Price visibility is enforced in the read, never only in the UI.**
`agreedPriceMinor` and `plannedRevenueMinor` are present only for roles that
read the ledger (`canReadLedger`, `packages/contracts/src/roles.ts:118`) with
FINANCE on. For DRIVER, `agreedPriceMinor` is present on their own trips only
when the company setting **Show trip price to drivers** is on. That setting is
a DIRECTOR-only boolean in `workspace_settings` (#348), off by default; if
#348 has not landed, the read treats it as off. `amountToCollectMinor` is
present for ledger readers and for the trip's own driver, whatever the
setting. Every other caller gets the key omitted, never `null` and never `0`.
The same gate covers `/v1/activities/:id`, aggregates, and the record history,
where both fields use the `MONEY` shape that already hides money
(`packages/contracts/src/reads/history-fields.ts:89`).

### 8. Module

`SCHEDULING` joins `TOGGLEABLE_MODULE_CODES`
(`packages/contracts/src/modules.ts:5`) and depends on ACTIVITIES. ACTIVITIES
cannot be disabled while SCHEDULING is on (#326). It is off by default for
every preset, and the vendor turns it on (ADR-0005).

**When it is off:** the six SCHEDULING commands and both reads return
MODULE_DISABLED, the Planning tab, Book a trip and the Home card are absent,
and Trips works as it does today, plus `record-delivery`, which belongs to
ACTIVITIES and stays available on any running trip. Existing PLANNED trips stay in the database,
unseen and unstartable, and reappear when the module is turned back on.

### 9. Words

The status words are **masculine in the base `fr.json`** because every trip is
shown under its preset's noun, and both nouns are masculine: *trajet*
(TRUCKING) and *voyage* (PASSENGER_TRANSPORT). Presets do not override status
words. The OPEN label changes from "En route" / "On the road" to "En cours" /
"In progress", so the board, the trip page and the driver's step line say the
same thing. #334 thereby fixes `activities.status.CLOSED` from #143. The other
two feminine strings in #143 stay with that issue.

| Key | fr | en |
|---|---|---|
| Planned trip | Trajet planifié / Voyage planifié (overlay) | Planned trip / Planned journey |
| Cancellation reasons | Annulé par le client · Pas de camion ou de chauffeur · Réservé deux fois · Autre | Customer cancelled · No vehicle or driver · Booked twice · Other |
| Delivery, Record delivery | Livraison, Enregistrer la livraison | Delivery, Record delivery |
| Received by | Reçu par | Received by |
| Agreed price, Amount to collect | Prix convenu, Montant à encaisser | Agreed price, Amount to collect |
| Show trip price to drivers | Afficher le prix du trajet aux chauffeurs (overlay: *voyage*) | Show trip price to drivers |

Every one is a full ICU message. Nothing is built by concatenating words.

## Alternatives rejected

- **A separate `bookings` table that spawns a trip at start.** It means two
  records for one job, two places to cancel, and the customer, rate and route
  copied across. Offline facts captured against a booking id would also have
  no trip to land on.
- **A DELIVERED status.** Rejected by the owner, 2026-10-08. It would make a
  half-done trip look done, and multi-drop trips have several deliveries.
- **Storing the planned truck and driver as segment and crew rows.** Segments
  require an actual start and use an exclusion constraint for "who is carrying
  now", and crew rows are what pay postings hang off. Planned rows there would
  turn reassignment into deleting facts.
- **Blocking double-bookings.** Dispatchers know when two short runs fit in one
  day. A block would push them back onto paper.
- **Rejecting an offline start on a cancelled trip.** That would reject
  reality and strand every later fact the driver captured on that trip.
- **A v2 of `create-activity` with an optional `startedAt`.** It would make one
  command mean both "book" and "it happened", and the queueability, roles and
  approval for those two differ.
- **Hiding the price in the driver's UI only.** The cached payload and
  DevTools would still show it (#344).

## Consequences

- Every query that sorts or filters on `started_at` must decide what to do
  with PLANNED rows. The default above is to exclude them.
- The own-trip rule for DRIVER widens from "author" to "author, planned driver
  or crew driver". `role-matrix.test.ts` and
  `docs/reference/roles-and-access.md` must say so.
- Recurring bookings ("every Monday for six weeks") are N `plan-trip`
  commands sent by the client. No recurrence rule is stored. The bus timetable
  (#346) will need its own decision.
- A trailer on the plan is not modelled yet. Starting with a trailer goes
  through the existing segment commands.

## Tests the build slices add

- **#334** `apps/api/src/commands/planned-trip.test.ts`:
  - every allowed and refused transition;
  - the CHECKs: a planned trip with `started_at` fails;
  - started once only, and a retry returns the original result with no second
    segment, crew row or posting;
  - stale `expectedVersion` on assign, reschedule, update and cancel;
  - roles, branch scope and own-trip for each command;
  - DRIVER_INELIGIBLE and ASSET_NOT_OPERATIONAL;
  - each warning code;
  - the offline table in section 5, both origins;
  - SCHEDULING off;
  - the existing commands refusing PLANNED and CANCELLED;
  - `create-activity.v1` and the sheets unchanged.

  Also `packages/contracts/src/commands/plan-trip.test.ts`,
  `COMMAND_QUEUEABILITY` entries and contract snapshots.
- **#336** `apps/api/src/reads/planning.test.ts`:
  - window overlap at day, week and month boundaries in Africa/Douala;
  - the 42-day cap;
  - conflicts recomputed;
  - Grounded blocks with MAINTENANCE on and off;
  - every role, branch and module gate;
  - cross-workspace and cross-branch ids;
  - price keys absent for non-ledger roles.
- **#344** `apps/api/src/reads/my-schedule.test.ts`:
  - only the caller's trips;
  - the price omitted unless the setting is on;
  - `amountToCollectMinor` always present for the own driver.
