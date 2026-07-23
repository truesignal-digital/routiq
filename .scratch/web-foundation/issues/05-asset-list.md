# 05 — Asset list

**What to build:** An asset manager opens Assets and sees the fleet: registered assets scoped to their workspace and branch visibility, category labels rendered from the bilingual category data per active locale, a designed empty state for a fresh workspace ("register your first asset"). Includes the server side of the slice: an asset list read view shaped for this screen (no client-side joins).

**Blocked by:** 02 — Login + session; spine 03 — Command pipeline core + RegisterAsset (`.scratch/spine/issues/03-command-pipeline-core.md`).

**Implementation note:** run in a git worktree; touches `apps/web` + a read endpoint in `apps/api` (new route file, no shared-file edits with the spine session).

- [ ] Asset list read view on the API: workspace-scoped, branch-visibility filtered, response shaped per screen (id, name/identifier, category labels fr+en, lifecycle status)
- [ ] List screen renders on mobile and desktop widths; category label follows the active locale from the data, never from translation files
- [ ] TanStack Query with workspace-scoped query key; no cache persistence
- [ ] Empty state in fr/en with a register call-to-action (target may 404 until ticket 06 — acceptable)
- [ ] Lifecycle status displayed distinctly from availability (vocabulary per ARCHITECTURE.md §3.1 — they are different concepts)
- [ ] Seeded workspace B cannot see workspace A's assets through this view (test)
