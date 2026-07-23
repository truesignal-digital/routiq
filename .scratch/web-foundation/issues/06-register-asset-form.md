# 06 — RegisterAsset form

**What to build:** The walking skeleton closes its loop: an asset manager fills the RegisterAsset form on their phone — category from their company's presets, identifier, capacity, template-specific fields — submits through the command client, watches the true submission state (sending → confirmed, or rejected with a precise French message), and sees the new asset appear in the list. Retrying after a network failure never creates a duplicate (same idempotency key, §5.3 replay all the way to the UI).

**Blocked by:** 03 — Command client; 05 — Asset list; spine 07 — Asset lifecycle: categories + presets (`.scratch/spine/issues/07-asset-lifecycle-commands.md`).

**Implementation note:** run in a git worktree; touches `apps/web` (+ category read view in `apps/api` if spine 07 didn't expose one — new route file).

- [x] Form uses React Hook Form + the shared Zod RegisterAsset contract — client validation and server schema are the same schema
- [x] Category select populated from the workspace's seeded presets (bilingual labels per active locale); template-specific `custom_values` fields render per the selected category's template field list
- [x] Submission goes through the command client only; no fetch in the form
- [x] In-flight state visible per ADR-0001 (`submitting` indicator; `committed` → navigate/confirm; `rejected` → French message from the `errors.*` namespace, form values preserved)
- [x] Duplicate retry proven: submit, kill the network mid-flight, retry — exactly one asset exists
- [x] On commit: asset list query invalidated and refetched — no cache patching
- [x] Whole flow usable one-handed at 360px width; French labels don't overflow

## Comments

- Implemented (2026-07-23, branch `web-ui`). RHF + `zodResolver(registerAssetPayload)` — the shared contract IS the client validation (`z.input`/`z.output` split for the `.default()` fields); zod's built-in fr/en locale packs wired to the app language, so client-side validation speaks French by default. Category + branch selects come from a new `GET /v1/reference/asset-registration` read view (workspace-scoped, branch-visibility filtered); template-specific fields render from `TEMPLATE_FIELDS` — a contracts ADDITION mirroring the backend validator's list. Submission rides the command client via a `SubmissionCache`: unchanged payload → same submission (same idempotency key), edited payload → fresh one; in-flight state read from the ADR-0001 status store; commit → assets query invalidated (workspace-scoped key) → navigate to list.
- Verified live end-to-end in a browser: guard → login → returned to `/assets/new`; empty submit → French zod messages; **duplicate-retry proof: filled form, killed the API mid-submit (rejected banner), restarted, resubmitted — exactly one `DLA-T-003` row in Postgres**; list shows the new Iveco after invalidation; template switch to PASSENGER_TRANSPORT renders `seatCount*`/`lineType`; 360px no overflow. Full suite 120 tests green.
- Relay to backend: (1) `TEMPLATE_FIELDS` now lives in contracts (`src/templates.ts`) as the client mirror of `apps/api/src/commands/templates.ts` — please adopt the contracts module as the single source. (2) reference read route is registered from inside `reads/assets.ts` to avoid touching `server.ts` — a `reads/index.ts` entry point wired once in server.ts would clean this up. (3) Via dev proxy, a dead API surfaces as 500→`COMMAND_FAILED` rather than `NETWORK_ERROR` (proxy swallows the connection failure) — cosmetic in dev, correct cross-origin in prod.
- Zod's default French messages are technical ("Trop petit : chaîne doit avoir >=1 caractères") — acceptable now; per-field friendly messages can land with the E2E polish pass.
- Follow-up applied (post-review, 2026-07-23): client-side template-field validation — `templateFieldIssues` in contracts (pure mirror of the server validator, 5 unit tests) layered onto the resolver via `superRefine`, inline localized errors under each template field; server `TEMPLATE_FIELD_INVALID` metadata (missingRequired/wrongType/unknownKeys) now maps onto fields via `setError`. Verified live: PASSENGER_TRANSPORT without seatCount → inline "Ce champ est obligatoire." pre-network; filled → bus registered with `{"seatCount": 70}`.
