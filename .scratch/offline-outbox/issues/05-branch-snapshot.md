# 05 — Branch snapshot cache for offline form rendering

**What to build:** Forms cache their branch-scoped read responses wholesale (categories, assets, branches, documents) in Dexie for offline rendering. Data is refreshed on every successful sync, never on stale cursors.

**Blocked by:** nothing

**Status:** ready-for-agent

- [ ] Dexie schema in `apps/web/src/offline/db.ts`: `branchCache` table with (workspaceId, branchId, categories, assets, branches, documents as JSON blobs, updatedAt)
- [ ] On every successful sync drain in `apps/web/src/offline/sync.ts`, refetch branch-scoped reads and overwrite cache wholesale
- [ ] TanStack Query hooks in `apps/web/src/assets/` and similar (following pattern in `apps/web/src/documents/useDocuments.ts`): if offline, load from branchCache; if online, fetch fresh (server truth always)
- [ ] Never cache company-wide data; cache only branch-scoped reads (categories + assets + branches + documents per branch)
- [ ] Unit tests: form renders offline with cached data, sync refreshes cache atomically, stale cursor never consulted
