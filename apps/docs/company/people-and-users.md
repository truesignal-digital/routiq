# People and users

**Goal** — Tell **People** from **Users**, add one of each, and check who may change access.

**Log in as** — the Director (`emilienne`). Then the Administrator (`boris`) and Finance (`nadege`) for the checks. PINs are on [Access](/start-here/01-access).

Two lists, two jobs:

- **People** is everyone the fleet works with: drivers, mechanics, crew. *A person can drive without signing in.*
- **Users** is who can sign in, with which role and in which branches.

A person can have a login, or not. A login can be linked to a person (**Link login**), so trips planned for that person show as theirs.

## Steps

### People

1. Click **People** in the sidebar.

> ✅ Expected: the page **People** with the line *The people your fleet works with: drivers, mechanics and crew. A person can drive without signing in.* Columns **Name**, **Staff number**, **Usual role**, **Status** and **Login**. Jean Ngwa reads **No login**; Sali reads **Sali (sali)**.

![People: Jean Ngwa has no login, Sali and Patrice do](/company/people.png)

2. Look at **Add a person** at the top right while the header shows **All my branches**.

> ✅ Expected: **Add a person** is greyed out. A person belongs to one branch, so pick one first in **Choose a branch** next to it.

3. In **Choose a branch**, pick **Douala**. Click **Add a person**.

> ✅ Expected: a panel **Add a person** with **Full name**, **Usual role** (**Choose a role**) and **Phone**, and the buttons **Cancel** and **Register person**.

![Add a person](/company/add-person.png)

4. Fill **Full name** with your run code (for example `LB-14 Test driver`), pick a usual role, and click **Register person**.

> ✅ Expected: the person appears in the list with **No login**.

5. Open the `⋯` menu on Jean Ngwa's row and choose **Link login**.

> ✅ Expected: a panel **Link login**: *This person signs in with the login you choose. Work planned for them, or with them on the crew, then shows as theirs.* A **Login** list (**Choose a login**). Close it with **Cancel**; do not relink the demo accounts.

### Users

6. Click **Users** in the sidebar.

> ✅ Expected: the page **Users**, *Who can sign in, with which role and in which branches.* Columns **Name**, **Username**, **Role**, **Branches** and **Status**. Every demo account is listed with its role and branches (Amadou: **Administrator**, **Yaoundé**).

![Users](/company/users.png)

7. Click **Add a user**.

> ✅ Expected: a panel **Add a user**: *Create access for a member of your team. Hand them their username and PIN yourself: neither is sent anywhere.* Fields **Full name**, **Login username**, **Role** (**Choose a role**), **Branch scope** (**All branches** ticked), **PIN** and **Confirm PIN**. Buttons **Cancel** and **Add user**.

![Add a user](/company/add-user.png)

8. Add a Driver for Douala only. Pick **Driver** under **Role**. Untick **All branches**: the branch boxes **Bafoussam**, **Douala** and **Yaoundé** appear. Make sure only **Douala** is ticked. Give a PIN you will remember and click **Add user**.

> ✅ Expected: the toast **User added: …** and a new row with **Driver** and **Douala**. Check the **Branches** column says only Douala: unticking **All branches** may leave another branch ticked.

9. Sign out and sign in as the new user.

> ✅ Expected: the user lands on the Driver's short Dashboard. The name at the bottom of the sidebar reads **Driver** with their branch.

10. Back as `emilienne`, open **Users** and the `⋯` menu on your new user's row.

> ✅ Expected: **Change role**, **Reset PIN** and **Deactivate user**.
> - **Change role** offers **Role** and **Branch scope**, saved with **Save role**.
> - **Reset PIN** says *This also unlocks the account and ends their open sessions.*
> - **Deactivate user** says the person *will no longer be able to sign in. Their history is kept and the account can be reactivated.*

11. Choose **Deactivate user** and confirm. Then try to sign in as that user.

> ✅ Expected: the row leaves the list, because the **Status** filter shows **Active only** by default; pick **Include deactivated** to see it again. The sign-in is refused with the same message as a wrong PIN (*Nom d'utilisateur ou code PIN incorrect.* on the French sign-in page).

## Who may do what

| | Director | Administrator | Finance | Others |
| --- | --- | --- | --- | --- |
| See People | ✓ | ✓ | read only | — |
| Add a person | ✓ | ✓ | — | — |
| See Users, add and change logins | ✓ every role but Director | ✓ Driver, Technician, Cashier only | — | — |

## Try to break it

- **Administrator gives too much.** As `boris`, click **Add a user** and open **Role**. Expect only **Driver**, **Technician** and **Cashier**. Try to change Nadège's role. Expect no way to.
- **Change the Director.** As `emilienne`, look for a `⋯` menu on your own row. Expect none: nobody changes the Director's access in the app.
- **Same username twice.** Add a user with the username `sali`. Expect a clear refusal naming the username.
- **PINs that don't match.** Type two different PINs. Expect the form to refuse before saving.
- **Finance edits people.** As `nadege`, open **People**. Expect the list but no **Add a person**.
- **Branch scope.** As `amadou` (Yaoundé), add a person. Expect only Yaoundé to be offered.

## Report it

Use the template in [Reporting bugs](/testing/reporting-bugs).

Next: [Branches](./branches.md)
