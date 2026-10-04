# Verify an existing fix

Use this mode when an open pull request or merged commit plausibly fixes the issue.

The existing artifact owns the fix. Verify it. Do not edit it, author a competing patch, or open another pull request.

## Qualify the artifact

Require one concrete artifact:

- An open pull request with code changes that address the symptom
- A merged pull request
- A merged commit on `develop` with matching code and intent

A comment claim, a label, a branch name, or a cause hypothesis without a pull request or commit is not enough.

When several artifacts exist, choose the one linked from the issue. Otherwise choose the closest match to the affected code and say why.

## Protect the working tree

Use separate worktrees for the baseline and the patched build (`git worktree add`). Do not touch anyone's uncommitted changes. Run `pnpm install --frozen-lockfile` in each.

Record:

- Baseline revision
- Patched revision
- Pull request or commit URL
- Slot, role, language and seed shared by both runs

## Measure the baseline

For an open pull request, the baseline is its base branch (normally `develop`). For a merged fix, use the revision just before the fix when that revision builds and shows the old behavior.

From the baseline worktree:

1. `pnpm verify up --slot N`, then `pnpm verify doctor --slot N`.
2. Run the reported path with `pnpm verify drive`.
3. Observe the discriminating symptom.
4. Reset with `pnpm verify up --slot N --reseed` and repeat.
5. Capture the screenshot, `--video`, and the same read-only check (`pnpm verify api` or `pnpm verify db`).
6. `pnpm verify down --slot N`.

If the symptom does not appear twice on the baseline, there is no baseline. Do not claim the fix works.

## Measure the patched build

From the patched worktree, with the same slot inputs:

1. Run the same UI path.
2. Repeat it twice.
3. Confirm the broken state is gone.
4. Confirm the expected state appears.
5. Capture the after screenshot, video and the same state check.

Do not stop at compilation or tests. The after result must come from a running patched app.

## Outcomes

**Confirmed.** The baseline reproduces twice and the patched build resolves it twice. Post one short comment on the issue with the before and after result and the artifact link. If the artifact is an open PR, also comment on the PR. Open no pull request.

**Insufficient fix.** The symptom appears on both builds. Comment on the PR with what still fails and how to see it. Open no competing pull request.

**Inconclusive.** The baseline does not reproduce, the patched app cannot run, or the evidence does not show the discriminating state. Do not claim success. Say which half could not be measured, in the run output only.

## Cleanup

`pnpm verify down` for every slot you started, then `git worktree remove` for worktrees you added. Evidence under `.verify/` stays until a person clears it.
