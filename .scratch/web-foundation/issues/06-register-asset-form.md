# 06 — RegisterAsset form

**What to build:** The walking skeleton closes its loop: an asset manager fills the RegisterAsset form on their phone — category from their company's presets, identifier, capacity, template-specific fields — submits through the command client, watches the true submission state (sending → confirmed, or rejected with a precise French message), and sees the new asset appear in the list. Retrying after a network failure never creates a duplicate (same idempotency key, §5.3 replay all the way to the UI).

**Blocked by:** 03 — Command client; 05 — Asset list; spine 07 — Asset lifecycle: categories + presets (`.scratch/spine/issues/07-asset-lifecycle-commands.md`).

**Implementation note:** run in a git worktree; touches `apps/web` (+ category read view in `apps/api` if spine 07 didn't expose one — new route file).

- [ ] Form uses React Hook Form + the shared Zod RegisterAsset contract — client validation and server schema are the same schema
- [ ] Category select populated from the workspace's seeded presets (bilingual labels per active locale); template-specific `custom_values` fields render per the selected category's template field list
- [ ] Submission goes through the command client only; no fetch in the form
- [ ] In-flight state visible per ADR-0001 (`submitting` indicator; `committed` → navigate/confirm; `rejected` → French message from the `errors.*` namespace, form values preserved)
- [ ] Duplicate retry proven: submit, kill the network mid-flight, retry — exactly one asset exists
- [ ] On commit: asset list query invalidated and refetched — no cache patching
- [ ] Whole flow usable one-handed at 360px width; French labels don't overflow
