# How to test

Testing ROUTIQ means following a structured walkthrough, then deliberately trying to break it. This page explains the rhythm and what counts as a finding.

## Before you start

- You have access to two test workspaces: TRUCKING and PASSENGER.
- You have test account credentials (check the pinned team chat).
- You have an English-language UI (switch to English if needed).
- Test data is disposable — you can freely register assets, record trips, and submit entries without worrying about corrupting a shared state.
- **The partner demo workspace is off-limits** — only team members marked as testers may access it.

---

## The test rhythm

Each walkthrough has three parts: **Setup**, **Expected Behavior**, and **Try to Break It**.

### Setup

Read this section to understand what you're testing and what state the test workspace should be in. You might be asked to log in as a specific account (Admin, Entry, or Approver), or to start with a clean slate.

### Expected Behavior

Follow the numbered steps. After each step, compare what you see against the "Expected" box.

**A mismatch is a finding, even if small:**
- Wrong label ("Trucks" instead of "Trucks", or vice versa)
- Missing button or link
- Wrong toast message (the pop-up notification)
- Count off by one (5 trucks shown instead of 4)
- Toast appears when it shouldn't, or doesn't when it should
- Typo or grammar error in English text
- Form field accepting invalid input (negative amount, future date on a past trip)

If French labels appear when you expect English, or English when French is expected, that is a bug.

Do not assume a small issue is "already known" — report it with the exact text and context. Small inconsistencies are how production bugs slip through.

### Try to Break It

Once the happy path works, deliberately deviate. The section suggests specific challenges — hit them hard.

**Examples of things to try:**
- Leave a required field blank and submit the form
- Enter a negative amount where only positives make sense
- Try to approve your own submission (should fail)
- Submit an entry over the approval threshold and watch the queue
- Lock a period that still has pending submissions (should warn, not block)
- Register a truck with a duplicate code (should fail)
- Switch workspaces mid-test (state should persist, or reset cleanly)

**Record what you did and what happened.** If it crashes, freezes, or shows an error message, note the exact error text. If it silently breaks (no error but the action didn't take), that's even more interesting to report.

---

## What to track while testing

- **Device and browser:** iPhone 12 Safari, Pixel 6 Chrome, MacBook desktop Firefox — all are valid. The app is a PWA; report if offline mode behaves differently.
- **Workspace and account:** Always note which workspace (TRUCKING or PASSENGER) and which account (Admin, Entry, or Approver) you were using when you found something.
- **Steps to reproduce:** Explain the exact sequence so someone else can see the same thing. "Click Assets → click the first truck → click Edit" is reproducible; "open the app" is not.
- **Exact text:** If a label says "Ship Truck" when it should say "Assign Truck", report the exact wrong text. Copy-paste from the screen if possible.
- **Screenshot:** Always include a screenshot of the mismatch or error. Blurred sensitive data is fine; blank screenshots are not.

---

## Walkthroughs order

Follow walkthroughs in the order they're published. Early walkthroughs set up data that later ones depend on. If you skip ahead, you might find false positives (things that appear broken because you missed a setup step).

---

## This is not a load test

You don't need to:
- Try to register 1,000 trucks at once
- Hammer the approval button repeatedly
- Leave the app open for 8 hours to test memory leaks
- Test on a phone with 1% battery and no signal

Do report if normal single-user actions (registering one truck, recording one trip, approving one entry) are visibly slow, or if the app crashes on a routine action. But you're testing correctness and UX, not scale.

---

## After you find something

See [Reporting bugs](./reporting-bugs.md).
