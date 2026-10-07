# ROUTIQ consistency view (proposal, 2026-10-04)

Handoff: see `HANDOFF.md` for the next session (issue breakdown and build order).

Status: **decided 2026-10-04** — neutral theme; everything else as recommended in `choices.html`. Next: move these rules into `apps/web/AGENTS.md` and file the fix slices.

Open `index.html` in a browser for the mockups. Pages:

| File | What it shows |
|---|---|
| `choices.html` | Ten decisions, each argued both ways, with a recommendation and a box for the owners' pick; neutral vs brand theme side by side |
| `insights.html` | Every page's overview, where charts go and who sees them, executive overview (desktop + phone, working charts), chart rules, data we have vs need |
| `platform.html` | The new direction: core + modules + presets (trucking, bus, internal fleet); setup matrix and vendor setup tool; words per preset; navigation per operator; who is a customer; Customers list and record (trucking and bus); follow-ups and complaints; Parcels (colis); forms, charts, decisions |
| `modules.html` | Core vs modules, the module contract (manifest examples), how you reach each module, on/off proof, Partners (placement, pages, every action) |
| `settings.html` | Company settings (logo, accent colour, details, regional, approvals, categories, numbering, module settings) + My settings; what always stays ROUTIQ |
| `featuremap.html` | Source of truth: every feature with its status (built, backend only, wrong scope, decided, designed, later) and evidence from develop |
| `scheduling.html` | Booking trips for a date: Planned status on the trip, Book a trip form, planning board (week by truck), month calendar, driver's My schedule, bus timetable + charters, role scope, charts, backend pieces |
| `vendor.html` | Is this too much (honest answer, build order, guardrails), what each person sees, our super admin console (tenants list, tenant record, module dialog), support access with consent, tenant isolation, companies working together (later), backend pieces |
| `stock.html` | The Loom videos (the reference app procurement + customers tutorials) mapped onto ROUTIQ's planned Stock module (#27): workflow, navigation, Stock page, purchase order workspace, forms by layout, phone receiving, charts, questions for the owners |
| `form-layouts.html` | Six form layouts (Quick entry, Record, Line items, Decision, Long capture, Edit in place), measures, pairs that may share a row, every form mapped, code shape |
| `index.html` | The rule, every feature in the feature map mapped to an archetype, owner decisions |
| `pages.html` | Five page archetypes, desktop and phone, with layer outlines |
| `forms.html` | Form surfaces, field kit, states after submit, decision dialog, page form, edit vs correct, the build recipe |
| `sidebar.html` | Navigation: develop today vs the unmerged brand-identity pass vs the proposal, per-role sidebars, phone bottom bar, coming soon, what to do with the brand branch |
| `audit.html` | Findings from five audits of develop @ `6399529`, ranked, with a fix order |
| `audits/*.md` | Raw audit reports (evidence) |

## The rule

Every page, every tab and every record panel answers three questions in this order:

1. **Overview**: what is this, and does anything need me? (title + purpose, metric strip, up to 3 attention items; or status + the blocking thing + who acts)
2. **Details**: the records (toolbar + DataTable, cards on phone; or fields in the same groups as the form that made them).
3. **Act**: what can I do here? (one primary button; the record action bar; forms open on the surface their job calls for)

## Page archetypes

| Archetype | Region order | Used by |
|---|---|---|
| Module list | Header (title, one-line purpose, one primary action) → `MetricStrip` (server counts, each filters the table) → attention (max 3) → toolbar → DataTable | `/assets`, `/activities`, `/maintenance`, `/finance/entries` |
| Record workspace | Breadcrumb → identity strip (code, name, status badge, who/where) → status block (the blocking thing, who acts) → facts line → tabs (first = Overview) → fixed action bar; sub-records open in the record panel | `/assets/$id` (reference), `/activities/$id`, `/finance/entries/$id` |
| Tab inside a record | Tab summary strip → list → tab action; item click opens the record panel | Every vehicle tab |
| Decision queue | Header (no create) → strip: waiting / amount / oldest → rows showing what's missing, with inline decisions; negative decisions open a dialog | `/finance/approvals`, later issue triage |
| Home | "Needs you" (same rows as the vehicle To do) → role's metrics → recent | `/` |
| Settings list | Header with a sentence explaining what the list controls + primary action → DataTable; create/edit in the panel; deactivate in a dialog | `/more/branches`, `/more/users`, `/more/persons`, `/finance/periods` |

Rules across archetypes:

- One filled button per page. On phone the primary action moves to a bottom bar.
- Overview numbers come from server aggregates, never client counts.
- State-locked actions stay visible with a lock and the reason; role-forbidden actions are hidden.
- Breadcrumb is the only "back". Every route has a trail.
- Missing values read "Non renseigné" / "Not recorded", with an inline "Add" when the user may fill it.

## Visual rules carried over from the brand pass (`feat/brand-identity` DESIGN.md)

- Figures (money, counts, references) use `tabular-nums` in the sans face, never monospace. [DS-1]
- No colour literals in components; semantic tokens only. [DS-2]
- The logo is drawn only by the brand component (R with map-pin counter and road stem; letter `currentColor`, pin brand blue). [DS-3]
- Labels and badges in sentence case; no uppercase eyebrows or shouting badges. [DS-4]
- `PageHeader` owns title + one-sentence description + actions; `PageContainer` owns gutters and width (`narrow` forms, `default` reading, `wide` lists and workspaces).
- Not used: pill buttons, numbered section labels, monospace labels, italic accent words, decorative gradients, cream backgrounds.
- Theme (neutral vs brand navy) is decision 1 in `choices.html`; the logo ships either way.

## Navigation

- Sidebar rows are places (pages with records), never actions or single records.
- Two groups: **Daily work** (Home, Trucks, Trips, Maintenance, Money) and **Company** (Personnel, Branches, Accounting months).
- **Money is one place.** Entries and Approvals merge: approvals is the "Waiting approval" view of the Money list (tile + filter + row decisions for approvers; `/finance/approvals` redirects). Periods become Company → Accounting months (finance approvers and admins). The Finance pill tabs go.
- Hidden when the module is off or the role can't read it (#64); never greyed, never a link to a denial.
- Row label = page title = first breadcrumb.
- Counts only where someone waits (expenses waiting your approval on Money, new Maintenance problems), from server aggregates.
- Personal settings (language, theme, sign out) in the name menu at the bottom; the "More" page goes.
- "What's coming": one quiet row to the roadmap page, plus a one-line notice inside the module where each feature will live. Driven by the brand pass's `features/catalog.ts`.
- Phone: bottom bar with three places per role + Menu (the full sidebar as a sheet).
- Visibility is data in `shell/sections.ts` (group, module, read capability) and tested per role.

## Lists on phone

DataTable keeps one implementation. On phone it renders **list rows**, not bordered cards and not the squeezed table: line 1 title (left, the only tap target) + value (right, tabular figures); line 2 meta joined by " · " (empty values skipped) + status badge under the value; ⋯ at the end; 60 px rows divided by 1 px lines; filters collapse into one "Filters (n)" button. Columns declare a phone role: `title`, `meta`, `value`, `status`, `hidden`.

## Overviews and charts (see `insights.html`)

- Every page opens with tiles (numbers that filter the list). Managers, finance and executives also see change vs last period and a sparkline.
- Charts only where the question is "how is it changing / where / why": executive overview (Home for EXECUTIVE_VIEWER and admins), one chart per module overview for that module's managers, and the truck's Money tab. Never on queues or settings.
- Forms: line for trends, sorted horizontal bars for comparisons; no pies, gauges, 3D or dual axes; ≤ 3 series.
- Series colours: blue `#2a78d6`, orange `#eb6834`, aqua `#1baf7a` (validated for colour blindness; aqua needs direct labels). Status colours stay reserved. The neutral theme adds these as chart tokens only.
- Server summaries only; every chart has a question subtitle, a unit, hover/tap values, a table view and a link to the list behind it.

## Form system

### Surface by job

| Surface | When | Never |
|---|---|---|
| **Panel** (default): right sheet 440 px desktop, full-height bottom sheet phone | Recording or editing a fact, up to ~12 fields, page behind stays the context | Centered dialog for create; popover forms |
| **Dialog** | A decision on an existing record (reject, reverse, cancel, release, deactivate, close period, discard) with at most a reason | Creating records; "OK / Annuler" labels |
| **Page** | Long multi-section capture with drafts/offline (Record a trip, Register a truck); steps + review on phone | Short forms |

All three render through `components/command-form.tsx` (`panel`/`sheet` share one look, `dialog`, `page`).

### Frame

- Title = the action as a verb phrase, same words as the button that opened it. Submit repeats the verb ("Enregistrer la dépense"), never "OK"/"Valider" alone.
- Submit is always the last (rightmost) button; cancel before it.
- Footer hint says what happens next (approval, who sees it).
- Context the page already knows (vehicle, branch, work order) is **pinned**, not asked.
- Groups in order: what → how much → when → proof → more details (optional, folded, with a filled count).
- Required fields first, marked with a red asterisk.
- Defaults: today, context branch, last reading as a hint.
- Closing with typed data asks to discard (dialog rules).

### Form layouts (see `form-layouts.html`)

| Layout | When | Surface / width | Phone |
|---|---|---|---|
| Quick entry | ≤ 6 fields, done many times a day (fuel, note, reading, receipt, expense) | Panel 440 | Full sheet; main value 52 px |
| Record | Default: 7–14 fields in 2–4 groups (problem, work order, document, person, user, branch) | Panel 440 | Full sheet |
| Line items | Repeating rows (WO cost lines, trip legs/crew/entries) | Panel 560 | Rows become cards |
| Decision | Yes/no on an existing record, ≤ 1 field | Dialog 440 | Stacked buttons |
| Long capture | > 4 groups or > 14 fields, offline, drafts (record a trip, register a truck) | Page, 760 column, 2 columns per section | Steps + review |
| Edit in place | A record's Details tab only | The card | 1 column |

Measures (owned by `FormLayout`, never set by a form): header padding 16/18, title 18 px; 16 px between fields, 24 px between groups; inputs 44 px; label 13 px semibold above; help/error 12 px below; sticky 64 px footer with hint left, Cancel then submit right. Two fields share a row only for allowed pairs: amount + date, date + time, from + to, quantity + unit price, amount + litres, assignee + cost, code + name, issued + expires, PIN + confirm. A form file is `<FormLayout kind>` + `FormGroup` / `FormPair` / `FormOptional` + field-kit fields; no spacing or footer markup.

### Field kit

`TextField`, `NoteField`, `MoneyField` (XAF integer, space grouping, suffix, numeric keypad), `DateField` / `DateTimeField` (popover calendar + Today/Yesterday; never native inputs), `ChoiceField` (2–4 options segmented, 5–12 select, more = search), `PersonField` / `VehicleField` (search + "register new"), `FileField` (camera first), `ReadingField` (unit suffix + last reading hint). Each owns label, required marker, help, error message, 44 px height, and reads back in the record panel with the same label and group.

### States after submit

| Outcome | Look |
|---|---|
| Client validation fails | Error summary at top with links + inline messages; nothing sent |
| Server refuses (code) | Banner above untouched fields, translated from the stable code |
| `VERSION_CONFLICT` | Form replaced by "changed while you were editing" + Refresh |
| Offline | "Saved on this phone, sends when online"; record shows "Not sent yet" |
| Success | Surface closes; one toast via `notifyCommandSuccess` with "View"; record renders as pending (ADR-0001) |
| Sending | Submit shows the -ing form of its verb, disabled |

### Decisions

Dialog names the record, says what happens and what stays. Negative decisions (reject, reverse, cancel, dismiss) require a reason (marked, max 500) and use a destructive button that repeats the verb. The dismiss button says what stays ("Garder l'écriture", "Retour"), never "Annuler", because "Annuler" is also a domain verb. Approve is one tap, no dialog.

### Edit and correct (ADR-0008)

"Modifier" opens the same form prefilled, on the same surface. A posted record opens in correction mode: warning banner, old → new on each changed field, required reason, preview of the reversal and the new entry. The Details tab keeps its in-place edit (#84) using the same fields and groups.

## Recipe: a new form

1. Contract: `packages/contracts/src/commands/<name>.ts` payload schema + field helpers.
2. Form: `apps/web/src/<feature>/<Name>Form.tsx` = `useCommandForm(schema, command)` + `<CommandForm surface>` + field-kit fields. No layout beyond groups.
3. Tests: `<Name>Form.test.tsx` with the six harness tests: opens with pinned context and defaults; empty submit shows summary and sends nothing; valid fill sends the exact payload; server code shows its banner and keeps values; conflict replaces the form; success closes and toasts.
4. Copy: `<feature>.<name>.{title,description,submit,submitting,hint,success}` + field labels in `fr.json` and `en.json`.
5. Verify: one recipe line in `.agents/skills/verify-routiq/features/<feature>.md`; `pnpm verify drive` on desktop and phone, stored row read back via the API.

`useCommandForm` (`apps/web/src/components/use-command-form.ts`) and the harness (`describeCommandForm` in `apps/web/src/test/form-harness.ts`) exist since #290, with Add note as the first form on them; guard `H17` holds the forms not yet moved (#294). The field kit is #292.

### Guards (build fails on regressions)

- No `type="date"` / `type="datetime-local"` in `src/`.
- `Dialog` with a form only in the decision allow-list.
- Every `*Form.tsx` / `*Dialog.tsx` has a harness test.
- Interactive primitives default to ≥ 44 px; no `h-8`/`h-9`/`size="sm"` on controls in screens.
- No local status-tone maps outside each domain's badge file.
- No `components/ui/toast` imports outside `lib/notify.ts`.

## Fix order

See `audit.html#order`. In short: (1) approvals rows open the entry, (2) breadcrumb trails for trips, (3) 44 px primitives, (4) one status badge per domain, (5) command labels + destructive tone + button order, (6) toasts for branches/users, (7) date fields, (8) field kit + harness, (9) panel as default create surface, (10) overview strips, (11) record shell for trip and entry detail, (12) formatting, (13) one timeline with notes.

## Owner decisions (decided 2026-10-04)

1. Is the vehicle workspace the model for every record (trip, entry; work order via the panel)? Recommended: yes. This is design-lab direction D.
2. Panel as the default form surface, dialogs only for decisions? Recommended: yes.
3. Steps + review on phone for the two page forms? Recommended: yes.
4. Submit always last on every surface? Recommended: yes (today panels put it first).
5. Sidebar: proposal C (`sidebar.html`), with the phone bottom bar? Recommended: yes.
6. Theme: **neutral** chosen; the logo still ships. Items 1–5 and the rest of `choices.html`: as recommended.
