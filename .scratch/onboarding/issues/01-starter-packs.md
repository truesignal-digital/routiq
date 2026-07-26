# 01 — Starter packs as versioned data files + replay script

Status: needs-triage

## What

Per-business-type seed bundles (`packs/trucking.json`, `packs/passenger.json`) containing asset categories, expense categories, document types + lead times, required-field lists, approval thresholds. One script replays a pack into a fresh workspace **as commands** through the normal pipeline.

## Why

- Onboarding step 5 in spec.md — repeatable, auditable, idempotent (rerun safe).
- Same mechanism works cloud and future on-prem (workspace export/import bootstrap, ARCHITECTURE.md §6a).
- Pack diffs per tenant are the evidence base for a future config engine.

## Notes

- Dev seed script (commit 1d9306b) is the embryo — generalize it rather than writing parallel tooling.
- Packs live in-repo, versioned; applying a pack records provenance via `created_by_command_id` like any other write.
