# 07 — Expose enabled presets in `/v1/me`

Status: resolved

Roadmap item 2, web half, server piece. The web needs to know the workspace's enabled preset set to collapse single-preset UX.

## Requirements

- Extend `GET /v1/me` (`apps/api/src/server.ts:95`) with `enabledPresets: TemplateCode[]`, computed alongside `enabledModules` in the same handler:
  - read `workspace_templates` rows for the workspace;
  - zero rows → all `TEMPLATE_CODES` (grandfather parity with `presetEnablement` — cite the helper in a comment);
  - otherwise the codes with `enabled = true`, in `TEMPLATE_CODES` order (stable).
- If a contracts type describes the /v1/me response, extend it; if the shape is implicit, add nothing speculative.
- Tests in the existing auth/me test file's style: provisioned workspace (single preset) returns exactly that preset; grandfathered workspace returns both.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] Me-route tests pass; full api suite green

## Comments

2026-07-30 — Done (Opus 5 worker + review). templates/registry.ts refactored so one rule serves both callers: readTemplateRows + enablementOf shared by presetEnablement (dispatcher) and new enabledPresets(tx, ws) (/v1/me) — grandfather clause cannot diverge between enforcement and UI. Returned in TEMPLATE_CODES order. /v1/me computes modules + presets in one transaction. auth.test: grandfathered workspace → both presets; workspace provisioned via the real command with TRUCKING only → exactly ["TRUCKING"]. api suite 364 green, verified by orchestrator.
