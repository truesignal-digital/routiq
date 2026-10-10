-- Administrators change the company settings too (owner decision 2026-10-10,
-- ADR-0013, #711): the approval thresholds (update-approval-threshold) and the
-- Dashboard summary schedule (set-summary-schedule). The handlers now allow
-- ADMIN; without a matching rule its call would meet APPROVAL_REQUIRED. A new
-- workspace gets the same rows from provisioning/packs/core.ts; this gives
-- them to workspaces provisioned before. Workspace-wide rows (no branch, no
-- category, no band), like Direction's: the setting is the company's.
-- Idempotent: NOT EXISTS per workspace and command.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, c.command_type, NULL, NULL, NULL, NULL, 'ADMIN'
FROM workspaces w
CROSS JOIN (
  VALUES ('update-approval-threshold'), ('set-summary-schedule')
) AS c(command_type)
WHERE NOT EXISTS (
  SELECT 1 FROM approval_rules ar
  WHERE ar.workspace_id = w.id
    AND ar.command_type = c.command_type
    AND ar.required_role = 'ADMIN'
    AND ar.category_code IS NULL
    AND ar.branch_id IS NULL
    AND ar.amount_min_minor IS NULL
    AND ar.amount_max_minor IS NULL
);
