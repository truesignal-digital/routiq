# 07 — PageContainer and card/surface unification

Status: ready-for-human
Phase: 1
Blocked by: 01

**What to build:** A `PageContainer` with a three-value `width` prop that ends the hand-repeated container classes, plus adoption of the already-vendored (and currently unused) `Card` and `Separator` everywhere a card surface is hand-rolled.

## Context

Audit §4.9 — container widths are copy-pasted per screen: `max-w-xl` (`AssetRegisterScreen`), `max-w-3xl` (`AssetDocumentsScreen`, `FinancePeriodsScreen`, `FinanceEntryDetailScreen`, `FinanceRecordScreen`, `MoreStub`), `max-w-4xl` (`FinanceEntriesScreen`, `FinanceApprovalsScreen`), `max-w-6xl` (`AssetsStub`). `FinanceApprovalsScreen` even disagrees with itself — `max-w-3xl` on the permission-denied branch (`:216`) versus `max-w-4xl` on the main branch (`:228`). Audit §3 notes there is no page-container component at all, though `src/components/page.tsx` (`PageHeader`, `EmptyState`, `ErrorState`, `LoadingState`) is adopted by 8 of 10 screens.

Audit §1 — **`card.tsx` and `separator.tsx` have zero consumers.** Every card surface is hand-rolled instead: `rounded-xl border border-border bg-card p-4` in finance (e.g. `FinanceEntryDetailScreen.tsx:126`, `AssetDocumentsScreen.tsx:134`) versus `rounded-2xl border border-foreground/10 bg-card shadow-[0_12px_34px_-30px_var(--foreground)]` in `AssetsStub.tsx:292`. Border colour drifts too: `border-border` mostly, `border-foreground/10` in `AssetsStub`/`AssetActions`.

Audit §4.10 — import style drifts: `components/ui/*` use the `@/` alias, screens mix alias and relative ESM (`../lib/utils.js`); compare `AppShell.tsx:3` with `AssetsStub.tsx:27`.

**Sanctioned widths for this ticket:** `narrow` = `max-w-xl` (single-column forms), `default` = `max-w-3xl` (detail and short list screens), `wide` = `max-w-6xl` (dense tables and the asset grid). The two finance list screens move from `max-w-4xl` to `wide`; `max-w-4xl` disappears from the codebase. `FinanceApprovalsScreen` uses one container for both its branches.

## Tasks

- [ ] `src/components/page-container.tsx` — `PageContainer({ width = "default", className, children })` rendering the container, horizontal padding and vertical rhythm currently duplicated per screen. Keep it a layout element only; it must not own headers or data states.
- [ ] Adopt it in all ten screens, deleting the per-screen container classes. Widths: `AssetRegisterScreen` narrow; `AssetDocumentsScreen`, `FinancePeriodsScreen`, `FinanceEntryDetailScreen`, `FinanceRecordScreen`, `MoreStub` default; `FinanceEntriesScreen`, `FinanceApprovalsScreen`, `AssetsStub` wide. `LoginScreen` renders outside `AppShell` with its own `max-w-sm` `<main>` — leave it alone.
- [ ] Replace hand-rolled card markup with the vendored `Card` (and `CardHeader`/`CardContent`/`CardTitle` where the content has a heading): `FinanceEntryDetailScreen.tsx:126`, `AssetDocumentsScreen.tsx:134`, `AssetsStub.tsx:292` (`AssetCard`, line 283). Use `Separator` where a rule is currently a bare bordered div.
- [ ] Unify surfaces: one border token (`border-border`) — drop `border-foreground/10` in `AssetsStub`/`AssetActions`; keep the `AssetsStub` card entrance animation (`.asset-card`) and drop the bespoke arbitrary shadow in favour of the `Card` default.
- [ ] In every file this ticket touches, normalise imports to the `@/` alias (audit §4.10). Do not sweep files the ticket does not otherwise change.
- [ ] Register `page-container` in `apps/web/registry.json`; add `card` and `separator` to the `page`/`page-container` item's `registryDependencies` where they now apply.
- [ ] `src/components/page-container.test.tsx` — each `width` value emits its sanctioned max-width class and children render inside it.

## Acceptance

- [ ] `grep -rn "max-w-4xl" apps/web/src` returns nothing; `max-w-xl|3xl|6xl` appear only inside `page-container.tsx`
- [ ] `card.tsx` and `separator.tsx` have real consumers
- [ ] Existing screen tests green with no behavioral change (this is layout only)
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

The `AssetsStub` full-bleed hero and its decorative styling (`shadow-[…]`, `tracking-[0.19em]`, `text-[0.68rem]`, `.empty-grid`) beyond the border/card change — the hero survives this ticket. The DataTable mobile card markup (`data-table.tsx:119`) belongs to ticket 10. Hardcoded palette colors (ticket 14). Any change to `PageHeader`/`EmptyState`/`ErrorState`/`LoadingState` behavior.

## Comments

- 2026-07-26 [codex] worker: committed (ui-registry 07). narrow/default/wide only in page-container.tsx; Card/Separator finally consumed; Approvals single container; 428 tests green.
