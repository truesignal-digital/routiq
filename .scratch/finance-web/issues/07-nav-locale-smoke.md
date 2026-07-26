# 07 — Finance nav gating, locale sweep, smoke

Status: ready-for-human
Blocked by: 03, 04, 05, 06

**What to build:** The slice's integration pass.

- **Nav:** `Finances` tab in the shell (mobile bottom bar + desktop sidebar), visible when FINANCE module enabled and role may see any finance screen; sub-nav Entries / Record / Approvals / Periods with Approvals + Periods gated to FINANCE_APPROVER + ADMIN. Approvals badge count wired from ticket 05's hook. Follow the module/role gating pattern from the DOCUMENTS nav (web-mtp 02).
- **Locale sweep:** every string added by tickets 03–06 exists in BOTH `en.json` and `fr.json` under the `finance` namespace; no hardcoded strings in components (grep sweep); no sentence concatenation; fr-CM is the reviewed-first text.
- **Smoke:** extend `apps/api/scripts/smoke.ts` happy path if gaps remain (it already covers record → approve → reverse → lock server-side); add a web e2e-style check per the web-foundation 08 convention if one exists, else a routing test that all four screens mount gated correctly per role.

## Acceptance

- [x] MODULE_DISABLED / role-denied users never see the Finance tab (test per AssetsStub.roles.test.tsx pattern)
- [x] Locale key parity test or sweep output attached in Comments
- [x] Full `pnpm test` + `pnpm typecheck` green at repo root
- [x] Screenshots or happy-path walkthrough noted in Comments for ready-for-human review

## Comments

2026-07-26 [codex] nav landed as a sections.ts shell model (gated, tested incl. loading state), FinanceNav sub-nav, locale-parity test at i18n/locales.test.ts, role-gating tests. During review Fable pulled the useRef<any> thread and found the critical shared-intentRef bug in committed 05/06 (reject silently approving after an approve). Fixed in this batch: one typed CommandIntent ref per command across all three screens, plus jsdom regression tests asserting the dispatched command-name sequence for approve->reject and lock->reopen. Full repo: 358 tests + typecheck green.
