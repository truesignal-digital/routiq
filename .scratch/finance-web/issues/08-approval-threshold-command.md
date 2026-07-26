# 08 — update-approval-threshold command

Status: ready-for-agent
Blocked by: —

**What to build:** The approval threshold (100 000 XAF pilot placeholder) already lives per-tenant in `approval_rules` rows; no command can change it. Add `update-approval-threshold.v1` so an ADMIN adjusts it through the pipeline — versioned, audited, offline-replayable — per the onboarding spec's config-as-data guard ("config mutations go through the command pipeline").

## Payload (`packages/contracts/src/commands/update-approval-threshold.ts` + test, export from index)

- `commandType`: `"record-revenue" | "record-expense"`
- `amountMaxMinor`: moneyMinor, min 0. 0 means every entry needs approval.

## Handler (`apps/api/src/commands/update-approval-threshold.ts`, registered)

- Module CORE (threshold governs finance but editing config is core admin); allowedRoles ADMIN only.
- branchAuthorization `{ kind: "workspace" }`.
- Updates `amount_max_minor` on the workspace's band rules for the given commandType (the four-role band seeded by `approval-defaults.ts` — rules where `amountMaxMinor` is not null); bumps rowVersion. 422 if no band rules exist.
- Audit event `approval-threshold.updated` with before/after amounts.
- Approval default for this command itself: ADMIN wildcard (registry conventions — check `registry.test.ts` and follow it).

## Acceptance

- [ ] Contract test (payload bounds, 0 allowed)
- [ ] Handler test: threshold change flips a 150k entry from SUBMITTED to POSTED after raising to 200k, and the reverse after lowering
- [ ] Non-admin 403; audit event carries before/after
- [ ] Full api suite + typecheck green

## Comments

Deferred: per-branch/per-category thresholds (the rules table already supports them — UI/command later per rule-of-three); admin UI screen (candidate ticket 09 in the More section).
