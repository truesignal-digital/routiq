# Vehicle workspace

A user opens a truck from the trucks list and works from one page: what needs doing now, maintenance, money, trips, documents, history and the editable details. Tabs are URL path segments under `/assets/<assetId>`.

## Sub-features

- `trucks-list` lists trucks with search ("Code, plaque ou modèle…") and opens one by its code.
- `ws-now` shows the identity strip (code, plate, home branch), the grounded banner, To do, Needs attention, the month's money and Recent.
- `ws-maintenance` lists work orders, new problems and done items (see [maintenance-work-orders.md](./maintenance-work-orders.md)).
- `ws-money` shows the month's entries for the truck with period arrows and filter chips.
- `ws-trips` lists the truck's trips.
- `ws-documents` lists current documents with their expiry state.
- `ws-history` shows the event history with filter chips ("Afficher les événements").
- `ws-details` shows the details and lets DIRECTOR or ADMIN edit make, model, acquisition date and amount.
- `ws-record-panel` opens any record in a side panel through `?panel=<kind>:<uuid>`.

## How to get to it (user POV)

- Sidebar "Camions" / "Trucks" → row button with the truck code (for example "VH003").
- Trucks list row "⋯" ("Actions") → "Ouvrir la fiche" / "Open asset record".
- Tabs in the navigation "Sections du véhicule" / "Vehicle sections": "Vue d'ensemble"/"Overview", "Maintenance", "Argent"/"Money", "Trajets"/"Trips", "Documents", "Historique"/"History", "Détails"/"Details".

## Driving it with pnpm verify

Preconditions:

- Fresh seed. VH003 (plate LT 482 AB) is grounded by "Brake pressure warning on the Kekem descent" with an approved brake work order, has an open bodywork problem, an expired technical inspection and insurance expiring in 12 days.

- **List and every tab.** Run `pnpm verify drive flow:vehicle-workspace --role admin --lang en`. It clicks "Trucks", the "VH003" button, then each tab by `getByRole("tab", { name: /^Maintenance/ })` and so on, waits for the URL to end in `/maintenance`, `/money`, `/trips`, `/documents`, `/history`, `/details`, and screenshots each. The cross-check reads `GET /v1/assets/<id>` → `VH003`, plate `LT 482 AB`, `IN_SERVICE`.
- **Add note (the command-form hook, #290).** Run `pnpm verify drive flow:add-note --role manager --lang en` (add `--viewport 390x844` for the phone sheet). It opens VH003 → "More actions" (phone: "More") → "Add note", submits empty and expects the summary region "1 thing to fix" / "1 point à corriger", clicks its link and waits for focus in the Note field, adds a note and reads it back from `GET /v1/assets/<id>/history`. Mutates; `--reseed` between runs if you count notes.
- **Log fuel (field kit, Quick entry, #292).** Run `pnpm verify drive flow:log-fuel --role driver --lang en` (add `--viewport 390x844` for the phone sheet). It opens VH003 → "Log fuel", waits for focus in "Amount paid" (the first empty required field), submits empty and expects "1 thing to fix" / "1 point à corriger", fills 45,000, a reading 412 km over the last one and the Station in the optional fold, saves, and reads the FUEL entry back from `GET /v1/finance/entries?assetId=` and the reading from `GET /v1/assets/<id>`. Mutates; `--reseed` before each run.
- **Role differences.** Run the same flow with `--role cashier` (the header shows "Consultation seule" / "View only" instead of action buttons, and To do becomes "À surveiller") and `--role technician` (the flow logs `tab Argent is not offered to this role`).
- **Edit details.** Run `pnpm verify drive flow:edit-details --role admin --lang en`. It clicks "Edit details" (French "Modifier"), fills "Make" = `Mercedes-Benz` and "Model" = `Actros 2640`, clicks "Save", and reads `GET /v1/assets/<id>` back with those values. Mutates; reseed after.
- **Money for a past month.** In a DriveScript, `ctx.nav("/assets/<id>/money?period=2026-07")`. The Garoua trip's fuel, tolls and allowance are in July 2026. Not yet a committed flow.
- **Proof.** `02-vh003-now.png` through `08-vh003-details.png` in the run directory.

## Gotchas

- Tab names carry hidden counters ("6 choses à faire", "Vous attend"), so match them with a prefix regex, not an exact name.
- The first tab is "Overview" / "Vue d'ensemble" at `/assets/$assetId` (#90). Its To do block comes first, open by default, and collapses to its count; the choice is kept per browser.
- Record panels are dialogs. After an action that opens one, close it with Escape before reaching for the tab underneath, and scope locators with `getByRole("dialog", { name })`.
- `patrice` sees "Ce véhicule n'existe pas ou n'est pas dans vos agences." for every seeded truck (YDE scope).
- The Money tab defaults to the current month; seeded July entries need `?period=2026-07`.
