# 33 — Rows per page + totals on the finance screens

Status: ready-for-agent
Phase: 6
Blocked by: 29, 30

**What to build:** Wire the pager capabilities that tickets 29 and 30 made possible into the two finance list screens. The operator picks how many rows a page holds, and the pager stops guessing — « Page 1 sur 12 · 583 résultats » instead of a bare « Page 1 ». Web only; both reads already accept `limit` and both now publish `total`.

Files: `apps/web/src/finance/useEntries.ts`, `apps/web/src/finance/useApprovals.ts`, `apps/web/src/screens/FinanceEntriesScreen.tsx`, `apps/web/src/screens/FinanceApprovalsScreen.tsx` (+ tests). The approvals screen is also touched by ticket 32 — **sequential, 32 first.**

## Design

### `limit` on the hooks

Both hooks build their react-query key from the whole params object:

- `useEntries` — `queryKey: ["ws", session?.workspaceSlug, "finance", "entries", params]`
- `useApprovals` — `queryKey: ["ws", session?.workspaceSlug, "finance", "approvals", params]`

so adding `limit` to `UseEntriesParams` / `UseApprovalsParams` gets **cursor reset for free**: a page-size change is a different key, hence a fresh query starting at page 1 with no cursor. That is the correct behaviour and it needs no extra code — say so in a comment next to the param, the same way `sort` already documents it ("`field:asc|desc`; the cursor is keyed on it, so a change starts a new query").

Both fetchers need to forward it. `fetchFinanceEntries` (`useEntries.ts`) and `fetchApprovals` (`useApprovals.ts`) currently append only `sort` and `cursor`:

```ts
if (params?.limit !== undefined) url.searchParams.append("limit", String(params.limit));
```

Server side is already done: `listQuery` folds in a bounded `limit` (`packages/contracts/src/reads/list.ts` — default `LIST_LIMIT_DEFAULT = 50`, ceiling `LIST_LIMIT_MAX = 100`), and both finance reads destructure it. Nothing to change in the API. Do not let a client send a size above 100 — clamp to the shared `PAGE_SIZE_OPTIONS` (exported by ticket 29), which tops out at 50.

### Page size is state, not a constant

- **Entries**: `FinanceEntriesScreen.tsx` currently hardcodes `pageSize: LIST_LIMIT_DEFAULT` (~line 243) on the `loadMore` config. Replace with `useState` defaulting to **50**.
- **Approvals**: `FinanceApprovalsScreen.tsx` has `const APPROVALS_PAGE_SIZE = 100;` (~line 55). Replace with `useState` defaulting to **100** — the queue is worked top to bottom and a deep queue paged at 50 doubles the round trips. Note that 100 is the server ceiling, so it is not in `PAGE_SIZE_OPTIONS`; either extend the options for this screen or accept 50 as its top choice and drop the default to 50. Pick one, state which in the ticket comment, and make the selected value always appear in its own dropdown (a `Select` whose value is absent from its items renders blank).

The chosen size feeds three places at once: the read's `limit` param, `DataTableLoadMore.pageSize` (so the pager's slice width matches what the server returns — mismatched and the pages stop lining up with the cursor), and the pager's `pageSizeOptions` / `onPageSizeChange`.

### Totals into the footer

Ticket 30 added `total` to `financialEntryListResponse`; approvals has published one since it shipped and `approvalsTotal(data)` (`useApprovals.ts`) already reads it off page 1. Pass `total` through the new `DataTableLoadMore.total` field (ticket 29), which makes `ListPager` render « Page N sur M » plus the result count. Read it off the **first page** of the infinite-query data, not the last — every page carries the same value and page 1 is always loaded.

**No page jumping.** ADR-0003 is unchanged: knowing M is a display fact, not a navigable index. The pager exposes first/prev/next only, and this ticket must not add a goto control.

### i18n

The pager's own keys landed in ticket 29. Add only what these screens need (a rows-per-page label if not already covered by the existing `dataTable.rowsPerPage`). fr+en parity is enforced by `apps/web/src/i18n/locales.test.ts`.

## Tasks

- [ ] `limit` on `UseEntriesParams` / `UseApprovalsParams` and forwarded by both fetchers, with the query-key/cursor-reset comment.
- [ ] Page-size state on both screens (entries 50, approvals 100 or 50 per the decision above) replacing the hardcoded constants; the same value drives `limit`, `loadMore.pageSize`, and the pager control.
- [ ] `total` wired into `loadMore.total` on both screens, read off page 1.
- [ ] i18n fr+en for anything new; zero literals.
- [ ] Tests on both hooks and both screens.

## Acceptance

- [ ] Test: changing rows per page sends the new `limit` to the read **and** restarts at page 1 with no cursor (assert the request URL has `limit` and no `cursor`).
- [ ] Test: the react-query keys for two different limits are distinct — no cache bleed between page sizes.
- [ ] Test: the footer renders « Page 1 sur M » and the result count from the server `total`, and M recomputes when the page size changes.
- [ ] Test: `loadMore.pageSize` always equals the requested `limit` (the slice-width invariant that keeps pages aligned with the cursor).
- [ ] Test: the pager still offers no last-page or page-jump control on either screen.
- [ ] Test: bulk selection from ticket 32 survives a page-size change without leaving stale ids selected (a size change is a new query — assert the selection is cleared or, if kept, that it holds only ids still present).
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests stay green.
- [ ] Browser walk: set entries rows-per-page to 10 and see « Page 1 sur M » with the honest result count; page forward and back.

## Out of scope

The assets screen (ticket 34), any API change (`limit` is already accepted, `total` already landed in 30), offset pagination or page jumps, per-user persistence of the chosen page size.
