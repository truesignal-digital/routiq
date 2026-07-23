# 04 — Commission & assign actions with conflict UX

**What to build:** From the assets list/detail, commission a registered asset and assign branch/custodian — carrying rowVersion, and turning VERSION_CONFLICT and APPROVAL_REQUIRED into designed states instead of failures.

**Blocked by:** 01, 03.

**Status:** ready-for-human

- [x] Actions available per lifecycle status (commission only on REGISTERED; assign hidden on SOLD/RETIRED/WRITTEN_OFF) and per role
- [x] Envelope carries the rowVersion the row was rendered with; VERSION_CONFLICT (409) → "modified elsewhere" prompt with reload-and-reapply, never silent overwrite; EXPECTED_VERSION_REQUIRED is unreachable by construction
- [x] Cross-branch assignment shows the APPROVAL_REQUIRED state ("requires approval — coming with the approval flow"), visually distinct from errors; same-branch assign succeeds
- [x] List/detail refreshes to the new rowVersion + status after success
- [x] Component tests: conflict prompt, approval state, status-gated visibility

## Comments

- Done (2026-07-23, web-ui). `AssetActions` on each asset card: commission only on REGISTERED, assign hidden on disposed statuses, nothing at all for EXECUTIVE_VIEWER (role gate short-circuits). Intents thread `expectedVersion: asset.rowVersion` — and `SubmissionCache` now includes options in its fingerprint, so a reloaded rowVersion is a NEW envelope (a stale attempt can never replay; EXPECTED_VERSION_REQUIRED unreachable by construction since every mutation path supplies the version it rendered with).
- Designed states: VERSION_CONFLICT → amber "Modifié ailleurs" prompt with Actualiser (invalidates workspace queries → fresh rowVersion, user re-applies deliberately — never silent overwrite); APPROVAL_REQUIRED → sky-blue `role=status` info panel ("arrives with the approval flow"), deliberately not an alert; other codes → the localized error panel. Success invalidates workspace queries → list shows new status + version.
- Component tests (5, jsdom, injectable client): status gates (REGISTERED/IN_SERVICE/RETIRED/read-only), conflict prompt incl. asserting the envelope carried the rendered rowVersion=4, approval state asserting role=status and no alert.
- Verified live on :5435: commissioned an asset (card flipped to "En service", commission button gone after refetch); cross-branch assign DLA→YDE → "Approbation requise"; row_version bumped via psql behind the UI → same-branch assign → "Modifié ailleurs" → Actualiser cleared it with fresh data. 64 web tests + full suite green.
