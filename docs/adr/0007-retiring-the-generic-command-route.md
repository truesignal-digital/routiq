# Retiring the generic command route

ADR-0002 kept `POST /v1/commands` (name in the body) as a temporary facade over
the dispatcher and asked for a separate decision before removing it. This is
that decision.

The web client already uses the named route. The remaining callers are inside
this repository: API tests, `apps/api/src/test/seed.ts` and
`apps/api/scripts/smoke.ts`. Tests are what agents copy, so while they use the
facade, new code keeps adopting it.

1. **Stop the spread now.** The guard suite (#62) counts every `"/v1/commands"`
   literal outside the route itself (`A18 named-command-routes`); the count may
   only go down.
2. **Move every in-repo caller** to `POST /v1/commands/:name`, starting with
   the smoke script and the shared test seed, until the `A18` baseline is 0.
3. **Measure outside callers.** Once the baseline is 0, the facade logs each
   call with its origin. Offline outboxes, provisioning runs and box scripts
   outside this repository show up there.
4. **Delete the facade** after two weeks with no logged calls on the demo box,
   together with its tests.

A deployed client that still needs the generic shape after that point gets a
named route of its own, not a revived facade. (Decided 2026-09-25, trust
audit D10.)
