---
name: verify-journey
description: "Hold a ROUTIQ screen to its user's intent: write the journey (who, goal, device, done-when, budgets), measure the real app and throwaway prototypes with the same code (words, prose, primary actions, small targets, axe, taps), and run a blind first-glance read. Use when designing or redesigning a screen or flow, when comparing prototype variants, when a UI 'explains itself' with text, or before calling UI work done. CLI: pnpm verify drive journey:<id>, pnpm verify measure."
---

# Verify a journey

A screen is good when the person it is for can see what is going on and what to do next, at a glance, on their phone. This skill makes that a bar you can measure. It has three parts:

1. **The journey**, in `tools/verify/journeys/<id>.ts`: one user, one goal, one device, the end state, what a stranger should get from one look, and the budgets. It's the intent screens are built from and the bar they're checked against.
2. **The measure**, in `tools/verify/journey/`: in-page code that counts what a screen asks of its reader. It runs on the real app (`pnpm verify drive journey:<id>`) and on throwaway HTML prototypes (`pnpm verify measure`), so the numbers compare like for like.
3. **The first-glance read**: a fresh agent sees only the first screens, unlabelled, and says what each is for, what state it shows and what to tap. See [references/first-glance.md](references/first-glance.md).

The driving, slots, accounts and evidence rules are [verify-routiq](../verify-routiq/SKILL.md)'s. Read its Launch section and the proof standards under Evidence first.

## Screen rules the budgets enforce

Show the rule; don't write it down.

- **A rule becomes a constraint.** Hide, disable or filter, and don't print a sentence explaining it. For example, notes can't be edited: show no Edit button and a Correct button, not "Notes are never edited".
- **A blocker becomes a checklist with the next action.** Use ticks and crosses with the record they name. Don't write a paragraph about what must happen first.
- **A status is one word, a colour and an icon** (green on track, blue planned, amber waits, red blocked, grey finished).
- **A trend is a number and its change,** not a sentence.
- **A rule that matters appears at the moment of action,** in that dialog, not resting on the page.
- **One filled button per screen:** the actor's next step.

## The loop

This is pstack's Prototype playbook (upstream, not in this repo: cursor/plugins `pstack/skills/poteto-mode/playbooks/prototype.md`), plus a measured baseline and a gate.

1. **Write the journey** before you look at numbers. Copy `tools/verify/journeys/release-to-service.ts`. Set the budgets from the intent: what this user, on this device, should have to read and tap. Don't derive them from a run of the current screen. Set `arrangeAs` to the account the drive starts as, to arrange preconditions through the UI or real commands. It is often not the actor: whoever completed a repair may not release it. The `drive` export calls `assertStartedAs(ctx, journey)` first, so a wrong `--role` fails at once with the right command. It then measures every screen the user passes through, with `run.screen(label, caption)` after each `run.tap(locator)`, and ends with an API read that proves done-when.
2. **Baseline the current app.**
   ```bash
   pnpm verify up --slot N                      # verify-routiq Launch; --reseed between mutating runs
   pnpm verify drive journey:<id> --slot N --role <journey.arrangeAs> --viewport 390x844 --throttle phone --lang fr
   ```
   The runner refuses a drive whose viewport or throttle differ from the journey's device, and the report states the conditions it ran on. Run it in fr and en, since French runs longer. The run writes `journey.md` (verdict, budget table, per-screen numbers, the five longest prose blocks per screen, other findings) and `journey.json` into the drive's evidence directory. A journey over budget throws at the end. The drive then prints `FAIL script … over budget (the bar, not a crash)` and saves a `failed-script` screenshot of the last screen, and it exits 1. On the current app that is expected, and the report is the baseline.
3. **Prototype variants** in `.scratch/prototypes/<id>/index.html`. This is throwaway: vanilla HTML, the app's tokens, real seed data, no framework. Build 2–4 structurally different variants behind one switcher. Rules for the file so it can be measured:
   - URL params pick the variant, state and language (`?v=A&s=ready&lang=fr`). `?bare=1` hides the switcher.
   - Mirror the app shell: the header, the content and the bottom bar all sit inside one `<main>`, as `AppShell` does. Otherwise the prototype gets its chrome words for free.
   - The switcher carries `data-measure-ignore`. Only `measure` honours it. On the app, the attribute fails the drive.
   - Each view names itself with `data-screen="<label>"`. Use the journey's screen labels where they match.
   - The tap path is marked in order: `data-step="1"`, `"2"`, … on the element the user taps next. The measure follows it and counts taps.
   - Cover the states that change the screen (ready, blocked by something else, done), not only the happy path.
4. **Measure them with the same code.**
   ```bash
   P=.scratch/prototypes/<id>/index.html
   pnpm verify measure "$P?bare=1&v=A&s=ready&lang=fr" "$P?bare=1&v=B&s=ready&lang=fr" --journey <id>
   ```
   This writes `compare.md` (one row per target) plus per-target `journey.md` and screenshots under `.verify/<time>-measure/`. `measure` opens files, so it takes no `--slot`. Seconds aren't measured on prototypes, and their reports leave that budget out. Iterate on the prototype until it passes, or until a budget turns out to be a real tradeoff. If so, **stop and ask the owner**. Don't loosen a budget to pass.
5. **Run the first-glance read** on the first screen of each variant and of the current app, following [references/first-glance.md](references/first-glance.md). Compare each answer with the journey's `firstGlance`.
6. **Present** a table (taps, max words, words above the fold, prose, primary actions, small targets, axe, first-glance sureness and next action) with screenshots, the tradeoffs, and a recommendation. The owner picks. The real build then follows the normal feature path. When it lands, `pnpm verify drive journey:<id>` passing is the gate, and its reel is the PR evidence.

## What the numbers mean

| Metric | Measured as | Known limits |
|---|---|---|
| words | Visible words in the open dialog, else `<main>`, else `<body>`. Toasts (`aria-modal=false`) don't count as a dialog. Labels and data both count; scrolled-away content counts too. `.sr-only`, `aria-hidden` and SVG text don't count | Data values count as words; that's deliberate, a screen full of numbers is heavy too. Chart labels drawn in SVG aren't counted. An open popover with role=dialog becomes the root |
| foldWords | Words in blocks on screen when the measure runs, fixed bars and sheets included | The scroll position at measure time; screens are measured at the top unless the drive scrolled |
| proseWords / longestBlock | Text grouped by its nearest block-level element; inline links and buttons belong to their sentence. A block of 8+ words is prose: a sentence the user has to read. The report quotes the five longest per screen | A standalone inline button next to loose text in a plain block merges with that text |
| primaryActions | Visible interactive elements with a dark fill (luminance < 0.3, opaque) and light text; the pointer moves away first, so hover doesn't fade a button | Light mode only; the drive and measure force `colorScheme: light` |
| smallTargets | Interactive elements under 44 px (viewport < 768 px) or 24 px; a target displayed inline inside a sentence (8+ words) is exempt (WCAG 2.5.8) | Small links in data rows count, as they should on a phone |
| axe | axe-core 4.14 on the same root, WCAG 2.0–2.2 A/AA tags; serious + critical count against the budget | Color contrast needs real rendering; it works in both drive and measure |
| taps | `run.tap()` calls on the app; `data-step` clicks on prototypes | Typing isn't counted; a form journey should budget fields separately |
| seconds | The sum of each `tap()` until the next screen's API traffic is quiet (or, for a final tap, until the drive calls `finish()`), on the app only. The measuring and screenshots are left out | Lab numbers; quote n. Time on `pnpm verify up --built`: the dev server's unbundled loads are several times slower |

`measureScreen(page, label)` is exported from `tools/verify/journey/measure.ts` for any DriveScript that wants one screen's numbers without a full journey.

## Anti-shortcuts

- Don't edit a budget, the measure code or a baseline to make a screen pass. If the bar looks wrong, say so and ask.
- Don't put `data-measure-ignore`, `aria-hidden` or off-screen tricks on product UI to hide words from the count.
- The first-glance reader never sees the answer key, the variant names or the words test, eval or judge.
- A prototype that passes isn't the product. Only the real build passing `journey:<id>` on the app counts.

## Journeys

| Journey | Actor | Device | Status |
|---|---|---|---|
| `release-to-service` | Administrateur releases a repaired truck; arranged as `technician` | phone 390×844, throttled | Baseline and prototype numbers: [references/release-to-service.md](references/release-to-service.md). Prototypes A/B/C in `.scratch/prototypes/release-to-service/` |
| `director-checks-month` | Direction reads the month on the Dashboard, then Profit by truck | desktop 1440×900 | Rebuilt 2026-10-17: every budget passes (words 459→229, fold 269→133, prose 220→9, axe 4→0) |
| `admin-clears-today` | Administrateur starts on the first To do row from a phone | phone 390×844, throttled | Rebuilt 2026-10-17: all pass but foldWords 99/50 (was 163); 2.0–2.1 s to the record on `up --built` (12.3 s on the dev server) |

## Cleanup

`pnpm verify down --slot N` (verify-routiq Cleanup). Evidence under `.verify/` stays. Prototypes stay in `.scratch/` until the owner has picked. Then capture the chosen one per the `prototype` skill's rule 6 and delete the rest.
