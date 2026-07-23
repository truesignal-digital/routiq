# Repo + scaffold baseline

Type: task
Status: resolved

## Question

Version the project and lock the build starting line: git init + first commit of current scaffold (Linus must approve the commit), pin toolchain versions per ARCHITECTURE.md §8, confirm typecheck/test commands run green. Unblocks build hand-off structure (fog).

## Answer

Resolved 2026-07-22.

- `git init` on `main`; root commit `0448daf` (206 files) approved by Linus, includes scaffold + skills + tracker + docs/agents.
- Toolchain verified per §8: Node 24.12.0 (engines ≥24), pnpm 10.28.0 (packageManager pin), TS 7, Zod 4, Tailwind 4, Vite 8, React 19, Fastify 5, Vitest 4.
- Fix applied: `drizzle-orm` and `drizzle-kit` were caret-ranged; now pinned exact (0.45.2 / 0.31.10) per §8 "pin exact"; lockfile updated.
- Green at commit: `pnpm typecheck` 4/4 packages; `pnpm test` 7 tests pass (domain 3, contracts 3, api 1, web passWithNoTests).
- Unblocks: build hand-off structure (spec → implementation tickets).
