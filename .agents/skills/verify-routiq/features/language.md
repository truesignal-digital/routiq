# Language

The app opens in French (fr-CM). A user switches to English on My settings (name menu at the foot of the sidebar → My settings, `/my-settings`; #316). The choice is stored per device in `localStorage["routiq-language"]` and survives reloads, deep links and new tabs (#127).

## Sub-features

- `lang-default-fr` shows French on a first visit with nothing stored.
- `lang-switch-en` switches every visible label to English from My settings.
- `lang-switch-fr` switches back to French.
- `lang-vocabulary` applies the trucking preset words (Camions/Trucks, Trajets/Trips) in both languages.

## How to get to it (user POV)

- Sidebar footer: the name menu (initial, name, role · branch) → "Mes réglages" / "My settings" → section "Langue" / "Language" → buttons "Français" and "English" (the labels are not translated).

## Driving it with pnpm verify

Preconditions:

- Slot up; any role.

- **Default.** Run `pnpm verify login --role director`. The screenshot shows "Accueil", "Camions", "Trajets", "Finances" in the sidebar.
- **Switch to English.** Run `pnpm verify login --role director --lang en`. The step `switch language to English (My settings → English)` passes once the heading "Language" is visible; the home screenshot shows "Home", "Trucks", "Trips", "Finance". `document.documentElement.lang` is `en`.
- **Stay in English.** In a DriveScript after `--lang en`, move with `ctx.nav("/finance/entries")` or clicks. Labels stay English.
- **Reload resets.** In a DriveScript, `await ctx.page.reload()`; the sidebar shows "Accueil" again. This is #127's current behavior, not a harness fault.
- **Proof.** The home screenshot in each language from the `login` run directories.

## Gotchas

- Each drive starts in a fresh browser context, so storage is empty and the app opens in French until `--lang en` switches it.
- Right after the click, the "Français" button can still look selected for a moment; read the state after the next render, not in the same tick.
- English UI and English captions are the rule for walkthrough videos; French is the rule for anything else a Cameroonian user sees first.
