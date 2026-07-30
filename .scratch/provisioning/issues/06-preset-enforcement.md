# 06 — Enforce enabled presets server-side

Status: resolved
Blocked by: 04

## Task

Close the gap CONTEXT.md flags under Template binding: today any user can submit either preset's sheet. Commands that carry a `templateCode` must reject presets not enabled for the workspace — checked in the pipeline like module flags (ADR-0004).

## Requirements

- Helper mirroring `isModuleEnabled` (`apps/api/src/modules/registry.ts`): `isPresetEnabled(tx, workspaceId, presetCode)` over `workspace_templates`. Semantics decision — modules are absent-means-enabled, but presets were explicitly chosen at provisioning, so absent means DISABLED. Exception: a workspace with ZERO `workspace_templates` rows predates provisioning (both current tenants) — treat as all-enabled and log a warning, so this ships without a data migration. Record this grandfather rule in a comment at the helper.
- Enforcement point: find every command whose payload carries `templateCode` (`register-asset`, sheet commands — grep contracts) and add the check. Prefer one pipeline hook (a `CommandDefinition` field like `presetCode(payload)` checked by the dispatcher next to the module check) over N copies in handlers — follow the module-check precedent.
- Stable error code (e.g. `PRESET_DISABLED`), never an English string; add fr + en messages to web locale files ONLY if the web app maps command error codes there today (check `apps/web/src/i18n/locales/` for existing command-error patterns; if not present, out of scope).
- Tests: enabled preset passes; non-enabled → 403 with the code; zero-rows workspace passes (grandfather); existing test seeds keep passing (they have zero rows → grandfathered).

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] New tests pass; full api suite green (no existing test needed pack rows added)
- [ ] Single enforcement point in the dispatcher, not per-handler copies

## Comments

2026-07-30 — Done (Opus 5 worker + review). apps/api/src/templates/registry.ts: presetEnablement(tx, ws, preset) → ENABLED | DISABLED | UNCONFIGURED — three-state instead of the ticket's boolean, approved: the grandfather rule needs "tenant chose it" vs "nobody configured this workspace" distinguishable to log backfill candidates; UNCONFIGURED documented as a transition state to delete once pilot tenants have rows. Dispatcher checks presetCode?.(payload) right after the module check (rejection consumes no idempotency key, leaves REJECTED receipt); grandfather emits preset.unenforced via widened CommandLog{error, warn?} (pino warn reaches production logs — asserted by test). Wired: register-asset + create-activity read payload.templateCode; sheets return their fixed config.templateCode (sheets carry no templateCode in payload — the hook-shape caught what a payload-field check would miss). PRESET_DISABLED in contracts + fr/en strings. Micro-fix folded in: StarterPack type with optional approvalRules; replayPacks flatMaps all packs. 7 tests incl. both sheet directions, explicit enabled=false, grandfather + warning emission; tenants set up via real provision-workspace + loginWithPin. Final verification (orchestrator, sequential): typecheck green; contracts 113, api 42 files/361, web 75 files/753 — all pass.
