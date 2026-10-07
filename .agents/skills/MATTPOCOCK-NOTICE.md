# mattpocock/skills notice

Most skills in this directory come unchanged from Matt Pocock's skill pack (https://github.com/mattpocock/skills, MIT licence), installed with the `skills` CLI and pinned in `skills-lock.json`. The ones below are edited copies. Their lock entry records the hash of the upstream folder at the commit below, so running a skills updater over them would overwrite the edits. Re-port them by hand and update the commit here.

- Commit ported: `6fd947921b935b7e1e69293a200400f0fdd5c15f`
- Ported: 2026-10-06

| Skill here | Changes |
|---|---|
| `pr` | Follows `.github/pull_request_template.md` and adds a Merge danger section. Evidence is the `pnpm verify` reel. Lists this repo's one-way doors. Reads `CONTEXT.md`, not `GLOSSARY.md`. Keeps upstream's `CREDITS.md`. |
| `retro` | The model may invoke it. Checks are `tools/guards` and CI; reviewer rules go to `code-review` and the `AGENTS.md` rule table, not `CODING_STANDARDS.md`. Points at `correct` for repeated mistakes and at `writing-great-skills`. |
| `to-tickets` | The model may invoke it: `disable-model-invocation` and the Codex `allow_implicit_invocation: false` policy are removed, and the description says when to use it. The body is upstream's. |
