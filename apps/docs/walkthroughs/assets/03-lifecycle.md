# 03 — Lifecycle

**Goal** — Move a truck from **Registered** to **In service**, move it between branches, and see which actions a truck stops offering once it has left the fleet.

**Log in as** — **Admin** for commissioning and for a move within the same branch. You will need the **Finance approver** account for the cross-branch transfer at the end.

## Where you are

```mermaid
flowchart LR
  A[Register truck] --> B[Create trip]
  B --> C[Record costs]
  C --> D[Approval]
  D --> E[Close trip]
  E --> F[Review history]
  classDef current fill:#f59e0b,stroke:#b45309,color:#111827,stroke-width:2px
  class A current
```

## The statuses

A truck's status is fixed by code, not configurable. You will see these six on screen: **Registered**, **In service**, **In maintenance**, **Sold**, **Retired**, **Written off**. The last three mean the truck has left the fleet.

Note that **status is not availability**. A truck being **In service** says it has been commissioned, not that it is free today.

## Steps

1. Open **Trucks** and click the truck from lesson 01. Confirm the chip reads **Registered**.
2. Click **Commission**.

> ✅ Expected: a dialog titled **Commission** with the explanation *Puts the truck into service. Its operating history starts counting from here.* and two buttons, **Cancel** and **Confirm**.

![Commission confirmation dialog for TRK-001](/assets-03-commission-dialog.png)

*Commissioning is a deliberate one-time lifecycle transition.*

3. Click **Confirm**.

> ✅ Expected: a toast **Truck commissioned**. The dialog closes, and the status chip on the record changes to **In service**.

![Truck record after commissioning with In service status](/assets-03-in-service.png)

*After confirmation the truck is In service and Commission is no longer offered.*

4. Look at the header actions again.

> ✅ Expected: **Commission** is gone. Only **Assign** (plus **History**) remains — a truck is commissioned exactly once.

5. Click **Assign**.

> ✅ Expected: a dialog titled **Assign** with the note *Moves the truck to another branch. Records already booked stay with the branch that made them.*, a dropdown labelled **Assign to branch** listing branches as `Name (CODE)`, and **Cancel** / **Confirm**.

![Assign truck dialog with branch selector](/assets-03-assign-dialog.png)

*Assignment changes the truck's current branch without moving prior records.*

6. Choose the branch the truck is **already** in, and click **Confirm**.

> ✅ Expected: a toast **Truck assigned**. A same-branch assignment is an ordinary command that an admin completes on the spot.

![Truck record after a same-branch assignment](/assets-03-same-branch-assigned.png)

*A same-branch assignment completes immediately for an administrator.*

7. Now click **Assign** again and pick a **different** branch. Click **Confirm**.

> ✅ Expected: the dialog does **not** close with a toast. It is replaced in place by a blue notice **Approval required** — *A transfer to another branch needs an approval. That step arrives with the approval flow.* — with a **Close** button. The truck stays in its original branch.

![Approval required notice for a cross-branch assignment](/assets-03-approval-required.png)

*The administrator's cross-branch attempt stops at the Approval required notice.*

8. Sign out. Sign in as the **Finance approver**, open the same truck, click **Assign**, choose the other branch, and click **Confirm**.

> ✅ Expected: this time a toast **Truck assigned**, and the branch chip on the record now shows the new branch. Moving a truck between branches is a finance decision; the finance approver is the only role the seeded rule authorises for it.

![Truck record after the finance approver completes the transfer](/assets-03-cross-branch-complete.png)

*The finance approver completes the cross-branch move and the branch chip updates.*

9. Open **History** on the truck.

> ✅ Expected: **Asset registered**, **Asset commissioned** and one **Asset assigned** row per successful assignment, each stamped with its author. The refused cross-branch attempt from step 7 left no record — it never committed.

![Truck history showing registration, commission, and assignments](/assets-03-history.png)

*History contains only successful lifecycle commands, with the actor for each event.*

## Try to break it

- **Commission twice.** Open the truck in two browser tabs before commissioning. Commission it in tab A, then press **Confirm** in tab B. Expect tab B to swap the dialog for **Modified elsewhere** — *Someone else modified this asset. Refresh, review, then reapply your action.* — with a **Refresh** button. Every lifecycle command carries the row version it was rendered from, so a stale screen can never overwrite a fresh change.
- **Assign to a deactivated branch.** Have an admin deactivate a branch (see **More → Branches**), then try to assign a truck into it. Expect a refusal: a deactivated branch accepts no new arrivals. Moving a truck *out* of a deactivated branch is still allowed — that is the reason branches get deactivated.
- **Cross-branch as the Entry operator.** Sign in as the Entry operator and try **Assign**. Expect the button to be visible but the command to be refused with *Your role does not allow this action.*
- **Look for a way to sell or scrap a truck.** Search the record page and the row `⋯` menu for anything that would set **Sold**, **Retired** or **Written off**. Expect to find nothing — that command is not built in the web app yet. Report it as a gap, not as a bug, if it comes up in testing.
- **Check that a disposed truck offers nothing.** If a truck in your test workspace already sits at **Sold**, **Retired** or **Written off**, open it. Expect **no** action buttons at all: no **Commission**, no **Assign**. A truck that has left the fleet takes no new operational records.

> ⚠️ Note for maintainers: two things to reconcile.
>
> 1. The **Approval required** copy in step 7 says the step "arrives with the approval flow", but there is no queue entry for it — the **Approvals** screen only lists financial entries. The only way to complete a cross-branch transfer today is for a `FINANCE_APPROVER` to perform the assignment themselves (`apps/api/src/provisioning/packs/core.ts`, the `assign-asset` / `CROSS_BRANCH` rule). The wording should say who to ask rather than imply a pending item.
> 2. `docs/business-rules.md` §10 gives `FINANCE_APPROVER` no asset rights at all, while `assign-asset` deliberately lists it in `allowedRoles` for exactly this transfer.

Next: [Create a trip](/walkthroughs/activities/01-create-trip)
