# ROUTIQ web UI anatomy audit

This was a read-only audit. I edited no files. Paths are relative to `apps/web/src/`.

## 1. Route and tab inventory

Abbreviations: **PH** = `PageHeader`; **L/E/Er** = `LoadingState` / `EmptyState` / `ErrorState` from `components/page.tsx`; **BSL** = `BranchScopeLine`; **VO** = `DataTableViewOptions`.

| Route | Screen | Regions, top to bottom | Overview before details? | Primary action | States | Deviations |
|---|---|---|---|---|---|---|
| `/login` | screens/LoginScreen.tsx | hand-rolled h1 (:73) → form → ErrorBanner | n/a | form submit | ErrorBanner | Outside the shell, so the hand-rolled h1 is acceptable |
| `/` | screens/DashboardScreen.tsx | PH, title only (:48) → Er banner → `SectionCards` KPI grid (:60) → chart → "Recent entries" card with DataTable (:99) | **yes** | none; the KPI cards link out | L/E/Er | KPI cards are their own component, not `MetricStrip` |
| `/assets` | screens/AssetsStub.tsx | PH, title + Link (:174) → subtitle (:188) → `MetricStrip` (:192) → BSL + VO (:199) → DataTable with filters → mobile FAB (:360) | **yes** | PH action on sm+ only (:180); FAB on phone | L/E/Er + BranchScopedEmptyState | The only page with a subtitle, a FAB and a hand-styled Link button |
| `/assets/new` | screens/AssetRegisterScreen.tsx | eyebrow p (:165) → PH (:168) → form → ErrorBanner → inline submit (:474) | n/a | bottom submit | ErrorBanner | `narrow` width; the only page with an eyebrow |
| `/assets/$assetId` (shell) | vehicle/VehicleWorkspaceScreen.tsx | header (:149): IdentityStrip with its own h1 → OtherBranchNotice → StatusBlock (status sentence + one action) → FactsLine (md+ only) → sticky VehicleTabsNav (:155) → tab Outlet → QuickActionBar (phone) → RecordPanel sheet → AllActionsSheet | **yes** (StatusBlock) | header buttons on md+ (IdentityStrip.tsx:81), StatusAction, QuickActionBar on phone | L / E for not found / Er (:47-69) | Does not use PH; h1 is `text-base md:text-lg` |
| ↳ `/` Now | vehicle/tabs/NowTab.tsx | two columns: To-do card │ Month card + Recent card (:27) | **yes** (this tab is the overview) | step button on each to-do row (:114) | MonthCard has its own skeleton and a plain `<p>` error with no retry (:281-287) | No TabHeader |
| ↳ maintenance | vehicle/tabs/MaintenanceTab.tsx | TabHeader with action (:85) → SubHead work orders + count → card list → SubHead new problems + count → card list → collapsible "Done" | partial (counts in the subheads) | TabHeader action | L/E/Er for the whole tab | |
| ↳ money | vehicle/tabs/MoneyTab.tsx | TabHeader (title with period, month stepper, record expense) (:137) → `PeriodStats` stat grid (:176) → 2 chart cards → SubHead → FilterChips → card list → load-more button → lifetime line | **yes** | TabHeader action | L/E/Er | Stats are hand-rolled (`Stat`/`PeriodStats` :261/:298), not `MetricStrip` |
| ↳ trips | vehicle/tabs/TripsTab.tsx | TabHeader, total km in the description (:52) → card list → load more | partial | TabHeader action | L/E/Er | |
| ↳ documents | vehicle/tabs/DocumentsTab.tsx | TabHeader (:93) → card list | no (expiry shows only as a row tone) | TabHeader action | L/E/Er | |
| ↳ history | vehicle/tabs/HistoryTab.tsx | TabHeader, no action (:63) → FilterChips → day-grouped cards → load more | no (a log; fine) | — | L/E/Er | |
| ↳ details | vehicle/tabs/DetailsTab.tsx | sr-only h2 (:85) → right-aligned Edit (:89) → 3-column facts card or edit card | n/a | Edit, top right | ErrorBanner when editing | No TabHeader |
| ↳ `?panel=` | vehicle/panel/RecordPanel.tsx | Sheet, right or bottom (:32): back link → `DetailHeader` (eyebrow, title, meta) (parts.tsx:392) → DetailSections → PanelFooter actions | partial (meta chips) | PanelFooter | PanelLoading (wraps L), PanelMissing | |
| `/activities` | screens/ActivitiesScreen.tsx | PH, title + Record (:169) → BSL + VO (:184) → DataTable with filters | **no** | PH action | L/Er + BranchScopedEmptyState | |
| `/activities/record` | screens/ActivitySheetScreen.tsx | PH (:106) → subtitle (:107) → template Tabs (:446) → ErrorBanner → section Cards → sticky footer submit (:899) | n/a | sticky footer | ErrorBanner | |
| `/activities/$activityId` | screens/ActivityDetailScreen.tsx | PH, activity number + ActivityActions + history (:74) → meta line (TripState, branch, type, customer…) (:84) → description → CompletenessBanner (:116) → ActivityOverview `MetricStrip` → timeline │ assets → legs → money → ProvenanceStamp | **yes** | PH actions | L/Er; not found falls into Er (:48) | No breadcrumb page crumb (see §2.8) |
| `/maintenance` | screens/MaintenanceScreen.tsx | PH, title + 2 actions (:168) → Tabs held in local state (:197) → per tab: StatusChips + BSL → DataTable (work orders open a drawer, issues use rowActions) | **no** | PH actions | L/E/Er + BranchScopedEmptyState | Tabs are not in the URL |
| `/finance/record` | screens/FinanceRecordScreen.tsx | PH (:31) → form at `max-w-xl` inside a `wide` container | n/a | form submit | — | No FinanceNav on this page |
| `/finance/entries` | screens/FinanceEntriesScreen.tsx | PH, title only (:185) → FinanceToolbar: FinanceNav │ VO + Record (:188) → BSL → DataTable with filters, row drawer + full-screen | **no** | toolbar, `size="sm"` (:196) | L/Er + BranchScopedEmptyState; a bare L with no container while `me` loads (:54) | |
| `/finance/entries/$entryId` | screens/FinanceEntryDetailScreen.tsx | PH, generic title + history (:74) → OtherBranchNotice → Card with EntrySummary (:95) → hand-rolled postings box (:102) → reversal chain box (:123) → full-width Edit (:137) → full-width Reverse (:162) | partial (field list; status is not first) | bottom of body | L/E/Er; bare L (:26) | `default` width (max-w-3xl) |
| `/finance/approvals` | screens/FinanceApprovalsScreen.tsx | PH (:243) → FinanceToolbar: nav with count badge │ VO → BSL with count + "outside branch" link (:257) → DataTable with approve/reject rowActions | partial (count line, nav badge) | row ⋯ | L/E/Er | |
| `/finance/periods` | screens/FinancePeriodsScreen.tsx | PH (:206) → FinanceToolbar → DataTable, paginated (:231) | **no** (no open-period callout) | row ⋯ | L replaces the table (:220) | |
| `/more` | screens/MoreStub.tsx | PH (:29) → "signed in as" → h2 Manage + link list (:44) → h2 Language → h2 Theme → Logout | n/a | — | — | `default` width |
| `/more/persons` | screens/PersonsScreen.tsx | PH, title + branch Select (h-9) + Register (:134) → BSL + VO → DataTable, paginated | no | PH action | L/Er + BranchScopedEmptyState | |
| `/more/users` | screens/UsersScreen.tsx | PH, title + Add (:168) → VO right-aligned → DataTable with load more | no | PH action | L/E/Er | No BSL (workspace-scoped, which is correct) |
| `/more/branches` | screens/BranchesScreen.tsx | same as users (:120) | no | PH action | L/E/Er | |

## 2. Inconsistencies

**1. Overview regions are rare, and there are three implementations.**
- Only Dashboard, Assets, Activity detail, the vehicle header with its Now tab, and the Money tab show an overview first.
- Activities, Maintenance, Finance entries, approvals and periods, and the admin lists open straight onto filters and a table.
- KPI tiles are built three ways:
  - `MetricStrip` (AssetsStub.tsx:192, ActivityOverview.tsx:42/60)
  - `SectionCards` (dashboard/SectionCards.tsx:36,170)
  - `PeriodStats`/`Stat` (vehicle/tabs/MoneyTab.tsx:261,298)

**2. Headings.**
- Page h1: `PageHeader` renders `text-2xl` (components/page.tsx:24). The vehicle h1 is `text-base md:text-lg` (vehicle/header/IdentityStrip.tsx:37).
- Tab h2: `TabHeader` (vehicle/parts.tsx:175) is used in five tabs. NowTab has none (:27). DetailsTab hides its h2 with sr-only (:85).
- Section headings use five styles:
  - `CardTitle` (activities/detail/ActivityLegs.tsx:47)
  - a plain `h2 font-semibold` inside a bordered div (FinanceEntryDetailScreen.tsx:103,124)
  - `CardHead` h2 text-sm (parts.tsx:154)
  - `SubHead` h3 (parts.tsx:194)
  - `h2 text-sm font-medium` (MoreStub.tsx:44)

**3. Page description.**
- Only Assets (:188) and the Activity sheet (:107) have a subtitle line.
- Every vehicle tab gets one through `TabHeader`.
- An eyebrow appears only on Asset register (:165).

**4. Where the primary action sits.**
- Usual place: the PH actions slot (Activities, Maintenance, Persons, Users, Branches).
- Finance entries puts it in the toolbar at `size="sm"`, which is `h-7` (components/ui/button.tsx:26; FinanceEntriesScreen.tsx:196). That is 28 px, below the 44 px rule.
- Assets uses a hand-styled `<Link>` that is hidden on phones, plus the app's only FAB, in `bg-signal` (AssetsStub.tsx:178-180, 360-367).
- Finance entry detail puts Edit and Reverse as full-width buttons at the bottom of the body (:136-168). Activity detail puts its actions in the PH (:76-81).
- The vehicle workspace has four places for actions: header buttons on md+, StatusAction, TabAction on each tab, and QuickActionBar on phones (QuickActionBar.tsx:20).

**5. Detail surfaces differ for the same record type.**
- A financial entry opens three ways:
  - the DataTable row drawer (FinanceEntriesScreen.tsx:265-280; vaul `Drawer`, data-table.tsx:762)
  - a full page (`FinanceEntryDetailScreen`)
  - the vehicle panel `Sheet` (RecordPanel.tsx:32 → EntryRecord.tsx:118)
- A work order opens in the Maintenance drawer `WorkOrderSheet` (MaintenanceScreen.tsx:235) or the vehicle `WorkOrderRecord` panel. It has no page.
- An activity opens as a full page from the list (ActivitiesScreen.tsx:229) but as the `TripRecord` panel inside the vehicle.
- The three header shapes differ: DrawerHeader (title + description), `DetailHeader` (eyebrow, title, meta), and `PageHeader`.
- Titles differ too. Entry detail uses the generic "Détail de l'écriture" (:75). Activity detail uses the record number (:75). The vehicle uses code · make.

**6. Tabs and sub-navigation.**
- `FinanceNav` is URL-routed, uses the default pill `TabsList` with `Badge` counts, and sits inside a toolbar row (FinanceNav.tsx:44-57).
- `VehicleTabsNav` is URL-routed, uses `variant="line"`, is sticky, and draws its own NumberMarker and DotMarker (VehicleTabsNav.tsx:83,110-121).
- Maintenance tabs live in local state (`defaultValue`, :197), so they are not linkable. Its `TabsList` also lacks the `h-11` height that apps/web/AGENTS.md requires.
- `/finance/record` drops the finance nav entirely (FinanceRecordScreen.tsx:31).

**7. Filters and paging.**
- Three filter controls: DataTable filters on most lists, `StatusChips` in Maintenance (:205), and `FilterChips` in the vehicle tabs at `h-8`, which is 32 px (parts.tsx:234).
- The vehicle tabs hand-roll "load more" buttons at `h-9` (MoneyTab.tsx:234, HistoryTab.tsx:111) instead of using DataTable `loadMore`.

**8. Breadcrumbs and back links (a navigation bug).**
- `PAGE_TRAILS` has no entries for `/activities/record` or `/activities/$activityId` (shell/breadcrumbs.ts:23-48).
- On those pages the trail ends at an unlinked "Activités".
- The phone back link needs at least 3 crumbs (SiteHeader.tsx:33), so activity detail has no way back up on a phone.
- The vehicle crumb is the generic "Fiche de l'actif". The panel carries its own back button (RecordPanel.tsx:45).

**9. Loading, empty and error states.**
- NowTab's MonthCard hand-rolls its skeleton and shows a plain `<p>` error with no retry (:281-287).
- Finance entries and entry detail return a bare `LoadingState` with no `PageContainer` while `me` loads (FinanceEntriesScreen.tsx:54, FinanceEntryDetailScreen.tsx:26).
- Periods swaps the whole table for a loader (:220). Entries and Approvals keep the table mounted on purpose (FinanceEntriesScreen.tsx:218-221).
- Not found: the vehicle and the entry use `EmptyState`. Activity detail shows `ErrorState` with a retry (:48).

**10. Width.**
- Detail pages: Activity is `wide`, Entry is `default`, the vehicle is `wide`.
- Create forms: Asset register is `narrow`, Finance record is `wide` with an inner `max-w-xl`, the Activity sheet is `wide`.
- The `PermissionDenied` width varies from screen to screen.

**11. Title wording (fr).**
- "Vos actifs" is the only possessive title; the others are plain nouns.
- Page titles and tab labels disagree:
  - "Écritures comptables" (page) vs "Écritures" (tab)
  - "Gestion des périodes" (page) vs "Périodes" (tab)
- Recording an entry goes by three names: the action says "Saisir une écriture", the page says "Enregistrer une transaction", the crumb says "Saisie".
- Registering an asset: the button says "Nouvel actif", the page says "Enregistrer un actif".
- On the vehicle, money appears as "Argent · {period}".

**12. Touch targets under 44 px.** These are in addition to the items above:
- the Persons branch Select at `h-9` (PersonsScreen.tsx:150)
- the vehicle StatusAction at `h-10` on phones (StatusBlock.tsx:201)
- the TodoRow button at `h-9` (NowTab.tsx:116)

## 3. Proposed page archetypes

| Archetype | Best existing page | Region order to standardise on | Pages to bring in line |
|---|---|---|---|
| **Dashboard** | DashboardScreen | PH → KPI tiles with attention tone, each linking to its list → trend → "recent" card with "view all" | Replace `SectionCards` with `MetricStrip` plus links |
| **List / register** | AssetsStub | PH (title + primary action) → one-line description → `MetricStrip` with an attention tile → BSL + VO → DataTable with filters → keyset load more | Activities, Finance entries, Maintenance (per tab), Persons |
| **Queue** (work to decide) | FinanceApprovals (closest) | PH → section nav with count badge → **overview strip (count pending, oldest, total amount; nothing builds this today)** → scope line with an "outside branch" link → DataTable with row decisions | Maintenance issues tab, Periods (which period is open or due) |
| **Record workspace** | VehicleWorkspace for a multi-section record; ActivityDetail for a single-page record | Identity h1 + actions → status sentence with the one next action → facts or meta line → banner (completeness or exceptions) → overview (Now tab or `MetricStrip`) → detail sections or tabs (`TabHeader`: title, description, one action) → provenance; child records open in the side panel | FinanceEntryDetail (title = entry number, status first, actions in the header, `wide`); give Now and Details a `TabHeader` |
| **Form / create** | ActivitySheetScreen | PH → description → sectioned Cards → sticky footer submit | AssetRegister, FinanceRecord (one width, one submit placement) |
| **Settings hub / list** | MoreStub (hub); Users / Branches (list) | Hub: PH → grouped link lists. List: PH + add → DataTable | — |

Inside a tab, the best pattern today is the vehicle Money tab: `TabHeader` → stats → charts → filtered list.