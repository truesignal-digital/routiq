# 13 — /v1/assets adopts the list contract

Status: ready-for-human
Phase: 3
Blocked by: 12

**What to build:** Server-side filtering and keyset pagination for `/v1/assets` using the ticket-12 contract, a normal TanStack Query hook in place of `useAssets`'s bespoke return shape, and `AssetsStub` consuming server filtering instead of filtering the full list in the browser.

## Context

Audit §5. `apps/api/src/reads/assets.ts:22` accepts **no query params** and returns every asset the caller can see, ordered by `assets.assetCode` ascending (`:66`), wrapped as `{ workspaceId, assets }` (`:69-89`). The web side compensates: `src/assets/useAssets.ts:26-30` returns a custom `{ status, assets, retry }` shape that `AssetsStub.tsx:142-149` string-compares (losing `isFetching` and error details), and `src/assets/model.ts:38` `assetMatches(asset, query, filter)` filters client-side over asset code, registration number, manufacturer, model and category labels, with `filter` being the UI's `ALL | IN_SERVICE | ATTENTION` (ATTENTION = `UNDER_MAINTENANCE | RETIRED | WRITTEN_OFF`).

Response validation lives in `src/assets/api.ts` (`isAssetListResponse`, `isAssetListItem`) — it checks `workspaceId` and `assets`, so it changes with the envelope.

The finance hook is the shape to copy: `src/finance/useEntries.ts:39-54` (`useInfiniteQuery`, workspace-scoped key, `sessionStore` token, injectable `fetchImpl`, `getNextPageParam` from `nextCursor`).

Spec decision 4: this migration exists to prove the contract on a second resource. Breaking the `/v1/assets` envelope is fine — both sides move in this ticket.

## Tasks

- [ ] `apps/api/src/reads/assets.ts`: accept `status` (one or more lifecycle statuses), `category` (asset class code), `branchId`, `search`, `cursor`, `limit` via the ticket-12 `listQuery` helper; unknown values → `400 VALIDATION_FAILED`.
- [ ] Keyset-paginate on `(asset_code ASC, id)` using the shared cursor helper from `apps/api/src/reads/cursor.ts`; respond `{ items, nextCursor }`. Drop `workspaceId` from the body unless a consumer still needs it (it is derived from auth, not data).
- [ ] `search`: case-insensitive match over `asset_code`, `registration_number`, `manufacturer`, `model`. Category *labels* were searchable client-side; searching them server-side needs the categories join in the predicate — do it if it is one clause, otherwise leave them out and note the deliberate narrowing in the ticket comments.
- [ ] Branch scope stays as it is (`auth.branchScope === "ALL"` vs `inArray`) and is never client-supplied; all queries stay inside `inWorkspace`.
- [ ] `src/assets/useAssets.ts`: rewrite as a plain `useInfiniteQuery` mirroring `useEntries.ts:39-54`, taking a filter params object and returning the query object. Delete the `{ status, assets, retry }` shape.
- [ ] `src/assets/api.ts`: send the query params, parse the `{ items, nextCursor }` envelope, keep the runtime type guards (adjusted to the new shape) and the injectable `fetchImpl`.
- [ ] `AssetsStub.tsx`: replace the `status` string comparisons (`:142-149`) with `isPending` / `isError` / `isFetching`, feed the search box and the `ALL | IN_SERVICE | ATTENTION` filter to the server (mapping ATTENTION to its three lifecycle statuses), and page with the cursor. Delete `assetMatches` from `src/assets/model.ts` and its tests, keeping `assetDisplayName`.
- [ ] If ticket 11 has landed, update its asset filter select to the new hook signature.
- [ ] API tests in `apps/api/src/reads/assets.test.ts`: each filter narrows correctly; `search` is case-insensitive and matches each searched column; pagination is stable with no duplicates or gaps across pages; a branch-scoped member sees only their branches; `limit` above the max is rejected.

## Acceptance

- [ ] `/v1/assets` returns `{ items, nextCursor }` and honours every documented filter
- [ ] `grep -rn "assetMatches" apps` returns nothing
- [ ] Asset list search and filtering work end to end against a fake `fetchImpl` in the web tests
- [ ] `pnpm --filter @routiq/api test && pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Sorting controls on the asset list (the order stays `asset_code ASC`), migrating documents/categories/reference reads, any asset write command, and `AssetsStub`'s visual design — the hero and card grid survive as-is apart from what the new hook requires.

## Comments

- 2026-07-26 Opus worker: implemented; committed as 0e2725a. 202 api / 364 web / 80 contracts tests green. Deviations accepted on review: branch code/name dropped from search (deliberate narrowing, comment in code); hero metrics now page-scoped (honest fix = aggregate endpoint, dashboard-ticket concern); local useDebouncedValue in AssetsStub pending dedupe with ticket 09's lib hook; three lifecycle statuses seeded by direct update in tests (no write command exists yet).
