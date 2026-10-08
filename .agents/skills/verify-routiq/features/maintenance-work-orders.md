# Maintenance and work orders

Problems reported on a truck become work orders; a work order is opened with an expected cost, then completed with a summary and the real repair cost, which lands as a finance entry linked to the order. A safety-critical problem grounds the truck until its work order is done and the truck is released.

## Sub-features

- `mx-report` reports a problem from the truck ("Signaler un problème" / "Report a problem").
- `mx-open-wo` opens a work order from a problem with a description and expected cost.
- `mx-complete-cost` completes an approved work order with a summary and the repair cost.
- `mx-complete-no-cost` completes with "Aucun coût" / "No cost" or "Facture pas encore reçue" / "Invoice not received yet".
- `mx-release` releases a grounded truck once its safety work is done ("Remettre en service" / "Release to service").
- `mx-list` lists all work orders and problems on `/maintenance`.

## How to get to it (user POV)

- Truck → "Maintenance" tab → problem row "⋯" ("Actions pour …" / "Actions for …") → "Créer un ordre de travail" / "Create work order".
- Truck → "Plus d'actions" / "More actions" → "Toutes les actions" sheet → "Create work order".
- `/maintenance` → "Nouvel ordre de travail" / "New work order".
- Work-order row "⋯" or its record panel footer → "Terminer les travaux" / "Complete work" (only while the order is APPROVED).

## Driving it with pnpm verify

Preconditions:

- Fresh seed. VH003 has the open bodywork problem 99D91608 ("Rear mudguard cracked and loose on its bracket") with no work order, and the approved brake work order 059DC371. Roles allowed: DIRECTOR, ADMIN, TECHNICIAN; approvals: ADMIN, DIRECTOR.

- **Open and complete with cost.** Run `pnpm verify drive flow:work-order --role technician --lang en`. It opens VH003 → Maintenance, clicks the problem's "Actions for …99D91608" menu → "Create work order", fills "Expected cost" = 60000, clicks "Open work order", waits for the toast "Work order opened", closes the record panel with Escape, opens the new order's "Actions for …" menu → "Complete work", fills "Work summary" and "How much did the repair cost?" = 55000, clicks "Declare complete" and waits for "Work completed".
- **Cross-check.** The flow reads `GET /v1/work-orders/<id>` → `COMPLETED`, `actualCostMinor` 55000, `costOutcome` `LINES`. Independently: `pnpm verify api GET '/v1/work-orders?status=COMPLETED' --role maintenance`.
- **Proof.** `01-new-work-order.png`, `02-work-order-opened.png`, `03-complete-with-cost.png`, `04-work-order-completed.png`.
- **Mutates.** Run `pnpm verify up --reseed` before repeating; the problem no longer offers "Create work order" once it has one.

## Gotchas

- Row references are the first 8 characters of the record id, upper-cased (99D91608, 059DC371). Seeded ids are deterministic; new ones are not, so read them from `GET /v1/work-orders?assetId=<id>`.
- After "Open work order" the problem's record panel stays open on top of the tab, sometimes with the closing dialog: press Escape until no dialog is left.
- Locked steps stay visible but disabled with a reason (the creator cannot authorize, the completer cannot sign off, nobody self-releases a safety-critical grounding). A disabled item is the app's rule, not a harness fault.
- "Declare complete" stays disabled until the cost question has a valid answer.
- With the default rules every completion lands COMPLETED; there is no seeded completion awaiting sign-off.
