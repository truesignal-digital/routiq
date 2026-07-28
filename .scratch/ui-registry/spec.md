# ui-registry — spec

Status: approved 2026-07-26 (registry home, dark-mode deferral, dashboard sequencing, assets API migration all confirmed by Linus).

## Goal

One consistent UI system for ROUTIQ, distributed as a **shadcn-style registry** (`@routiq` namespace), so every screen composes the same primitives and every future model gets list/table/form UIs "for free". Companion change on the API: a single list-endpoint contract so reads are as dynamic as the table expects.

North star: stock shadcn look and behavior (base-nova style, Base UI backing — NEVER Radix). Reference: shadcn `dashboard-01` block (sidebar + KPI cards + chart + feature-rich data table) and the stock shadcn Tabs (pill-highlight active tab). Prefer vendoring stock shadcn components over inventing; customize via tokens, not forks.

Input: `audit.md` (full consistency audit, file:line cites). Baseline commit 5a5e114.

## Decisions

1. **Registry lives in `apps/web`**: `registry.json` over `src/components/{ui,*}`, `shadcn build` → `public/r/*.json`. Web app serves its own registry (fits appliance topology §6a). No new package until a second app exists.
2. **Dark mode deferred.** Don't finish `.dark`; don't add toggle. Clean up so the dead block can't misfire (sonner stays light). Later effort.
3. **Dashboard-01-style home is the LAST ticket** — after primitives, DataTable v2, API contract.
4. **`/v1/assets` migrates to the new list contract in this effort** (server-side filter + keyset pagination), proving the contract on a second resource.

## Non-negotiables

- Base UI only; any `@radix-ui` import is a bug. Vendor via shadcn CLI with `base-nova` (apps/web/components.json).
- fr-CM default i18n; no hardcoded UI English; API errors only via `errorMessage(i18n, code)`.
- Money: `bigint` minor units, XAF exponent 0; canonical formatter is the phase-1 `lib/format.ts` wrapping `packages/domain` money.
- Verification gate per ticket: `pnpm --filter @routiq/web test && pnpm typecheck`; jsdom command-routing regression tests stay green.
- One worker-implemented ticket per commit; review each diff before commit.

## Phases

- **Phase 0 — Foundation** (tickets 01-03): registry scaffold; re-vendor `form.tsx` from base-nova; semantic tokens (`success`/`warning`/`info`, fix `--signal`, `--font-heading`).
- **Phase 1 — Primitives** (04-09): vendor stock shadcn tabs/checkbox/dropdown-menu/popover/alert/tooltip/sheet; `lib/format.ts` (money/date/label helpers); StatusBadge + ErrorBanner; PageContainer + card unification; form-controls sweep (raw select/textarea → vendored, kill `AttachmentField`); quick bug batch (denied-flash, raw-error-code leaks, DataTable i18n).
- **Phase 2 — DataTable v2** (10-11): full-featured registry block (sorting, column visibility, row selection, declarative filter toolbar, pagination, mobile cards, i18n); migrate finance screens onto it.
- **Phase 3 — API list contract** (12-13): shared list-query/list-response Zod schemas in `packages/contracts` + ADR; migrate `/v1/assets` + `AssetsStub` to server-side filtering.
- **Phase 4 — Sweep + dashboard** (14-15): migrate remaining screens onto registry components, fetch-layer cleanups; dashboard-01-style home block.

Order: 0 → 1 → (2 ∥ 3) → 4.

## Out of scope

- Dark mode completion, theme toggle.
- File-storage upload failure seen in devtools screenshot (artifact PUT failing) — API-side, file separately.
- Threshold admin UI (ticket 09 of finance-web), More screen content — will land ON these primitives afterwards.

## Ticket index

See `issues/`. Numbering 01-15 per phase list above.
