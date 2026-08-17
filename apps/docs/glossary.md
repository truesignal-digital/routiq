# Glossary for testers

This glossary explains domain terms and business concepts in plain English. Your screen's labels depend on which workspace preset you're using (TRUCKING or PASSENGER_TRANSPORT); the mapping table below shows how terms change.

---

## Terminology mapping

The canonical domain terms are **Asset** and **Activity**. The UI overlays preset-specific labels.

| Canonical | TRUCKING UI | PASSENGER UI | French (Trucking/Passenger) |
|-----------|------------|-------------|--------------------------|
| Asset | Truck | Vehicle | Camion / Véhicule |
| Activity | Trip | Trip (same) | Trajet / Voyage |
| Activity leg | Leg | Leg | Étape / Étape |

---

## Core concepts

### Workspace

Your isolated business tenant. One workspace = one transport company. Data never crosses workspaces (at the database level — you can't see another company's trucks or trips). You choose a workspace when you log in.

### Branch

An operating location of your business (warehouse, depot, office). Every truck and trip is assigned to exactly one branch. You might see "Agence" in French. Branches are deactivated, never deleted — a branch can't be removed from the system even when it closes, so the history stays complete.

**Branch scope:** Your user account is granted access to one or more branches. You see and touch only your branches' data. A user scoped to "North Branch" cannot see "South Branch" trucks or trips.

**Ambient branch:** The branch you're currently viewing through (a client-side filter). Changing it doesn't change what you're authorized to see — it just narrows the view. If you're assigned to two branches, you can switch between them in the header. Switching grants nothing; it's just a lens.

### Asset (Truck or Vehicle)

An expensive capital asset your business operates — a truck, trailer, or bus. Each asset has:
- A unique code (e.g., "TR-001")
- A lifecycle: REGISTERED (set up, not yet commissioned) → IN_SERVICE → UNDER_MAINTENANCE (temporarily out) → SOLD, RETIRED, or WRITTEN_OFF (out of service for good — no new records allowed after these)
- A commission date (when it went into service)
- Linked expenses, fuel records, and trips

### Activity (Trip)

A business journey recorded in the system — one truck from pickup to dropoff (TRUCKING), or one passenger route (PASSENGER_TRANSPORT). Trips capture:
- Distance traveled (odometer readings)
- Fuel consumed
- Linked expenses and revenue
- Trip type (regular delivery, emergency run, etc. — tenant-defined)
- A lifecycle: OPEN (open for edit) → CLOSED (no longer editable)

### Activity leg (Étape)

A segment of a trip. Passenger transport in particular records legs (stage 1: city center to highway, stage 2: highway run, stage 3: final delivery). Each leg has its own fuel and time records.

### Approval Chain

The business rule deciding who approves what. Each workspace has one approval threshold (a single amount boundary). For example:
- Entries at or under 100,000 XAF → post immediately (no approval needed)
- Entries over 100,000 XAF → saved as SUBMITTED and wait for a decision from an approver (FINANCE_APPROVER or ADMIN)

An approver always reviews submissions; the person who recorded the entry cannot approve it (the "four-eyes" rule — a second approver must decide). The threshold is configured per workspace — different companies have different values.

### Approval threshold

The amount boundary in XAF (whole francs — XAF has no cents). Entries at or under the threshold post immediately; over it, they're SUBMITTED and wait for an approver's decision. The threshold is stored in `approval_rules` and can be changed via the `update-approval-threshold` command (audited like everything else).

### Entry role

Your role in the system, which determines what you can do. The main roles are:

- **ADMIN** — Workspace owner. Configures settings, manages users, approves entries, locks periods.
- **FIELD_SUBMITTER** — Operator who records trucks, trips, and expenses. Cannot approve.
- **FINANCE_APPROVER** — Finance manager. Reviews and approves submitted entries. Cannot configure the workspace.

### Preset

A bundle of terminology, categories, and field definitions that shapes ROUTIQ for your business type. ROUTIQ ships with two presets:
- **TRUCKING** — For transport companies operating trucks and trailers.
- **PASSENGER_TRANSPORT** — For passenger transport (buses, minibuses).

Your workspace is assigned one or more presets when it's created. All trucks and trips you create are stamped with the preset they were created under.

---

## Financial concepts

### Expense

Money your business spent: fuel, tolls, maintenance, driver wages, etc. Recorded as a transaction with a date, amount, category, and optional truck assignment.

### Revenue

Money your business earned: fares, delivery fees, contract payments. Recorded like expenses, but with a positive sign.

### Entry (or financial entry)

A single transaction record — one expense or revenue. Entries are immutable after approval: corrections are made by reversals, not edits.

### Posted

An entry that has been approved and is final. It counts toward financial reports and period totals. Posted entries are marked POSTED and include approval metadata (who, when).

### Submitted

An entry created but awaiting approval (it exceeds the threshold). It's safe and audited; it just isn't final. Shown to approvers in the approval queue.

### Rejected

An entry the approver said no to. It didn't post. The submitter sees the rejection reason and can resubmit with corrections.

### Reversal

A correction to an already-posted entry. Instead of editing, you create a mirror entry with the negated amount. Both the original and the reversal are visible with a "reversed" flag. This keeps the audit trail complete.

**Why reversals, not edits?** Because every transaction needs a who, when, and why. A reversal answer all three: "I reversed Entry 123 on 2026-08-17 at 11:34 because the fuel receipt was dated wrong." An edit would hide that why.

### Period

A calendar month (Jan, Feb, etc.). Periods create themselves automatically when you first post an entry in that month. Periods start OPEN and can be locked by a FINANCE_APPROVER or ADMIN.

### Period lock

A deliberate action: marking a month's figures as final. After lock:
- No new entries can be added to that month
- Existing entries can't be edited or reversed
- The figures are locked for reporting

Reopening a period is possible but requires a reason (audited).

### Late posting

An entry approved after its month was locked. It posts into the current open month but is flagged `is_late_posting` so it doesn't hide the original month's closure.

### Completeness

A flag on a trip or period indicating whether all expected data has been recorded. A trip might close as COMPLETE (everything recorded) or COMPLETE_WITH_EXCEPTIONS (a fuel reading is missing, but that's okay for now). Reports never invent missing values; they show what's actually there.

---

## Data concepts

### Idempotency (safe retry)

A safety mechanism: if you submit the same entry twice by accident (or your network drops and you retry), the second submission is ignored. The system recognizes it by an "idempotency key" (a unique ID for this exact action). Safe to retry — you'll get the original result, not a duplicate.

### Audit trail (command receipt)

Every transaction is logged: who did it, when, what command, what data changed, and why (if a reversal). You can see this trail on entry detail screens. It's permanent and never edited.

### Command

A named, versioned instruction that changes data. Examples: `register-asset.v1`, `record-expense.v1`, `approve-entry.v1`. Every command goes through the same pipeline: auth → authorization → validation → approval rules → database commit. There is no back door.

### Superseded

An older entry that has been corrected or replaced. It's still visible but marked SUPERSEDED, linked to the correcting entry.

---

## Workflow concepts

### Approval queue

The list of entries waiting for your decision (if you're FINANCE_APPROVER or ADMIN). Each row shows amount, category, submitter, and submission date. Entries you submitted yourself appear with a notice: "Your submission — another approver must decide" (you can't approve your own work).

### Four-eyes rule

A core safety feature: the person who recorded an entry cannot approve it, even if they're an admin. An external approver must decide. This prevents individual fraud and enforces accountability.

### Maker ≠ approver

The same rule. The person who makes (records, submits) cannot approve.

---

## Configuration concepts

### Provisioning

The act of creating a new workspace (vendor-only operation, done via CLI). Includes:
- Creating the workspace and its branches
- Adding the first admin user
- Enabling modules (Finance, Activities, Assets)
- Assigning template presets
- Replaying the starter pack (seeded categories, approval defaults)

All in one audited transaction.

### Starter pack

A versioned data file (JSON) that seeds a new workspace with categories and approval defaults for its preset. Applied only at provisioning — never retroactively. Different presets get different starter packs (e.g., trucking comes with fuel-category defaults; passenger comes with ticket-sales defaults).

### Configuration as data

Configuration lives in the database as editable tenant data (categories, approval thresholds, branch names) — not in code. This lets you change thresholds and category names via the app, and every change is audited.

---

## Troubleshooting terms

### Toast

A small pop-up message (usually at the top or bottom of the screen, briefly appearing then disappearing). "Entry posted" or "Error: code already exists" — both are toasts. The app uses green toasts for success and red for errors.

### Modal

A dialog box that overlays the main screen, blocking interaction with the page behind it. Usually for forms (register a truck, approve an entry) or confirmations (delete account?).

### Sidebar

The left navigation panel showing Home, Assets, Activities, Finances, More. On mobile, it collapses to a menu icon.

### Ambient branch switcher

A dropdown in the top header letting you pick which branch you're viewing. Changes the lists on screen, not your actual access — only a display filter.

---

## That's it

If you see a term in the app or documentation that's not explained here, ask in the team chat. This glossary is a living document and grows as you find gaps.
