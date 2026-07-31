# 05 — Activities list: wire remaining filters + hidden columns

Status: resolved

## Task

No layout change. The read supports `activityTypeCode, branchId, assetId, from, to` — the screen wires none of them.

## Requirements

- Add filters: activity type (options from categories read, ACTIVITY_TYPE kind, localized labels), branch, asset (async options — reuse/extend `useAssetOptions`; note it currently drains the full cursor, acceptable at pilot scale but leave a comment), date range from/to via the shadcn Base UI date picker (user directive 2026-07-31): vendor `calendar` with `pnpm dlx shadcn add calendar` (base-nova resolves the Base UI-backed version; Popover is already vendored), register it plus a small `date-range-picker` composition component in registry.json, and use that — NOT native date inputs. Single-date and range modes per ui.shadcn.com/docs/components/base/date-picker.
- All server-side via the DataTable filters API; no client narrowing.
- Add `endedAt` and `crewCount` columns with `mobile: "hidden"` priority, sortable only if the read declares them (it doesn't — so not sortable).
- fr+en strings for new labels.
- Tests: filter params reach the query; new columns togglable via view options.

## Acceptance

- [ ] `pnpm typecheck` && full `pnpm --filter @routiq/web test` green

## Comments

2026-07-31 — Done (codex worker ui-filters + two review rounds). All four unwired filters reach the server (type via categories, branch via reference read using branch.id — first pass sent branch.code as branchId, caught in review, now pinned by a UUID test — asset via useAssetOptions, from/to via new Base UI date-range-picker). calendar vendored Base UI-native (zero radix), date-range-picker registered; native DataTableDateFilter deleted (function, render branch, union member) leaving select/search/custom filter types. endedAt/crewCount columns mobile-hidden, unsortable. First pass also landed in the main tree by mistake — ported, main cleaned. typecheck + full web suite (873) green.
