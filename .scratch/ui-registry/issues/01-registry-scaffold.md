# 01 — Registry scaffold

Status: ready-for-human
Phase: 0
Blocked by: —

**What to build:** Turn `apps/web` into a shadcn-style registry under the `@routiq` namespace: a `registry.json` describing every shared component, a `shadcn build` step emitting `public/r/*.json`, and a short consumption doc. No component code changes in this ticket — this is the distribution shell that tickets 04–07, 10 and 15 register into.

## Context

Spec decision 1: the registry lives in `apps/web` (`registry.json` over `src/components/{ui,*}`, built to `public/r/*.json`, served by the web app itself — fits the on-prem appliance topology, ARCHITECTURE.md §6a). No new package until a second app exists.

`shadcn` 4.14.0 is already a dependency of `@routiq/web` (`apps/web/package.json:28`) and `apps/web/components.json` is configured with `"style": "base-nova"` and the `@/` aliases. Current inventory (audit §1): fifteen files in `src/components/ui/`, plus `src/components/data-table.tsx` and `src/components/page.tsx`, plus `src/lib/{utils,error-message,notify}.ts`.

## Tasks

- [ ] `apps/web/registry.json` — `$schema: "https://ui.shadcn.com/schema/registry.json"` (items validate against `https://ui.shadcn.com/schema/registry-item.json`), `name: "routiq"`, `homepage` pointing at the app origin, `items: [...]`.
- [ ] One item per shared component. Type mapping: files under `src/components/ui/*` → `registry:ui`; `src/components/{data-table,page}.tsx` → `registry:component`; `src/lib/*.ts` → `registry:lib`. Each item carries `name`, `type`, `files: [{ path, type }]`, `registryDependencies` (e.g. `data-table` → `button`, `table`), and npm `dependencies` where the file imports one (`@tanstack/react-table`, `react-hook-form`, `sonner`, `lucide-react`).
- [ ] Do not register screens (`src/screens/*`), routing, or app-specific slices (`src/finance`, `src/assets`, `src/documents`).
- [ ] `"registry:build": "shadcn build"` in `apps/web/package.json` scripts; output lands in `apps/web/public/r/`.
- [ ] Add `apps/web/public/r/` to `.gitignore` (build output, not source) and note in the doc that `registry:build` runs before `vite build` for a deployed appliance.
- [ ] `apps/web/README.md` (create if absent) — a "UI registry" section: what the `@routiq` namespace is, the one-line install form `pnpm dlx shadcn@latest add <origin>/r/<item>.json`, and the rule that any new file under `src/components/` must be added to `registry.json` in the same change.
- [ ] `apps/web/src/registry.test.ts` — parse `registry.json`, assert every `files[].path` exists on disk and every `registryDependencies` entry names an item in the same file. This is the guard that keeps later tickets honest.

## Acceptance

- [ ] `pnpm --filter @routiq/web registry:build` succeeds and writes one JSON per item under `apps/web/public/r/`
- [ ] `registry.test.ts` fails if a registered path is deleted or a dependency name is wrong (verify by temporarily breaking one entry)
- [ ] No `@radix-ui` package appears anywhere in `apps/web/package.json` or the lockfile
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Publishing the registry anywhere, versioning items, a second app or a `packages/ui` extraction, and any change to component source. Do not vendor new primitives here — that is ticket 04.

## Comments

- 2026-07-26 [codex] worker: implemented; committed as 383772f. 20 items registered, registry:build emits 21 JSON files, 103-assertion guard test verified to catch missing files/bad deps.
