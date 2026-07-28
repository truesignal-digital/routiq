# 05 — One formatting module (money, dates, labels)

Status: ready-for-human
Phase: 1
Blocked by: —

**What to build:** `apps/web/src/lib/format.ts` as the single place money, dates and `labelFr`/`labelEn` pairs turn into display strings, wired to the active i18next language — then delete every duplicate implementation the audit found.

## Context

Audit §4.1: **four money implementations with divergent output.** `FinanceEntriesScreen.tsx:198` local `formatAmount(minor, signDisplay)` renders `+150 000`; `FinanceApprovalsScreen.tsx:276` renders `150 000` for the same entry; `FinanceEntryDetailScreen.tsx:55` is an inline closure with `signDisplay: "always"`; `finance/model.ts:15` `formatMoneyXaf` normalises U+202F and is used only for amount-input blur (`FinanceRecordScreen.tsx:385`); `packages/domain/src/money.ts:14` `formatXAF` is the canonical one and has exactly one consumer (`AssetRegisterScreen.tsx:33`). All four hardcode `"fr-CM"` and ignore the language switch, and screens append the currency by hand (`{formatAmount(...)} {row.original.currency}`).

Audit §4.2: **three date renderings, none locale-aware.** Raw ISO straight from the API at `FinanceEntriesScreen.tsx:56-58`, `FinanceEntryDetailScreen.tsx:162`, `AssetDocumentsScreen.tsx:202-204`, and raw ISO inside an ICU message at `AssetDocumentsScreen.tsx:162-165`; `new Date(x).toLocaleDateString()` with no locale argument (follows the browser, not i18next) at `FinanceApprovalsScreen.tsx:76`, `FinancePeriodsScreen.tsx:224`, `FinanceEntryDetailScreen.tsx:170`. There is no date helper in `src/lib/`.

Audit §7: the `labelFr`/`labelEn` ternary is duplicated in eight places — `AssetsStub.tsx:285-288`, `FinanceEntriesScreen.tsx:63-66`, `FinanceApprovalsScreen.tsx:82-85`, `FinanceRecordScreen.tsx:184-185`, `AssetDocumentsScreen.tsx:64-65` and `:256-257`, `FinanceEntryDetailScreen.tsx:50-51`, `AssetRegisterScreen.tsx:113-114`.

Money invariant (CLAUDE.md, ARCHITECTURE.md §3.4): **XAF has exponent 0 — 1 XAF = 1 minor unit, never divide by 100.**

## Tasks

- [ ] Extend `packages/domain/src/money.ts` `formatXAF` to take an options bag `{ locale?, signDisplay? }` while keeping the existing `(minor, locale)` call shape working. The exponent-0 rule stays in the domain package; the web layer never re-derives it.
- [ ] `src/lib/format.ts` exporting:
  - `formatMoney(minor, { currency, signDisplay?, locale? })` — delegates to the domain formatter for XAF, falls back to `Intl.NumberFormat` currency style for other codes; includes the currency in the output so no call site appends it; normalises U+202F narrow no-break space to a regular space (the behavior `finance/model.ts:17-22` relies on for amount-input round-trip); defaults `locale` to `i18n.resolvedLanguage`.
  - `formatDate(iso, locale?)` and `formatDateTime(iso, locale?)` — `Intl.DateTimeFormat`, locale defaulting to `i18n.resolvedLanguage`, tolerant of `null`/`undefined` (returns `""` so callers stop guarding).
  - `localizedLabel({ labelFr, labelEn }, language?)` — resolves against the active language, falls back to `labelFr` when the other side is empty.
- [ ] Replace all of audit §4.1: delete the local `formatAmount` in `FinanceEntriesScreen`, `FinanceApprovalsScreen` and the closure in `FinanceEntryDetailScreen`; point `AssetRegisterScreen.tsx:33` at `formatMoney`; keep `parseMoneyXaf` in `finance/model.ts` but move/retire `formatMoneyXaf` so `FinanceRecordScreen.tsx:385` blur formatting goes through `formatMoney` with `signDisplay: "never"`.
- [ ] Replace all of audit §4.2 with `formatDate`/`formatDateTime`, including the ICU-embedded date at `AssetDocumentsScreen.tsx:162-165` (format first, interpolate the formatted string — never concatenate sentences).
- [ ] Replace all eight `labelFr`/`labelEn` ternaries from audit §7 with `localizedLabel`.
- [ ] `src/lib/format.test.ts`: XAF stays exponent 0 (`150000` → `150 000 FCFA`-shaped, never `1 500,00`); `signDisplay` `always` / `exceptZero` / `never`; fr-CM vs en grouping and separators differ; U+202F normalised; date output changes with `resolvedLanguage`; `localizedLabel` falls back when `labelEn` is empty. Add a `packages/domain` test for the new options bag.

## Acceptance

- [ ] `grep -rn "formatAmount\|toLocaleDateString\|labelEn :" apps/web/src/screens` returns nothing
- [ ] Switching language re-renders money and dates in the new locale (assert in a test, not by eye)
- [ ] `pnpm --filter @routiq/web test && pnpm --filter @routiq/domain test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

Number-input parsing changes (`parseMoneyXaf` keeps its current semantics, including admitting 0 — the server rejects with a stable code), relative-time formatting, timezone handling beyond what `Intl` does by default, and any layout or component change to the screens touched.

## Comments

- 2026-07-26 [codex] worker: implemented in two passes (first run stopped at 70%); committed as 5c915c2. 351 web + 11 domain tests green. Review fixes: one missed labelEn ternary in AssetCard (AssetsStub) replaced with localizedLabel during review.
- Known limitation: formatMoney's non-XAF fallback formats minor units as major (no exponent table). Only XAF exists today; if a second currency ever lands, add exponent handling in @routiq/domain first.
