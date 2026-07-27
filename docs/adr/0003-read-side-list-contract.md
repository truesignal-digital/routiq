# One read-side list contract, keyset-paginated

Reads stay CQRS-lite: a list endpoint is a plain SQL view over the write model,
assembled per request. There are no projections, no denormalised read tables and
nothing to rebuild, so a read can never drift from the records the command
pipeline wrote. What the endpoints did lack was a shared shape — finance grew
filters, a base64url cursor and a page size of its own while `/v1/assets`
returned every row unpaginated.

Lists are now keyset-paginated on a stable sort key, never offset. Offset paging
skips and duplicates rows as concurrent commands post entries, and it degrades
on exactly the connections our users have. The cursor is an opaque base64url
payload holding the sort key plus the row id — the id makes the order total, so
a page boundary can never land inside a tie. `apps/api/src/reads/cursor.ts`
encodes and decodes it against a Zod schema: a tampered or stale cursor decodes
to nothing and is answered `400 VALIDATION_FAILED`, not a crash and not a silent
first page.

The envelope is `{ items, nextCursor }`, from `listResponse` in
`packages/contracts/src/reads/list.ts`. `/v1/finance/entries` keeps `entries`
instead of `items` — a documented legacy exception, expressed through the `key`
escape hatch rather than a second schema, to be retired once the web client no
longer reads that key. New resources take `items`; the escape hatch is not for
them.

Filters and list controls are declared per resource and validated by Zod through
`listQuery`, which folds in `sort`, `cursor` and `limit`. A rejected query is
`400 VALIDATION_FAILED` — a stable code, never an English string. `limit` is
bounded server-side (50 by default, 100 maximum) so no client can ask for an
unbounded page, and a resource may only be sorted by fields it explicitly
declares. Tenant and branch scope are not part of this contract at all: every
list read runs inside `inWorkspace` and applies `auth.branchScope`, both derived
from the session exactly as the command envelope derives them. A `branchId`
filter narrows within that scope and can never widen it. (Decided 2026-07-26.)

Amended 2026-07-27: the `entries` legacy exception covers two endpoints, not one
— `/v1/finance/entries` and `/v1/finance/approvals`, which also publishes a
`total` alongside the envelope. Both retire together once the web client stops
reading that key.

Amended 2026-07-27: a cursor now carries the sort that minted it (field and
direction) alongside the key value and row id. Replaying one under a different
sort is answered `400 VALIDATION_FAILED`, same as a tampered cursor — re-sorting
mid-walk would otherwise skip and duplicate rows with no error anywhere.
