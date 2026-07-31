# Sheet-form unification — one fiche for record, view, and edit

The activity page and the record flow converge into a single sheet-shaped
component. The fiche is the domain object; the screen should look like it.
Decided with the owner 2026-07-31 after live use: the modular detail view
plus a separate record form makes two mental models of one thing, and the
detail header accumulates action buttons faster than anyone can learn them.

## Current state (verified 2026-07-31)

- Record: `ActivitySheetScreen` + `apps/web/src/activities/sheet/` +
  `sheet-model.ts` — a long single-pass form ("Saisir une fiche") posting the
  `record-sheet` command. After `fix/sheet-explicit-close`: lands OPEN by
  default, optional "Enregistrer et clôturer".
- View: `ActivityDetailScreen` + `apps/web/src/activities/detail/` — modular
  cards (header stats, engins/équipage, trajets, relevés, finances), header
  actions Clôturer / Rouvrir / Ajouter un trajet / Relever le compteur /
  Saisir une dépense / Historique — six buttons and growing.
- Mid-trip capture commands already exist and are the write path for every
  section (activity-legs, meter readings, record-expense, close/reopen).
- History: `RecordHistorySheet` global timeline; after
  `fix/history-changes-only`: changes-only default. Field-level diff read
  (`GET .../:eventId`) shipped 2026-07-31.

## Design

### One component, three modes

`ActivityFiche` renders the same section skeleton always; a `mode` prop picks
the behavior per field:

| Mode | Who sees it | Field behavior |
|---|---|---|
| `input` | "Saisir une fiche" route | everything editable, drafts allowed |
| `edit` | activity page for a role that may write | committed facts read-only; open slots editable |
| `view` | activity page otherwise (role- or status-driven) | all read-only |

`view` is just `edit` where nothing is writable — one rule engine, not three
renderings.

### Read-only is a domain rule, not a form rule

A field is locked in `edit` mode when ANY of:
1. **Immutability** — the fact is committed append-only: posted/approved
   financial lines, meter readings (corrections supersede via their own
   affordance), arrived legs' recorded times. These lock regardless of role.
2. **Lifecycle** — activity CLOSED locks all data sections (Rouvrir is the
   escape hatch); posting-period LOCKED locks financial sections hard.
3. **Role** — `canRecordActivities` gates writability at all;
   EXECUTIVE_VIEWER-style roles get `view`.

"Mandatory and already recorded" (the owner's framing) is the visible effect
of rule 1 — the spec encodes it as immutability so the lock reasons stay
explainable. A locked field shows a lock affordance with a one-line reason on
press ("Relevé validé — les corrections passent par un nouveau relevé").

### Sections are commands are collapsibles

The form is long; every section is a disclosure (click to expand/close):

| Section | Backing command(s) | Collapsed summary line |
|---|---|---|
| Identité (type, client, réf, description) | create/record-sheet | type · client · n° |
| Engins & équipage | segments + crew parts of sheet | codes + crew count |
| Trajets | activity-legs | n legs · total km |
| Relevés compteur | meter commands | last reading + delta |
| Finances | record-expense / record-revenue | result FCFA · n lines |
| Clôture | activity-close / reopen | status + réserves count |

Rules:
- **Section = save unit.** Each section saves through its own command; there
  is no whole-form submit outside `input` mode. A dirty section shows its own
  Enregistrer; leaving it unsaved prompts locally, not globally.
- **Actions dissolve into their sections**: "Ajouter un trajet" is a row
  affordance inside Trajets; "Saisir une dépense" inside Finances; "Relever
  le compteur" inside Relevés. The page header keeps ONLY lifecycle:
  Clôturer / Rouvrir, plus Historique.
- Collapsed-by-default state: in `edit`/`view`, sections with content expand
  the two most relevant (Trajets, Finances); in `input`, all expand.
  Remember per-user collapse state per section type (localStorage), not per
  activity.
- 2G rule: collapsing is presentation; no per-section lazy fetch beyond what
  the reads already do — one activity read feeds the whole fiche.

### History woven into the fiche

The global feed (RecordHistorySheet, changes-only default) stays behind the
header's Historique — the audit view. The fiche adds **field-level
provenance**:

- A field or section whose data changed after first record shows a subtle
  "modifié" marker (dot + actor initial is enough; no color-only signal).
- Pressing it opens a popover with that field's before → after (from the
  event diff read, fetched on press), actor, date, and motif when present.
- Mapping: `changedFields` names → form fields via each section's existing
  label-key map — the same raw-code fallback rule as the timeline.
- Events that map to no visible field (bookkeeping) never mark anything.

### Routes

- `/activities/record` renders `ActivityFiche mode=input`.
- `/activities/:id` renders the fiche in `edit` or `view` — the modular
  detail components in `apps/web/src/activities/detail/` are absorbed and
  deleted by the end of the effort. No second "detail" view survives.
- Mid-trip capture entry points (list row menu, dashboards) deep-link to a
  section: `/activities/:id#finances` expands that section.

## Non-scope

- No new commands, no API changes — this is a web-layer reshape over the
  existing command set. If a section can't be built without a new command,
  stop and flag it.
- No offline/outbox changes; the sheet stays online-first until the outbox
  effort lands (§6). Design section boundaries so per-section saves can later
  queue as envelopes — but build nothing for it now.
- Assets/finance entries keep their current screens; if the fiche pattern
  proves out, they follow in their own effort.
- No relabeling of lifecycle statuses, no new statuses (CONTEXT.md:
  lifecycles are fixed).

## Build order

1. `ActivityFiche` skeleton + mode/lock rule engine + collapsible section
   frame, rendering existing sheet fields in `input` mode; "Saisir une fiche"
   switches to it. (Old sheet screen deleted here.)
2. `edit`/`view` modes on `/activities/:id` for Identité + Trajets, absorbing
   their detail cards; header shrinks to Clôturer/Rouvrir/Historique.
3. Engins & équipage, Relevés, Finances sections absorbed; detail/ directory
   deleted; deep-link section anchors.
4. Field-level provenance markers + popover on the diff read.
5. Sweep: tests consolidated, ux pass at mobile width both locales, spec
   updated to as-built.

Each step ships green on its own; the page is never half-migrated across a
release.
