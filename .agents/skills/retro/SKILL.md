---
name: retro
description: "Review one coding session and propose changes to the agent's environment (guards, navigation pointers, AGENTS.md, skills, tooling) so the next session avoids the same friction. Use when the user asks for a retro or retrospective, or at the end of a long session where the user corrected the agent more than once or the agent lost time hunting for files or information. Use for /retro."
---

You are suggesting improvements to the coding agent's **environment** so future sessions go better. You propose; you don't change anything until the user picks which candidates to act on.

This skill looks at one session. The `correct` skill looks across many sessions for mistakes that keep coming back and makes them impossible. When a candidate here is a mistake class, act on it with `correct`'s rung order.

## Steps

1. Read the session the user names; default to the current one. Transcripts:
   - Claude Code: `~/.claude/projects/<cwd with / replaced by ->/<session-id>.jsonl`.
   - Codex CLI: `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`.
   - A decision log in `.audit/*.tsv`, if the session kept one (`show-me-your-work`).

2. Look for candidates in these categories.

- **Navigation.** Did the agent take long to find a file or fact? Is there a hidden dependency between files? Would a pointer in `AGENTS.md`, `apps/web/AGENTS.md` or a skill have saved the search? _Use when_ the session spent many calls finding something.
- **Automated checks.** Could a check have caught a mistake the agent made? Read what exists first: `tools/guards/rules.ts`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm metrics` and `.github/workflows/ci.yml`. A check that exists but is unwired or silently broken is the finding, not a new one. _Use when_ the agent made a mistake a check could catch.
- **Review rules.** Should the reviewer enforce something new? A mechanical rule (a banned API, an import shape, a file location) becomes a guard in `tools/guards/rules.ts` with a case in `tools/guards/rules.test.ts`. A judgement call no guard can check goes into `.agents/skills/code-review/SKILL.md`. Either way, a mistake made twice gets a row in the rule table in `AGENTS.md` naming what enforces it, as `correct` requires. _Use when_ the review missed a mistake.
- **Steering file size.** Should an instruction in `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md` or the user's global `~/.claude/CLAUDE.md` move into a guard, a skill or a doc? _Use when_ a steering file is long.
- **No-ops.** Which instructions in the steering files change nothing the agent does? _Use when_ the steering files are long.
- **Tool economy.** Did the agent make expensive calls that a script or a narrower command would replace, such as dumping whole files, rerunning the full suite, or polling? Is a CLI (`pnpm verify`, `pnpm observe`) missing a flag that would have saved the call? _Use when_ the agent made an expensive call.
- **Information access.** Was a key fact out of reach, such as dev server logs, field telemetry or a third-party dashboard? _Use when_ the agent guessed at something it could have read.

3. Present the candidates to the user, most severe first. For each: what happened (with the transcript evidence), the change you propose, and where it lives.

## Where things go

The implementing agent carries the most context: it explores, writes code and debugs. The reviewing agent gets a diff and carries the least. So standards belong to review and to checks, not to the implementer's always-loaded files.

- `AGENTS.md` (imported by `CLAUDE.md`) loads into every agent here. Keep additions to pointers, rows in the rule table, and rules that nothing can enforce. Follow its trust rungs: architecture, then static checks, then guidance, then human review.
- `apps/web/AGENTS.md` loads for web work only.
- Docs under `docs/` are reference files; point to them from `AGENTS.md` or a skill. Look for an existing doc before writing a new one.
- Skills live in `.agents/skills/<name>/` with a symlink in `.claude/skills/`. A skill's description is always in context, so it can carry a pointer. Follow `writing-great-skills`.
- Lessons about the user, not the repo, go to the agent's memory, not the repo.
