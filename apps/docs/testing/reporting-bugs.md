# Reporting bugs

Found a mismatch or unexpected behavior? Report it in the team chat (WhatsApp, Slack, or whatever channel the team is using), not GitHub.

---

## Report template

Copy and paste this template into the team chat. Fill in each field with the exact details.

```
🐞 [lesson/page] [step number]
Did: ...
Expected: ...
Got: ...
Workspace: transports-ngwa | littoral-voyages
Account: username and role, e.g. clarisse (Cashier)
Language: English | French
Device/browser: ...
Screenshot: attach
```

### How to fill each field

- **[lesson/page] [step number]** — Name the lesson or page you were on, and which step if applicable. Example: `[Register a truck] [step 2]` or `[Money → To approve]`. For a finding in the October 2026 release, start with `[October 2026]`.

- **Did:** Describe the exact action you took. Be specific:
  - ✓ "Clicked the 'Register a truck' button on the Trucks page"
  - ✗ "I tried to add a truck"
  
  - ✓ "On Money → To approve, clicked Approve entry on the 450 000 FCFA repair"
  - ✗ "Approved something"

- **Expected:** What should have happened.
  - ✓ "A green toast saying 'Truck registered' should appear, and I should see the new truck in the list"
  - ✗ "It should work"

- **Got:** What actually happened. Be exact, especially for error messages.
  - ✓ "No toast appeared. The truck code field was cleared but the truck did not appear in the list."
  - ✓ "A red error banner appeared saying: 'Code must be unique within this workspace'"
  - ✗ "It didn't work"

- **Workspace:** Use the exact slug: `transports-ngwa` or `littoral-voyages`. Words and data differ by workspace.

- **Account:** The username and role you were using, for example `clarisse (Cashier)` or `amadou (Administrator, Yaoundé)`.

- **Language:** English or French. Many label bugs exist in one language only.

- **Device/browser:** The specific device and browser, plus OS if relevant.
  - ✓ "MacBook Pro, Chrome 130, macOS 15.0"
  - ✓ "iPhone 12, Safari, iOS 18"
  - ✓ "Pixel 6a, Chrome, Android 14"

- **Screenshot:** Attach or link a screenshot showing the mismatch. It should be clear what's wrong at a glance.
  - If you're reporting a missing button, show the screen where it should be.
  - If you're reporting wrong text, show the wrong text circled or highlighted.
  - If you're reporting an error, show the error message.
  - Blur out usernames or data you'd rather keep private.

---

## One bug per message

If you find three separate issues, send three separate messages. This keeps findings easy to track and triage.

---

## Reproducibility

After your initial report, if you can reproduce it a second time, add a follow-up: "Reproduced ✓" (or "Reproduced ✗" if you couldn't). This helps the team prioritize; consistent bugs are higher priority than one-off events.

---

## Examples

### Example 1: Two counts that disagree

```
🐞 [October 2026] [Trucks — Overview]
Did: Opened Trucks. Read the Grounded tile, then opened the Dashboard's To do.
Expected: The same number of days grounded on both.
Got: The Grounded tile says "VH003 · 2 days". The Dashboard To do says "Grounded 3 days".
Workspace: transports-ngwa
Account: emilienne (Director)
Language: English
Device/browser: MacBook Pro, Chrome 130, macOS 15.0
Screenshot: [both screens]
Reproduced ✓
```

### Example 2: Wrong word

```
🐞 [Trucks — Documents tab]
Did: Signed in to transports-ngwa and opened Trucks → Documents.
Expected: The first column says "Truck".
Got: The first column says "Vehicle".
Workspace: transports-ngwa
Account: emilienne (Director)
Language: English
Device/browser: Pixel 6a, Chrome, Android 14
Screenshot: [the table header]
```

### Example 3: A role sees too much

```
🐞 [Accounts and roles] [Try to break it]
Did: Signed in as the Cashier and typed /more/users after the app address.
Expected: A refusal page.
Got: The Users list with every login.
Workspace: transports-ngwa
Account: clarisse (Cashier, Douala)
Language: English
Device/browser: iPhone 14, Safari, iOS 18.1
Screenshot: [the page]
```

(Example 3 is made up to show the format. Examples 1 and 2 were seen on the October 2026 test build.)

---

## Questions?

Ask in the team chat. There are no dumb questions — if something is unclear about how to report or what to look for, ask before spending an hour on it.
