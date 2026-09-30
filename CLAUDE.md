# CLAUDE.md — ROUTIQ

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. The rules shared by every agent live in `AGENTS.md`; keep them there, not here.

@AGENTS.md

## Claude Code specifics

- Skills live in `.agents/skills/` and are symlinked into `.claude/skills/`. `skills-lock.json` pins their upstream versions.
- Before changing anything under `apps/web/`, read `apps/web/AGENTS.md` (also imported by `apps/web/CLAUDE.md`).
