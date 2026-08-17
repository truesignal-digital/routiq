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
Workspace: TRUCKING | PASSENGER
Account: Admin | Entry | Approver
Device/browser: ...
Screenshot: attach
```

### How to fill each field

- **[lesson/page] [step number]** — Name the walkthrough or page you were on, and which step if applicable. Example: `[Register a truck] [step 2]` or `[Approvals queue] [check queue]`.

- **Did:** Describe the exact action you took. Be specific:
  - ✓ "Clicked the green 'Register truck' button on the Assets page"
  - ✗ "I tried to add a truck"
  
  - ✓ "Entered '50000' in the Expense Amount field and clicked Submit"
  - ✗ "Submitted an expense"

- **Expected:** What should have happened.
  - ✓ "A green toast saying 'Truck registered' should appear, and I should see the new truck in the list"
  - ✗ "It should work"

- **Got:** What actually happened. Be exact, especially for error messages.
  - ✓ "No toast appeared. The truck code field was cleared but the truck did not appear in the list."
  - ✓ "A red error banner appeared saying: 'Code must be unique within this workspace'"
  - ✗ "It didn't work"

- **Workspace:** Say which test workspace: TRUCKING or PASSENGER. (This matters because terminology changes.)

- **Account:** Which account you were logged in as: Admin, Entry, or Approver.

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

### Example 1: Missing toast

```
🐞 [Register a truck] [step 3]
Did: Entered "ABC123" in the Truck Code field, entered "My Truck" in the Name field, and clicked the Register button.
Expected: A green toast saying "Truck registered" should appear at the top of the screen.
Got: No toast appeared. I see the truck in the list immediately without confirmation.
Workspace: TRUCKING
Account: Entry
Device/browser: MacBook Pro, Chrome 129, macOS 15.0
Screenshot: [screenshot showing the truck list with no toast visible]
Reproduced ✓
```

### Example 2: Wrong label

```
🐞 [Assets page]
Did: Logged in as Entry account to TRUCKING workspace and opened the Assets page.
Expected: The navigation item should say "Trucks".
Got: The navigation item says "Vehicles".
Workspace: TRUCKING
Account: Entry
Device/browser: Pixel 6a, Chrome, Android 14
Screenshot: [screenshot showing sidebar with "Vehicles" label]
```

### Example 3: Validation bypass

```
🐞 [Record a trip] [step 5]
Did: Opened a trip record, left the "Trip Type" field blank, and clicked Save.
Expected: The form should show "Trip Type is required" and prevent submission.
Got: The form saved and the trip shows with an empty Trip Type.
Workspace: PASSENGER
Account: Entry
Device/browser: iPhone 14, Safari, iOS 18.1
Screenshot: [screenshot showing trip with empty Trip Type field]
```

---

## Questions?

Ask in the team chat. There are no dumb questions — if something is unclear about how to report or what to look for, ask before spending an hour on it.
