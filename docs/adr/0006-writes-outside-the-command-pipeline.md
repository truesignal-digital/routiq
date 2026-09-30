# Writes outside the command pipeline

Every business write goes through a registered command (`ARCHITECTURE.md` §1,
§5), which gives it a receipt, an audit event and one transaction. Two paths
wrote to the database without a command, and neither was written down, so the
next route that needed to store something had a precedent to copy.

**Authentication state is the one sanctioned exception.** Sessions and
credentials (`apps/api/src/auth/local.ts`: session insert, PIN lockout
counters) are how the server decides who is calling, not business records.
They are written before any actor exists to stamp a command with, and a login
attempt must not produce an audit event per keystroke. They stay outside the
pipeline.

**Artifact registration is not an exception.** The upload route inserts the
`source_artifacts` row directly (`apps/api/src/artifacts/routes.ts`). Evidence
files back financial and legal records, so their registration needs a receipt
and an audit event like any other fact. It moves into a `register-artifact`
command once the maintenance work that rewrites that route (#44) has landed;
until then the guard suite (#62) counts it as a known violation (`A16` baseline 1)
that may only go down.

No other adapter, script or route may insert, update or delete business rows
directly. The guard `A16 writes-through-commands` in `tools/guards` (#62) enforces the allowlist:
command handlers, provisioning, schema setup, test fixtures and
`auth/local.ts`. Adding to that allowlist requires amending this record.
(Decided 2026-09-25, trust audit D5.)
