# 14 — Screen sweep: feedback, permission-denied, invalidation, LoginScreen, palette

Status: ready-for-human
Phase: 4
Blocked by: 06, 07, 08

**What to build:** The remaining audit items that are pattern unification rather than new components — one success-feedback pattern, one permission-denied pattern, targeted cache invalidation, `LoginScreen` on the `Form` components, and the last hardcoded palette colors moved onto semantic tokens.

## Context

**Success feedback (audit §4.5).** Toasts (`src/lib/notify.ts` → sonner) fire only for approve / reject / lock / reopen / reverse. Other mutating flows report inline or not at all: `FinanceRecordScreen`'s `OutcomeView` (`:552`), `AssetActions` panels (`:92-111`), `AssetRegisterScreen` navigates silently, `AssetDocumentsScreen` closes silently. Warnings are a toast in half the app and a green box list in `FinanceRecordScreen.tsx:585-605`. Note `notify.ts:15-22` hardcodes the `finance.notify.*` key prefix, so asset flows cannot use it as written.

**Permission denied (audit §4.8).** Four shapes: `EmptyState` + `errorMessage(i18n, "MODULE_DISABLED")` at `FinanceRecordScreen.tsx:66`, `FinanceEntriesScreen.tsx:92`, `AssetDocumentsScreen.tsx:71`, versus `EmptyState` + a screen-specific `accessDenied` key at `FinanceApprovalsScreen.tsx:218` and `FinancePeriodsScreen.tsx:125`. Ticket 09 fixed the `me`-timing flash; the copy and shape are still four things.

**Invalidation (audit §5).** Blanket `["ws"]` invalidation at `AssetDocumentsScreen.tsx:106`, `FinanceEntryDetailScreen.tsx:97`, `AssetActions.tsx:56` (nukes every workspace query) versus targeted keys at `AssetRegisterScreen.tsx:107-109`. Two screens hand-roll optimistic removal with a local `Set` of removed ids: `FinanceApprovalsScreen.tsx:52`, `FinancePeriodsScreen.tsx:70`. **`docs/adr/0001-command-lifecycle-rendering-over-optimistic-updates.md` forbids optimistic cache patching** — the fix is mutation callbacks that invalidate the right keys and let server truth re-render, not a better optimistic layer.

**LoginScreen (audit §3).** `useState` + `Label`/`Input`, no `Form`, bare `p role="alert"` error at `:83`.

**Palette (audit §6.4).** Hardcoded colors remain in `AssetsStub.tsx:32-37`, `AssetDocumentsScreen.tsx:28-30` and `:366`, `FinanceRecordScreen.tsx:564-592` (green success panel, amber warnings), `FinanceEntryDetailScreen.tsx:257,271` (blue links), `AssetActions.tsx:93,101`, `components/ui/file-upload.tsx:225` (emerald). Semantic tokens exist from ticket 03; badges and banners were handled in ticket 06.

## Tasks

- [ ] **REVISED (Linus, 2026-07-27): new shadcn toast, not sonner.** Vendor the new shadcn `toast` component via the CLI (base-nova — Base UI-backed, `toast.add({title, description})` API; see https://ui.shadcn.com/docs/components/toast Base UI tab). Position bottom-right; neutral colors only (no green/red washes — the stock look). Rewrite `src/lib/notify.ts` on it with a key-namespace parameter; migrate ALL existing sonner call sites; delete `sonner.tsx`, remove the `sonner` dependency, drop its registry item. Localize any hardcoded English in the vendored toast (dialog/sidebar precedent).
- [ ] **Delete `OutcomeView` entirely** (Linus: no big green panel after completing an action). Success = toast + navigation; warnings (`EVIDENCE_MISSING`/`LATE_POSTING`) ride in the same toast's description as localized lines. Route every mutating flow through notify: asset registration, document upload/close, `AssetActions`, record screen. New keys fr+en, ICU.
- [ ] One permission-denied surface: a small component taking a stable code, rendering `EmptyState` + `errorMessage(i18n, code)`, guarded on `me !== undefined`. Adopt it in all five screens; delete the screen-specific `accessDenied` keys, keeping the distinction between a disabled module and an insufficient role by passing different codes.
- [ ] Replace the three blanket `["ws"]` invalidations with targeted keys following `AssetRegisterScreen.tsx:107-109`.
- [ ] Delete the removed-id `Set`s at `FinanceApprovalsScreen.tsx:52` and `FinancePeriodsScreen.tsx:70`; invalidate the relevant list key in the mutation's success callback instead, per ADR-0001. Do not introduce `setQueryData` patching.
- [ ] `LoginScreen`: RHF + `Form`/`FormItem`/`FormLabel`/`FormMessage`, error via `ErrorBanner` (ticket 06). It stays outside `AppShell` with its own narrow `<main>`; do not give it `PageContainer`.
- [ ] Replace every remaining hardcoded palette class from audit §6.4 with semantic tokens (`success`, `warning`, `info`, `destructive`, `signal`). Links use a token, not `blue-600`.
- [ ] Tests: a mutating flow in each of assets and documents shows a toast; the denied surface renders one shape across screens; a mutation invalidates only its own key (assert the query client's invalidated keys); `LoginScreen` shows a field error and a localized `AUTH_FAILED` banner; a grep-style test or lint check that screens contain no `bg-(emerald|amber|sky|blue|green)-` classes.

## Acceptance

- [ ] `grep -rnE "(bg|text|border)-(emerald|amber|sky|blue|green|stone|red)-[0-9]" apps/web/src` returns nothing
- [ ] `grep -rn "invalidateQueries({ queryKey: \[\"ws\"\] })" apps/web/src` returns nothing
- [ ] Every mutating flow gives the user feedback (enumerate them in the ticket comments when closing)
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Added during ticket 11 review

- [ ] FinanceRecordScreen asset field (":518-531") is still a free-text UUID input — convert to a Select fed by useAssets (same option labeling as the entries filter: code — displayName, drained cursor). Last free-text UUID input in finance.

- [x] FinanceNav active-tab bug — SUPERSEDED by ticket 21 (rebuild on stock Tabs with exact matching).

## Out of scope

Dark mode and the theme toggle (deferred by the spec), new screens or nav entries, the `More` screen's content, the threshold admin UI (finance-web ticket 09), and any change to the command client or the in-flight command store — ADR-0001 stands.

## Comments

- 2026-07-27 Opus worker: committed as 46253a0. Base UI toast (stock bottom-right neutral) via notify.ts namespace chain; OutcomeView + notifyCommandWarnings deleted (one toast carries warnings as description lines); PermissionDenied component across 5 screens w/ MODULE_DISABLED vs ROLE_FORBIDDEN; blanket invalidations + removed-id Sets gone per ADR-0001; LoginScreen on RHF/Form/ErrorBanner; palette.test.ts walks the tree as the anti-drift guard. Review polish: fr common.close guillemets removed. Deviations accepted: two ticket-09 denied-flash test files consolidated into permission-denied.test.tsx (coverage up); notifyCommandError exported-unused as before; 1500ms post-reversal navigate left as-is. 557 tests.
