---
name: principle-prove-it-works
description: "Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'"
---

# Prove It Works

Verify every task output by checking the real thing directly. Do not infer from proxies, self-reports, or "it compiles."

**Why:** Unverified work has unknown correctness. Indirect verification (file mtimes, output freshness, agent self-reports, cached screenshots) feels cheaper than direct observation. Acting on a wrong inference costs far more than checking the source.

Check the real thing, not a proxy:
- Check process liveness directly, not indirectly through derived state
- Read the actual value, not a cached or derived representation
- When verification fails, suspect the observation method before suspecting the system

Match the check to the change:
- A UI change walks the changed flow in the running app: `pnpm verify up`, then `pnpm verify drive` (see the `verify-routiq` skill).
- A command or read change calls the real API and reads back the row: `pnpm verify api` and `pnpm verify db`.
- A pure function change runs its test file: `pnpm --filter <package> exec vitest run <file>`.
- A migration replays against a fresh stack, not the owner's dev database.

A worker's report counts only with its evidence: `file:line`, the command and its output, or an evidence path you opened yourself.

## Script the check when you can

The strongest proof is a deterministic script that re-runs the same comparison, not a one-time eyeball. Write the script, run it, and keep its output as an artifact a reviewer can re-run instead of trusting your word.

Keep the artifact visible for the human. Commit it only for large or complex work where the trail has to be auditable later, like a big port or migration (the `show-me-your-work` skill).
