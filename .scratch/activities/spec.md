# Activities & sheet commands

## Goal

Build the activity command family — the missing core of the §5.1 catalog. ARCHITECTURE.md calls the composite sheet commands "the pilot's make-or-break". End state: an operator can record a haulage job or scheduled journey (one form → activity + segments + crew + legs + readings + revenue/expenses), close it with completeness warnings, and see costs/revenue attributed per activity.

## Scope

Commands (per §5.1 catalog, granular first, composites on top):

1. `create-activity.v1`, `record-movement-leg.v1`, `substitute-asset.v1` — granular fallbacks / correction path
2. `close-activity.v1` (completeness state, warn-not-block), `reopen-activity.v1` (1 approval)
3. `record-journey-sheet.v1`, `record-haulage-job-sheet.v1` — composite: one payload emits activity + segments + crew + legs + readings + financial entries, atomically

Plus the Drizzle schema for `activities`, `activity_asset_segments`, `activity_people`, `movement_legs`.

## Non-scope

- Web UI (separate workstream; ui-registry session owns `apps/web` right now)
- Reads/reports (activity contribution report is §9; later)
- Meter-reading tables if not already present — composite sheets may stub reading capture behind a follow-up issue if schema is missing
- Work orders, stock, DisposeAsset — separate workstreams

## Authoritative references

- §3.1–§3.2 — Activity, ActivityAssetSegment (roles PRIMARY/TRAILER/SUBSTITUTE/RECOVERY), ActivityPerson, MovementLeg entities + relationships
- §3.4 — invariants: close warns-not-blocks (`COMPLETE_WITH_EXCEPTIONS`), substitution keeps one customer-facing activity, no overlapping PRIMARY segments (`EXCLUDE USING gist`), lifecycle status gates
- §4.1 — conventions: composite tenant FKs, `row_version`, `created_by_command_id`, client-generatable UUIDs
- §5.1 lines ~235–262 — command names + approval defaults
- Existing pattern to mirror: `register-asset` / `record-financial-entry` (contract in `packages/contracts/src/commands/`, handler in `apps/api/src/commands/`, registered via `registerCommand`)

## Ordering

01 schema → 02 create-activity → 03 legs+substitute → 04 close/reopen → 05 journey sheet ∥ 06 haulage sheet

## Open questions

- Activity numbering format may be gated by open `mtp-pilot` numbering decision — issues use existing `numbering.ts` helper as-is; flag if it can't express activity numbers.
- Meter readings table existence unverified — issue 05/06 must check and split out if absent.
