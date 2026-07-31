# OCC gaps: pin-reset and deactivate/reactivate ignore expectedVersion

Label: ready-for-agent

From the 2026-07-31 adversarial review (finding 6). Only update-member-role
enforces `expectedVersion`; reset-member-pin has none, deactivate/reactivate
bump unconditionally. Concurrent PIN resets are silent last-write-wins;
concurrent deactivate+reactivate double-bump `row_version` and emit duplicate
transition audit events; a role update racing a deactivation records a stale
`beforeState.role` in the audit.

Fix direction: all member mutations accept optional `expectedVersion` per
house style; transition commands (deactivate/reactivate) reject when the
membership is already in the target state instead of re-emitting.

Not a merge blocker: admin-race integrity is protected by the per-workspace
advisory lock added in the same review round; this issue is about clean
versioning semantics and audit fidelity.
