-- Custom SQL migration file, put your code below! --
-- Backfill the maintenance-command approval defaults for workspaces that predate
-- these command types. Without this backfill, existing tenants would meet the new
-- commands with no matching approval rule — and no matching rule means APPROVAL_REQUIRED
-- (the safe default), which would reject every command from non-ADMIN roles.
--
-- Default rules per provisioning/packs/core.ts Phase 2a:
--   report-issue: ADMIN, OPS_MANAGER, FIELD_SUBMITTER, MAINTENANCE
--   create-work-order, complete-work-order, cancel-work-order: ADMIN, OPS_MANAGER, MAINTENANCE
--   release-asset-to-service: ADMIN, OPS_MANAGER
--
-- Idempotent: the NOT EXISTS is per workspace and command type, so re-running
-- after a partial application adds nothing.

INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT
  w.id,
  c.command_type,
  NULL,
  NULL,
  NULL,
  NULL,
  c.required_role
FROM workspaces w
CROSS JOIN (
  VALUES
    ('report-issue', 'ADMIN'),
    ('report-issue', 'OPS_MANAGER'),
    ('report-issue', 'FIELD_SUBMITTER'),
    ('report-issue', 'MAINTENANCE'),
    ('create-work-order', 'ADMIN'),
    ('create-work-order', 'OPS_MANAGER'),
    ('create-work-order', 'MAINTENANCE'),
    ('complete-work-order', 'ADMIN'),
    ('complete-work-order', 'OPS_MANAGER'),
    ('complete-work-order', 'MAINTENANCE'),
    ('cancel-work-order', 'ADMIN'),
    ('cancel-work-order', 'OPS_MANAGER'),
    ('cancel-work-order', 'MAINTENANCE'),
    ('release-asset-to-service', 'ADMIN'),
    ('release-asset-to-service', 'OPS_MANAGER')
) AS c(command_type, required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = c.command_type
    AND r.required_role = c.required_role
);
