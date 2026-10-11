# Access the test companies

**Goal** — Sign in to a test company as one of its people, and switch the app to English.

Open the app link the team gave you. The public demo is [demo.truesignaldigital.com](https://demo.truesignaldigital.com/). The [October 2026 release](/release-2026-10/) reaches the public demo when it ships; until then it runs on the test build the team gives you.

ROUTIQ asks for three things: the **workspace** (which company), a **username** (which person) and a six-digit **PIN**.

::: danger Disposable public credentials
Every account on this page is public and belongs to a test-only company. There are no real users or real records in these workspaces. Never reuse these PINs anywhere else. This is the only page of the handbook that prints PINs.
:::

## Transports Ngwa (trucking)

Workspace: **`transports-ngwa`**. Branches: Douala, Bafoussam and Yaoundé.

| Person | Username | PIN | Role | Branches |
| --- | --- | --- | --- | --- |
| Émilienne | `emilienne` | `111111` | Director | All |
| Boris | `boris` | `222222` | Administrator | All |
| Amadou Bello | `amadou` | `555555` | Administrator | Yaoundé only |
| Nadège Fotso | `nadege` | `777777` | Finance | All |
| Clarisse Ewane | `clarisse` | `888888` | Cashier | Douala only |
| Hervé Mbarga | `herve` | `666666` | Technician | All |
| Sali | `sali` | `333333` | Driver | All |
| Patrice | `patrice` | `444444` | Driver | Yaoundé only |

## Littoral Voyages (passenger)

Workspace: **`littoral-voyages`**. Branches: Douala and Yaoundé.

| Person | Username | PIN | Role | Branches |
| --- | --- | --- | --- | --- |
| Josiane Ndongo | `josiane` | `101010` | Director | All |
| Paul | `paul` | `202020` | Administrator | All |
| Aline | `aline` | `404040` | Finance | All |
| Grace | `grace` | `606060` | Cashier | Douala only |
| Bertrand | `bertrand` | `505050` | Technician | All |
| Éric Tchoua | `eric` | `303030` | Driver | All |

## Steps

1. Open the app link.

> ✅ Expected: the sign-in page. It is in French until you choose English: **Espace de travail** (workspace), **Nom d'utilisateur** (username), **Code PIN** and the button **Se connecter** (sign in).

![The sign-in page, in French by default](/start-here/login.png)

*The sign-in page asks for the workspace, the username and the PIN.*

2. Type the workspace, the username and the PIN from one row above. Click **Se connecter**.

> ✅ Expected: you land on your role's first page. Most roles land on the **Dashboard**. The Technician lands on **Maintenance**. [Accounts and roles](./02-accounts.md) lists where each role lands.

3. Click your name at the bottom of the sidebar.

> ✅ Expected: a menu with your name, the company name (**Transports Ngwa**), **My settings** and **Sign out**.

![The menu under your name: My settings and Sign out](/start-here/user-menu.png)

4. Click **My settings**. Under **Language**, click **English**.

> ✅ Expected: the whole app switches to English at once. The page also offers **Appearance**: **Light**, **Dark** or **Same as phone**. Your language choice stays on this device after you sign out.

![My settings with Language and Appearance](/start-here/my-settings.png)

5. Look at the top right of the header.

> ✅ Expected: an account with all branches sees **All my branches** and can pick one branch. An account with one branch sees that branch's name (for example **Douala** for Clarisse).

## Use English for the main run

Run each lesson in English first, so the labels match this handbook. Then repeat the word checks in French when the team asks for it.

## Try to break it

- **Wrong PIN.** Type a wrong PIN a few times. Expect a clear refusal each time and no hint about which part was wrong. Repeated wrong PINs lock the login for a while, so copy PINs carefully.
- **Wrong workspace.** Sign in as `emilienne` with workspace `littoral-voyages`. Expect a refusal: usernames belong to one company.
- **Sign out on a shared phone.** Sign out, press the browser's Back button. Expect the sign-in page, not the last screen you saw.

## Report it

Found something wrong? Use the template in [Reporting bugs](/testing/reporting-bugs).

Next: [Accounts and roles](./02-accounts.md)
