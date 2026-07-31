# Record history — "who did what" on any record

Surface the audit trail the write path already captures. Per-record timeline
answering: who acted, when, through which command, from which origin, changing
which fields. First read + UI over `audit_events`; the workspace-wide audit log
screen is a later, separate effort.

## Current state (verified 2026-07-30)

- Every command writes `audit_events` inside its transaction via
  `appendAuditEvent` (26 call sites): `event_type`, `actor_principal_id`,
  `entity_type`/`entity_id`, `before_state`/`after_state` JSONB,
  `changed_fields`, `command_id`, `occurred_at`. Append-only; runtime role has
  no UPDATE/DELETE.
- Event types in use: `activity.created/closed/reopened`,
  `asset.registered/commissioned/assigned`, `category.*`, `module.*`,
  `person.registered`, `approval-threshold.updated`, `workspace.provisioned`,
  plus financial-entry events. Treat the set as open — the read must not
  enumerate it.
- `commands` receipts carry origin, name+version, `client_occurred_at`,
  approval outcome. `principals.display_name` gives the actor label.
- **No read endpoint, no screen.** Nothing in `apps/api/src/reads/` or the web
  app touches `audit_events`.

## Scope

### 1. Contract — `packages/contracts/src/reads/history.ts`

History item: `eventId`, `eventType` (string, open set), `occurredAt`,
`actor { principalId, displayName, scope }` (scope surfaces PLATFORM events —
"by ROUTIQ" — distinctly from tenant actors; **`principalId` and
`displayName` are nullable** — the schema masks `actor_principal_id` to NULL
at read time when `scope = 'PLATFORM'`, so the principals join yields nothing
and the label derives from scope alone), `command { id, name, version,
origin, clientOccurredAt }`, `changedFields: string[]`, and **`note: string |
null`** — extracted server-side from known state keys (`after_state.reason`
today; correction notes later). Reopen motifs and correction reasons are the
most human-valuable lines in the timeline; without this field they'd be
reachable only through the diff view, which is cuttable. Envelope
`{ items, nextCursor }` per ADR-0003, keyset on `(occurred_at desc, id)`.

`before_state`/`after_state` are **not** in the list item — the list stays
light for 2G. A detail item (single event by id) carries them for the diff
view (issue-level, see build order).

### 2. Read — `GET /v1/history/:entityType/:entityId`

Join `audit_events` → `commands` → `principals`, workspace-scoped under RLS.
`entityType` validated against a contracts enum of known entity types (this
one IS closed — it's our own row vocabulary). Visibility rule: **history is
visible to whoever can read the record.** Mechanism (existing reads carry no
per-role gates — they are module check + RLS only): a closed
`entityType → ModuleCode` map in contracts; the history read enforces that
module check plus RLS, nothing else. History reveals nothing the reader
can't already see, and field staff seeing "the office corrected my sheet" is
a feature, not a leak. Needs index `(workspace_id, entity_type, entity_id,
occurred_at desc, id)`.

The event **detail** read (issue 3) never serves `before_state`/`after_state`
raw: it passes them through a per-entity-type allowlist of state keys (or at
minimum strips fields matching credential patterns) — future user-management
events snapshot principal state, and a PIN hash must never reach a client.
Verify how `bigint` money serializes in the JSONB states before building the
diff view.

### 3. UI — shared `RecordHistorySheet`

One component, mounted from every detail screen. Chosen shape (option a):

- **Trigger**: "Historique" action in the detail screen header (icon + label),
  opening a bottom sheet on mobile / side drawer on desktop. Rationale over
  the alternatives — (b) inline collapsible section bloats detail screens that
  are already long and pushes an extra fetch onto every detail view on 2G;
  (c) a tab only works where tabs exist and buries provenance two levels deep.
  The sheet lazy-loads on open, costs nothing until asked, and is identical on
  every record type.
- **Row**: event label (i18n key derived from `eventType`, e.g.
  `history.event.activity-closed`; unknown types render the raw code — stable
  fallback, no English strings invented), actor display name, absolute
  date+time (fr-CM format; relative time secondary), origin badge only when it
  isn't plain web (`OFFLINE_SYNC`, `IMPORT`, later `AI`), changed-field chips
  (field names via the record's existing label keys; unknown field names
  render the raw code — same stable fallback as unknown event types), and the
  `note` when present (motif/reason, muted secondary line).
- **Platform events** render the actor as ROUTIQ (vendor), styled distinctly.
- Keyset "load more" at the bottom; newest first.
- Vendored per UI-registry conventions (DataTable not needed — this is a
  timeline list, not a grid).

First mount points: ActivityDetailScreen, AssetDetailScreen,
FinanceEntryDetailScreen. Everything else follows for free once the component
exists.

### 4. i18n

`history.*` keys in `fr.json` + `en.json`: sheet title, event labels for the
known event types, origin badges, empty state ("Aucun historique" should be
effectively unreachable — every row is born from a command).

## Non-scope

- Workspace-wide audit log screen (filter by actor/date/type) — separate spec
  once per-record history proves the read shape.
- Before/after diff view — staged as the last issue here, cuttable without
  loss to the rest.
- Hash chaining, export, retention — ARCHITECTURE.md already defers them.

## Build order

1. Contract + read endpoint + index (+ tests: cross-tenant isolation, keyset
   stability, unknown entity type → 400).
2. `RecordHistorySheet` + mount on the three detail screens (+ tests: event
   label fallback, origin badge, platform actor).
3. Event detail read (`before_state`/`after_state`) + diff view inside the
   sheet.
