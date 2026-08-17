# Accounts and responsibilities

ROUTIQ authorizes a person with two values: a fixed application **role** and a **branch scope**. A company job is the business meaning testers give that combination.

For example, the Operations Director and a Branch Manager both hold `OPS_MANAGER`. The director has every branch in scope; the manager has one. The header branch selector narrows what an all-branch user is viewing—it never grants access.

## Company jobs at a glance

| Company job | Application role | Scope | Primary responsibility |
| --- | --- | --- | --- |
| Owner / Admin | `ADMIN` | All | Govern configuration, branches, and users |
| Operations Director | `OPS_MANAGER` | All | Supervise company-wide assets and operations |
| Branch Manager | `OPS_MANAGER` | One branch | Run one branch and handle operational exceptions |
| Entry Clerk | `FIELD_SUBMITTER` | One branch | Capture daily trips, documents, revenue, and costs |
| Maintenance | `MAINTENANCE` | One branch | Record meter readings and inspect local operating history |
| Finance Controller | `FINANCE_APPROVER` | All | Decide money movements and close financial periods |
| Executive | `EXECUTIVE_VIEWER` | All | Review company performance without changing records |

The [quick-login page](./01-access.md) provides one account for every job in both test companies.

## Owner / Admin

**Role:** `ADMIN` · **Scope:** all branches

The owner/admin governs ROUTIQ rather than performing every company task personally.

**Can:**

- Create, rename, deactivate, and reactivate branches.
- Add members and assign their roles and branch scopes.
- Configure categories, templates, and the approval threshold.
- Perform operational and finance commands when necessary.
- Approve, reject, reverse, lock, and reopen financial records.

**Cannot:** approve an entry they created themselves. ROUTIQ enforces maker ≠ approver even for Admin.

**Testing job:** verify the company structure first, then hand operational work to the appropriate manager.

## Operations Director and Branch Managers

**Role:** `OPS_MANAGER`

The role is shared because both jobs manage operations. Scope creates the difference:

- The **Operations Director** has all branches, can use **All my branches**, and coordinates transfers or exceptions across the company.
- A **Branch Manager** has one branch and can operate only on assets, people, and activities belonging to that branch.

**Can:**

- Register people and assets, commission assets, and assign them.
- Create, record, and close activities.
- Reopen a closed activity with an audited reason.
- Add or renew asset documents.
- Record financial entries, which still follow approval thresholds.

**Cannot:** manage branches or user accounts, approve financial entries, reverse ledger entries, or lock periods.

**Testing handoff:** the Branch Manager prepares the branch for daily capture; the Operations Director intervenes only when work crosses branches or needs company-wide oversight.

## Entry Clerk

**Role:** `FIELD_SUBMITTER` · **Scope:** one branch

The clerk or dispatcher captures facts produced by daily operations.

**Can:**

- Create and close trips and record legs, crew, meter readings, revenue, and costs.
- Add and renew asset documents.
- Search and read assets and activities in the assigned branch.
- Submit financial entries; small amounts post immediately and larger ones wait for Finance.

**Cannot:**

- Register or commission assets—the server restricts those actions to Admin and Operations Manager.
- Reopen a closed trip.
- Approve, reject, reverse, or lock financial records.
- Read another branch's records.

The current UI may still show an asset-registration action to this role; submitting it must be refused. The asset walkthrough treats that mismatch as a deliberate permission test.

## Maintenance

**Role:** `MAINTENANCE` · **Scope:** one branch

This account represents a mechanic, workshop recorder, or maintenance clerk.

**Intended job:** inspect local operational history and record odometer or hour-meter readings against an asset.

**Cannot:** register assets, create or close trips, record general finance entries, approve money, or manage the company.

::: warning Current web gap
The server authorizes `MAINTENANCE` for `record-meter-reading`, but the current web app hides **Record reading** together with the other activity capture controls. Today this account tests branch-scoped operational visibility and confirms that known missing affordance. The Entry Clerk records the reading in the UI until the maintenance control is separated. Work orders, parts, and repair scheduling are also not implemented yet.
:::

## Finance Controller

**Role:** `FINANCE_APPROVER` · **Scope:** all branches

Finance is a company-wide control function and receives work from both branch teams.

**Can:**

- Record financial entries.
- Approve or reject submitted entries from another maker.
- Reverse posted entries with a reason.
- Lock and reopen monthly financial periods.
- Complete approval-controlled cross-branch asset transfers.

**Cannot:** approve their own submission, register assets, run trips, or manage users and branches.

**Testing handoff:** Entry Clerks create financial facts; Finance decides only the entries that require judgment and then closes the reporting period.

## Executive

**Role:** `EXECUTIVE_VIEWER` · **Scope:** all branches

The executive is deliberately read-only.

**Can:** review dashboards, assets, activities, and operating history across both branches.

**Cannot:** submit any command. Mutation buttons should be absent, and a direct command attempt must be refused by the server.

**Testing job:** inspect the final state produced by the operating and finance teams, then confirm there is no way to change it.

Next: [Tour of the app](./03-tour.md)
