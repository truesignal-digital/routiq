# Assets & Activities UI rebuild

Design doc: claude.ai/code/artifact/88c01434-8a24-4dbe-89b8-869061b4caf1 (approved 2026-07-30: table-only assets, stacked activity sections, new /v1/assets/summary read). Wireframes and module tables live there; issues here carry the buildable slices.

## Decisions (locked)

- Assets list joins the DataTable basis — table only, no card toggle; mobile via column-priority collapse. FAB stays.
- Metric strip is server-fed (`/v1/assets/summary`, counts by lifecycle bucket in SQL) — the client-side loaded-pages counting dies.
- AssetActions: inline panel strip → DataTable `rowActions` + dialogs (ActivityActions pattern), role gating in the screen `// role-config` seam.
- Activity detail = stacked conditional section modules: overview band, planned-vs-actual CSS timeline, assets+crew+readings panel, full legs table, money with signed POSTED-only net, provenance stamp footer.
- Activities list: wire the 4 unwired server filters (type, branch, asset, from/to), expose endedAt/crewCount as hidden-priority columns.
- Everything registers in `registry.json` same-change (registry.test.ts enforces). Vendor any missing primitives only via shadcn CLI (base-nova → Base UI). No new chart deps; timeline is CSS.
- Excluded: inline editing, drag-reorder, client-side aggregation beyond on-screen rows, card-grid toggle.

## Conventions that bind every issue

- DataTable rules (memory + data-table.tsx docs): primaryColumn sole click target, loadMore keyset xor pagination, sort only via declared sortFields with sort-in-cursor (ADR-0003), mobile meta primary/secondary/hidden.
- Semantic tokens only (palette.test.ts); fr+en locale parity, ICU only; Base UI never Radix; module/role gating patterns as found in the screens.
- `assets/model.ts` hand-rolled type dies — import contract types.

## Ordering

01 api → 02 metric-strip → 03 assets-explorer → 04 asset actions; 05 activities filters ∥ 06 activity detail modules (both independent of 01–04).
