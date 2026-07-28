# 04 — Vendor stock base-nova primitives

Status: ready-for-human
Phase: 1
Blocked by: 01

**What to build:** Vendor seven stock shadcn primitives via the CLI — `tabs`, `checkbox`, `dropdown-menu`, `popover`, `alert`, `tooltip`, `sheet` — register them, and localize the two hardcoded English strings in the already-vendored `dialog.tsx` while in the neighbourhood. Nothing consumes these yet; tickets 06, 08, 10 and 15 do.

## Context

Audit §1: `src/components/ui/` holds fifteen components, all Base UI-backed or plain DOM. The seven above are missing and are prerequisites for later tickets — `alert` for ErrorBanner (06), `checkbox` + `dropdown-menu` for DataTable v2 row selection and column visibility (10), `popover`/`tooltip`/`sheet`/`tabs` for the sweep and dashboard (14, 15).

`apps/web/components.json` is configured `"style": "base-nova"`, so the CLI resolves Base UI-backed versions. **Any `@radix-ui` package entering the lockfile is a bug** (spec non-negotiable). Spec north star: stock shadcn look and behavior — the pill-highlight active tab is the stock Tabs, do not restyle it.

Audit §7 i18n leak in `dialog.tsx`: the `sr-only` "Close" on the close button and the literal `Close` inside `DialogFooter` are never localized, in an app whose default language is fr-CM. There is no `common` namespace in `src/i18n/locales/{fr,en}.json` yet.

## Tasks

- [ ] `pnpm --filter @routiq/web exec shadcn@latest add tabs checkbox dropdown-menu popover alert tooltip sheet`. Accept stock output; do not restyle.
- [ ] Verify every new file imports from `@base-ui/react/*` (or is plain DOM) and that no `@radix-ui` dependency appeared in `apps/web/package.json` or the lockfile.
- [ ] Add each new component to `apps/web/registry.json` as `registry:ui` with correct `files` and `registryDependencies`; `registry.test.ts` (ticket 01) must stay green.
- [ ] Add a `common` namespace to `src/i18n/locales/fr.json` and `en.json` with `common.close` (fr-CM first: « Fermer »). Key parity is enforced by `src/i18n/locales.test.ts`.
- [ ] Localize `dialog.tsx`: the `sr-only` close label and the `DialogFooter` close action both read `t("common.close")` via `useTranslation()`. Keep the component's props/API unchanged.
- [ ] `src/components/ui/primitives.test.tsx` — mount each of the seven primitives once in jsdom with minimal props and assert it renders (a cheap regression net for future re-vendoring). Trigger-driven components (`dropdown-menu`, `popover`, `tooltip`, `sheet`) only need the closed/trigger state.

## Acceptance

- [ ] `grep -rn "@radix-ui" apps/web pnpm-lock.yaml` returns nothing
- [ ] Seven new files under `src/components/ui/`, all present in `registry.json`
- [ ] Rendering a `Dialog` in fr-CM shows « Fermer », not "Close"; `locales.test.ts` parity green
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Using these primitives in any screen (tickets 06, 08, 10, 14, 15), restyling stock output, vendoring `sidebar` or `chart` (ticket 15), and any other `dialog.tsx` change beyond the two strings.

## Comments

- 2026-07-26 [codex] worker: implemented; committed as 3f7c349. 7 primitives vendored (alert is plain DOM+CVA — stock has no headless dep), dialog Close localized via common.close, registry now 27 items incl. corrected form metadata (label registryDep, @base-ui/react dep). Zero @radix-ui.
