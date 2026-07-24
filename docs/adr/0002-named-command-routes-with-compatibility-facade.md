# Named command routes with a compatibility facade

Canonical writes use `POST /v1/commands/:name` with
`{ version, envelope, payload }`. The URL identifies the command while the
existing dispatcher remains the only write pipeline.

The earlier spine implementation exposed generic `POST /v1/commands` with
`{ name, version, envelope, payload }`. That route remains temporarily as a
compatibility facade over the same dispatcher, so existing offline envelopes
and integrations are not broken during migration.

The web command client uses the named route. New clients and documentation must
not adopt the compatibility route. Removing the facade requires a separately
planned compatibility decision after deployed clients have migrated.

This resolves the implementation drift from `ARCHITECTURE.md` §2 without
duplicating handlers, authorization, idempotency, approval, or transaction
logic. (Decided 2026-07-23.)
