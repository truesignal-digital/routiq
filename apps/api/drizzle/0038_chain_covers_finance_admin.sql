-- The approval chain covers Finance and the Administrateur (#412, owner
-- decision 2026-10-05). Their own entries above the recording band now wait
-- for a decision like everyone else's; only Direction's post at any amount.
-- provisioning/packs/core.ts gives a new workspace the same rules.
--
-- 1. record-expense and record-revenue: FINANCE's and ADMIN's unfiltered,
--    unbounded catalog rule goes. Catalog means no command created it (seeded
--    before provisioning was a command) or provision-workspace did; rules a
--    tenant command created are left alone, as in 0037.
-- 2. Work orders: the first work-order threshold kept ADMIN's unbounded rule
--    beside its new band (update-approval-threshold). Where that band exists,
--    the unbounded rule goes too. Workspaces that never set one keep every role
--    unbounded, so nothing changes there.
--
-- A rule a command receipt cites is never deleted (commands.approval_rule_id
-- is an FK): it is bounded in place at the role's band instead, which leaves a
-- duplicate of that band. A role with no band of its own on the command takes
-- the lowest workspace-wide band there, else the catalog's 100 000 XAF.

DELETE FROM approval_rules r
WHERE r.command_type IN ('record-expense', 'record-revenue')
  AND r.required_role IN ('FINANCE', 'ADMIN')
  AND (
    r.created_by_command_id IS NULL
    OR EXISTS (
      SELECT 1 FROM commands c
      WHERE c.workspace_id = r.workspace_id
        AND c.id = r.created_by_command_id
        AND c.command_type = 'provision-workspace'
    )
  )
  AND r.category_code IS NULL
  AND r.branch_id IS NULL
  AND r.amount_min_minor IS NULL
  AND r.amount_max_minor IS NULL
  AND EXISTS (
    SELECT 1 FROM approval_rules band
    WHERE band.workspace_id = r.workspace_id
      AND band.command_type = r.command_type
      AND band.required_role = r.required_role
      AND band.category_code IS NULL
      AND band.branch_id IS NULL
      AND band.amount_min_minor IS NULL
      AND band.amount_max_minor IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM commands c
    WHERE c.workspace_id = r.workspace_id AND c.approval_rule_id = r.id
  );
--> statement-breakpoint
UPDATE approval_rules r
SET amount_max_minor = COALESCE(
    (
      SELECT min(band.amount_max_minor) FROM approval_rules band
      WHERE band.workspace_id = r.workspace_id
        AND band.command_type = r.command_type
        AND band.required_role = r.required_role
        AND band.category_code IS NULL
        AND band.branch_id IS NULL
        AND band.amount_min_minor IS NULL
        AND band.amount_max_minor IS NOT NULL
    ),
    (
      SELECT min(band.amount_max_minor) FROM approval_rules band
      WHERE band.workspace_id = r.workspace_id
        AND band.command_type = r.command_type
        AND band.category_code IS NULL
        AND band.branch_id IS NULL
        AND band.amount_min_minor IS NULL
        AND band.amount_max_minor IS NOT NULL
    ),
    100000
  ),
  row_version = r.row_version + 1
WHERE r.command_type IN ('record-expense', 'record-revenue')
  AND r.required_role IN ('FINANCE', 'ADMIN')
  AND (
    r.created_by_command_id IS NULL
    OR EXISTS (
      SELECT 1 FROM commands c
      WHERE c.workspace_id = r.workspace_id
        AND c.id = r.created_by_command_id
        AND c.command_type = 'provision-workspace'
    )
  )
  AND r.category_code IS NULL
  AND r.branch_id IS NULL
  AND r.amount_min_minor IS NULL
  AND r.amount_max_minor IS NULL;
--> statement-breakpoint
DELETE FROM approval_rules r
WHERE r.command_type IN ('create-work-order', 'complete-work-order')
  AND r.required_role = 'ADMIN'
  AND (
    r.created_by_command_id IS NULL
    OR EXISTS (
      SELECT 1 FROM commands c
      WHERE c.workspace_id = r.workspace_id
        AND c.id = r.created_by_command_id
        AND c.command_type = 'provision-workspace'
    )
  )
  AND r.category_code IS NULL
  AND r.branch_id IS NULL
  AND r.amount_min_minor IS NULL
  AND r.amount_max_minor IS NULL
  AND EXISTS (
    SELECT 1 FROM approval_rules band
    WHERE band.workspace_id = r.workspace_id
      AND band.command_type = r.command_type
      AND band.required_role = 'ADMIN'
      AND band.category_code IS NULL
      AND band.branch_id IS NULL
      AND band.amount_min_minor IS NULL
      AND band.amount_max_minor IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM commands c
    WHERE c.workspace_id = r.workspace_id AND c.approval_rule_id = r.id
  );
--> statement-breakpoint
UPDATE approval_rules r
SET amount_max_minor = band.amount_max_minor,
  row_version = r.row_version + 1
FROM (
  SELECT workspace_id, command_type, min(amount_max_minor) AS amount_max_minor
  FROM approval_rules
  WHERE command_type IN ('create-work-order', 'complete-work-order')
    AND required_role = 'ADMIN'
    AND category_code IS NULL
    AND branch_id IS NULL
    AND amount_min_minor IS NULL
    AND amount_max_minor IS NOT NULL
  GROUP BY workspace_id, command_type
) band
WHERE band.workspace_id = r.workspace_id
  AND band.command_type = r.command_type
  AND r.required_role = 'ADMIN'
  AND (
    r.created_by_command_id IS NULL
    OR EXISTS (
      SELECT 1 FROM commands c
      WHERE c.workspace_id = r.workspace_id
        AND c.id = r.created_by_command_id
        AND c.command_type = 'provision-workspace'
    )
  )
  AND r.category_code IS NULL
  AND r.branch_id IS NULL
  AND r.amount_min_minor IS NULL
  AND r.amount_max_minor IS NULL;
