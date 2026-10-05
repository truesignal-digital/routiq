# ROUTIQ UI consistency audit (admin, slot 7, commit 6399529)

I captured 182 screenshots in `/tmp/routiq-ui-audit/`, 46 steps per run, in four runs: desktop 1440x900 and phone 390x844, each in English and French. The drive script is `/tmp/routiq-ui-audit/audit.ts`. I opened about 75 of the shots myself: all of desktop-en, most of phone-en, and the French spot-checks. No forms were submitted and no data changed. `doctor` passed every check. Each run logged 5 console errors, all the known Base UI `nativeButton` warning (from `tabs.tsx:40`, `button.tsx:33` and `popover.tsx:19`). There were no failed requests. Slot 7 is torn down (`pnpm verify down --slot 7`: containers and volumes removed).

All paths below are under `/tmp/routiq-ui-audit/`.

**Screenshot artifacts I did not count as findings:**
- In full-page phone shots, the fixed vehicle action bar (Expense/Problem/Trip/More) and the sticky record-sheet bar appear in the middle of the page.
- On full-page desktop shots, the sidebar background ends at 900px.
- Grey primary buttons on Branches/Users are hover states left from the previous click.

## 1. Page headers and overviews

| Page / viewport | Screenshot | Inconsistency | Compare with |
|---|---|---|---|
| Home, desktop | `01-home-desktop-en.png` | H1 "Home" with no subtitle and no primary action. | `02-trucks-list-desktop-en.png` has a title, a subtitle and a primary action. |
| Trucks, desktop | `02-trucks-list-desktop-en.png` | The only list that opens with summary cards (TOTAL / IN SERVICE / ATTENTION). Trips, Maintenance, Finance, Branches and Users go straight into a table. | `12-…`, `17-…`, `23-…` |
| Vehicle header, desktop | `03-vh003-now-desktop-en.png` | The VH003 title is visibly smaller (about 20px) than other page H1s (about 26px), and has an icon tile. | `02-…`, `12-…` |
| Finance tabs, desktop | `17-…`, `21-…`, `22-finance-*-desktop-en.png` | The H1 changes per tab ("Entries" / "Approvals" / "Period management") while the tab says "Periods". The action buttons sit on the tab row and are short (about 26px), while other pages put tall (44px) buttons on the title row. | `12-maintenance-list-desktop-en.png` |
| Entry detail and More, desktop | `19-entry-detail-desktop-en.png`, `32-more-desktop-en.png` | Content is centred in a narrow column (about 736px). Every other page is full-width and left-aligned. | `24-trip-detail-desktop-en.png` |
| Vehicle Details tab, desktop | `09-vh003-details-desktop-en.png` | No section title or subtitle, and the action is an outline button. The other tabs (Maintenance, Money, Trips, Documents, History) all have an H2, a subtitle and a black primary on the right. | `04-…`, `06-…`, `07-…` |
| Trip detail, desktop | `24-trip-detail-desktop-en.png` | The breadcrumb stops at "Home > Trips" with no trip number. Entry detail shows "… > Entries > Detail". A debug footer "TRUCKING v1 · created … · command d65f0997" is visible to users. | `19-…` |
| Record sheet, desktop | `25-form-record-trip-desktop-en.png` | The breadcrumb is "Home > Trips" while the page is a form. Record entry shows "Finance > Record". | `20-…` |
| Lists, desktop | `02-…`, `23-…`, `26-…`, `28-…`, `30-…` | The "View" button sits alone on its own row, wasting a row. Entries puts it beside "Record an entry". | `17-…` |
| Back navigation, phone | `24-trip-detail-phone-en.png` | Shows plain "Trips" with no back chevron. | `04-vh003-maintenance-phone-en.png` ("< Trucks"), `19-entry-detail-phone-en.png` ("< Entries") |

## 2. Form containers for similar jobs

| Job | Screenshots | Inconsistency |
|---|---|---|
| Report a problem | `16-form-new-issue-desktop-en.png` (centred dialog) and `37-form-report-problem-desktop-en.png` (right side sheet) | Same form, two containers, opposite button order. The action is called "Report a problem", but the form title is "New issue". |
| New work order | `15-form-new-work-order-desktop-en.png` (dialog) and `38-form-create-work-order-desktop-en.png` (side sheet) | Same split. |
| Record expense | `20-form-record-entry-desktop-en.png` (full page "Record a transaction", full-width submit, no Cancel) and `35-form-record-expense-desktop-en.png` (side sheet "Record an expense") | Same job, different container. The trigger on the list says "Record an entry". |
| Start a trip | `41-form-start-trip-desktop-en.png` | Leaves the vehicle for a full page. Every other vehicle action opens a sheet over the vehicle. |
| Edit details | `40-form-edit-details-desktop-en.png` | Inline edit with labels to the left of fields. Every other form stacks the label above the field. |
| Record panels | `14-work-order-sheet-desktop-en.png` vs `18-entry-drawer-desktop-en.png` vs `34-form-log-fuel-desktop-en.png` | Work-order sheet: no X, actions in the middle of the sheet, full-width Close at the bottom. Entry drawer: no X, full-width "Open full screen" and Close stacked. Form sheets: X at top, buttons in the footer. |
| Phone containers | `34-form-log-fuel-phone-en.png` (bottom sheet, left title, X, two buttons side by side), `15-form-new-work-order-phone-en.png` (floating dialog, stacked buttons), `14-work-order-sheet-phone-en.png` and `18-entry-drawer-phone-en.png` (bottom sheet, centred title, no X) | Three different patterns for similar jobs. |

## 3. Button placement in forms

- **Dialogs** (`15-…`, `16-…`, `27-…`, `29-…`, `31-…-desktop-en.png`): Cancel then the primary, right-aligned, on a grey footer band.
- **Side sheets** (`34-…` to `39-…`, `42-…`): the primary then Cancel, left-aligned. This is the reverse order.
- **Edit details** (`40-…`): Cancel then Save, right-aligned, inside the card.
- **Record entry page** (`20-…`): one full-width submit at the bottom.
- **Record sheet** (`25-…`): sticky bar with "Record and close" and "Record sheet" on the right. On phone (`25-…-phone-en.png`) the primary is stacked on top.
- **Reverse** (`19-entry-detail-desktop-en.png`): a destructive action shown as a full-width black primary.
- **Submit verbs vary:** Create (branch), Add (user), Register (person), Open work order, Report issue, Record, Save fuel, Add note, Declare complete. Titles vary the same way: "New branch", "Add a user", "New person". The New person subtitle ("…without leaving the sheet") is written for the trip sheet, but it shows on the People page (`31-…`).

## 4. Field labels, inputs and dates

- **Input heights mix within one form.**
  - `15-…`: selects about 32px, Expected cost about 44px.
  - `34-…`: Amount 44px, the date/station/odometer fields 32px.
  - `35-…`: every field is 44px.
- **Label casing differs.** Entry drawer and detail use UPPERCASE labels ("ENTRY NUMBER") in `18-…` and `19-…`. The work-order sheet (`14-…`) and the Details tab (`09-…`) use sentence case.
- **Native date inputs look native** ("mm/dd/yyyy, --:-- --" with the browser calendar icon) in `20-…`, `25-…`, `34-…` and `35-…`. Edit details uses a custom picker ("Not recorded" + calendar icon) in `40-…`. On French phone the native field shows "10/04/2026, 01:07 PM" (`34-form-log-fuel-phone-fr.png`), while app-rendered dates on the same screen are "04/10/2026 12:57".
- **Required vs optional.** "(optional)" is used fairly consistently, but `15-…`, `29-…` and `40-…` mark nothing either way.
- **Currency in money fields differs:**
  - label "Amount (XAF)" in `20-…` and `35-…`
  - prefix "FCFA" inside the field in `40-…`
  - no unit at all on "Expected cost" in `15-…` and `38-…`
- **Misleading helper.** The Create work order sheet shows "With no issue linked, the work order is preventive." under a disabled Issue field that does have an issue linked (`38-…`).
- **Filters differ.** Period is a free-text "Period (YYYY-MM)" box (`17-…`), and trips From/To are plain text boxes (`23-…`), while every other filter is a select.

## 5. Money, badges and status styling

- **The same entry has opposite signs.** DLA-2026-00008 (a fuel expense) shows "+FCFA 86,000" in `17-…`, `18-…` and `19-…`, but "-FCFA 86,000" in `24-trip-detail-desktop-en.png`. Home (`01-…`) puts "+" on every expense. The vehicle Money and History tabs show expenses unsigned and revenue with "+" (`08-…`, `10-…`). Approvals shows no sign (`21-…`).
- **Amount font differs.** Home, finance and trip detail use monospace bold (`01-…`, `17-…`, `24-…`). The vehicle workspace uses the proportional font (`05-…`, `10-…`).
- **Status badges differ:**
  - "POSTED"/"PENDING" are uppercase green/blue in `01-…` and `17-…`.
  - "Posted" is sentence-case grey in the vehicle Money tab (`10-…`) and green in trip detail (`24-…`).
  - Periods "Open" is plain text with no badge (`22-…`).
  - Trucks "Registered" is grey with no icon, while "In service" is green with an icon (`02-…`).
  - In French, list badges read "COMPTABILISÉE" (`17-…-desktop-fr.png`) and trip detail reads "Comptabilisée".
- **Stat cards come in three styles:**
  - Home: icon, sentence-case label, mono number (`01-…`).
  - Trucks: UPPERCASE label, no icon (`02-…`).
  - Trip detail: UPPERCASE label with huge mono dates that wrap on phone (`24-…`, `24-…-phone-en.png`).
  - The vehicle Money tab has a fourth: sentence case with info icons (`05-…`).
- **Branch display differs.** Approvals shows the branch as a chip with an icon (`21-…`). Everywhere else it is plain text.
- **Pagination differs.** Periods and People use "Rows per page" with first/last buttons (`22-…`, `30-…`). Other lists show only "Page 1 < >".
- **Only amber primary.** The phone Trucks FAB is amber, the only amber primary in the app, and it covers VH003's row menu (`02-trucks-list-phone-en.png`). The other phone lists keep a black header button (`23-…-phone-en.png`).

## 6. Tabs and sub-navigation

Four tab styles are in use:
- underline tabs in the vehicle workspace (`03-…`)
- a grey segmented control for Maintenance Work orders/Issues (`12-…`) and Finance (`17-…`), which is links styled as tabs
- black-filled pill chips for status filters (`12-…`, `13-…`)
- an outlined-active segmented control with counts in the Money and History tab filters (`05-…`, `08-…`)

On phone the vehicle tab strip is clipped ("Doc…") with no scroll cue. It also does not scroll the active tab into view: on Details, "Maintenance" looks bold and Details is off-screen (`09-vh003-details-phone-en.png`, `40-…-phone-en.png`).

Maintenance remembers the last sub-tab (Issues) across visits (`14-…-FAILED` run, `15-…`, `16-…` backgrounds). Finance tabs are routes and do not behave this way.

## 7. Mixed language and terminology

- **"Issue" vs "Problem".** The Maintenance page uses "New issue"/"Issues". The vehicle uses "Report a problem"/"New problems". The Create work order sheet shows "← Problem 99D91608" above a field labelled "Issue" (`38-…`). The work-order sheet says "Cancel the work order"; the menu says "Cancel work order" (`14-…`).
- **Raw category codes.** BODYWORK, BRAKES and OTHER show as raw codes in the Issues table in both languages (`13-maintenance-issues-desktop-fr.png`, `14-…-FAILED`). The vehicle tab shows "Bodywork" (`04-…`).
- **French screens:**
  - "Job de halage" (franglais) and "TRUCKING v1" in the footer.
  - "Clôturé, 5 manques" next to "Clôturée avec réserves": the past participle doesn't agree with "Clôturée" (`24-trip-detail-desktop-fr.png`).
  - Seed descriptions are English ("Brake pressure warning…"). That is data, but it makes French screens look half-translated (`03-…-fr.png`).
- **The French branch switcher is truncated** to "Toutes mes agen" on every page and both viewports (`03-vh003-now-desktop-fr.png`, `03-…-phone-fr.png`).
- **Currency naming mixes** "XAF" (labels) and "FCFA" (display).

## 8. Phone layout problems

- **Pages wider than the screen:**
  - Maintenance: header buttons push the page to about 441px in English and about 561px in French (`12-maintenance-list-phone-en.png`, `12-…-phone-fr.png`, `13-…-phone-en.png`).
  - People: about 407px ("Add a person" cut off) (`30-people-phone-en.png`).
- **Desktop table clipping:**
  - Finance entries: the last column ("…") is clipped at 1440px in English (`17-…-desktop-en.png`). In French the whole "Rattaché à" column is cut (`17-…-desktop-fr.png`).
  - Trip detail on phone: the Legs table loses Arrived/Load/Distance (`24-…-phone-en.png`).
- **Mobile card layouts:**
  - Stray separators ("7/21/26 · – ·", "Douala ·") and oddly indented link lines (`17-…-phone-en.png`, `12-…-phone-en.png`, `21-…-phone-en.png`).
  - Category moves between the badge row and the amount row from card to card (`01-home-phone-en.png`).
- **Wrapping:** the trip number wraps "DLA-2026-\n00002", and NET splits into "–" / "FCFA 86,000" (`24-…-phone-en.png`).
- **Filters before data:** filters stack five or six deep before any row on Trips, Entries and Maintenance (`23-…`, `17-…`, `12-…-phone-en.png`).

## 9. Data shown wrongly (found while checking visuals)

- **Approvals "Economic date" shows the submission date.** The column is labelled Economic date but renders `submittedAt`: `apps/web/src/screens/FinanceApprovalsScreen.tsx:123-127` uses header `finance.entries.detail.date` with `formatDate(row.original.submittedAt)`. The UI shows 10/4/26 for DLA-2026-00005 and -00006. The DB and `GET /v1/finance/approvals` return 2026-07-29 and 2026-10-02 (`21-approvals-desktop-en.png` vs `17-…`).
- **Trucks "ATTENTION 0"** while VH003 is grounded with an expired inspection (`02-…` vs `03-…`).
- **TR001 shows its code twice** as title and subtitle (`02-…`).

## Top 10 most visible problems

1. The same entry shows +FCFA in Finance and −FCFA in Trip detail, and the sign rule differs on every screen (`17-…`, `24-…`, `10-…`).
2. Five form containers for similar jobs: dialog, side sheet, bottom sheet, full page and inline. The same "New issue" and "New work order" forms open differently from Maintenance and from the vehicle (`16-…` vs `37-…`, `15-…` vs `38-…`).
3. Button order flips between dialogs (Cancel then primary, right) and sheets (primary then Cancel, left), with no consistent Close/X (`27-…`, `34-…`, `14-…`).
4. Phone pages overflow horizontally on Maintenance and People, worst in French (`12-…-phone-fr.png`, `30-…-phone-en.png`).
5. Four tab styles, and the phone vehicle tabs hide the active tab (`03-…`, `12-…`, `05-…`, `09-…-phone-en.png`).
6. Status badges: uppercase green "POSTED", grey "Posted" and plain "Open" for the same idea (`17-…`, `10-…`, `22-…`).
7. The Approvals "Economic date" column shows the submission date (`21-…`; code at `FinanceApprovalsScreen.tsx:127`).
8. Native browser date/time inputs next to one custom picker, with US formatting inside French screens (`25-…`, `34-…-phone-fr.png`, `40-…`).
9. "Issue" and "Problem" are used for the same thing, sometimes on one screen, plus raw English category codes on French screens (`38-…`, `13-…-desktop-fr.png`).
10. Page structure varies: overview cards only on Trucks, centred narrow pages only for Entry detail and More, an orphaned "View" row on most lists, and a debug footer on Trip detail (`02-…`, `19-…`, `23-…`, `24-…`).

`git status` now shows untracked `PROGRESS.md` and `docs/design/` in the worktree. I didn't create them, since I edited no source, and I left them alone.