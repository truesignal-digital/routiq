# Finance entries and reversal

The entries list shows every financial entry the role may read, with filters kept in the URL. An entry opens in a drawer and then as a full page with its posting lines. A posted entry is corrected by reversing it with a reason; the reversal is a new entry that links back, and the original becomes REVERSED.

## Sub-features

- `fin-list` lists entries with status, direction, period and truck filters (`?status=POSTED` etc.).
- `fin-drawer` opens an entry in a drawer from its number.
- `fin-detail` opens the full-page detail ("Détail de l'écriture" / "Entry detail") with posting lines.
- `fin-reverse` reverses a POSTED entry with a reason and lands on the reversal entry.
- `fin-chain` shows "Extourne l'écriture #…" / "Reverses entry #…" and "Extournée par l'écriture #…" / "Reversed by entry #…".
- `fin-record` records a new entry ("Saisir une écriture" / "Record an entry", `/finance/record`: Entries with the record panel open over it, #296). Flow: `flow:panel-forms --role director` shows every create form in the panel and the discard question.

## How to get to it (user POV)

- Sidebar "Finances" / "Finance" (`/finance/entries`).
- Entry number cell → drawer → "Ouvrir en plein écran" / "Open full screen".
- Row "⋯" ("Actions") → "Ouvrir en plein écran" / "Open full screen", or "Contre-passer" / "Reverse" (FINANCE, DIRECTOR, POSTED entries only).
- Truck → Money tab → entry panel → "Ouvrir l'écriture complète".

## Driving it with pnpm verify

Preconditions:

- Fresh seed: 6 POSTED and 2 SUBMITTED entries (`pnpm verify db "select entry_number, status, amount_minor from financial_entries order by 1"`). Readers (interim): DIRECTOR, ADMIN, FINANCE, DRIVER. Reversers: FINANCE, DIRECTOR.

- **List, drawer, detail.** Run `pnpm verify drive flow:finance-entry --role finance --lang en`. It reads the newest POSTED entry from `GET /v1/finance/entries?status=POSTED`, clicks "Finance", waits for the "Entries" heading, clicks the button named with the entry number, screenshots the drawer, clicks "Open full screen" inside the dialog, and waits for `/finance/entries/<id>` with the heading "Entry detail". The cross-check reads the same entry back.
- **Cancel entry** (the interface word for a reversal, #426). Run `pnpm verify drive flow:reverse-entry --role finance --lang en`. It opens a POSTED entry's detail, clicks "Cancel entry", picks the radio "Wrong details, to record again", submits with the dialog's "Cancel entry", clicks "Record again" in the same dialog, submits the pre-filled "Record expense" form and lands on the new entry. The cross-check reads the original as `REVERSED` with `reversedByEntryId` set and `cancellation.reasonCode` `WRONG_DETAILS`, and the new entry as a plain recording.
- **Fits the card on desktop.** Run `pnpm verify drive flow:desktop-fit`. At 1440 and 1280 px, fr and en, the list must not scroll inside its card and every row's ⋯ must sit inside it (#436). Below 1440 px the list starts without Counterparty; Posting date, the column it is sorted by, stays on screen, and "Affichage" / "View" brings Counterparty back.
- **Cancel from the record panel.** Run `pnpm verify drive flow:cancel-from-panel --role finance --lang en`. It opens a posted trip entry from its number on Money, checks the panel's "Trip DLA-…" link and its Cancel entry button, cancels with "Entered twice" and reads the original back as `REVERSED` (#525).
- **Plain routes.** `pnpm verify ui /finance/entries --role director` screenshots the list in French.
- **Proof.** `01-entries-list.png`, `02-entry-drawer.png`, `03-entry-detail.png`; for reversal `01-reverse-dialog.png`, `02-reversal-entry.png`.

## Gotchas

- Clicking the entry number opens a drawer, not the page. "Ouvrir en plein écran" appears in both the drawer and the row menu; scope to the dialog or the menu.
- "Reverse" is a prefix of "Reverses entry #…" and "Reverse entry", and the page and dialog both have a "Reverse" button while the dialog is open: use `exact: true` and scope to `getByRole("dialog")`.
- French mixes "Contre-passer" (the action) and "Extournée" / "Extourne l'écriture" (status and chain).
- A reversal entry can itself be reversed from the finance pages (#130).
- The list shows Base UI `nativeButton` console errors on load; they are a known app issue, not a harness failure.
- Entry numbers change between reseeds; always look them up.
