# Review and merge workflow

Feature PRs target `develop`. Release PRs target `main`. The repo stays public; this change buys no plan and changes no deployment or Sentry credentials.

## Before opening or merging a PR

Link the issue and describe the bounded scope. Record the author model in the PR body. Run the checks appropriate to the change and attach app proof when app behavior changes.

A reviewer using a different model runs `.agents/skills/code-review/SKILL.md` against pinned base/head SHAs and the linked acceptance criteria. Its report includes Standards and Spec findings, one PASS/FAIL/UNVERIFIED verdict per acceptance line, file:line evidence, executed checks and reproduction steps for blockers. Missing criteria or unverified acceptance cannot receive `review:approve`.

When authorized, the coordinator posts the report and applies exactly one of `review:approve` or `review:changes`. New commits invalidate it; re-review the current head. The report must match the current base/head SHAs and every acceptance line must PASS. A different-model report posted through the author's GitHub account is valid review evidence; the selected policy does not require a separate GitHub approving review.

## Merge authorization and accounts

Humans can merge after checking CI, the current independent report, `review:approve` and resolved findings. An agent can do the same only when the user explicitly requests the merge of that PR, including a PR the agent authored. A request to implement, review or open a PR does not authorize a merge.

Immediately before merging, fetch the live base/head and check them against the report. Bind the merge to the reviewed head SHA, such as GitHub's merge API `sha` field or `gh pr merge --match-head-commit`. If the branch is behind, checks are pending/red, the report is stale, an acceptance line is FAIL/UNVERIFIED or a blocker remains, resolve it and refresh review first. Use the normal protected merge path.

`linus5304` is the owner's personal account and needs Write collaborator access to merge in GitHub. Accept the repository invitation while signed into that account. `truesignal-agent` is the automation collaborator; `truesignal-digital` owns the repository. Use the available authorized credentials for a requested merge; do not switch identities to manufacture approval.

## GitHub enforcement

`.github/branch-protection.json` is the settings source for `main` and `develop`. It requires a PR, up-to-date `ci` from the GitHub Actions app and resolved conversations. Required approving review count is zero and latest-push approval is disabled. It blocks force pushes and branch deletion and applies to administrators. Optional approving reviews are dismissed after new commits.

GitHub enforces CI and conversation resolution. The human or explicitly authorized agent merger enforces the different-model report, its base/head SHAs, all-PASS acceptance table and `review:approve`; GitHub does not verify those model/report/label claims. This is the owner's selected CI + independent-model-review policy, without an extra GitHub approval click.

CodeRabbit supplies additional feedback through comments; its request-changes/approval workflow is disabled. On PR #155, automatic review was skipped because the repo has fewer than 10 stars, and the bot still returned SUCCESS with `fail_commit_status: true`. Both review-progress and legacy commit-status output are therefore disabled; review details remain in comments.

When CodeRabbit skips an automatic review, an authorized coordinator can request `@coderabbitai full review` once after the final push. Inspect its findings and address valid blockers. If it reports a rate limit, permission or plan blocker, record that and proceed with the mandatory independent different-model review; do not retry on a timer or buy a plan automatically. A skipped review, summary or green CodeRabbit status never substitutes for that independent review.

Check the live protection API after applying settings. An unmerged config file does not change repository settings. Evidence and ratchet checks from PR #63 are not yet required because their workflow has not landed; review and merge #63 separately, then add its live check names to protection. Do not require missing checks and strand every PR.

To apply the reviewed settings from this checkout with admin access:

```sh
node -e 'const fs = require("node:fs"); const config = JSON.parse(fs.readFileSync(".github/branch-protection.json", "utf8")); fs.writeFileSync("/tmp/routiq-branch-protection.json", JSON.stringify(config.protection));'
gh api --method PUT repos/truesignal-digital/routiq/branches/develop/protection --input /tmp/routiq-branch-protection.json
gh api --method PUT repos/truesignal-digital/routiq/branches/main/protection --input /tmp/routiq-branch-protection.json
```

GitHub protection remains editable by repository administrators. The settings above do not prevent an administrator from changing the policy itself.

## Sentry intake compatibility

The separately developed `sentry-issue-intake` adapter imports sanitized runtime reports and sends them to the triage system. It does not authorize a fix or approval. An intake report needs confirmed reproduction, expected behavior and acceptance criteria before an agent fixes it. The resulting PR follows the same proof and review rules as any other fix.

Keep full diagnostics and Sentry credentials in restricted Sentry/local environment files. Public review evidence must not quote raw events, request/user fields or secrets. A completed review video demonstrates evidence; the independent code review judges the diff against the issue.

The review changes do not alter `pnpm sentry:intake`, its preview/apply behavior, deduplication markers or triage queue. Both branches edit `AGENTS.md`; retain the intake routing paragraph when combining them. The separate Sentry branch owns its CLI, skill and environment additions.
