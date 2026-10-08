---
name: principle-encode-lessons-in-structure
description: "Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a type, a guard, a runtime check, or a script instead of more text."
---

# Encode Lessons in Structure

Encode recurring fixes in mechanisms (types, guards, runtime checks, scripts) instead of textual instructions. Every error, human correction, and unexpected outcome is a learning signal. Capture it, route it, and close the loop.

**Why:** Textual instructions are easy to miss. They require the reader to notice, remember, and comply. Structural mechanisms (guard rules, runtime checks, scripts) enforce the rule without cooperation.

**Pattern:**
When you catch yourself writing the same instruction a second time:
1. Ask: can this be a type, a guard in `tools/guards/rules.ts`, a runtime check, or a script?
2. If yes, encode it. Delete the instruction.
3. If no (requires judgment), make the instruction more prominent and add an example of the failure mode.

**Pick the strongest mechanism.** When more than one mechanism would work, choose the strongest the situation allows (an unrepresentable state that cannot compile, then a guard that fails `pnpm lint` and CI, then a canonical helper, then a runtime check), because agents copy whatever the surrounding code already does and a weaker guard becomes the next template. This is the rung order in `AGENTS.md` ("How trust works here"); the `correct` skill runs the full loop.

**Corollary:** If the fix is structural, only use the structural fix. The instruction is the symptom.

**Feedback loop:**
- **Capture every correction.** When the human intervenes or tests fail, decide if it's a one-off or a pattern.
- **Route to the right layer.** One-off: a note in the PR or issue. Recurring fix: a guard, a helper, or a skill. Systemic issue: an ADR in `docs/adr/` or a line in `AGENTS.md`.
- **Close the loop.** Don't just record. Apply now or file a concrete GitHub issue.

**Anti-patterns:**
- Acknowledging without recording ("I'll keep that in mind" does not persist)
- Recording without routing (a note about a guard that should exist is wasted unless the guard gets written)
- Fixing without generalizing (fixing one instance while leaving the recurring pattern intact)
