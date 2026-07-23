# 05 — Asset list

**What to build:** An asset manager opens Assets and sees the fleet: registered assets scoped to their workspace and branch visibility, category labels rendered from the bilingual category data per active locale, a designed empty state for a fresh workspace ("register your first asset"). Includes the server side of the slice: an asset list read view shaped for this screen (no client-side joins).

**Blocked by:** 02 — Login + session; spine 03 — Command pipeline core + RegisterAsset (`.scratch/spine/issues/03-command-pipeline-core.md`).

**Implementation note:** run in a git worktree; touches `apps/web` + a read endpoint in `apps/api` (new route file, no shared-file edits with the spine session).

- [x] Asset list read view on the API: workspace-scoped, branch-visibility filtered, response shaped per screen (id, name/identifier, category labels fr+en, lifecycle status)
- [x] List screen renders on mobile and desktop widths; category label follows the active locale from the data, never from translation files
- [x] TanStack Query with workspace-scoped query key; no cache persistence
- [x] Empty state in fr/en with a register call-to-action (target may 404 until ticket 06 — acceptable)
- [x] Lifecycle status displayed distinctly from availability (vocabulary per ARCHITECTURE.md §3.1 — they are different concepts)
- [x] Seeded workspace B cannot see workspace A's assets through this view (test)

## Comments

- Completed (2026-07-23, branch `web-ui`) from the WIP snapshot committed as 624baa0. The WIP's read endpoint (`/v1/assets`: workspace + branch-scope filtered, bilingual category labels joined server-side, code-ordered) and screen (metrics row, search, filter chips, status badges, empty/error/skeleton states, FAB to `/assets/new`) were kept; its data layer was rewritten.
- Fixed from WIP: (1) `readActiveSessionToken` parsed the pre-merge session shape (`activeUsername`) — silently broken against the merged store's `activeKey`; deleted, now uses `sessionStore.getToken()`. (2) Hand-rolled fetch state replaced with TanStack Query per ticket — workspace-scoped key `["ws", workspaceSlug, "assets"]`, no persistence, QueryClientProvider added at root. (3) Reads route returned Fastify's default 500 leaking raw SQL — now try/catch → stable `READ_FAILED` + server-side log. (4) `fetchAssets` takes injectable fetch; api tests rewritten from token-parsing to response-guard behavior.
- Verified live (dev DB :5434 + real API): login → empty state; three assets registered through real `register-asset` commands → cards with bilingual category labels (Remorque/Trailer from data), REGISTERED badges, branch; no horizontal overflow at 360px; desktop two-column grid. Full suite 117 tests green incl. workspace-B isolation integration test.
- Dev seed script extended (approval-rule defaults + category presets — without them a hand-seeded workspace gets APPROVAL_REQUIRED on every command, safe default working as designed).
- For backend session: consider a global error envelope so no route can leak internals on 500 (reads now guards locally); `AssetsStub.tsx` name is stale (real screen now) — renaming with ticket 06 which touches it anyway.
