# Trips

Trips (activities) record a truck's journeys: start, legs, meter readings, costs, and close. A trip closed with missing data is marked complete with exceptions instead of being blocked.

## Sub-features

- `trips-list` lists trips with their number, truck, route and status.
- `trips-detail` shows one trip with status "En cours" / "Clôturée" and completeness.
- `trips-record` records a trip sheet ("Saisir une fiche" / "Record a sheet", `/activities/record`).
- `trips-close` closes an open trip ("Clôturer" / "Close") with an optional arrival time and note.
- `trips-from-truck` starts a trip from the truck ("Démarrer un trajet").

## How to get to it (user POV)

- Sidebar "Trajets" / "Trips" (`/activities`).
- Trip number cell → `/activities/<id>`; row "⋯" → "Ouvrir l'activité".
- Truck → "Trajets" / "Trips" tab.

## Driving it with pnpm verify

Preconditions:

- Fresh seed: Douala → Garoua (VH003 + TR001, closed), Douala → Bafoussam (VH001, closed with exceptions), Douala → Yaoundé (VH003, open). Recording and closing: ADMIN, OPS_MANAGER, FIELD_SUBMITTER.

- **List and detail.** Run `pnpm verify drive flow:trips --role manager --lang en`. It reads `GET /v1/activities`, picks a CLOSED trip, clicks "Trips", waits for the "Trips" heading, clicks the button named with the trip number, and waits for `/activities/<id>` with that number as the heading. The cross-check reads `GET /v1/activities/<id>` (for example `CLOSED COMPLETE_WITH_EXCEPTIONS`).
- **Close the open trip.** In a DriveScript, open the Yaoundé trip (status `OPEN` in `GET /v1/activities`), click "Clôturer" / "Close", then "Confirmer la clôture" in the dialog "Clôturer l'activité". Read the trip back as `CLOSED`. Mutates; reseed after. Not yet a committed flow; labels come from `apps/web/src/activities/ActivityActions.tsx`.
- **Proof.** `01-trips-list.png`, `02-trip-detail.png`.

## Gotchas

- The demo uses the trucking words: Trajets/Trips, "N° de trajet" / "Trip no.". The generic "Activités" label appears only in non-trucking workspaces.
- The trips list shows a Base UI `nativeButton` console error from a popover trigger; a known app issue.
- Trip numbers share the `DLA-2026-000NN` pattern with entry numbers; don't mix them up when matching by text.
