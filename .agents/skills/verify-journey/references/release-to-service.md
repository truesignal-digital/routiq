# release-to-service: run log

Administrateur releases a repaired truck. Phone 390 × 844, throttled. Arranged as `technician`.

## Baseline: current app, main @ ed46e4d7, 2026-10-17

| Screen | Words en / fr | Above the fold | Prose words | Longest block | Primary | Small targets | axe |
|---|---|---|---|---|---|---|---|
| home | 406 / 438 | 164 / 163 | 214 / 229 | 53 / 56 | 0 | 9 | 3 |
| vehicle | 247 / 273 | 111 / 127 | 61 / 76 | 19 / 22 | 1 | 2 / 1 | 2 |
| confirm | 34 / 38 | 34 / 38 | 20 / 22 | 20 / 22 | 1 | 1 | 0 |
| done | 233 / 252 | 114 / 124 | 52 / 65 | 11 / 13 | 0 | 2 / 1 | 2 |

The run took 3 taps and 3.4 s (en) / 3.5 s (fr) from tap to settled, with phone throttling. It's over on words, foldWords, prose, longestBlock, smallTargets and axe (color-contrast, definition-list, dlitem). Evidence: `.verify/2026-10-17T04-50-12Z-drive-s7` (en) and `.verify/2026-10-17T04-50-49Z-drive-s7` (fr). That directory is local and not committed.

## Prototypes A/B/C, `.scratch/prototypes/release-to-service/`, iteration 3

| Variant | Taps | Max words en / fr | Max above fold en / fr | Prose | Primary | Small targets | axe |
|---|---|---|---|---|---|---|---|
| A Checklist | 3 | 46 / 50 | 46 / 50 | 0 | 1 | 0 | 0 |
| B Straight to decision | 2 | 47 / 51 | 47 / 51 | 0 | 1 | 0 | 0 |
| C Repair track | 3 | 46 / 50 | 46 / 50 | 0 | 1 | 0 | 0 |

The worst screen in every variant is Home, which goes over the 40-word fold budget. Whether to show fewer needs above the fold or allow ~50 words is the owner's call. Iterations:
1. Iteration 1 failed axe on the red chip's contrast.
2. Iteration 2 dropped the subtitles from the unrelated rows.
3. Iteration 3 moved the header and bottom bar inside `<main>`, as the app has them, so the chrome words count on both surfaces.

The first-glance read is in [first-glance.md](first-glance.md).
