# 05 — Module entitlements

**What to build:** A workspace admin enables or disables application modules as an audited command, and the pipeline enforces it in exactly one place: a command owned by a disabled module is rejected with a stable code, with no per-feature conditionals inside handlers (ARCHITECTURE.md §3.3a).

**Blocked by:** 03 — Command pipeline core.

**Status:** ready-for-agent

- [ ] `workspace_modules` table: workspace, module code, enabled, enabled_at, enabling command provenance
- [ ] Module codes are a fixed code-level registry; each declares the commands it owns; ASSETS and DOCUMENTS registered
- [ ] Pipeline gains one check after authorization: command's owning module enabled for the workspace, else stable rejection code
- [ ] EnableModule / DisableModule commands, admin role only, fully audited through the normal pipeline
- [ ] Integration test: RegisterAsset succeeds with ASSETS enabled, is rejected after DisableModule, succeeds again after EnableModule; data untouched throughout
