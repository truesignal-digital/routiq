## What changed

<!-- One or two sentences: the behaviour change and why. Reference the issue (#NN). Issues close only when the change reaches main, so close them by hand after merging into develop. -->

## Walkthrough video

<!-- Required when this PR changes apps/web/src or apps/api/src (tests excepted). Link a recording of the feature working in the app and nothing around it breaking: English UI, English captions. The pr-evidence check fails without an https link here. -->

## Found while testing

<!-- Anything else in the app that looked wrong while you tested. File each as its own issue (labels: walkthrough-finding, needs-triage) or its own PR and link it here, or write "none". Don't fix it in this PR. -->

## Checks

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass
- [ ] No guard baseline went up (the ratchet check enforces this)
