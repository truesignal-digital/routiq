-- Custom SQL migration file, put your code below! --
-- Backfill finance command defaults for workspaces that predate these command
-- types. Each insert is independently idempotent so the migration is safe to
-- re-run after a partial application.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT
  w.id,
  'record-revenue',
  NULL,
  NULL,
  NULL,
  rule.amount_max_minor,
  rule.required_role
FROM workspaces w
CROSS JOIN (
  VALUES
    ('FIELD_SUBMITTER', 100000::bigint),
    ('OPS_MANAGER', 100000::bigint),
    ('FINANCE_APPROVER', 100000::bigint),
    ('ADMIN', 100000::bigint),
    ('FINANCE_APPROVER', NULL::bigint),
    ('ADMIN', NULL::bigint)
) AS rule(required_role, amount_max_minor)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules existing
  WHERE existing.workspace_id = w.id
    AND existing.command_type = 'record-revenue'
    AND existing.required_role = rule.required_role
    AND existing.category_code IS NULL
    AND existing.branch_id IS NULL
    AND existing.amount_min_minor IS NULL
    AND existing.amount_max_minor IS NOT DISTINCT FROM rule.amount_max_minor
);

--> statement-breakpoint

INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'approve-entry', NULL, NULL, NULL, NULL, rule.required_role
FROM workspaces w
CROSS JOIN (
  VALUES ('FINANCE_APPROVER'), ('ADMIN')
) AS rule(required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules existing
  WHERE existing.workspace_id = w.id
    AND existing.command_type = 'approve-entry'
    AND existing.required_role = rule.required_role
    AND existing.category_code IS NULL
    AND existing.branch_id IS NULL
    AND existing.amount_min_minor IS NULL
    AND existing.amount_max_minor IS NULL
);

--> statement-breakpoint

INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'reject-entry', NULL, NULL, NULL, NULL, rule.required_role
FROM workspaces w
CROSS JOIN (
  VALUES ('FINANCE_APPROVER'), ('ADMIN')
) AS rule(required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules existing
  WHERE existing.workspace_id = w.id
    AND existing.command_type = 'reject-entry'
    AND existing.required_role = rule.required_role
    AND existing.category_code IS NULL
    AND existing.branch_id IS NULL
    AND existing.amount_min_minor IS NULL
    AND existing.amount_max_minor IS NULL
);

--> statement-breakpoint

INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'reverse-entry', NULL, NULL, NULL, NULL, rule.required_role
FROM workspaces w
CROSS JOIN (
  VALUES ('FINANCE_APPROVER'), ('ADMIN')
) AS rule(required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules existing
  WHERE existing.workspace_id = w.id
    AND existing.command_type = 'reverse-entry'
    AND existing.required_role = rule.required_role
    AND existing.category_code IS NULL
    AND existing.branch_id IS NULL
    AND existing.amount_min_minor IS NULL
    AND existing.amount_max_minor IS NULL
);

--> statement-breakpoint

INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'lock-period', NULL, NULL, NULL, NULL, rule.required_role
FROM workspaces w
CROSS JOIN (
  VALUES ('FINANCE_APPROVER'), ('ADMIN')
) AS rule(required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules existing
  WHERE existing.workspace_id = w.id
    AND existing.command_type = 'lock-period'
    AND existing.required_role = rule.required_role
    AND existing.category_code IS NULL
    AND existing.branch_id IS NULL
    AND existing.amount_min_minor IS NULL
    AND existing.amount_max_minor IS NULL
);

--> statement-breakpoint

INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'reopen-period', NULL, NULL, NULL, NULL, rule.required_role
FROM workspaces w
CROSS JOIN (
  VALUES ('FINANCE_APPROVER'), ('ADMIN')
) AS rule(required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules existing
  WHERE existing.workspace_id = w.id
    AND existing.command_type = 'reopen-period'
    AND existing.required_role = rule.required_role
    AND existing.category_code IS NULL
    AND existing.branch_id IS NULL
    AND existing.amount_min_minor IS NULL
    AND existing.amount_max_minor IS NULL
);
