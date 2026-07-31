# 02 — `metric-strip` registry component

Status: resolved
Blocked by: 01

## Task

Generic stat-tile band: 2–4 tiles, each `{ label, value, tone?: "neutral" | "warning", hint? }`, loading skeleton + error state, `<dl>` semantics, tabular-nums. Registered in registry.json (component) same-change. Reuses Card/Skeleton primitives; semantic tokens only.

Wire nothing yet — issue 03 consumes it. A small screen-agnostic test (renders tiles, tones, skeleton).

## Acceptance

- [ ] `pnpm typecheck` && `pnpm --filter @routiq/web test` green (incl. registry.test.ts)

## Comments

2026-07-31 — Done (ui-api/Opus + review). Committed 2741ecd. Copy-free tile band, null→em-dash (§3.4), 2-4 tuple-capped, skeleton keeps labels. 10 tests.
