# 04 — close-activity.v1 + reopen-activity.v1

Status: ready-for-agent
Blocked by: 03

## Task

Close/reopen pair, mirroring how `period-commands.ts` groups lock/reopen.

## Requirements

- `close-activity.v1`: auto approval. **Warn, don't block** (§3.4 invariant 6): missing readings/legs/source summaries set completeness `COMPLETE_WITH_EXCEPTIONS` with structured warning list in the result; complete data sets `COMPLETE`. Never rejects for missing data. Records what was missing (stable codes).
- `reopen-activity.v1`: 1 approval (§5.1) — wire through the existing approval machinery (`approvals.ts` / `approval-defaults.ts`) the way `reopen-period` does; requires reason.
- No new operational records after close except via reopen (enforce in issue-03 commands if not already — legs/substitutions must reject a CLOSED activity with stable code; adjust issue 03 tests if this lands here).
- Tests: close with full data → COMPLETE; close with missing legs → COMPLETE_WITH_EXCEPTIONS + warning codes; reopen requires approval; post-close leg rejected.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] New vitest files pass
- [ ] Completeness semantics match §3.4 exactly (warn, never block)
