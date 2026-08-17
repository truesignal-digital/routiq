# 01 — Create a trip

**Goal** — Record a trip sheet end to end, including its legs, and leave the trip **Open** so the next two lessons can work on it.

**Log in as** — **Entry operator**. This is the role the sheet was designed for. The Admin account works too.

## Where you are

```mermaid
flowchart LR
  A[Register truck] --> B[Create trip]
  B --> C[Record costs]
  C --> D[Approval]
  D --> E[Close trip]
  E --> F[Review history]
  classDef current fill:#f59e0b,stroke:#b45309,color:#111827,stroke-width:2px
  class B current
```

## Before you start

The sheet needs at least one **commissioned** truck (lesson 03) and at least one person registered as crew. If **People** is empty you can create a driver without leaving the sheet — step 7 shows how.

## Steps

1. Click **Trips** in the navigation.

> ✅ Expected: the page header reads **Trips**, with a **Record a sheet** button beside it. An empty workspace shows *No trips yet. Recorded trip sheets will appear here.*

2. Click **Record a sheet**.

> ✅ Expected: the page header reads **Record a sheet** with the line *Work down the paper trip sheet. Anything it does not say can stay empty.* below it. The form is a stack of cards: **References**, **Vehicle and meters**, **Crew**, **Legs**, **Cargo**, **Revenue and expenses**.

> ⚠️ If your workspace has **both** presets enabled you will also see a tab strip at the top with **Journey** and **Haulage job** — pick **Haulage job**, that is the trucking sheet. A trucking-only workspace has no tab strip because there is nothing to choose.

3. In **References**: choose the **Branch**, choose the **Activity type**, and optionally fill **Customer (optional)**, **Client ref. (optional)** and **Notes (optional)**.
4. In **Vehicle and meters**: pick the **Primary truck**, then fill **Departure** and **Arrival** (both are date-and-time fields, and both are required).

> ✅ Expected: the truck dropdown offers trucks from **every** branch you have access to, not only the branch you chose on the sheet — a truck borrowed from another agency is exactly the trip worth recording.

5. Click **Add meter readings** in the same card, then fill **Reading at departure** and **Reading at arrival** with the odometer values from the paper sheet, leaving **Unit** on **Odometer**.
6. Still in **Vehicle and meters**, look at the **Trailer** block. Set an **Asset** and its **Role** if the truck pulled a trailer; leave the row untouched if it did not.
7. In **Crew**: pick a **Person** and their **Role** (Driver, Conductor, Assistant, Relief, Mechanic, Other). If the driver is not in the list, open the person picker and choose **New person**, fill **Full name**, **Usual role** and **Phone**, and click **Register**.

> ✅ Expected: registering from inside the sheet shows a toast **Person registered** and drops the new person straight into the crew row you were filling. Nothing you had already typed on the sheet is lost.

8. In **Legs**: fill the first leg's **From** and **To**, and optionally **Departure time**, **Arrival time**, **Distance (km)** and **Load**. Click **Add a leg** and fill a second one, so the trip has a real route.

> ✅ Expected: each leg row is numbered, and the **Load** dropdown offers **Laden**, **Empty** and **Partial**. The place fields suggest **Known places** as you type and let you enter a **One-off stop** for anywhere not on the list.

9. In **Cargo**: fill **Cargo** and **Weight (kg)**.
10. Leave **Revenue and expenses** empty for now — lesson 02 covers it.
11. Click **Record sheet** (**not** **Record and close**).

> ✅ Expected: a toast **Sheet recorded**, and you land on the new trip's own page. Its header is the generated trip number, with an **Open** status chip. The page shows the overview, the planned-vs-actual timeline, the assets and crew, the **Legs** table with both of your legs, and **Revenue and costs**.

12. Go back to **Trips**.

> ✅ Expected: the trip is in the table with its **Trip no.**, **Open** status, type, **Started** / **Ended**, **Primary truck**, **Legs** count and **Crew** count.

## Try to break it

- **Submit an empty sheet.** Press **Record sheet** with nothing filled. Expect **This field is required.** on **Branch**, **Activity type**, **Primary truck**, **Departure** and **Arrival**, and no request sent. Everything else on the sheet is genuinely optional.
- **Arrive before you depart.** Set **Arrival** earlier than **Departure** and submit. Expect **Arrival must come after departure.** on the **Arrival** field.
- **Half-fill a leg.** Type a **From** but leave **To** empty, then submit. Expect **Give both ends of this leg.** on the empty side. A completely untouched leg row is simply dropped at submit — only a half-described leg is an error, because that is a trip the sheet described and the record would lose.
- **Add a crew row and leave it blank.** Click **Add a crew member**, touch nothing, submit. Expect the sheet to save with only the crew you actually filled in — blank rows never reach the record.
- **Flip the sheet type mid-entry** (only if your workspace enables both presets). Fill the references and crew, then switch **Haulage job** → **Journey** and back. Expect everything shared by both paper sheets to survive; only the flavour-specific fields (**Cargo** / **Weight** versus **Seats sold** / **Seats available**, and the per-leg **Load** versus **Passengers**) are cleared.
- **Record the same sheet twice.** After a successful save, press the browser Back button and press **Record sheet** again on the same form. Expect the retry to replay the original command rather than mint a second trip.

> ⚠️ Note for maintainers: the **Vehicle and meters** card keeps the word *Vehicle* in a trucking workspace — `activities.record.sections.vehicle` is not in either preset overlay (`apps/web/src/i18n/presets/trucking.en.json`), so the canonical wording leaks through on a screen where everything around it says *truck*.

Next: [02 — Record costs](/walkthroughs/activities/02-record-costs)
