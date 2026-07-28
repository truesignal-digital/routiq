# 03 — Semantic tokens (success / warning / info, --signal, --font-heading)

Status: ready-for-human
Phase: 0
Blocked by: —

**What to build:** The token layer that tickets 06, 07 and 14 depend on. Add `success` / `warning` / `info` (each with a `-foreground`) to the light theme and to `@theme inline`, promote the half-finished `--signal` to a mapped token, and give `--font-heading` a real value. Dark mode stays deferred.

## Context

Audit §6. `apps/web/src/styles.css` is CSS-first Tailwind 4 config (no `tailwind.config.js`): `@theme inline` at lines 6-47 maps the shadcn token set, `:root` at 49-84 is the light theme (warm paper background, green primary, oklch), `.dark` at 86-118 is stock neutral shadcn.

Problems this ticket fixes:

1. `--signal` / `--signal-foreground` (`styles.css:82-83`) exist in `:root` but are absent from `@theme inline`, so they can only be used as arbitrary values — `bg-[var(--signal)]` at `AssetsStub.tsx:59,171,233`.
2. `--font-heading: var(--font-sans)` (`styles.css:7`) is a no-op, yet three vendored base-nova components use the `font-heading` utility: `card.tsx:41`, `alert-dialog.tsx:120`, `dialog.tsx:123`. Headings currently render identically to body text.
3. Only `destructive` exists as a semantic tone. Eight files hardcode palette classes (audit §6.4) because there is nothing to point at.

Spec decision 2: **dark mode is deferred.** Do not complete `.dark`, do not add a toggle, `sonner.tsx:5` stays `theme="light"`.

## Tasks

- [ ] Add to `:root`: `--success`, `--success-foreground`, `--warning`, `--warning-foreground`, `--info`, `--info-foreground`. Use oklch values that sit in the existing warm-paper/green-primary palette (background `oklch(0.976 0.008 86)`, primary `oklch(0.31 0.067 161)`, destructive `oklch(0.577 0.245 27.325)`). Foregrounds must clear 4.5:1 against their own surface at the tints components will use.
- [ ] Map all six in `@theme inline` as `--color-success`, `--color-success-foreground`, … so `bg-success`, `text-warning-foreground`, `border-info/20` all work.
- [ ] Map `--color-signal` / `--color-signal-foreground` in `@theme inline`, then replace the three `bg-[var(--signal)]` usages in `AssetsStub.tsx:59,171,233` with `bg-signal`.
- [ ] Give `--font-heading` a distinct system stack (no webfont — offline, low-end Android is the target). Something visually separable from the rounded body stack, e.g. a `system-ui`-led display stack, so `font-heading` on card/dialog titles is a real typographic step.
- [ ] Leave `.dark` untouched except for a comment above it recording that it is unfinished, unused (nothing sets the `.dark` class) and deliberately deferred, so nobody wires it up by accident.
- [ ] `apps/web/src/styles.test.ts` — read `styles.css` as text and assert that for each of `success`, `warning`, `info`, `signal` both a `:root` declaration and a `@theme inline` `--color-*` mapping exist, and that `--font-heading` is not `var(--font-sans)`.

## Acceptance

- [ ] `grep -r "bg-\[var(--signal)\]" apps/web/src` returns nothing
- [ ] `styles.test.ts` green and fails if a mapping is removed
- [ ] `.dark` block byte-identical apart from the added comment; no theme toggle anywhere; `sonner.tsx` still `theme="light"`
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Migrating the eight files that hardcode palette colors (audit §6.4) — that is ticket 14, and ticket 06 for badges/banners. Completing dark mode, adding a toggle, or restyling `.dark`. Touching the body background gradients or the `.asset-card` / `.empty-grid` decorative rules.

## Comments

- 2026-07-26 [codex] worker: implemented; committed as 22e86fa. 271 web tests + typecheck green at time of implementation.
- Review note: `AssetsStub.tsx:171` is `shadow-[12px_12px_0_var(--signal)]` (arbitrary shadow, not a bg utility) — correctly left; `:233` still uses `text-[var(--signal-foreground)]`, can become `text-signal-foreground` in ticket 14's palette sweep.
