# First-glance read

A stand-in for the five-second test with a real user. It catches screens that read as something else ("a profit overview" when the user came to release a truck) and screens where no next action stands out. It is advisory: a real driver or clerk on their own phone outranks it.

## Prepare

1. Take the first screen the actor sees on each surface: the current app (the drive's `frames/NN-<label>.png`, already one viewport) and each prototype variant (`.verify/<time>-measure/<target>/01-<label>.png`). Add the decision screen too when it differs from the first.
2. Crop every image to one viewport, `sips --cropOffset 0 0 -c 844 390 <file>` (macOS), so nobody gets to scroll.
3. Copy them into a fresh directory as `S1.png … Sn.png` in shuffled order. Write the key (which S is which) **outside** that directory.

## Ask

Spawn a fresh subagent (a Claude model; Sonnet is enough, as this is a stand-in reader, not a reviewer) with no other context and this prompt, adjusted to the journey's actor:

> You manage a branch of a trucking company in Douala. You're busy; you pick up your phone between other jobs. Look at these phone screenshots, one at a time: <absolute paths>. Open each with the Read tool. Read nothing else: no other files, no searching. Treat each screen as if you only had about five seconds with it. Answer from your first impression and don't study the details.
>
> For each screen, give:
> 1. Purpose: what is this screen for, in under 10 words?
> 2. State: what's going on with the trucks or the truck shown, in under 15 words?
> 3. Next action: what would you tap next, and why, in under 15 words? Say "nothing obvious" if no clear next action comes to mind.
> 4. Sure: how sure are you of 1–3, from 1 (guessing) to 5 (certain)?
> 5. Effort: what did you have to read to get there? Name the specific words or areas. Did anything slow you down or compete for your attention?
>
> Reply as a table with one row per screen, then at most three sentences on anything that confused you. Don't suggest changes.

Never tell the reader what is being compared, which screens are prototypes, or that this is a test.

## Score

Against the journey's `firstGlance`:

- **Purpose** matches → pass. Read as something else → fail.
- **Next action** names the journey's next step → pass. "Nothing obvious" or another action → fail.
- **Sure** ≥ 4 on the decision screen.
- Quote the **Effort** column. What competed for attention is the redesign input.

## 2026-10-17, release-to-service (English, 390 × 844)

| Screen | Purpose read | Next action | Sure |
|---|---|---|---|
| current Home | "Profit overview for the month" | **nothing obvious** | 3 |
| current vehicle | full detail page for VH003 | Release to service | 4, "felt busy" |
| A vehicle (Checklist) | VH003 status and release step | Release to service | **5**, "nothing competing" |
| B Home (decide from Home) | things needing my attention | Release on the VH003 row | 4, other rows compete |
| C vehicle (Repair track) | VH003 status and release step | Release to service | 4, unclear whether "Back on the road" is done or waiting |
| prototype Home (A/C) | things needing my attention | the VH003 row | 3, rows look alike, unclear what a tap does |
