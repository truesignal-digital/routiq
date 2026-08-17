# Tour of the app

After logging in, you'll see the ROUTIQ interface organized around a left sidebar navigation. The app adapts its labels to match your workspace's preset — if you're using TRUCKING, you'll see "Trucks" and "Trips"; in PASSENGER, "Vehicles" and "Voyages".

## Login screen

![Screenshot: Login screen](/tour-login.png)

Enter your username and password, then choose a workspace. You're authenticated via email and optional two-factor setup — test accounts skip both for speed.

---

## Dashboard (home)

![Screenshot: Workspace and nav overview](/tour-nav-overview.png)

The Dashboard is your landing page after login. It shows summary cards: trucks (or vehicles) in service, recent trips, and financial summaries. Each card is a quick way to jump into a section. Your branch scope and workspace are visible in the top-right header; a branch selector (if multiple branches are assigned) lets you narrow your view to one location.

The left sidebar holds the main navigation:

- **Home** — Dashboard overview (always visible)
- **Assets** (Trucks or Vehicles) — Fleet registration and lifecycle
- **Activities** (Trips) — Trip records and logs
- **Finances** — Expense and revenue entries, approvals, period locks
- **More** — Settings, user management, branches, language (role-dependent)

---

## Assets list (Trucks or Vehicles)

![Screenshot: Trucks/vehicles list](/tour-assets-list.png)

Click **Assets** (or **Trucks**/**Vehicles**) in the sidebar. You see a table of all assets in your branch scope, with columns for asset code, status (in service, decommissioned), and recent activity.

**What you can do here:**
- Search by asset code or name
- Filter by status
- Click an asset to view its full record and transaction history
- If you're an ADMIN or FIELD_SUBMITTER, register a new asset

Each asset record holds its lifecycle (draft → active → sold/retired), linked expenses, and recent trips.

---

## Activities list (Trips)

![Screenshot: Trips list](/tour-activities-list.png)

Click **Activities** (or **Trips**) in the sidebar. You see a table of all trips, with trip number, assigned truck or vehicle, status, and dates.

**What you can do here:**
- Search by trip number or asset
- Filter by trip type or status
- Click a trip to view details: mileage, fuel consumption, linked expenses, and any missing data flags
- If you have entry permissions, add or edit trip details

Trips move through a lifecycle: draft (open for edit) → closed (finalized but not locked) → locked (immutable).

---

## Approvals queue (Finances)

![Screenshot: Approvals queue](/tour-approvals-queue.png)

Click **Finances** in the sidebar, then select **Approvals**. This page is only visible to FINANCE_APPROVER and ADMIN roles.

You see a list of submitted entries waiting for your decision. Each row shows the amount, category, submitter, and submission date.

**What you can do here:**
- Click an entry to view full details
- Approve it (it posts immediately, if below threshold, or waits for lock)
- Reject it (requires a written reason)
- Reverse an already-approved entry (creates a mirror negative entry, flags the original as REVERSED)

Entries you submitted yourself appear in the queue but with a notice: "Your submission — another approver must decide." You cannot approve your own work.

---

## Finances — Entries

Click **Finances** > **Entries** to see all expense and revenue records in your scope: posted, submitted, and rejected.

Filter by date, category, status, or asset. Click an entry to view details, see the audit trail (who, when, why), and — if applicable — reverse it.

---

## Finances — Periods

Click **Finances** > **Periods** to view monthly financial periods. Each period starts OPEN and can be locked by a FINANCE_APPROVER or ADMIN.

**Why lock a period?**
- Once locked, that month's figures are final and approved entries cannot be added.
- A reopening always requires a reason and is audited.
- Entries approved after a month is locked "late-post" into the open month and are flagged for review.

---

## More menu (Settings)

![Screenshot: Settings and admin menu](/tour-more-menu.png)

Click **More** (three horizontal lines) in the sidebar.

**Admin-only screens (if you're ADMIN):**
- **Users** — add, edit, remove users; assign roles and branch scope
- **Branches** — manage operating locations; deactivate branches (never delete)
- **Settings** — workspace configuration, approval thresholds, language preference

**User screens (all roles):**
- **Profile** — your username and workspace
- **Logout** — sign out

---

## Branch scope and switcher

Your user account is assigned to one or more branches (operating locations). The branch switcher in the top header lets you narrow your current view to one branch, or see the whole scope at once. This is a client-side filter — it doesn't change what you're authorized to see, only what's displayed in lists.

The app calls branches "Agences" in French; they're always English "Branches" in code.

---

## Language switching

Click **Settings** > **Language** (or look for a globe icon in the sidebar footer on some versions). Switch between English and French. French labels come from preset overlays — the domain language stays French-first (fr-CM default).

---

Next: [How to test](../testing/how-to-test.md)
