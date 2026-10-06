# Standing brief: speed and evidence

DRAFT. The owner edits this; agents don't.

A session takes this brief only when asked to ("you're on the speed and evidence brief"). Other sessions ignore it.

## What you own

How fast and how trustworthy ROUTIQ feels to the pilot tenants: French-first users on low-end Android phones over intermittent connections. You own:

- finding slow, janky or fragile stretches of the journeys below;
- building the flow, benchmark or count that shows the problem;
- shipping the fix, with a reel as evidence;
- locking the gain in with a ratchet, so it can't quietly come back;
- proposing the next thing to measure.

The goal is for you to run this loop on your own. Today the owner approves every merge and rules on anything a user would notice.

## The journeys

1. A driver records a trip expense on a phone.
2. A cashier records revenue at the branch.
3. Finance opens an entry from the approvals queue and decides it.
4. The director opens Home.

For each journey, measure first, before changing anything: the baseline goes in the PR or issue, then the target. `pnpm verify drive ... --throttle phone` measures it in the lab. The numbers that may gate CI are deterministic ones: first-load bytes (`pnpm metrics`), API requests, layout shifts, console errors, guard counts. Timings on a throttled phone stay in the lab until you have shown they track what users feel.

## The loop

1. Pick a stretch of a journey. Say which number shows it is slow or fragile, and its value today.
2. If no number shows it, build one first: a flow in `tools/verify/flows/`, a count, a test. Prove it moves with what users feel before you optimise against it, and drop it if it doesn't.
3. Fix it. Use several small PRs sized for review rather than one big one.
4. Evidence: a reel (`pnpm verify drive ... --reel`, and `pnpm verify reel --before ...` for before and after) plus the numbers before and after.
5. Lock it: tighten the ratchet in the same PR.
6. Go to the next slow stretch of the same journey. Hitting a target is not the stopping point.

## Be bold inside the guardrails

The guardrails are `pnpm verify`, the guards, the metrics ceilings, an independent review on every PR, and the owner's approval. Because they exist, prefer the bigger fix when it is the right one. Don't pad estimates or park findings as tickets when you could prove and fix them today.

## Ask the owner first

- before raising any ceiling (`pnpm metrics raise` records why; the owner rules on it);
- before any change a user would notice: show it in a reel and let the owner choose;
- before adding a dependency or a build plugin to save a few milliseconds.

## Report

One message per finished loop: the journey, the number before and after, the reel link, and the ratchet you tightened. Lead with the number.
