# 05 — Module entitlements

**What to build:** A workspace admin enables or disables application modules as an audited command, and the pipeline enforces it in exactly one place: a command owned by a disabled module is rejected with a stable code, with no per-feature conditionals inside handlers (ARCHITECTURE.md §3.3a).

**Blocked by:** 03 — Command pipeline core.

**Status:** ready-for-human

- [x] `workspace_modules` table: workspace, module code, enabled, enabled_at, enabling command provenance
- [x] Module codes are a fixed code-level registry; each declares the commands it owns; ASSETS and DOCUMENTS registered
- [x] Pipeline gains one check after authorization: command's owning module enabled for the workspace, else stable rejection code
- [x] EnableModule / DisableModule commands, admin role only, fully audited through the normal pipeline
- [x] Integration test: RegisterAsset succeeds with ASSETS enabled, is rejected after DisableModule, succeeds again after EnableModule; data untouched throughout

## Comments

- Implemented 2026-07-22. Modules default enabled when no entitlement row exists; disabling is the recorded act. CORE owns the toggle commands and cannot itself be disabled. Audit after-state is built from the database-returned row so timestamps and versions exactly match persisted state.
- Fable review (2026-07-23): enable/disable handlers were 95% duplicated — collapsed into one `moduleToggleCommand` factory; behavior unchanged, tests untouched and green.
