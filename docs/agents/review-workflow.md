# Review and merge workflow

Feature PRs target `develop`. Release PRs target `main`. The repo stays public; this change buys no plan and changes no deployment or Sentry credentials.

## Before opening or merging a PR

Link the issue and describe the bounded scope. Record the author model in the PR body. Run the checks appropriate to the change and attach app proof when app behavior changes.

A reviewer using a different model runs `.agents/skills/code-review/SKILL.md` against pinned base/head SHAs and the linked acceptance criteria. Its report includes Standards and Spec findings, one PASS/FAIL/UNVERIFIED verdict per acceptance line, file:line evidence, executed checks and reproduction steps for blockers. Missing criteria or unverified acceptance cannot receive `review:approve`.

When authorized, the coordinator posts the report and applies exactly one of `review:approve` or `review:changes`. New commits invalidate it; re-review the current head. A same-account agent comment is independent-model evidence, but GitHub does not let it become an approving review of its own PR.

## GitHub enforcement

`.github/branch-protection.json` is the settings source for `main` and `develop`. It requires up-to-date `ci` from the GitHub Actions app, one approving review, dismissal of stale approvals, approval by someone other than the last pusher, and resolved conversations. It blocks force pushes and branch deletion and applies to administrators. No reviewer bypass is configured.

An eligible separate GitHub reviewer or the installed CodeRabbit app must submit an actual approving review. A green CodeRabbit commit status, skipped review, summary, local report or label alone does not satisfy that approval requirement. The human merger also checks the current independent-model report and `review:approve`; that label rule is not automated by this settings file.

Check the live protection API after applying settings. An unmerged config file does not change repository settings. Evidence and ratchet checks from PR #63 are not yet required because their workflow has not landed; review and merge #63 separately, then add its live check names to protection. Do not require missing checks and strand every PR.

To apply the reviewed settings from this checkout with admin access:

```sh
node -e 'const fs = require("node:fs"); const config = JSON.parse(fs.readFileSync(".github/branch-protection.json", "utf8")); fs.writeFileSync("/tmp/routiq-branch-protection.json", JSON.stringify(config.protection));'
gh api --method PUT repos/truesignal-digital/routiq/branches/develop/protection --input /tmp/routiq-branch-protection.json
gh api --method PUT repos/truesignal-digital/routiq/branches/main/protection --input /tmp/routiq-branch-protection.json
```

GitHub protection remains editable by repository administrators. The settings above do not prevent an administrator from changing the policy itself.

## Sentry intake compatibility

The separately developed `sentry-issue-intake` adapter imports sanitized runtime reports and sends them to Pstack triage. It does not authorize a fix or approval. An intake report needs confirmed reproduction, expected behavior and acceptance criteria before an agent fixes it. The resulting PR follows the same proof and review rules as any other fix.

Keep full diagnostics and Sentry credentials in restricted Sentry/local environment files. Public review evidence must not quote raw events, request/user fields or secrets. A completed review video demonstrates evidence; the independent code review judges the diff against the issue.

The review changes do not alter `pnpm sentry:intake`, its preview/apply behavior, deduplication markers or triage queue. Both branches edit `AGENTS.md`; retain the intake routing paragraph when combining them. The separate Sentry branch owns its CLI, skill and environment additions.
