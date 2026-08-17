# Test accounts

Three personas are available in each test workspace: an owner/admin who configures the system, an entry operator who captures daily data, and a finance approver who reviews high-value submissions. Credentials for all accounts are in the pinned team chat message.

## Admin (workspace owner)

**Role code:** ADMIN

**Represents:** A workspace owner or system administrator who manages workspace configuration.

**Can do:**
- Provision and configure branches (locations)
- Add, edit, and remove users
- Assign roles and branch access to users
- View the entire workspace's data regardless of branch scope
- Create, approve, and reject financial entries and corrections
- Lock and reopen financial periods
- Access admin settings and configuration screens

**Cannot do:**
- Approve their own submissions (the system rejects this with "requires another approver")

**Use this account for:** Admin lessons and configuration walkthroughs.

---

## Entry operator (day-to-day capture)

**Role code:** FIELD_SUBMITTER

**Represents:** A field operator or office clerk who records assets, trips, fuel receipts, maintenance costs, and other business transactions.

**Can do:**
- Record trips and trip details (mileage, fuel, time)
- Submit expense and revenue entries
- Search and view the workspace's assets and activities
- See only branches assigned to this user

**Cannot do:**
- Register or commission trucks/vehicles — the server allows only ADMIN and OPS_MANAGER (the button may still be visible; hitting the refusal is a known finding — see the register-asset walkthrough)
- Approve any submission, even their own (approval always goes to FINANCE_APPROVER or ADMIN)
- Access admin settings or user management
- Lock or reopen financial periods
- Reverse or correct approved entries

**Use this account for:** Day-to-day capture walkthroughs and field operator workflows.

---

## Finance approver

**Role code:** FINANCE_APPROVER

**Represents:** A finance manager or controller who reviews submitted entries and decides whether to approve or reject them.

**Can do:**
- View the approval queue showing submitted entries waiting for a decision
- Approve or reject entries (rejected entries require a written reason)
- Reverse or correct approved entries (marked as REVERSED, linked to the original)
- Lock and reopen financial periods with audit reasons
- Create, approve, and reject financial entries and corrections
- See only branches assigned to this user

**Cannot do:**
- Approve their own submissions (the system enforces "four-eyes" — another approver must decide)
- Register assets or record trips (entry-capture is restricted to FIELD_SUBMITTER and ADMIN)
- Access admin settings or user management

**Use this account for:** Approval workflows and finance review walkthroughs.

---

## Selecting a test account

1. From the login screen, enter the username and password.
2. Choose your workspace (TRUCKING or PASSENGER).
3. You log in with that account's role and branch scope already active.

Each account has full access to its workspace's data within its assigned branches. If a test account is scoped to a single branch, it will only see data from that branch.

---

Next: [Tour of the app](./03-tour.md)
