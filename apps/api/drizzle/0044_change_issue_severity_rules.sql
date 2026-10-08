-- Approval defaults for change-issue-severity (#96), for workspaces that
-- predate it (a new workspace gets the same rows from provisioning/packs/core.ts).
-- No matching rule means APPROVAL_REQUIRED, which would 403 every change.
-- Every role that reports problems may run it; the handler keeps lowering to
-- DIRECTOR and ADMIN. Idempotent: NOT EXISTS per workspace and role.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'change-issue-severity', NULL, NULL, NULL, NULL, r.required_role
FROM workspaces w
CROSS JOIN (
  VALUES ('DIRECTOR'), ('ADMIN'), ('TECHNICIAN'), ('DRIVER')
) AS r(required_role)
WHERE NOT EXISTS (
  SELECT 1 FROM approval_rules ar
  WHERE ar.workspace_id = w.id
    AND ar.command_type = 'change-issue-severity'
    AND ar.required_role = r.required_role
);

--> statement-breakpoint

-- The safety-critical mark may now change while the problem is OPEN (#96), as
-- a level-1 edit (ADR-0008): change-issue-severity updates the column and its
-- audit event keeps the value before. Everything else the report says (what
-- was seen, on which vehicle, when) still never moves, so the grant stays
-- column-level, as in 0027.
GRANT UPDATE (safety_critical) ON operational_issues TO routiq_app;
