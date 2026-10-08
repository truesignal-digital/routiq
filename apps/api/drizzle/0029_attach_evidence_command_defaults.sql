-- Custom SQL migration file, put your code below! --
-- Approval defaults for attach-evidence (#44), for workspaces that predate it.
-- A new workspace gets the same rows from provisioning/packs/core.ts;
-- vehicle-workspace.migration.test.ts holds the two copies together. No
-- matching rule means APPROVAL_REQUIRED, which would 403 every attached receipt.
--
--   attach-evidence: FIELD_SUBMITTER, OPS_MANAGER, FINANCE_APPROVER, ADMIN,
--   MAINTENANCE — record-expense's roles, without its amount band: a file
--   changes no amount, so there is nothing for a threshold to weigh.
--
-- No table changes: evidence is read from the command/artifact links and the
-- audit trail (PLAN §1.7), so this file is the backfill alone.
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
    ('attach-evidence', 'FIELD_SUBMITTER'),
    ('attach-evidence', 'OPS_MANAGER'),
    ('attach-evidence', 'FINANCE_APPROVER'),
    ('attach-evidence', 'ADMIN'),
    ('attach-evidence', 'MAINTENANCE')
) AS c(command_type, required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = c.command_type
    AND r.required_role = c.required_role
);
