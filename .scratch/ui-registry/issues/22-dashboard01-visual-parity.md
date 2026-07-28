# 22 — dashboard-01 visual parity: status-badge icons, tab badges, toolbar row

Status: ready-for-human
Phase: 4
Blocked by: 21

**What to build:** Make the finance screens' table + tab section visually match the dashboard-01 block (user screenshot review 2026-07-27). Three deltas remain; drag-reorder and inline cell editors stay excluded (domain: append-only ledger).

## Tasks

- [ ] **StatusBadge icon slot**: optional leading lucide icon, default mapping per tone — success→CircleCheck (filled/colored like the block's green check), warning→LoaderCircle or Clock, danger→CircleX, info→LoaderCircle, neutral→Undo2 for reversed (FinanceStatusBadge maps REVERSED→neutral+Undo2, SUBMITTED→info+LoaderCircle, POSTED→success+CircleCheck, REJECTED→danger+CircleX). Icon size ~size-3.5, `aria-hidden` (text carries meaning). Callers can pass `icon={null}` to omit or a custom icon. Update asset lifecycle + document expiry tone maps only if trivially compatible — otherwise leave them iconless.
- [ ] **FinanceNav count badges**: the approvals trigger renders its pending count as a small Badge inside the TabsTrigger (block style: muted pill after the label), replacing the current badge rendering. Keep the existing aria-label with ICU count. No counts on tabs that have no natural count.
- [ ] **Toolbar row layout on entries/approvals/periods** (block layout): one row with FinanceNav tabs on the left and right-aligned controls — the existing « Affichage » column-visibility control plus a primary action Button:
  - entries: « Saisir une écriture » → /finance/record (Add-Section analog, permission-gated like the record screen)
  - approvals/periods: no primary action (omit).
  Filters stay on their own row below (block has no filters; ours are required — keep them, same components).
- [ ] The Affichage control moves INTO this shared row (it currently floats alone above the table); extract a small `DataTableViewOptions`-style export from data-table.tsx if needed so screens can place it, without breaking the embedded default for other consumers.
- [ ] i18n: new strings fr+en, ICU. No @radix-ui, strict TS.
- [ ] Tests: FinanceStatusBadge renders the mapped icon per status (and no icon when icon={null}); FinanceNav approvals trigger shows the count badge; entries toolbar renders tabs + Affichage + action in one row and the action is absent for read-only roles; existing table/filter/drawer tests stay green.

## Acceptance

- [ ] Entries screen visually mirrors the block: tabs row w/ badge counts + right controls, bordered table, status chips with icons, pager/load-more footer
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests green

## Out of scope

Drag-reorder, inline cell editors, dark mode, dashboard home (15).

## Comments

- 2026-07-27 Opus worker: committed (ui-registry 22). Neutral tone deliberately iconless (REVERSED→Undo2 mapped in FinanceStatusBadge only); icons size-3 per badge.tsx sizing; DataTable gained controlled columnVisibility + DataTableViewOptions export (shared ColumnVisibilityMenu, id-resolution integration test). Verified visually in browser. 528 tests.
