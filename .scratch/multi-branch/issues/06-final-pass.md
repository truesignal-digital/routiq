# 06 — final pass

Status: open
Depends: 01–05

## Scope

1. Full workspace test run (api with Docker + web + contracts + domain), typecheck.
2. E2E visual walkthrough (orchestrator, browser): provision-or-create second branch → scoped member sees only theirs → superboss switches branches → register asset in branch B → cross-branch transfer approval still fires → deactivate branch → BRANCH_INACTIVE surfaced in UI as readable French.
3. Docs: ARCHITECTURE.md branch-related claims that changed (provision example, "Milestone 1" note), CONTEXT.md domain terms if new (Agence lifecycle), CHANGELOG-style note if repo keeps one. `.scratch/multi-branch/` issues all marked done.
4. Squash-review: read the full `feat/multi-branch` diff start to finish (orchestrator + one independent worker review), fix nits ≤10 lines or file follow-ups.
5. Report to user: PR-ready summary, remaining follow-ups.

## Verify

Everything green; visual walkthrough recorded (screenshots or GIF).
