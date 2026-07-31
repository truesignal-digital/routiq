# 05 — Activities list: wire remaining filters + hidden columns

Status: ready-for-agent

## Task

No layout change. The read supports `activityTypeCode, branchId, assetId, from, to` — the screen wires none of them.

## Requirements

- Add filters: activity type (options from categories read, ACTIVITY_TYPE kind, localized labels), branch, asset (async options — reuse/extend `useAssetOptions`; note it currently drains the full cursor, acceptable at pilot scale but leave a comment), date range from/to (two date inputs or the repo's existing date field pattern — check FinanceEntries screens for precedent and mirror it).
- All server-side via the DataTable filters API; no client narrowing.
- Add `endedAt` and `crewCount` columns with `mobile: "hidden"` priority, sortable only if the read declares them (it doesn't — so not sortable).
- fr+en strings for new labels.
- Tests: filter params reach the query; new columns togglable via view options.

## Acceptance

- [ ] `pnpm typecheck` && full `pnpm --filter @routiq/web test` green
