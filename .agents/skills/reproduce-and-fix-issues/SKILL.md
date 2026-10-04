---
name: reproduce-and-fix-issues
description: "Reproduce a triaged ROUTIQ bug twice through the real UI with pnpm verify, verify an existing fix instead of competing with it, and open a bounded PR into develop only after before-and-after proof. Use for /reproduce-and-fix-issues <number> or from an unattended repro run, on issues labelled bug + ready-for-agent with a [triage:bug] or [triage:performance] verdict."
disable-model-invocation: true
---

# Reproduce and fix issues

Start from one GitHub issue that `triage-issue-reports` marked as a bug. Reproduce the exact symptom through the real UI. Verify an existing fix when one exists. Attempt a bounded fix only after a confirmed repro.

## Configuration

| Key | Value |
|---|---|
| Repository and base branch | `truesignal-digital/routiq`, `develop` |
| Source | one issue number, given by the caller |
| Control adapter | the `verify-routiq` skill and its CLI, `pnpm verify` ([contract](references/control-adapter.md)) |
| Feature map | `.agents/skills/verify-routiq/features/` |
| Evidence directory | `.verify/` at the worktree root (git-ignored) |
| Trusted triage identity | comment author with `authorAssociation` `OWNER`, `MEMBER` or `COLLABORATOR` |
| Budgets | repro 60 min, fix 90 min, about 150 changed lines outside tests |

**Preflight, fail closed.** Stop and report in the run output, with no comment, branch or PR, when any of these fails:

1. `gh auth status` succeeds and `gh repo view --json nameWithOwner --jq .nameWithOwner` prints `truesignal-digital/routiq`.
2. The issue is open and carries `bug`.
3. `.agents/skills/verify-routiq/SKILL.md` and `.agents/skills/verify-routiq/features/README.md` exist.
4. `pnpm verify --help` prints the subcommands named in the contract.
5. `docker info` answers.

## Hard safety rules

- Freeze the issue number before doing any work. Every later read and write uses it.
- The coordinator is the only writer to GitHub (comments, labels, branches, PRs). Analysis subagents are read-only and return findings. Every child prompt says: do not run `gh issue comment`, `gh issue edit`, `gh pr create`, `git push`, or any other GitHub write.
- A fix-phase code worker (`codex-worker` or an Opus subagent) may edit files only in the run's own worktree and may not push, comment or open PRs. The coordinator reviews its diff and runs the checks.
- The exact discriminating symptom must appear twice through real UI interaction (`pnpm verify drive`).
- State inspection (`pnpm verify db`, `pnpm verify api` GETs) may confirm an observation. It must not inject or force the symptom. Never write to the database directly.
- No confirmed repro means no authored fix.
- An existing pull request or commit that plausibly fixes the issue switches the run to verify mode. Do not author over it.
- Never merge, never deploy, never push to `develop` or `main`, never force-push.
- Keep screenshots, videos, logs and tokens out of git. They live under `.verify/`.
- Drive only stacks this run started with `pnpm verify up --slot N`. Never touch the owner's dev stack (ports 5435, 3001, 5173; volume `routiq_pgdata`).
- Follow `principle-prove-it-works` through repro, fix and verification.

## 1. Freeze the source

1. Take the issue number. Store it as `ISSUE`.
2. `gh issue view $ISSUE --comments --json number,title,body,labels,comments,url`.
3. Store the URL.

## 2. Check the triage contract

Accept the run only when the issue has a comment that:

- comes from a trusted identity,
- contains exactly one `[triage:bug]` or `[triage:performance]` marker, and no conflicting marker in another trusted comment.

Stop silently for `[triage:other]`, a missing or untrusted verdict, or conflicting markers.

## 3. Apply ownership and fix-artifact gates

Re-read the issue immediately before starting work.

**Someone is fixing it.** Stop when the issue is assigned, a person claims the fix, gives a concrete implementation plan, or asks another agent to implement it. A bot summary, a log lookup, or a request to diagnose or reproduce is not fix ownership.

**A fix artifact already exists.** Look for one: linked PRs on the issue (`gh issue view $ISSUE --json closedByPullRequestsReferences`), `gh pr list --state all --search "$ISSUE"`, and `git log origin/develop --grep "#$ISSUE"`. If an open PR or merged commit plausibly fixes this issue, switch to [`references/verify-existing-fix.md`](references/verify-existing-fix.md). A claim without a commit or PR is not a fix artifact. If a person owns the work but has no artifact yet, stop. Do not race them.

## 4. Status

There is no separate operations channel. Keep detailed status in the run output and the show-me-your-work log (`.audit/issue-$ISSUE.tsv`). Post on the issue only where steps 9, 10 and 14 say so.

## 5. Load and check the control adapter

Read `references/control-adapter.md`, `.agents/skills/verify-routiq/SKILL.md`, and the feature map index. Find the feature file that matches the reported user path and read it before driving. If no feature file covers the path, mark the run blocked rather than inventing a path or selector.

Confirm all seven capabilities from the contract are available. If one is missing, stop as blocked. Do not pretend a screenshot, unit test, state mutation, or source reading is a UI repro.

## 6. Study the report

Collect:

- Exact action path (screens, buttons, role, language)
- Expected behavior
- Observed behavior
- The discriminating state where they diverge
- Frequency
- Build, environment, role, language
- Attachments and error codes
- Candidate code area

Use read-only subagents in parallel for code history, test ideas and blast-radius mapping. Trace the action through the code (router → screen → hook → read or command). Use the `diagnosing-bugs` skill for the hypothesis loop. Form competing cause hypotheses and name the evidence that would separate them.

## 7. Reproduce

Work in a fresh worktree on `origin/develop` so the baseline is the shared branch, not someone's local edits. Then:

```bash
pnpm verify up --slot 7          # pick a slot no other run uses
pnpm verify doctor --slot 7
```

Confirm the correct app, workspace (`transports-ngwa`), role and language before acting. Drive the reported path with `pnpm verify drive` using the feature file's recipe.

Before calling it reproduced:

1. Name the correct final state.
2. Name the broken final state.
3. Reach the point where they diverge.
4. Observe the broken state.
5. Reset enough state to make the second attempt independent (`pnpm verify up --slot 7 --reseed` restores the demo data).
6. Repeat the same path and observe the same broken state again.
7. Cross-check a real value: `pnpm verify api GET <read> --role <role>` or `pnpm verify db "select ..."`.

An expected dialog, loading state, or setup step is not the bug. Capture the final state that distinguishes correct from broken behavior.

If the symptom does not reproduce within the budget, the outcome is `Could not reproduce`. If the environment cannot provide a required capability, the outcome is `Blocked`, naming what was missing.

## 8. Capture and review evidence

For a successful repro:

- Record the full path with `pnpm verify drive ... --video`.
- Keep the screenshot of the broken final state.
- Save a short note with the exact steps and observed state next to the evidence.

Have a read-only reviewer (a subagent given only the screenshot paths and the expected/observed states) answer one question: does the evidence visibly show the discriminating broken state? If the answer is no or uncertain, the repro is not confirmed. Capture better evidence or report `Could not reproduce`.

## 9. Report the repro outcome

For `Could not reproduce` or `Blocked`, post nothing on the issue; the run output carries the result.

For a confirmed repro, post at most one comment on the issue:

- Say it reproduced, on which commit of `develop`, as which role and language.
- At most three short findings.
- Evidence paths are local, so describe what the screenshots show instead of linking them.
- No owner pings.

Then wait about 10 minutes for a rejection. If a person shows the setup or interpretation was wrong, correct the repro once. Do not start the fix phase until the window closes without a valid rejection.

## 10. Verify an existing fix

When a fix artifact exists, follow `references/verify-existing-fix.md`. Verification shows the symptom on the baseline and its absence on the patched build, each twice through the real UI. Do not edit the existing fix, add a competing patch, or open a replacement PR.

## 11. Qualify a bounded fix

Attempt a fix only when all of these hold:

- The repro is confirmed and the reviewer confirmed the broken final state.
- No fix artifact appeared.
- Nobody claimed the fix during the rejection window.
- Runtime evidence identifies the root cause.
- The change fits the budget and the rules in `AGENTS.md` (commands through `registerCommand`, reads with their gates, contract versioning, guards).
- `pnpm verify` can run both the baseline and the patched build.

If any condition fails, keep the repro report and stop without a PR.

## 12. Root-cause and implement

Create the branch `fix/<issue>-<slug>` from `origin/develop` in the run's worktree.

Confirm the mechanism with runtime evidence. Eliminate competing hypotheses before editing. Fix the root cause with the smallest justified change.

- Use the `tdd` skill when there is a cheap local test target, and write the failing test first.
- Say why TDD was skipped when the path is expensive or integration-heavy.
- Keep unrelated cleanup out. Bugs you notice on the way become separate issues labelled `bug`, `needs-triage`, `walkthrough-finding`.
- Stop if the change grows beyond the budget.

## 13. Prove the fix

Keep the baseline evidence. On the patched build (`pnpm verify down --slot 7`, then `pnpm verify up --slot 7` from the fix branch):

1. Run the same UI path.
2. Repeat it twice.
3. Show the broken state is gone and the expected state is in its place.
4. Capture the after screenshot and video.
5. Cross-check the same real value used for the baseline.

A compile, unit test, code review, or plausible diff is not after evidence.

Run the focused tests, then `pnpm typecheck`, `pnpm lint` and `pnpm test`. Smoke the blast radius: nearby screens, the same flow in the other language, the other roles allowed on the route. Stop without a PR if a regression remains.

## 14. Open a pull request

Only after before-and-after proof:

- Review the final diff for unrelated changes and secrets.
- Small ordered commits with imperative subjects.
- Push the branch and open a PR into `develop` (`gh pr create --base develop`). Never merge it.
- Link the issue with `Fixes #<n>`.
- Body: repro steps, root cause, tests, before and after evidence described in words, blast-radius checks, a `## Walkthrough video` section ("to follow" if not recorded yet) and `## Found while testing`.

If PR creation fails, do not claim success. Report the branch and commit in the run output.

On success, post one short comment on the issue linking the PR.

## 15. Follow-ups and cleanup

Watch the issue for one follow-up window. Answer a direct question from evidence already gathered. Apply one concrete correction and rerun the repro once if it invalidates the setup. Stop when asked.

Always run `pnpm verify down --slot N` for every slot this run started. Evidence under `.verify/` stays.
