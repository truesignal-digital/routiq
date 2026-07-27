# 03 — record-movement-leg.v1 + substitute-asset.v1

Status: ready-for-agent
Blocked by: 02

## Task

Two commands, one issue (they share the segment/leg model). Group handler file like `asset-lifecycle.ts` groups siblings; contracts get name literals each.

## Requirements

- `record-movement-leg.v1`: append ordered leg to an open activity — origin/destination place refs, departed/arrived, distance, load state (§3.1 MovementLeg). Auto approval. Reject on closed activity? No — legs are operational facts; period lock does NOT apply to legs (§4.3), but activity must not belong to a SOLD/RETIRED asset. Check ARCHITECTURE §6 facts-vs-decisions: offline-captured legs must be accepted; keep validation warn-flavoured where the doc says so.
- `substitute-asset.v1`: one customer-facing activity stays; closes the current PRIMARY segment's time range and opens a SUBSTITUTE (or new PRIMARY per §3.2 semantics — read the doc and match it) so each asset carries only distance/cost it actually incurred (§3.4 invariant 7). EXCLUDE constraint from issue 01 must not fire on correct handoff.
- `expectedVersion` optimistic concurrency on the activity row.
- Tests: leg ordering, substitution segment handoff (no overlap), idempotent retries.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] New vitest files pass (`pnpm --filter @routiq/api exec vitest run <files>`)
- [ ] Substitution leaves exactly one non-overlapping PRIMARY timeline per activity
