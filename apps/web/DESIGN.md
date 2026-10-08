# ROUTIQ design system

The visual rules every screen follows. Where a rule has a guard, its id is in brackets and `pnpm lint` fails on a new violation (`tools/guards/rules.ts`, ratchet in `tools/guards/baselines.json`). Everything else is reviewed by eye.

The direction behind these rules, with mockups, is in [`docs/design/consistency/README.md`](../../docs/design/consistency/README.md). The owners chose the neutral theme on 2026-10-04 (decision 1 in `choices.html`), so the brand pass's navy tokens are not used.

## Colour

Every colour is a token in `src/styles.css`, defined under `:root` and again under `.dark`. Components use the token classes (`bg-primary`, `text-muted-foreground`, `fill-chart-1`) or `var(--token)`, never a hex value, `rgb()`, `hsl()` or `oklch()` [DS-2], and never a raw Tailwind palette shade such as `bg-red-500` (`src/palette.test.ts`).

| Token | Use |
|---|---|
| `--background` / `--foreground` | The page: pure white and near-black in light, inverted in dark |
| `--primary` | Primary buttons and strong text |
| `--muted` / `--muted-foreground` | Quiet surfaces and secondary text |
| `--border` / `--input` / `--ring` | Lines, field outlines, the focus ring |
| `--success` `--warning` `--info` `--destructive` `--signal` | Status only, never decoration |
| `--chart-1` … `--chart-5` | Chart series, in order |
| `--sidebar-*` | The navigation rail |

Neutrals are pure greys (chroma 0). Cream or warm off-white backgrounds are out.

The only other file that holds colour values is `src/lib/theme.ts`: it mirrors `--background` for `<meta name="theme-color">`, which cannot read a CSS variable.

## Type

- Faces come from the system, so nothing downloads: `--font-sans` for text, `--font-heading` for titles.
- Figures (money, counts, record numbers such as `DLA-2026-00008`, codes) use `tabular-nums` in the sans face. Never `font-mono`. [DS-1]
- Labels, eyebrows and badges are sentence case, rendered as the catalog writes them. No `uppercase` class or `text-transform`. A code the user types in capitals is capitalised in the value, not by CSS. [DS-4]
- Page title: through `PageHeader`.

## Layout

- **Pages:** `PageHeader` owns the title, an optional one-sentence description and the actions. `PageContainer` owns the gutters and width: `narrow` for forms, `default` for reading, `wide` for lists and workspaces.
- **Tables:** `DataTable` only (see `apps/web/AGENTS.md`).
- **Touch:** 44 px targets on phones [H13].

## Deliberately not used

Pill-shaped buttons, numbered "01 / 02" section labels, monospace labels, italic accent words in headings, decorative gradients on content surfaces, cream backgrounds.
