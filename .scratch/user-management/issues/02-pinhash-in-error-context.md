# pinHash can reach logs/Sentry via Drizzle error messages

Label: ready-for-agent

From the 2026-07-31 adversarial review (finding 9). Add/reset send `pinHash`
as a query parameter; Drizzle 0.45.x embeds query parameters in
`DrizzleQueryError.message`, and the dispatcher logs unexpected errors and
forwards them to Sentry. A salted hash is not plaintext, but credential
material should never sit in error context.

Fix direction: scrub known credential keys (`pin`, `pinHash`, `pin_hash`)
from error messages/metadata at the dispatcher's unexpected-error boundary
before logging — one chokepoint, not per-command hygiene. Aligns with the
ARCHITECTURE.md observability rule: no financial evidence (or credentials) in
logs.
