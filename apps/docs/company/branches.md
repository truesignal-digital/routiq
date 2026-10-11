# Branches

**Goal** — Create, rename and deactivate a branch, and check that a branch code never changes.

**Log in as** — the Director (`emilienne`). Only the Director sees **Branches**. PINs are on [Access](/start-here/01-access).

A branch is a site: a depot or an office. Every truck, trip, person and money entry belongs to one branch. Branches are deactivated, never deleted, so history stays whole.

## Steps

1. Click **Branches** in the sidebar.

> ✅ Expected: the page **Branches**, *Branches group vehicles, people and money by site. Each user sees the branches they are given.* Columns **Code**, **Name**, **Time zone** and **Status**. Transports Ngwa has **BAF** Bafoussam, **DLA** Douala and **YDE** Yaoundé, all **Active**, all in **Africa/Douala**.

![Branches](/company/branches.png)

2. Click **Create a branch**.

> ✅ Expected: a panel **Create a branch**: *It becomes available in the forms and in user scope straight away.* Fields **Code** (*The code appears in record numbers and cannot change.*), **Name** and **Time zone** (**Africa/Douala**). Buttons **Cancel** and **Create branch**.

![Create a branch](/company/create-branch.png)

3. Create a branch with a short code from your run (for example `T14`) and a name. Click **Create branch**.

> ✅ Expected: the branch appears in the list as **Active**. Open the header branch picker: the new branch is there. Open **Users → Add a user**: it is offered under **Branch scope**.

4. Open the `⋯` menu on your branch and choose **Rename branch**.

> ✅ Expected: *New name for "…". The code stays as it is.* The **Code** is shown but cannot be changed. Rename it and save.

5. Open the `⋯` menu again and choose **Deactivate branch**.

> ✅ Expected: *No new operation will be able to target "…". Existing records and history are kept.* After **Deactivate branch**, the row shows the new status and the branch is no longer offered in new forms.

## Try to break it

- **Duplicate code.** Create a branch with code `DLA`. Expect a refusal.
- **Duplicate name.** Create a branch named `Douala` with a new code. Expect a refusal: names identify a branch within a company.
- **Use a deactivated branch.** After step 5, try to register a truck or record an entry in it. Expect it not to be offered.
- **Administrator.** As `boris`, type `/more/branches` after the app address. Expect a refusal page.
- **Record numbers.** Record something in your new branch before deactivating it. Its number should start with your branch code (for example `T14-2026-00001`).

## Report it

Use the template in [Reporting bugs](/testing/reporting-bugs). Do not deactivate Douala, Bafoussam or Yaoundé: other testers use them.

Next: [Company settings](./company-settings.md)
