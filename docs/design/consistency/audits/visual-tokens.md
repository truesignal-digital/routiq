> [codex] Raw audit, kept for evidence.

# Visual & Display Consistency Audit: apps/web

This is a **static, read-only audit** of 184 production `.ts`/`.tsx` files across all requested directories. Tests and fixtures were excluded. I also inspected shared formatters, styles, translation catalogs, and preset overlays. Counts are source occurrences, not rendered elements; responsive variants and inherited styles are identified separately. Paths are relative to `apps/web/src/`.

## 1. Typography

Size/weight combinations are normalized regardless of class order. "Overall" includes non-heading text such as amounts and branding.

| Pattern | Count | Example file:line |
|---|---:|---|
| `text-2xl font-semibold` | 2 declarations; 17 consumers | `components/page.tsx:24`, `screens/LoginScreen.tsx:73` |
| `text-lg font-semibold` | 2 declarations; 6 overall | `components/command-form.tsx:159`, `vehicle/parts.tsx:406` |
| `text-base font-semibold` | 3 declarations; 4 overall | `vehicle/header/IdentityStrip.tsx:37`, `vehicle/parts.tsx:175` |
| `text-base font-medium` | 5 title definitions | `components/ui/card.tsx:41`, `components/ui/dialog.tsx:128` |
| `text-sm font-semibold` | 6 declarations; 9 overall | `vehicle/parts.tsx:154`, `maintenance/WorkOrderSheet.tsx:403` |
| `text-sm font-medium` | 3 declarations; 38 overall | `screens/MoreStub.tsx:44` |
| `text-xs font-medium` | 5 declarations; 25 overall | `vehicle/tabs/DetailsTab.tsx:284` |
| `text-xs font-semibold` | 1 declaration; 16 overall | `components/record-history-sheet.tsx:260` |

**Inconsistencies**

- Page titles are `text-2xl` (24px) in PageHeader, but vehicle title is responsive `md:text-lg` (16px mobile/18px desktop) in IdentityStrip.
- Card titles use two systems: `font-heading text-base font-medium` in CardTitle (serif), versus inherited body font with `text-sm font-semibold` in vehicle CardHead (sans). Font families differ in `styles.css:7–8`.
- Overlay titles vary between base/medium, base/semibold, and lg/semibold inconsistently.

**Proposed single rule:** Give page, section, card, and overlay titles named shared variants that own font family, size, weight, and line height; make compact vehicle titles an explicit variant.

---

## 2. Spacing/Layout

Class counts are literal, unprefixed occurrences.

| Pattern | Count | Example file:line |
|---|---:|---|
| Shared page padding `px-4 py-6` | 22 uses | `components/page-container.tsx:22` |
| Page width `wide` → `max-w-6xl` | 16 uses | `screens/ActivitiesScreen.tsx:168` |
| Page width default → `max-w-3xl` | 5 uses | `screens/MoreStub.tsx:28` |
| Page width `narrow` → `max-w-xl` | 1 use | `screens/AssetRegisterScreen.tsx:164` |
| `gap-2` | 164 | `activities/ActivityActions.tsx:170` |
| `gap-3` | 68 | `components/ui/popover.tsx:40` |
| `gap-4`, `5`, `6`, `8` | 36 / 6 / 6 / 1 | `activities/ActivityActions.tsx:767`, `maintenance/WorkOrderSheet.tsx:296` |
| `space-y-6` | 7 | `vehicle/tabs/HistoryTab.tsx:62`, `vehicle/tabs/MaintenanceTab.tsx:84` |
| `<Card>` with standard spacing | 14 | `activities/detail/ActivityMoney.tsx:69` |
| Cards removing internal spacing: `gap-0 py-0` | 15 with custom headers | `vehicle/tabs/DetailsTab.tsx:136` |
| Native `<section>` elements | 16 | `vehicle/tabs/TripsTab.tsx:51` |

**Inconsistencies**

- Vehicle tab spacing ranges from 12px (`DetailsTab:84`), 20px (`HistoryTab:62`), to 28px (`MoneyTab:136`, `MaintenanceTab:84`). Activity detail uses 24px (`ActivityDetailScreen:123`).
- Half of Card call sites remove shared spacing and implement custom headers/rows. Finance detail separately constructs bordered card-like sections.
- Activity detail changes container width between states: loading/error use 768px (`max-w-3xl`), loaded state uses 1152px (`max-w-6xl`), misaligning content.

**Proposed single rule:** A shared page/section layout should own width and vertical rhythm across loading, error, and loaded states, with explicit standard-card and compact-record-card variants.

---

## 3. Display Formats

Formatter counts are calls across 184 files; shared implementations in `lib/format.ts` are additional.

| Pattern | Count | Example file:line |
|---|---:|---|
| `formatMoney(...)` | 30 | `finance/entryColumns.tsx:94` |
| Direct domain `formatXAF(...)` | 1 | `screens/AssetRegisterScreen.tsx:378` |
| Direct `Intl.NumberFormat("fr-CM")` | 1 | `components/money-input.tsx:75` |
| Other direct `Intl.NumberFormat` | 4 | `activities/detail/ActivityAssetsPanel.tsx:52` |
| `formatDate(...)` | 35 | `finance/entryColumns.tsx:66` |
| `formatDateTime(...)` | 29 | `activities/detail/ActivityOverview.tsx:28` |
| Direct `Intl.DateTimeFormat(...)` | 10 | `components/date-picker.tsx:67`, `vehicle/header/StatusBlock.tsx:33` |
| Literal em-dash missing value | 32 | `activities/activityColumns.tsx:75`, `maintenance/columns.tsx:121` |
| `t("vehicle.details.notRecorded")` | 10 | `vehicle/panel/TripRecord.tsx:74` |
| `t("history.actor.unknown")` | 12 | `vehicle/panel/NoteRecord.tsx:23` |
| Missing date renders blank | 1 finance column | `finance/entryColumns.tsx:75` |

**Inconsistencies**

- **Money locale variance:** Six of seven MoneyInput consumers omit locale (fixed French grouping + "XAF" suffix). Vehicle Details passes locale and uses localized placement. Node Intl: `150000` → `150 000 FCFA` (French) vs `FCFA 150,000` (English).
- **Money sign variance:** Finance table formats with `signDisplay: "always"` (stored magnitudes); activity detail negates expenses. Same expense appears positive in one view, negative in another.
- **Asset registration:** Calls `formatXAF` without locale, defaults to `fr-CM`. Switching app to English does not switch that preview.
- **Date formats:** Pickers use medium dates forced to `fr-FR`/`en-US`; shared read formatting uses short dates. Seventeen native date/datetime inputs introduce browser-controlled presentation.
- **Missing values:** Start time is `—` in activity list, `t("vehicle.details.notRecorded")` in vehicle panel, `…` in timeline.

**Proposed single rule:** All displays and inputs use one locale-aware formatting API with explicit money semantics, date/date-time styles, and missing-value states.

---

## 4. Status/Badges

| Pattern | Count | Example file:line |
|---|---:|---|
| `<StatusBadge>` no override | 23 | `activities/CompletenessBanner.tsx:40` |
| `<StatusBadge className="rounded-md">` | 13 | `activities/TripState.tsx:16` |
| `<FinanceStatusBadge>` | 3 consumers | `finance/EntrySummary.tsx:61` |
| `<TripState>` | 3 consumers | `vehicle/tabs/TripsTab.tsx:99` |
| Asset lifecycle map | 6 states | `assets/display.ts:10` |
| Member active/inactive | 3 states | `screens/UsersScreen.tsx:34` |
| Work-order map | 6 states | `maintenance/columns.tsx:22` |
| Issue map | 3 states + vehicle variant | `maintenance/columns.tsx:32`, `vehicle/panel/IssueRecord.tsx:33` |
| Financial-entry maps | 4 definitions | `finance/FinanceStatusBadge.tsx:10`, `activities/detail/ActivityMoney.tsx:12` |
| Document-state map | 5 branches | `vehicle/tabs/DocumentsTab.tsx:26` |

**Inconsistencies (same status, different colours)**

1. **SUBMITTED financial entry:** blue/info in `finance/FinanceStatusBadge.tsx:10`, amber/warning in `activities/detail/ActivityMoney.tsx:12`, maintenance, and vehicle.
2. **POSTED financial entry:** green/success in Finance, neutral in `vehicle/panel/shared.tsx:162`.
3. **RESOLVED issue:** success in maintenance table, neutral in `vehicle/panel/IssueRecord.tsx:48`.
4. **Clean CLOSED activity:** neutral in `activities/activityColumns.tsx:50`, success in `activities/TripState.tsx:29`.
5. Status geometry varies: default rounded badges, `rounded-md`, and finance-only uppercase.

**Proposed single rule:** Each domain owns one status presentation function returning label, tone, icon, and badge variant; every screen consumes it.

---

## 5. Icons

Counts are **import occurrences**, not rendered instances.

| Pattern | Count | Example file:line |
|---|---:|---|
| Add: `Plus` | 7 | `screens/BranchesScreen.tsx:3` |
| Add: `FilePlus2` | 2 | `screens/ActivitiesScreen.tsx:4` |
| Add person: `UserPlus` | 3 | `screens/UsersScreen.tsx:3` |
| Create work order: `ClipboardPlus` | 1 | `vehicle/actions.ts:14` |
| Edit: `Pencil` | 4 | `vehicle/tabs/DetailsTab.tsx:7` |
| History: `History` | 1 | `components/record-history-sheet.tsx:6` |
| History/time: `Clock` | 4 | `vehicle/tabs/HistoryTab.tsx:3` |
| Notes: `StickyNote` | 2 | `vehicle/actions.ts:24` |
| Expense: `Receipt` | 3 | `vehicle/actions.ts:83` |
| Add cost: `ReceiptText` | 1 | `vehicle/steps.ts:7` |
| Revenue: `CircleDollarSign` | 3 | `vehicle/actions.ts:12` |
| Vehicle: `Truck` | 7 | `vehicle/header/IdentityStrip.tsx:2` |
| Activity: `Route` | 8 | `activities/TripState.tsx:2` |

**Inconsistencies**

- History uses `History` generically but `Clock` in vehicle history.
- Expense recording uses `Receipt`; adding work-order cost uses `ReceiptText` (closely related, two glyphs).
- Add actions alternate generic (`Plus`) and object-specific (`FilePlus2`, `UserPlus`, `ClipboardPlus`) with no documented convention.

**Proposed single rule:** Maintain a semantic icon registry with a documented convention for generic "add" versus "add this object type."

---

## 6. i18n Leaks

| Pattern | Count | Example file:line |
|---|---:|---|
| Hard-coded English `Close` | 1 accessible label | `components/ui/sheet.tsx:73` |
| Hard-coded `Toggle Sidebar` | 3 | `components/ui/sidebar.tsx:277`, `:289`, `:292` |
| Hard-coded currency marker `XAF` | 1 | `components/money-input.tsx:89` |
| Raw event-code fallback | 3 | `maintenance/WorkOrderSheet.tsx:89` |
| Raw origin fallback | 1 | `components/record-history-sheet.tsx:357` |
| Raw field-key fallback | 3 | `components/record-history-sheet.tsx:379` |
| Raw category-code fallback | 1 | `vehicle/panel/IssueRecord.tsx:29` |
| History values without enum translation | 2 paths | `components/record-history-sheet.tsx:511` |
| Translated action + filename concatenation | 1 | `components/ui/file-upload.tsx:230` |
| Translated range-label concatenation | 1 | `components/date-range-picker.tsx:72` |
| Passenger terminology mismatch | 1 preset | `i18n/presets/passenger-transport.fr.json:4` vs `:158` |
| Mixed base asset terminology | 1 adjacent pair | `i18n/locales/fr.json:178–179` |

**Inconsistencies**

- French screen-reader users hear English from sheet close button and sidebar toggle controls.
- File removal constructs its accessible sentence outside translation, preventing language-specific word order.
- History formatters pass non-date values unchanged; enum changes have no translation step. Unknown event/field names deliberately fall back to technical codes.
- Passenger preset: navigation says **Voyages**, vehicle tabs/history say **Trajets** (`passenger-transport.fr.json:4` vs `:158`).
- Base vocabulary mixes "Vos actifs" with "chaque véhicule"; activity labels coexist with "Trajet" panel labels.
- (Note: Camion/Véhicule changes between presets are intentional per `preset-overlay.ts:26`.)

**Proposed single rule:** All interface and accessibility text—including enum values and interpolated labels—comes from translation keys, with one complete vocabulary per preset and localized fallbacks.

---

## 7. Raw Tailwind & Arbitrary Values

Bracket syntax does not imply a token violation. This inventory distinguishes literals from semantic-token expressions.

| Pattern | Count | Example file:line |
|---|---:|---|
| Raw chromatic palette (e.g., `bg-red-500`) | 0 found | All production files |
| Raw black overlay `bg-black/10` | 4 | `components/ui/sheet.tsx:29`, `ui/dialog.tsx:33` |
| Small text literals: `text-[0.7rem]`, `[0.8rem]`, `[11px]` | 2 / 1 / 1 | `components/record-history-sheet.tsx:377` |
| Icon size literals: `h-[18px]`, `size-[18px]` | 2 | `vehicle/VehicleTabsNav.tsx:110` |
| Mobile overlay heights: `max-h-[85vh]`, `[88vh]`, `[92vh]` | 1 / 1 / 2 | `components/record-history-sheet.tsx:221` |
| Border radius literals: `rounded-[2/3/4/5px]` | 6 / 1 / 2 / 2 | `components/ui/chart.tsx:223` |
| Semantic colours with arbitrary opacity | 11 | `components/status-badge.tsx:19` |
| Literal sheet transitions: `±2.5rem` | 8 | `components/ui/sheet.tsx:54` |
| Drawer cubic-bezier easing | 4 | `components/ui/drawer.tsx:73` |
| Drawer duration `400ms` | 4 | `components/ui/drawer.tsx:73` |

**Inconsistencies**

- Mobile overlay ceilings differ: history 85vh, all actions 88vh, record/form panels 92vh.
- Small text uses three literal sizes outside the typography scale.
- Corners mix radius tokens with literal 2/3/4/5px values.
- Neutral surfaces use several close opacity values: 0.03, 0.035, 0.04, 0.05, 0.055, 0.06.
- Overlay black is hard-coded in four primitives (`sheet.tsx:29`, `dialog.tsx:33`, `drawer.tsx:73`, `alert-dialog.tsx:31`). Lacks a shared scrim token.
- `styles.css:150–160` and `:206–216` contain literal decorative gradient colours outside theme variables.

**Proposed single rule:** Shared visual measurements and surface treatments use named tokens; allow arbitrary expressions for content geometry, safe areas, and library mechanics.

---

## 8. Touch Targets

Heights assume the standard 4px Tailwind spacing unit. Counts identify source patterns; inherited overrides can change actual dimensions.

| Pattern | Count | Example file:line |
|---|---:|---|
| Button size definitions | All 8 sizes: 24–36px | `components/ui/button.tsx:23–32` |
| `<Button size="sm">` | 11 | `screens/FinanceEntriesScreen.tsx:196` |
| `<Button size="icon">` | 8 | `components/data-table.tsx:924` |
| `<Button size="icon-sm">` | 9 | `vehicle/tabs/MoneyTab.tsx:143` |
| Buttons without explicit size | 87 | `activities/ActivityActions.tsx:172` |
| `h-8` on controls | 4 | `components/date-range-picker.tsx:73`, `vehicle/parts.tsx:234` |
| `h-9` on controls | 13 | `components/data-table.tsx:1137` |
| `h-10` on controls | 5 | `vehicle/header/StatusBlock.tsx:201` |
| `min-h-8` | 1 | `components/record-history-sheet.tsx:385` |
| `min-h-9` | 13 | `activities/ActivityActions.tsx:172` |
| Shared Input default | 32px (`h-8`) | `components/ui/input.tsx:12` |
| Shared Select defaults | 28px & 32px | `components/ui/select.tsx:91` |
| Shared TabsList default | 32px | `components/ui/tabs.tsx:25` |

**Confirmed mobile-facing defects**

- Vehicle month navigation: 28×28px icon buttons in `vehicle/tabs/MoneyTab.tsx:143`.
- Mobile table row-action menus: 28px icon buttons (`components/data-table.tsx:660`, `:980`).
- Vehicle filter chips: 32px high in `vehicle/parts.tsx:234`.
- Date-range picker triggers: 32px (single-date picker explicitly `min-h-11`).
- Vehicle status/panel actions: 40px on mobile (`StatusBlock.tsx:201`, `panel/shared.tsx:122`).
- Activity actions & remove-row controls: 36px (`ActivityActions.tsx:172`, `sheet/EntryRows.tsx:109`).
- Dialog/sheet close buttons: default 28px.

(Branch switcher's `h-11 md:h-9` is mobile-compliant; IdentityStrip's 36px actions are `hidden md:flex`.)

**Proposed single rule:** Interactive primitives guarantee a minimum **44×44px hit area** by default; visual compactness belongs inside that area, with any desktop-only exception explicit.

---

## Summary

**Blocked on me:** Nothing.

**Changed:** Nothing. Read-only audit only.

**Found:** Four conflicting same-domain status mappings; inconsistent money locales and signs; fragmented title/card styles; incomplete preset terminology; English accessibility labels; and multiple shared/mobile controls below 44px. Counts were scripted, key findings checked against source, locale difference reproduced with Node Intl.