# 34 — Assets card grid: real pager and honest metrics

Status: ready-for-agent
Phase: 6
Blocked by: 29

**What to build:** The assets screen is the last list still on a load-more button, and its three hero metrics count only the pages fetched so far — a fleet of 400 shows "12 total" until the operator clicks through. Replace the button with the standalone pager from ticket 29, add `total` to the assets read, and switch the metrics to server-reported counts.

`AssetsStub` is a **card grid, not a `DataTable`** — that is precisely why ticket 29 extracted `ListPager` and `useKeysetPager` as standalone pieces. Do not convert the grid to a table.

Files: `packages/contracts/src/reads/assets.ts`, `apps/api/src/reads/assets.ts`, `apps/web/src/assets/api.ts`, `apps/web/src/assets/useAssets.ts`, `apps/web/src/screens/AssetsStub.tsx` (+ tests). Ticket 35 also edits `AssetsStub` — **sequential, this one first.**

## Design

### Server `total`

Contracts, `packages/contracts/src/reads/assets.ts`:

```ts
export const assetListResponse = listResponse(assetListItem).extend({ total: z.number() });
```

`items` stays `items` — the `entries` legacy key is finance-only and this envelope is already on the ADR-0003 default. The existing comment on the export says exactly that; keep it.

API, `apps/api/src/reads/assets.ts`. Follow the approvals count pattern (`apps/api/src/reads/finance.ts:540-544`):

```ts
const [countResult] = await tx
  .select({ count: sql<number>`count(*)::integer` })
  .from(assets)
  .where(and(...conditions));
```

Two traps, the same pair ticket 30 hit on entries:

1. **The cursor condition is pushed into the same `conditions` array** (`if (decodedCursor) conditions.push(afterTextKeyset(...))`). Count **before** that push, or `total` shrinks on every page. A comment marking the ordering is required.
2. **The count needs the page query's joins.** The `search` filter reaches `categories.labelFr` / `categories.labelEn`, which are only in scope via `.leftJoin(categories, ...)`; a bare count over `assets` throws when `search` is set. Carry `.innerJoin(branches, ...)` and `.leftJoin(categories, ...)` onto the count too.

The count must observe the same `auth.branchScope` narrowing, `branchId`, `status`, `category`, and `search` conditions — it is literally the same `conditions` array, which is the point of counting before the cursor is appended.

The read currently runs its page query inside `inWorkspace(db, ...)`; put the count inside the **same** transaction callback so both see one snapshot.

Return `{ items, nextCursor, total }` through `assetListResponse.parse(...)`.

### Web-side types

Note that `apps/web/src/assets/api.ts` does **not** import the contracts schema — it declares its own `AssetListResponse` interface and hand-rolls an `isAssetListResponse` type guard, with `AssetListItem` living in `apps/web/src/assets/model.ts`. Both must gain `total` (interface field + `typeof value["total"] === "number"` in the guard), or the guard rejects every response and the screen goes to its error state. This is the most likely way to break this ticket.

### Pager on the card grid

`AssetsStub.tsx` currently renders, under the grid, a « Charger plus » button calling `assetsQuery.fetchNextPage()` when `assetsQuery.hasNextPage`. Replace with ticket 29's pieces:

```ts
const pager = useKeysetPager(assets, {
  hasNextPage: assetsQuery.hasNextPage,
  isFetching: assetsQuery.isFetchingNextPage,
  onLoadMore: () => void assetsQuery.fetchNextPage(),
  pageSize,
  resetKey: JSON.stringify(params),   // filter/search change → back to page 1
});
```

and render `<ListPager kind="keyset" ... total={total} pageSizeOptions={PAGE_SIZE_OPTIONS} onPageSizeChange={setPageSize} />` below the grid. The grid maps `pager.pageRows`, not the flattened `assets` array. `pageSize` is state (default `LIST_LIMIT_DEFAULT`) feeding both `useAssets({ limit: pageSize })` and the pager's slice width — mismatched and the pages stop lining up with the cursor. First/prev/next only; **no last-page button and no page jump**, ADR-0003 unchanged.

`useAssets`/`fetchAssets` need `limit` plumbed: `AssetListParams.limit` and the URL append already exist in `api.ts`; `UseAssetsParams` does not have it yet — add it. `limit` rides the query key (`["ws", slug, "assets", params]`), so a size change resets the cursor for free.

Delete the load-more button and the `assets.loadMore` i18n key if nothing else uses it (check both catalogs; `locales.test.ts` enforces fr/en parity).

### Metrics stop lying

Today:

```ts
// Server-side filtering means these count only the pages fetched under the
// current filter, not the whole fleet.
const summary = useMemo(() => summarizeAssets(assets), [assets]);
```

`summarizeAssets` (`apps/web/src/assets/model.ts`) counts the loaded array — total, in-service, attention. Replace **total** with the server's `total` (read off page 1 of the infinite query; every page carries the same value).

`inService` and `attention` are per-status counts the read does not publish. Do **not** invent them client-side from the loaded pages and present them as fleet-wide — that is the current bug. Pick one and say which in the comment:

- preferred, and cheapest: the three metrics become **three server totals** by keeping the existing `useAssets` shape and issuing two additional count-only queries (`limit: 1`) with `status` set to `["IN_SERVICE"]` and to `ATTENTION_STATUSES`, reading each response's `total`; or
- if that is judged too many requests, show only the honest `total` and drop the other two tiles rather than shipping numbers that are wrong.

Either way, no metric may be derived from `assets.length` after this ticket. Reports never invent missing values.

### The shared-hook trap

`useAssets` is also drained by the **entries screen's asset-filter dropdown** (`FinanceEntriesScreen`) — it calls the same hook to populate the asset picker. Its params differ, so its query key differs, and adding `limit` must keep it that way. If the assets screen's page-size state ever leaked into the dropdown's params they would share a cache entry and the dropdown would silently paginate. Pin it with a test.

## Tasks

- [ ] `total` on `assetListResponse` (contracts) + a schema test.
- [ ] Count query in `apps/api/src/reads/assets.ts`, before the cursor condition, with the page query's joins, inside the same `inWorkspace` transaction.
- [ ] `total` on the web `AssetListResponse` interface **and** the `isAssetListResponse` type guard; `limit` on `UseAssetsParams`.
- [ ] `useKeysetPager` + `ListPager` on `AssetsStub`; load-more button and its i18n key removed; grid maps `pager.pageRows`.
- [ ] Page-size state feeding both `limit` and the pager.
- [ ] Hero metrics switched to server totals per the decision above; `summarizeAssets` updated or retired accordingly.
- [ ] Tests: API read, `useAssets`, `AssetsStub` (extend `AssetsStub.filters.test.tsx` / add a pager test).

## Acceptance

- [ ] Test: `total` is constant across a full keyset walk of the assets list — the cursor-condition regression.
- [ ] Test: `total` respects `status`, `category`, `branchId` and `search` (search proves the `categories` join is present), and respects branch scope and tenant isolation.
- [ ] Test: the web type guard accepts a response with `total` and rejects one without it.
- [ ] Test: the pager walks forward by fetching, backward over cache without fetching, and `first()` returns to page 1 with no refetch; changing a filter or the search resets to page 1.
- [ ] Test: the hero total equals the server `total` and does **not** change as the operator pages through — the metric bug this ticket fixes.
- [ ] Test: **the entries screen's asset-filter dropdown and the assets screen use distinct react-query keys** and neither picks up the other's page size.
- [ ] Test: no last-page or page-jump control renders on the assets pager.
- [ ] `pnpm --filter @routiq/api test && pnpm --filter @routiq/web test && pnpm typecheck` green.
- [ ] Browser walk: page through the fleet, change rows per page, confirm the metrics stay put and the counts are honest.

## Out of scope

Selection or bulk actions on the card grid (ticket 35 — same file, sequential, after this), converting the grid to a `DataTable`, per-status counts beyond the decision above, sorting the assets list, per-user persistence of the page size.
