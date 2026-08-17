# Access the public test company

Open [demo.truesignaldigital.com](https://demo.truesignaldigital.com/) in your browser. ROUTIQ asks for three things: the workspace slug, a username, and a six-digit PIN.

::: danger Disposable public credentials
Every credential on this page is public and belongs to a test-only company. There are no real users or production records in these workspaces. Do not reuse these PINs anywhere else. The accounts must be removed or receive private PINs before real-user onboarding.
:::

## Trucking Test

Use workspace slug **`trucking-test`**. Its branches are Douala (`DLA`) and Bafoussam (`BAF`).

| Company job | Username | PIN | Branch access |
| --- | --- | --- | --- |
| Owner / Admin | `admin@trucking.test` | `111111` | All branches |
| Operations Director | `ops@trucking.test` | `121212` | All branches |
| Douala Branch Manager | `manager.douala@trucking.test` | `131313` | Douala only |
| Bafoussam Branch Manager | `manager.bafoussam@trucking.test` | `141414` | Bafoussam only |
| Douala Entry Clerk | `entry@trucking.test` | `222222` | Douala only |
| Bafoussam Entry Clerk | `entry.bafoussam@trucking.test` | `232323` | Bafoussam only |
| Douala Maintenance | `maintenance.douala@trucking.test` | `242424` | Douala only |
| Bafoussam Maintenance | `maintenance.bafoussam@trucking.test` | `252525` | Bafoussam only |
| Finance Controller | `approver@trucking.test` | `333333` | All branches |
| Executive | `executive@trucking.test` | `343434` | All branches |

## Passenger Test

Use workspace slug **`passenger-test`**. Its branches are Yaoundé (`YDE`) and Kribi (`KRI`).

| Company job | Username | PIN | Branch access |
| --- | --- | --- | --- |
| Owner / Admin | `admin@passenger.test` | `444444` | All branches |
| Operations Director | `ops@passenger.test` | `454545` | All branches |
| Yaoundé Branch Manager | `manager.yaounde@passenger.test` | `464646` | Yaoundé only |
| Kribi Branch Manager | `manager.kribi@passenger.test` | `474747` | Kribi only |
| Yaoundé Entry Clerk | `entry@passenger.test` | `555555` | Yaoundé only |
| Kribi Entry Clerk | `entry.kribi@passenger.test` | `565656` | Kribi only |
| Yaoundé Maintenance | `maintenance.yaounde@passenger.test` | `575757` | Yaoundé only |
| Kribi Maintenance | `maintenance.kribi@passenger.test` | `585858` | Kribi only |
| Finance Controller | `approver@passenger.test` | `666666` | All branches |
| Executive | `executive@passenger.test` | `676767` | All branches |

## Sign in

1. Open the demo URL.
2. Enter the exact **Workspace**, **Username**, and **PIN** from one row above.
3. Select **Sign in**.
4. Confirm that the branch switcher matches the account: an all-branch account offers both branches, while a local account offers only its assigned branch.

![ROUTIQ login screen with workspace, username, and PIN fields](/login.png)

*The workspace slug selects the test company; the username and PIN select the job inside it.*

ROUTIQ has no email confirmation or two-factor setup in this test environment. Five incorrect PIN attempts temporarily lock a login, so copy the PIN exactly.

## Pick the account for the work

Start with **Trucking Test** unless a walkthrough says Passenger Test. Change accounts when the company flow hands work to another person—do not use Admin for every step simply because it has broader access.

The [account and role reference](./02-accounts.md) explains what each person represents. The [company flow](./04-company-flow.md) shows when to hand work from one account to another.

## Use English for the primary run

The app supports English and French. Run each walkthrough in English first so its labels match this handbook, then repeat terminology checks in French when requested. Change the language under **More → Language**.

![More screen with English and French language controls](/start-03-more-menu.png)

Next: [Accounts and responsibilities](./02-accounts.md)
