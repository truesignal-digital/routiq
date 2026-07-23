# 04 — Module-driven navigation + More section

**What to build:** Navigation stops being hardcoded: the shell's sections (tabs/sidebar) come from the workspace's enabled modules, so a workspace with a module disabled never sees its section. Includes the server side of the slice: a read view exposing the authenticated workspace's enabled modules (per §3.3a the read API filters nav the same way the pipeline gates commands). Multi-branch users get a branch switcher in the header. The More section becomes real: profile info, language switcher (fr ⇄ en, persisted per device), logout.

**Blocked by:** 02 — Login + session; spine 05 — Module entitlements (`.scratch/spine/issues/05-module-entitlements.md`).

**Implementation note:** run in a git worktree; touches `apps/web` + a read endpoint in `apps/api` (coordinate with the spine session — new route file, no shared-file edits).

- [ ] Enabled-modules read view on the API, scoped to the authenticated workspace
- [ ] Nav renders sections from that view via TanStack Query (workspace-scoped key); disabling a module removes its section on next fetch
- [ ] No hardcoded section list remains in the shell (ticket 01's stubs deleted)
- [ ] Branch switcher in the header for multi-branch memberships; single-branch users see their branch, no switcher
- [ ] More section: profile (name, role, branch), language switcher persisted per device, logout
- [ ] Language switch re-renders app chrome and persists across restarts
