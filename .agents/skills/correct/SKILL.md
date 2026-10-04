---
name: correct
description: "Find the mistakes agents keep repeating in this repo and make each one impossible. Try architecture first, then types, then a guard whose error names the fix, then a test, and write docs last. Prove each check fails on a real past mistake. Repeat this each time the operator corrects you. Use for /correct."
disable-model-invocation: true
---

# Correct

The operator keeps correcting agents in this repo for the same mistakes. Change the repo so the next agent can't make them.

Assume every contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Design the repo so a change that looks right from one file is right for the whole repo.

This is the loop behind "How trust works here" in `AGENTS.md`. Its four rungs (architecture, static checks, guidance, human review) are the levels below, and the current plan is in `docs/audits/2026-09-25-trust-audit.md`.

## Find the mistake classes

First, read recent commits, reverts, PR review comments (`gh pr view <n> --comments`), issues labelled `walkthrough-finding`, `AGENTS.md`, `apps/web/AGENTS.md`, and comments that explain workarounds. Group the mistakes into classes. A class counts once it has happened twice.

## Fix each class at the highest level that works

1. **Eliminate it with architecture.** Give each piece of state one owner and each task one supported way. Hide internals so the wrong import fails. Replace hand-synced lists with one source of truth. Delete old ways and dead code an agent would copy.
2. **Enforce it with types so the bad state can't be written.** If bad code still compiles, add a guard in `tools/guards/rules.ts` whose `fix` text names the file, type, or function to use instead, with a case in `tools/guards/rules.test.ts`. If the pattern is already common, the ratchet in `tools/guards/baselines.json` fails only when a change adds more. Never raise a baseline by hand; the only exception is an ADR cited by a `Trust-Exception: ADR-NNNN` commit trailer.
3. **Test the behavior.** Fix or delete any test that would still pass if every function it calls returned nothing.
4. **Write docs or agent rules last, only for judgment calls.** Nothing fails when an agent skips them.

## Fix and prove

Then fix the most frequent classes now, one commit each. Prove each new check fails on a real past mistake: check out or recreate the offending code and show `pnpm lint` (or the test) failing on it. Run the same command locally and in CI (`.github/workflows/ci.yml`). Exceptions go on the offending line with a reason, an expiry date, and a human's approval.

## Keep the rule table

Last, keep the table in `AGENTS.md` that pairs each rule with what enforces it. When the operator corrects you, fix the mistake and add the rule. If the rule was already there and nothing enforces it, that's a repeat, so fix it at the highest level in the same change. Drop a rule once its mistake can't happen.

**Reply:** each class with its evidence, the level you picked, and why a higher level didn't work.
