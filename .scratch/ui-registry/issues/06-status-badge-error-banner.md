# 06 — StatusBadge and ErrorBanner

Status: ready-for-human
Phase: 1
Blocked by: 03, 04

**What to build:** One `StatusBadge` replacing three badge implementations plus two ad-hoc text flags, and one `ErrorBanner` built on the vendored `Alert` replacing six error-banner variants — with every error code resolved through `errorMessage(i18n, code)`.

## Context

Audit §4.3 — **three status-badge implementations.** `src/finance/FinanceStatusBadge.tsx` is the only proper one (vendored `Badge`, status → variant map). `AssetsStub.tsx:31-38` holds a `statusStyles` map of hardcoded palette classes rendered as a hand-rolled pill at `:315`; `AssetDocumentsScreen.tsx:27-32` holds `expiryBadgeStyles` with different pill markup at `:154`. Two ad-hoc text badges — the late-posting flag at `FinanceEntriesScreen.tsx:47` and the maker-guard note at `FinanceApprovalsScreen.tsx:109` — are both `text-amber-900` at different sizes.

Audit §4.4 — **six error-banner variants.** `div role="alert"` + icon + `rounded-md bg-destructive/10 p-3 text-sm` at `FinanceApprovalsScreen.tsx:329`, `FinancePeriodsScreen.tsx:294` and `:331`, `FinanceEntryDetailScreen.tsx:340`, `FinanceRecordScreen.tsx:287`; `p role="alert"` + `rounded-lg … px-4 py-3` without icon at `AssetRegisterScreen.tsx:377`, `AssetDocumentsScreen.tsx:361`; bare `p role="alert" text-sm text-destructive` at `LoginScreen.tsx:83`; `rounded-lg … px-3 py-2 text-xs` at `AssetActions.tsx:113`.

Worse, error-code resolution differs. Most call `errorMessage(i18n, code)` (`src/lib/error-message.ts` — safe fallback plus a console warning), but `FinanceApprovalsScreen.tsx:334`, `FinancePeriodsScreen.tsx:300` and `:337` use `` t(`errors.${error}`, { defaultValue: error }) ``, which renders the **raw error code to the user** for any unmapped code. That violates the i18n rule in CLAUDE.md: API errors are stable codes, never English strings.

Semantic tokens (`success`/`warning`/`info`) come from ticket 03; the `Alert` primitive from ticket 04.

## Tasks

- [ ] `src/components/status-badge.tsx` — a CVA-driven `StatusBadge` over the vendored `Badge` with tones `neutral | success | warning | info | danger`, styled **only** with semantic tokens from ticket 03 (`bg-warning/10 text-warning-foreground`-shaped), never palette classes. Children are the already-localized label; the component never translates.
- [ ] Rewrite `finance/FinanceStatusBadge.tsx` as a thin status → tone map over `StatusBadge` (SUBMITTED → info, POSTED → success, REJECTED → danger, REVERSED → neutral) so finance call sites do not churn.
- [ ] Replace `AssetsStub.tsx:31-38` + `:315` and `AssetDocumentsScreen.tsx:27-32` + `:154` with tone maps over `StatusBadge`; delete `statusStyles` and `expiryBadgeStyles`.
- [ ] Replace the two ad-hoc text flags (`FinanceEntriesScreen.tsx:47`, `FinanceApprovalsScreen.tsx:109`) with `StatusBadge` tone `warning`.
- [ ] `src/components/error-banner.tsx` on the vendored `Alert`: props `{ code }` (stable error code, resolved via `errorMessage(i18n, code)`) or `{ message }` for already-localized text, plus optional `title`. Keeps `role="alert"` and the icon. One size — accept the small visual change at `AssetActions.tsx:113`.
- [ ] Replace all nine sites listed in audit §4.4 with `ErrorBanner`.
- [ ] Delete the `` t(`errors.${…}`) `` bypasses at `FinanceApprovalsScreen.tsx:334`, `FinancePeriodsScreen.tsx:300` and `:337`; every code now goes through `errorMessage`.
- [ ] Register `status-badge` and `error-banner` in `apps/web/registry.json` (ticket 01) with their `registryDependencies` (`badge`, `alert`).
- [ ] Tests: `status-badge.test.tsx` asserting tone → semantic-token class (and that no `amber-`/`emerald-`/`sky-` class is emitted); `error-banner.test.tsx` asserting an unmapped code renders the generic fallback shape from `error-message.ts:9` (`generic (CODE)`) rather than the bare code, and that a mapped code renders its translation.

## Acceptance

- [ ] `grep -rn "t(\`errors\." apps/web/src` returns nothing
- [ ] `grep -rn "role=\"alert\"" apps/web/src/screens apps/web/src/assets` only matches `ErrorBanner` usage (`page.tsx`'s `ErrorState` may keep its own — it is a different component)
- [ ] No hardcoded palette class remains in the badge/banner code paths touched
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

The rest of audit §6.4's hardcoded palette colors (success panels, blue links, file-upload emerald — ticket 14), toast/inline success-feedback unification (ticket 14), permission-denied `EmptyState` unification (ticket 14), and `ErrorState` in `src/components/page.tsx`, which stays as the full-page retry surface.

## Comments

- 2026-07-26 [codex] worker: committed as 52661a7 (second pass — first pass skipped 7 banner sites, completed after review). Sanctioned leftovers: FormDescription field-level alerts in FinanceRecordScreen; AssetActions amber panel → ticket 14.
