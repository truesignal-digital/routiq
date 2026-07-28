# 02 — Re-vendor form.tsx from base-nova

Status: ready-for-human
Phase: 0
Blocked by: —

**What to build:** Replace the hand-written `src/components/ui/form.tsx` with the stock base-nova form, so `FormField` actually passes react-hook-form's `field` to its input and `FormControl` restores the `aria-invalid` / `aria-describedby` wiring. Migrate the two consumer screens onto the stock API and replace the placeholder test with real assertions.

## Context

Audit §1 "form.tsx divergence": the current file is the legacy shadcn v0-era form (forwardRef, `space-y-2`) modified in contract-breaking ways.

- `form.tsx:32-35` — `<Controller {...props} render={() => <div ref={ref}>{children}</div>}>` discards the controller's `field` (`value`, `onChange`, `ref`). Every consumer therefore wires inputs by hand.
- `form.tsx:106-120` — `FormControl` destructures `formItemId`, `formDescriptionId`, `formMessageId` and uses none of them; it renders a bare `<div data-testid="form-control">`. Inputs get no `aria-invalid`, no `aria-describedby`. Accessibility regression vs stock shadcn.
- `form.test.ts:8-39` asserts nothing real — it renders a hand-built `<p>` and checks that `<p>` exists.

Consumers (audit §3): `src/screens/FinanceRecordScreen.tsx` mixes `form.watch()` + `form.setValue()` (`:174-179`, `:268-269`, `:306`, `:341`, `:376-385`) with `FormField`/`FormControl` wrappers; `src/screens/AssetRegisterScreen.tsx` uses `form.register()` inside `FormControl` (`:128-136`, `:139-179`, `:182-189`).

## Tasks

- [ ] Vendor the stock component: `pnpm --filter @routiq/web exec shadcn@latest add form --overwrite`. It resolves base-nova via `apps/web/components.json`. Take what the CLI produces — do not hand-edit the primitive's behavior.
- [ ] Verify no `@radix-ui` package was added (`apps/web/package.json`, lockfile diff). Any `@radix-ui` import is a bug.
- [ ] Confirm the vendored file gives: `FormField` rendering `<Controller render={({ field }) => ...}>` with `field` reaching children, `FormControl` setting `id={formItemId}`, `aria-invalid` on error and `aria-describedby={formDescriptionId formMessageId}`, `FormLabel htmlFor={formItemId}`, `FormMessage id={formMessageId}`.
- [ ] Migrate `FinanceRecordScreen.tsx` to the stock `render={({ field }) => ...}` API. Behavior must not change: single-branch preselect (`:196`), category reset when direction flips (`:268-269`), amount reformat on blur via `formatMoneyXaf` (`:376-385`), submit payload identical.
- [ ] Migrate `AssetRegisterScreen.tsx` off `form.register()` inside `FormControl` onto the same API.
- [ ] Replace `src/components/ui/form.test.ts` with `form.test.tsx` (it renders JSX): a small RHF form with a zod resolver asserting (a) typing into a `FormField`-wrapped `Input` updates form state, (b) a failed submit puts `aria-invalid="true"` on the input and `aria-describedby` referencing the rendered `FormMessage` id, (c) `FormMessage` renders the resolver's message and nothing when valid.
- [ ] If `registry.json` (ticket 01) has landed, keep the `form` item's file list accurate.

## Acceptance

- [ ] `FinanceRecordScreen.test.tsx`, `AssetRegisterScreen`-related tests and the new `form.test.tsx` all green with no behavioral change to the two screens
- [ ] No remaining `form.setValue` / `form.register` calls used purely to compensate for the broken `FormField` (targeted `setValue` for cross-field logic like the category reset is fine)
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Migrating other screens onto `Form` (LoginScreen is ticket 14; dialog field wrappers are ticket 08), replacing raw `<select>` / `<textarea>` controls (ticket 08), and re-vendoring any other primitive (ticket 04).

## Comments

- 2026-07-26 Opus worker: implemented; committed as 1e069d0. Deviation: base-nova publishes no `form` item (stub JSON, no files — its successor is `field`), so the stock new-york-v4 form was ported with two Base UI substitutions: vendored Label, and useRender+mergeProps replacing Radix Slot (child props win, same precedence). FormField gained a third generic (TTransformedValues) for AssetRegisterScreen's transformed-values form. mode:"onChange" added to FinanceRecordScreen to preserve the errors-while-typing behavior the removed shouldValidate:true calls provided. Permanent tests added: category-reset-on-direction-flip, single-branch preselect, number coercion / decimal keystroke / optional omission on AssetRegister. registry.json follow-up (form item: +label registryDep, +@base-ui/react dep) folded into ticket 04's commit.
