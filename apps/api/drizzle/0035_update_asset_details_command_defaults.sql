-- Custom SQL migration file, put your code below! --
-- Approval defaults for update-asset-details (#84), for workspaces that predate
-- it. A new workspace gets the same rows from provisioning/packs/core.ts;
-- vehicle-workspace.migration.test.ts holds the two copies together. No
-- matching rule means APPROVAL_REQUIRED, which would 403 every edit.
--
--   update-asset-details: ADMIN, OPS_MANAGER — register-asset's roles.
--
-- No grant changes: routiq_app already holds table-level UPDATE on assets
-- (0004), and the command writes only the descriptive columns.
--
-- Idempotent: NOT EXISTS per workspace, command type and role.
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
    ('update-asset-details', 'ADMIN'),
    ('update-asset-details', 'OPS_MANAGER')
) AS c(command_type, required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = c.command_type
    AND r.required_role = c.required_role
);
