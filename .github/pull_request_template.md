## What changed

<!-- One or two sentences: the behaviour change and why. Reference the issue (#NN). Issues close only when the change reaches main, so close them by hand after merging into develop. -->

## Walkthrough video

<!-- Required when this PR changes apps/web/src or apps/api/src (tests excepted). Link a recording of the feature working in the app and nothing around it breaking: English UI, English captions. Include an https link here. The automated pr-evidence check is supplied by PR #63 and applies once that workflow lands. -->

## Found while testing

<!-- Anything else in the app that looked wrong while you tested. File each as its own issue (labels: walkthrough-finding, needs-triage) or its own PR and link it here, or write "none". Don't fix it in this PR. -->

## Independent review

<!-- Required before merge. An independent reviewer uses a different model from the author and runs .agents/skills/code-review/SKILL.md against the linked issue. Link the report with a PASS/FAIL/UNVERIFIED verdict for every acceptance line and file:line evidence. Approval applies only to the exact reviewed head SHA; new commits need another review. -->

- Author model:
- Reviewer model:
- Reviewed head SHA:
- Report URL:
- Verdict: `review:approve` / `review:changes`

## Checks

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass
- [ ] No guard baseline went up
- [ ] Independent review approves the current PR head; all blocking findings are resolved
