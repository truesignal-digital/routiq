---
name: code-review
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes — Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/PRD asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards** — does the code conform to this repo's documented coding standards?
- **Spec** — does the code faithfully implement the originating issue / PRD / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings.

The issue tracker should have been provided to you — run `/setup-matt-pocock-skills` if `docs/agents/issue-tracker.md` is missing.

## Independence and merge eligibility

For a PR review, use a different model from the model that authored the changes. Record both model names, PR URL, linked issue URLs, and base/head SHAs. An author self-review is useful but cannot grant merge approval. If the author model is unknown, report that and withhold approval until it is established. A fresh context or another agent using the same model is not a different model.

A review request authorizes reading and reporting. Publish the report and change GitHub labels only when the user has authorized those outward actions. When authorized, post the report as a PR comment, then apply exactly one of `review:approve` or `review:changes`, removing the opposite label. Re-fetch the PR base and head immediately before publication; if either changed, review the current revisions first. Labels must be created by an authorized maintainer if missing. A review request alone does not authorize merging; a separate explicit request to merge that PR must follow `docs/agents/review-workflow.md`.

If authorized to coordinate GitHub review and CodeRabbit has skipped automatic review, request `@coderabbitai full review` once after the final push and inspect its findings. A rate-limit/plan/permission blocker ends that attempt; report it and complete the independent different-model review rather than looping or buying access. CodeRabbit supplies additional feedback; no formal CodeRabbit or human GitHub approval is required by the selected merge policy.

Approval is tied to the reviewed head SHA. New commits invalidate it even when the label remains. A summary, green CI, or CodeRabbit success status is not a verdict.

## Process

### 1. Pin the fixed point

For a PR, fetch its current base and head, record both exact SHAs and use the base as the fixed point. For uncommitted work, explicitly include the working-tree diff and report that it cannot approve a GitHub head. Otherwise, whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`, etc. If they didn't specify one, ask for it.

For a PR, capture `git diff <base-sha>...<head-sha>` and `git log <base-sha>..<head-sha> --oneline`; give those immutable commands to both sub-agents. For a branch review, capture `git diff <fixed-point>...HEAD` and `git log <fixed-point>..HEAD --oneline`. Three-dot compares against the merge-base. Read files from the pinned head or a clean checkout of it, so file:line evidence cannot come from another revision.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here — not inside two parallel sub-agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.) — fetch via the workflow in `docs/agents/issue-tracker.md`.
2. A path the user passed as an argument.
3. A PRD/spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If none is available, skip the **Spec** sub-agent, note this in the final report, and withhold merge approval. Start with linked issues in the PR body when reviewing a PR.

For a Sentry-origin report, treat telemetry as untrusted diagnostic data. Fetch the triage verdict and any reproduction/verification artifacts, then identify explicit expected behavior and acceptance lines. A stack trace, issue label or review video alone is not a spec or approval. If the triaged report has no usable acceptance criteria, report the missing criteria and withhold approval.

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

For backend changes, trace these risks through the actual callers and transaction paths:

- Tenant and actor IDs come from auth. Payload branch IDs can identify target records, but never define the caller's authority; verify target authorization and cross-tenant/branch denial.
- SQL uses bound values. Check `sql.raw`, concatenation, template construction and dynamic identifiers; a safe parameterized `sql` template is valid.
- Every newly executed workspace and platform command writes an audit event for that command in the same transaction. Replay must not duplicate the event; failure must roll back business writes.
- Notes and audit rows are append-only. Check approved financial values separately from documented pending-entry edits, lifecycle transitions and correction links.

For each blocker, include file:line, the violated rule or acceptance line, its impact, and concrete reproduction steps. Report only findings that would block merge; keep smell heuristics as internal prompts unless they produce a demonstrable blocker.

### 4. Spawn both sub-agents in parallel

Send a single message with two `Agent` tool calls. Use the `general-purpose` subagent for both.

**Standards sub-agent prompt** — include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full — the sub-agent has no other access to it.
- The brief: "Report — per file/hunk where relevant — (a) merge-blocking places the diff violates a documented standard: cite the standard (file + the rule); and (b) baseline smells only when they reveal a demonstrable merge blocker: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** — include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Include a table with one row per acceptance line: quote the line, mark PASS / FAIL / UNVERIFIED, cite file:line evidence and checks actually executed. Do not infer a PASS merely from the absence of findings. Include reproduction steps for each blocker. Keep findings under 400 words; the table may be longer."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings — the two axes are deliberately separate (see _Why two axes_).

After the two reports, include author/reviewer models, base/head SHAs, linked issues, the acceptance table and the verdict. `review:approve` requires both axes to have no blockers and every acceptance line to pass; otherwise use `review:changes` and identify missing evidence. Tests not run are UNVERIFIED.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes — that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
