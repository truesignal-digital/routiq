# 07 — Finance nav gating, locale sweep, smoke

Status: ready-for-agent
Blocked by: 03, 04, 05, 06

**What to build:** The slice's integration pass.

- **Nav:** `Finances` tab in the shell (mobile bottom bar + desktop sidebar), visible when FINANCE module enabled and role may see any finance screen; sub-nav Entries / Record / Approvals / Periods with Approvals + Periods gated to FINANCE_APPROVER + ADMIN. Approvals badge count wired from ticket 05's hook. Follow the module/role gating pattern from the DOCUMENTS nav (web-mtp 02).
- **Locale sweep:** every string added by tickets 03–06 exists in BOTH `en.json` and `fr.json` under the `finance` namespace; no hardcoded strings in components (grep sweep); no sentence concatenation; fr-CM is the reviewed-first text.
- **Smoke:** extend `apps/api/scripts/smoke.ts` happy path if gaps remain (it already covers record → approve → reverse → lock server-side); add a web e2e-style check per the web-foundation 08 convention if one exists, else a routing test that all four screens mount gated correctly per role.

## Acceptance

- [ ] MODULE_DISABLED / role-denied users never see the Finance tab (test per AssetsStub.roles.test.tsx pattern)
- [ ] Locale key parity test or sweep output attached in Comments
- [ ] Full `pnpm test` + `pnpm typecheck` green at repo root
- [ ] Screenshots or happy-path walkthrough noted in Comments for ready-for-human review
