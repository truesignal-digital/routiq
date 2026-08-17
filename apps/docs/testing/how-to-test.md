# Run the company test flow

Test ROUTIQ as a chain of work moving through a company. Use the public accounts, sign out at each handoff, and verify that the next person sees exactly the work intended for them.

## Before you start

- Open the [public demo and credential table](/start-here/01-access).
- Use **Trucking Test** for the primary run; repeat the preset checks in Passenger Test afterward.
- Pick a short run identifier such as your initials plus the hour (`LB-14`) and add it to asset codes, counterparties, and reasons. The workspaces are shared and are not reset between testers.
- Use English for the primary run.
- Keep the partner demo workspace `transports-ngwa` out of this test. Use only `trucking-test` and `passenger-test`.

## Run the handoffs in order

### 1. Owner / Admin — verify the company

1. Sign in as Owner / Admin.
2. Open **More → Branches** and confirm both expected branches are active.
3. Open **More → Users** and confirm the 10 jobs from the [account reference](/start-here/02-accounts).
4. Check that the Operations Director, Finance Controller, Executive, and Admin have all branches; every local manager, clerk, and maintenance account has one.
5. Sign out. Do not create the operating records as Admin.

### 2. First Branch Manager — prepare an asset

1. Sign in as the manager of the first branch: Douala in Trucking or Yaoundé in Passenger.
2. Follow [Register an asset](/walkthroughs/assets/01-register-asset), using your run identifier in the asset code.
3. Follow the commissioning portion of [Lifecycle](/walkthroughs/assets/03-lifecycle).
4. Confirm the branch selector offers only the manager's branch.
5. Sign out and hand the asset code to the local Entry Clerk.

### 3. Entry Clerk — record daily operations

1. Sign in as the clerk for the same branch.
2. Follow [Create a trip](/walkthroughs/activities/01-create-trip).
3. Follow [Record costs](/walkthroughs/activities/02-record-costs): create one expense below the threshold and at least one above it.
4. Confirm the small entry is **Posted** and the larger entry is **Pending**.
5. Leave the trip open, sign out, and hand its number to Maintenance.

### 4. Maintenance — inspect usage and expose the current gap

1. Sign in as Maintenance for the same branch.
2. Find the asset or open trip and inspect its readings and operating history.
3. Confirm the other branch's assets are absent.
4. Confirm general trip creation, finance recording, approvals, and administration are unavailable.
5. Look for **Record reading**. The current expected web result is that it is absent even though the server authorizes the command—this is a known UI gap.
6. Sign out. Return as the Entry Clerk and record the meter reading for this run.

### 5. Entry Clerk and Branch Manager — close and correct

1. Return as the Entry Clerk and finish [Close a trip](/walkthroughs/activities/03-close-trip).
2. Confirm the clerk has no **Reopen** action after closing.
3. Sign in as the Branch Manager and reopen the trip with a reason.
4. Check **History** for the clerk's close and manager's reopen as separate events.
5. Close the trip again and sign out.

### 6. Finance Controller — decide and close

1. Sign in as Finance Controller.
2. Follow [Approve and reject](/walkthroughs/approvals/01-approve-and-reject).
3. Check that pending work from both branches is counted even if the header currently views one branch.
4. Reverse one posted test entry with a reason.
5. Open **Periods** and test a lock or reopen only on a period whose shared test data you understand.
6. Sign out.

### 7. Operations Director and Finance — transfer between branches

1. Sign in as Operations Director and find the test asset using **All my branches**.
2. Attempt to assign it to the second branch. Confirm ROUTIQ answers **Approval required** and leaves the asset in place.
3. Sign in as Finance Controller and perform the same cross-branch assignment. Confirm it commits.
4. Sign in as the first Branch Manager and confirm the transferred asset is no longer visible.
5. Sign in as the second Branch Manager and confirm the asset is now visible there.
6. Confirm the asset's earlier trip still names the original branch.

### 8. Executive — review the result

1. Sign in as Executive.
2. Review the dashboard, asset record, and trip across both branches.
3. Confirm all mutation and administration actions are absent.
4. If you can cause any state change, report it as a permission defect.

### 9. Repeat the terminology layer

Run the shorter [Passenger overlay](/walkthroughs/passenger-overlay) in `passenger-test`. The company responsibilities and permission handoffs must remain the same while Truck becomes Vehicle and the journey form gains passenger-specific fields.

## Test each boundary, not just each screen

For every happy-path action, try the closest forbidden version:

- Entry Clerk attempts asset registration.
- Maintenance confirms the known missing meter-reading control and attempts no general operating or finance capture.
- First-branch staff search for a second-branch asset.
- Finance attempts to approve its own submission.
- Executive looks for any write affordance.
- An all-branch account narrows the header to one branch, then confirms the selector changed the view rather than authorization.

A server refusal is the expected result of a forbidden command. A hidden button is better UX, but authorization must still hold if a request is sent directly.

## Record enough context

Every finding needs:

- Workspace slug and company job—not only the application role.
- Branch shown in the header and the account's authorized branch scope.
- Asset, trip, or entry number carrying your run identifier.
- Exact steps and exact on-screen text.
- Browser/device and a screenshot.
- Expected result and actual result.

See [Reporting bugs](./reporting-bugs.md) for the report format.

## This is not a load test

Do not create hundreds of records, hammer buttons, or try to deny service to the shared demo. Test correctness, handoffs, branch isolation, and ordinary retry behavior. Report routine actions that are visibly slow or crash, but keep the shared environment usable for the next tester.
