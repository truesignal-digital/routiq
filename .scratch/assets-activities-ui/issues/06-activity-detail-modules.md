# 06 — Activity detail: comprehensive modular sections

Status: ready-for-agent

## Task

Rebuild ActivityDetailScreen as stacked conditional modules per the design doc wireframe. Each module = one file under `src/activities/detail/`, registered in registry.json. Sections render only when their data exists.

## Modules

1. **activity-overview** — stat band (reuse metric-strip primitives if 02 has landed; otherwise self-contained tiles matching its API for later swap): started, ended ("running" when open), net XAF (signed sum of POSTED entries only, labeled "posted only"), legs count, crew count. Tabular-nums, money via existing MoneyFigure conventions (XAF exponent 0 — never divide).
2. **activity-timeline** — planned vs actual as two CSS bars + timestamp lines; renders only when planned dates exist; open activity shows actual bar as running. No chart lib. Reduced-motion safe.
3. **activity-assets-panel** — existing segments+crew card extended with readings: type, value from → to with unit, superseded readings behind a disclosure showing the correction chain (append-only — corrections visible, never hidden).
4. **activity-legs** — plain table (not DataTable): #, origin → destination, departed, arrived, load-state chip, distance, passengers (when present). Times in workspace-local format consistent with the rest of the app.
5. **activity-money** — extend the existing card: entry rows link to finance detail, net line separating POSTED from pending amounts.
6. **provenance-stamp** — muted footer: `templateCode vN · created <date> · command <shortid>`; generic component (activity first consumer).

Also surface: `description` (under header when present), `closedAt` (overview or header badge row).

## Requirements

- Layout: header + banner + overview full-width; timeline ∥ assets-panel in `lg:grid-cols-2`; legs, money full-width; stamp footer. Mobile: single column stack, same order.
- Every module tolerates partial data (no crash on null/empty — the warn-don't-block invariant means anything can be missing).
- fr+en strings; semantic tokens; no new deps.
- Tests per module (render with data / render nothing without) + a screen test for a full haulage fixture and a sparse journey fixture.

## Acceptance

- [ ] `pnpm typecheck` && full `pnpm --filter @routiq/web test` green (registry entries present)
- [ ] Sparse-data fixture renders without empty-shell sections
