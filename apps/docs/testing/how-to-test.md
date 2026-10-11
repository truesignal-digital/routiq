# How to test

**Goal** — Run the whole company story across the six roles, check every boundary between them, and leave the shared workspaces as you found them.

**Log in as** — each role in turn, in the order below. PINs and workspaces are on [Access](/start-here/01-access).

## Before you start

- Read [Accounts and roles](/start-here/02-accounts) and the [Tour](/start-here/03-tour).
- Use **Transports Ngwa** (`transports-ngwa`) for the main run. Repeat the word checks in **Littoral Voyages** (`littoral-voyages`) afterwards.
- Pick a short run code, such as your initials and the hour (`LB-14`). Put it in every truck code, name, counterparty and reason you type. The workspaces are shared and are not reset between testers.
- Use English for the main run.
- Sign out at every handoff. Do not do everything as the Director.
- Put shared settings back after you change them: approval thresholds, the Dashboard summary schedule.

## The run

Follow the [Company flow](/start-here/04-company-flow) story. At each step, also check the boundaries below.

### 1. Director — the starting picture

1. Sign in as `emilienne`. Read the [Dashboard](/daily-work/dashboard). Write down **Revenue**, **Expenses**, **Profit** and **Trucks that can drive** for **This month**.
2. Open each module's **Overview**. Click two tiles on each and check the list matches the tile.

### 2. Administrator — the truck

1. Sign in as `boris`. Follow [Register a truck](/daily-work/trucks/02-register-a-truck) with your run code.
2. Check [The truck page](/daily-work/trucks/03-truck-page): header, tabs, documents.
3. Boundary: Boris has no **Branches** and no **Accounting months** in the sidebar, and no way to approve money.

### 3. Driver — the trip and the problem

1. Sign in as `sali`. Follow [Record a sheet](/daily-work/trips/02-record-a-sheet) on your truck, with fuel and one more expense.
2. Follow [Report a problem](/daily-work/maintenance/02-report-a-problem) on the same truck.
3. Boundary: the Driver sees only their own entries, and has no Money or Maintenance row.

### 4. Technician and Administrator — the repair

1. Sign in as `herve`. Follow [Work orders](/daily-work/maintenance/03-work-orders).
2. Boundary: Hervé lands on Maintenance and never sees revenue, profit or loss on any page.
3. Sign in as `boris`. Release the truck to service. There is no approve step: the work order opened **Approved**. Boundary: the person who completed the work can never release the truck.

### 5. Cashier — the counter

1. Sign in as `clarisse`. Follow [Entries and recording](/daily-work/money/02-entries-and-recording): one expense under 100 000 FCFA, one above.
2. Boundary: the small one posts at once; the large one waits. Clarisse has no **To approve** tab and sees no profit.

### 6. Finance and Director — decisions

1. Sign in as `nadege`. Follow [Approve and reject](/daily-work/money/03-approve-and-reject).
2. Boundary: Nadège cannot decide her own entry, nor one above 1 000 000 FCFA.
3. Sign in as `emilienne` and decide the entry above 1 000 000 FCFA.
4. As `nadege`, follow [Accounting months](/daily-work/money/04-accounting-months), only on a month whose shared test data you understand.

### 7. Company

1. As `emilienne`, run [People and users](/company/people-and-users) and [Branches](/company/branches) with your run code.
2. As `boris` and then `amadou`, run [Company settings](/company/company-settings). Put everything back.

### 8. Director — the final picture

1. Sign in as `emilienne`. Open the Dashboard again.
2. Compare with step 1. Every change must be explained by something you did: the new truck, the approved expenses, the repair. Nothing you rejected may count.

### 9. Passenger company

1. Repeat steps 1 and 3 in `littoral-voyages` with `josiane` and `eric`.
2. Run the word checks in [Passenger company](/presets/passenger-company).

### 10. Phone

Repeat steps 1, 3 and 5 on a phone (or a browser window about 390 pixels wide). Check the bottom bar, tiles two per row, one step per section in long forms, and no sideways scrolling.

## What to look for everywhere

- **Labels.** A label that differs from this handbook is worth a note. A label that is English inside the French app (or the other way round) is a bug.
- **Formats.** Money **450 000 FCFA**. Losses **Loss 86 000 FCFA**. Dates **29 July 2026**. Date fields **dd/mm/yyyy**.
- **Numbers that disagree.** A tile and the list behind it must agree. The same count on two pages (for example **Can drive**) must be the same number.
- **Refusals.** A refusal should say why in plain words. A blank screen, a spinner that never ends, or a code like `FORBIDDEN` is a bug.
- **Lost work.** A long form should keep what you typed if you leave and come back.

## Report it

Report each finding as [Reporting bugs](/testing/reporting-bugs) describes. One finding per message.
