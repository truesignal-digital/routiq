# Company settings

**Goal** — Change the approval thresholds and the Dashboard summary schedule, as the Director and as an Administrator, and check that everyone else is told.

**Log in as** — the Administrator (`boris` or `amadou`), then the Director (`emilienne`). Use the Cashier (`clarisse`) or Technician (`herve`) to see the notice. PINs are on [Access](/start-here/01-access).

::: tip New in October 2026
Administrators can now change Company settings, not only the Director. It is the whole company's rule, whatever branches the Administrator has.
:::

## Steps

1. Sign in as `boris`. Click **Company settings** in the sidebar.

> ✅ Expected: the page **Company settings**, *Rules that apply to everyone in the company. Only the Director and Administrators can change them.* Two sections:
> - **Approvals** with **Change approval thresholds**: *Up to 100 000 FCFA: posts directly · Up to 1 000 000 FCFA: Finance approves · Above 1 000 000 FCFA: the Director approves.* Under it, **What each role's own entries meet**, one block per role. *Nobody approves their own entry, and the Director's own entries always post.*
> - **Dashboard summary** with **Change Dashboard summary**: *When the summary shows on the Dashboard and every Overview. It also shows when something big changes, except under Never.* The current choice, for example **Every Monday and on the 1st of the month**, *Each person can still close it.*

![Company settings: Approvals, what each role's own entries meet, Dashboard summary](/company/company-settings.png)

### Dashboard summary

2. Click **Change Dashboard summary**.

> ✅ Expected: a panel *Applies to everyone in the company, from the next visit on.* **Now** shows the current choice. **Show the summary** offers **Every Monday and on the 1st of the month**, **Every Monday**, **On the 1st of the month only** and **Never: tiles only**. Buttons **Cancel** and **Save**.

![Change Dashboard summary](/company/summary-form.png)

3. Pick **Every Monday** and click **Save**.

> ✅ Expected: the toast **Dashboard summary saved**, and the section now reads **Every Monday**.

![Saved: the section reads Every Monday](/company/summary-saved.png)

4. Put it back to **Every Monday and on the 1st of the month**.

> ✅ Expected: saved again. Other testers depend on the default.

### Approval thresholds

5. Click **Change approval thresholds**.

> ✅ Expected: a panel *Applies to every branch, from the next entry on.* Two amounts in FCFA: **Posts directly up to** (*Entries up to this amount post without review.*) and **Finance approves up to** (*Above the first amount and up to this one, Finance decides. Above it, only the Director decides.*). **Save thresholds** stays greyed out until you change an amount (*Change an amount to save.*). The panel warns who will see the new rules on their next screen.

![Change approval thresholds](/company/thresholds-form.png)

6. Change **Posts directly up to** to `150 000` and click **Save thresholds**.

> ✅ Expected: the **Approvals** box shows *Up to 150 000 FCFA: posts directly*, and a line under it names who changed the rules and when, for example *Boris changed them on 11 October 2026.* Every role's block moves too.

7. Sign out and sign in as `clarisse`.

> ✅ Expected: a notice **The approval rules have changed**, naming who changed them and when, with her new rules under **Your expenses** and **Your revenue**, and a **Got it** button. It shows on her next screen and stays until she clicks **Got it**.

![The notice another member sees after the rules change](/company/approval-rules-notice.png)

8. Sign back in as `boris` and put **Posts directly up to** back to `100 000`.

> ✅ Expected: saved. The demo story depends on 100 000 FCFA.

## Who may do what

| | Director | Administrator | Others |
| --- | --- | --- | --- |
| See Company settings | ✓ | ✓ | — |
| Change approval thresholds | ✓ | ✓ | — |
| Change the Dashboard summary | ✓ | ✓ | — |

## Try to break it

- **One-branch Administrator.** As `amadou` (Yaoundé only), change a threshold. Expect it to apply to the whole company, not only Yaoundé, and to name Amadou as the one who changed it.
- **Thresholds the wrong way round.** Set **Posts directly up to** above **Finance approves up to**. Expect a refusal before saving.
- **Zero or empty.** Clear an amount, or type `0` or letters. Expect the form to refuse.
- **No access.** As `nadege` and `clarisse`, type `/more/company` after the app address. Expect a refusal page and no **Company settings** row in the sidebar.
- **Never.** Choose **Never: tiles only**. Expect no summary on the Dashboard or any Overview, even when something big changes; the "Counted: …" line still shows. Put it back afterwards.
- **Notice once.** As `clarisse`, click **Got it**, then reload. Expect the notice gone for good, until the rules change again.

## Report it

Use the template in [Reporting bugs](/testing/reporting-bugs). Always put the settings back after a test: the workspaces are shared.

Next: [Passenger company](/presets/passenger-company)
