# Branch hierarchy and isolation

**Goal** — Prove the difference between company-wide oversight, branch-local authority, and the header's viewing filter.

**Accounts used** — Owner / Admin, Operations Director, both Branch Managers, one Entry Clerk, one Maintenance account, and Finance Controller.

## The two test companies

| Workspace | First branch | Second branch |
| --- | --- | --- |
| `trucking-test` | Douala (`DLA`) | Bafoussam (`BAF`) |
| `passenger-test` | Yaoundé (`YDE`) | Kribi (`KRI`) |

Run the steps in either workspace, substituting its branch names.

## 1. Verify the structure as Admin

1. Sign in as Owner / Admin.
2. Open **More → Branches**.

> ✅ Expected: two active branches. Each row shows an immutable code, name, time zone, and standing.

![Branches table with Yaoundé and Kribi](/branches-list.png)

*A branch code never changes; a branch may be renamed or deactivated without losing history.*

3. Open **More → Users**.

> ✅ Expected: 10 active members. Headquarters jobs show **All branches**. Every local Branch Manager, Entry Clerk, and Maintenance account names exactly one branch.

![Users table showing company-wide and branch-scoped test accounts](/branches-users.png)

*The Users screen exposes both the application role and its server-enforced branch scope.*

Only Admin can manage this structure. The Operations Director may run operations across the company but cannot administer branches or users.

## 2. Compare all-branch oversight with a viewing filter

1. Sign out and sign in as Operations Director.
2. Open the branch switcher in the shell header.

> ✅ Expected: it offers **All my branches** plus both branch names.

3. Select the first branch and inspect Assets and Trips.
4. Return to **All my branches**.

> ✅ Expected: lists widen again. Selecting a branch narrows collections inside the director's existing scope; it does not change the account, role, or authorization.

The same is true for Finance Controller and Executive. Attention badges such as pending approvals still count the account's whole branch scope even when the current list is narrowed.

## 3. Prove local scope

1. Sign in as the first Branch Manager.
2. Open the branch switcher.

> ✅ Expected: only the assigned branch is available. There is no second branch to select and no **All my branches** choice.

3. Search Assets and Trips for a known record belonging to the second branch.

> ✅ Expected: no result. Copying a direct record URL from an all-branch account must not bypass this boundary.

4. Repeat with the first branch's Entry Clerk and Maintenance account.

> ✅ Expected: the visible records remain within the same branch even though the three accounts have different write permissions.

## 4. Hand an asset to the other branch

Use an asset created for your test run.

1. As Operations Director, assign the asset to the second branch.

> ✅ Expected: ROUTIQ shows **Approval required** and does not move the asset.

2. As Finance Controller, repeat the assignment.

> ✅ Expected: the transfer commits and the asset's branch chip changes.

3. Sign in as the original Branch Manager.

> ✅ Expected: the asset is no longer in that manager's scope.

4. Sign in as the receiving Branch Manager.

> ✅ Expected: the asset is now visible and available for new operations.

5. Inspect an earlier trip from before the transfer with an all-branch account.

> ✅ Expected: the historical trip stays booked to its original branch. Moving the asset changes where it operates next; it does not rewrite history.

## Branch administration rules

- Codes are 2–8 uppercase letters or digits and are immutable.
- Names may change but must remain unique inside the workspace.
- Branches are deactivated, never deleted.
- An inactive branch keeps all history but accepts no new operations.
- At least one branch must remain active.
- User scope is an authorization boundary; the ambient branch selector is only a viewing lens.

## Try to break it

- Paste a second-branch asset URL while signed in as first-branch staff. Expect a not-found or permission response, never the record.
- Change a `branch` query parameter manually. Expect it to narrow within scope or be refused; it must never grant the named branch.
- Try to open **More → Users** or **More → Branches** as Operations Director. Expect no administration access.
- Attempt a cross-branch transfer as a Branch Manager or Operations Director, then inspect History. The approval-required attempt must leave no committed assignment event.
- Narrow Finance to one branch while work is pending in both. Expect the queue to disclose that more work exists elsewhere.

Next: [Run the complete company flow](/testing/how-to-test)
