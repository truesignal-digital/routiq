---
name: pr
description: "Write a PR body for this repo: the sections of .github/pull_request_template.md, plus a sketch of the change, before/after evidence and the merge danger. Use whenever you open a PR or write or rewrite a PR description (gh pr create, gh pr edit --body), and for /pr."
metadata:
  credits:
    skill: show-me
    author: Dex Horthy
    organisation: Humanlayer
    url: "https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md"
---

Write the body in the order of `.github/pull_request_template.md`, with one added section, **Merge danger**. Replace every HTML comment in the template with content; don't leave the comments in. Skip preambles, keep prose brief, and use the terms in `CONTEXT.md`, not the synonyms it lists under _Avoid_.

```markdown
## What changed

<one or two sentences: the behaviour change, why, and the issue (#NN)>

<sketch: diagram, diff-sketch or tree>

## Walkthrough video

<https link, plus before/after evidence>

## Merge danger

**Door:** <one-way or two-way>

<optional: why>

**Blast radius:** <one word>

<optional: what could break>

## Found while testing

<issues or PRs filed, or "none">

## Independent review

<the template's fields, filled once the review exists>

## Checks

<the template's checklist, ticked only for checks you ran>
```

## What changed

Lead with the behaviour change in one or two sentences. Issues close only when the change reaches `main`, so reference them (`#NN`); don't write `Closes #NN` on a PR into `develop`.

Then add the smallest sketch that makes the key point clear. Use one, sometimes two; never all of them.

- Logic or an algorithm as pseudocode:

```text
on(close activity)
  if required fields are missing
    set completeness COMPLETE_WITH_EXCEPTIONS
  commit records + receipt + audit event
```

- Runtime control flow as a call tree:

```text
POST /v1/commands/close-activity
  dispatch
    authorize
    checkIdempotency
    execute (one transaction)
```

- UI structure as a component tree, with the state and module boundaries that matter:

```text
<AssetDetailScreen> (apps/web/src/screens)
  useAssetSummary()
  <DataTable>
```

- A broad refactor as a shallow file tree.
- Interaction between parts as a Mermaid `sequenceDiagram`.
- A `diff` of any of the above when the shape already exists and the point is what changes:

```diff
 POST /v1/commands/close-activity
   dispatch
     authorize
+    checkPeriodLock
     execute
```

Place each sketch next to the sentence it supports. Keep only the calls, files, props and states a reviewer needs.

## Walkthrough video

Follow the template's rule for when a video is required and how to make it. Put the before/after evidence here:

- **App change:** the reel link from `pnpm verify drive ... --reel`; with `pnpm verify reel --before` when behaviour changed. Screenshots are the next best thing.
- **No app change:** the exact test or command that failed before and passes after, with its output. Show the test as pseudocode if its name doesn't say it.

## Merge danger

**Door.** A two-way door can be walked back by reverting the PR. A one-way door can't. In this repo, these are one-way:

- A migration that drops, rewrites or backfills data.
- A renamed or removed command, or a changed command payload. Offline outboxes replay old envelopes, so the old shape must keep working.
- Anything that changes posted financial records, meter readings or audit events. They are append-only.
- A change to idempotency keys or how they are scoped.

**Blast radius.** One word for how far a mistake would spread: `screen`, `module`, `tenant`, `all-tenants`, `offline-clients`. Then name what could break, such as layout on low-end Android, French strings, a report total, or another command that reads the same table.

## Found while testing and Independent review

Fill these as the template says. Leave the review fields for the reviewer when the review hasn't happened yet; never fill them in advance.
