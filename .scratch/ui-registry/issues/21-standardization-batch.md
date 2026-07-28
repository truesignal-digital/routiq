# 21 — Standardization batch: FinanceNav on Tabs, record toggle, select labels

Status: ready-for-human
Phase: 4
Blocked by: 20

**What to fix:** Three UI drifts spotted in Linus's screenshot review (2026-07-27) — all cases of one-off implementations where a registry primitive exists.

## Context

1. **FinanceNav active state is wrong on every page**: on /finance/record the "Approbations" item renders active; same on /finance/periods. The sidebar fixed this class of bug with exact-segment matching (src/shell/sections.ts `isSectionActive`, ticket 18) — FinanceNav (src/finance/FinanceNav.tsx) still uses its own matching. Supersedes the ticket-14 line item for this bug.
2. **FinanceNav is a hand-built link row**, not the vendored stock Tabs (src/components/ui/tabs.tsx). The standard (user requirement from session start) is stock shadcn Tabs — pill-highlighted active tab.
3. **FinanceRecordScreen's Dépense/Recette toggle** is a custom black segmented control — replace with stock Tabs (two triggers), keeping RHF direction field semantics (category reset on flip must keep working + its test).
4. **Select closed-trigger shows raw codes**: record screen shows "CASH" instead of « Espèces »; the entries filter trigger shows labels correctly. Fix at the component level in src/components/ui/select.tsx so SelectValue renders the selected item's label (Base UI Select `items` prop or equivalent), then verify the record screen's three selects (branch, category, payment method) display localized labels when closed. All existing call sites must keep compiling.

Native date input (browser-locale formatting) is accepted as-is — native is the right mobile/offline choice; the operators' devices are fr locale.

## Tasks

- [ ] FinanceNav: rebuild on vendored Tabs (navigation pattern — TabsList styled as stock, each trigger a router Link or Tabs value + navigate on change); active = exact-or-child segment match (reuse/mirror `isSectionActive` logic; /finance/entries/$id keeps Écritures active). Test: each of the four routes activates exactly its own tab; entry detail keeps Écritures active.
- [ ] FinanceRecordScreen: direction toggle → stock Tabs; category-reset-on-flip test stays green unchanged.
- [ ] select.tsx label rendering fix + tests (closed trigger shows label for a selected value; placeholder untouched).
- [ ] Sweep check: grep for any other SelectValue usage showing raw values.
- [ ] i18n: no new English; any new keys in fr+en, ICU.

## Acceptance

- [ ] Screenshots-equivalent states verified: /finance/record shows Saisie active + « Espèces » in the closed payment trigger; /finance/periods shows Périodes active
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests green

## Out of scope

Date-input relocalization, footer-mode differences (by design), form-control sweep (08), palette sweep (14).

## Added from ticket 20 review

- [ ] Bordered table shell per dashboard-01: wrap DataTable's table in `overflow-hidden rounded-lg border` (the block's container); mobile card mode unaffected.

## Comments

- 2026-07-27 Opus worker: committed (ui-registry 21). Category-reset test selector changed button→tab (stock Tabs sets role=tab — unavoidable, assertions byte-identical). Select fix walks children pre-render to build Base UI items map; explicit items wins. Known cosmetic issue parked for 15: sticky table header may not stick — vendored table-container's overflow-x:auto makes it the scrollport; needs bounded height or container rework.
