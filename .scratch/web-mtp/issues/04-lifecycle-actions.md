# 04 — Commission & assign actions with conflict UX

**What to build:** From the assets list/detail, commission a registered asset and assign branch/custodian — carrying rowVersion, and turning VERSION_CONFLICT and APPROVAL_REQUIRED into designed states instead of failures.

**Blocked by:** 01, 03.

**Status:** ready-for-agent

- [ ] Actions available per lifecycle status (commission only on REGISTERED; assign hidden on SOLD/RETIRED/WRITTEN_OFF) and per role
- [ ] Envelope carries the rowVersion the row was rendered with; VERSION_CONFLICT (409) → "modified elsewhere" prompt with reload-and-reapply, never silent overwrite; EXPECTED_VERSION_REQUIRED is unreachable by construction
- [ ] Cross-branch assignment shows the APPROVAL_REQUIRED state ("requires approval — coming with the approval flow"), visually distinct from errors; same-branch assign succeeds
- [ ] List/detail refreshes to the new rowVersion + status after success
- [ ] Component tests: conflict prompt, approval state, status-gated visibility
