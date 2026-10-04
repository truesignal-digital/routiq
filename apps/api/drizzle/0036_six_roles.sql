-- The six team roles (ADR-0009). A plain map that promotes nobody (owner
-- decision 2026-10-04):
--
--   ADMIN, OPS_MANAGER, EXECUTIVE_VIEWER -> ADMIN
--   FIELD_SUBMITTER                      -> DRIVER
--   MAINTENANCE                          -> TECHNICIAN
--   FINANCE_APPROVER                     -> FINANCE
--
-- Applied to every column that holds a role: memberships.role and
-- approval_rules.required_role (the catalog command defaults live there). No
-- CHECK constraint names a role; the codes are enforced in code.
--
-- Then the approval rules are brought to what provisioning/packs/core.ts gives
-- a new workspace (db/six-roles.migration.test.ts holds the two together):
--   1. DIRECTOR gets a copy of every rule shape, since Direction may approve
--      anything; tenant-set bands and branch or category rules included.
--   2. CASHIER, a new role, gets the DRIVER rules for the money it records
--      (same band), receipts, pending-entry edits and notes.
--   3. FINANCE gets the documents default it now holds.
--   4. Rules for a role the command no longer allows are deleted, unless a
--      command receipt cites them (commands.approval_rule_id is an FK).
--   5. Duplicates the map made (an ADMIN rule beside an ex-OPS_MANAGER one)
--      collapse to the oldest, under the same receipt exception.
--
-- Nobody becomes DIRECTOR here; the vendor appoints each workspace's first
-- (`pnpm --filter @routiq/api appoint-director`).

UPDATE memberships
SET role = CASE role
    WHEN 'OPS_MANAGER' THEN 'ADMIN'
    WHEN 'EXECUTIVE_VIEWER' THEN 'ADMIN'
    WHEN 'FIELD_SUBMITTER' THEN 'DRIVER'
    WHEN 'MAINTENANCE' THEN 'TECHNICIAN'
    WHEN 'FINANCE_APPROVER' THEN 'FINANCE'
  END,
  row_version = row_version + 1
WHERE role IN ('OPS_MANAGER', 'EXECUTIVE_VIEWER', 'FIELD_SUBMITTER', 'MAINTENANCE', 'FINANCE_APPROVER');
--> statement-breakpoint
UPDATE approval_rules
SET required_role = CASE required_role
    WHEN 'OPS_MANAGER' THEN 'ADMIN'
    WHEN 'EXECUTIVE_VIEWER' THEN 'ADMIN'
    WHEN 'FIELD_SUBMITTER' THEN 'DRIVER'
    WHEN 'MAINTENANCE' THEN 'TECHNICIAN'
    WHEN 'FINANCE_APPROVER' THEN 'FINANCE'
  END,
  row_version = row_version + 1
WHERE required_role IN ('OPS_MANAGER', 'EXECUTIVE_VIEWER', 'FIELD_SUBMITTER', 'MAINTENANCE', 'FINANCE_APPROVER');
--> statement-breakpoint
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT DISTINCT
  r.workspace_id, r.command_type, r.category_code, r.branch_id,
  r.amount_min_minor, r.amount_max_minor, 'DIRECTOR'
FROM approval_rules r
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules d
  WHERE d.workspace_id = r.workspace_id
    AND d.command_type = r.command_type
    AND d.category_code IS NOT DISTINCT FROM r.category_code
    AND d.branch_id IS NOT DISTINCT FROM r.branch_id
    AND d.amount_min_minor IS NOT DISTINCT FROM r.amount_min_minor
    AND d.amount_max_minor IS NOT DISTINCT FROM r.amount_max_minor
    AND d.required_role = 'DIRECTOR'
);
--> statement-breakpoint
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT DISTINCT
  r.workspace_id, r.command_type, r.category_code, r.branch_id,
  r.amount_min_minor, r.amount_max_minor, 'CASHIER'
FROM approval_rules r
WHERE r.required_role = 'DRIVER'
  AND r.command_type IN ('record-expense', 'record-revenue', 'attach-evidence', 'update-pending-entry', 'add-note')
  AND NOT EXISTS (
    SELECT 1
    FROM approval_rules c
    WHERE c.workspace_id = r.workspace_id
      AND c.command_type = r.command_type
      AND c.category_code IS NOT DISTINCT FROM r.category_code
      AND c.branch_id IS NOT DISTINCT FROM r.branch_id
      AND c.amount_min_minor IS NOT DISTINCT FROM r.amount_min_minor
      AND c.amount_max_minor IS NOT DISTINCT FROM r.amount_max_minor
      AND c.required_role = 'CASHIER'
  );
--> statement-breakpoint
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'add-or-renew-document', NULL, NULL, NULL, NULL, 'FINANCE'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = 'add-or-renew-document'
    AND r.category_code IS NULL
    AND r.branch_id IS NULL
    AND r.amount_min_minor IS NULL
    AND r.amount_max_minor IS NULL
    AND r.required_role = 'FINANCE'
);
--> statement-breakpoint
DELETE FROM approval_rules r
USING (
  VALUES
    ('register-asset', ARRAY['DIRECTOR', 'ADMIN']),
    ('commission-asset', ARRAY['DIRECTOR', 'ADMIN']),
    ('update-asset-details', ARRAY['DIRECTOR', 'ADMIN']),
    ('assign-asset', ARRAY['DIRECTOR', 'ADMIN', 'FINANCE']),
    ('release-asset-to-service', ARRAY['DIRECTOR', 'ADMIN']),
    ('record-meter-reading', ARRAY['DIRECTOR', 'ADMIN', 'TECHNICIAN', 'DRIVER']),
    ('add-note', ARRAY['DIRECTOR', 'ADMIN', 'FINANCE', 'CASHIER', 'TECHNICIAN', 'DRIVER']),
    ('add-or-renew-document', ARRAY['DIRECTOR', 'ADMIN', 'FINANCE']),
    ('report-issue', ARRAY['DIRECTOR', 'ADMIN', 'TECHNICIAN', 'DRIVER']),
    ('resolve-issue', ARRAY['DIRECTOR', 'ADMIN', 'TECHNICIAN']),
    ('dismiss-issue', ARRAY['DIRECTOR', 'ADMIN', 'TECHNICIAN']),
    ('create-work-order', ARRAY['DIRECTOR', 'ADMIN', 'TECHNICIAN']),
    ('complete-work-order', ARRAY['DIRECTOR', 'ADMIN', 'TECHNICIAN']),
    ('cancel-work-order', ARRAY['DIRECTOR', 'ADMIN', 'TECHNICIAN']),
    ('approve-work-order', ARRAY['DIRECTOR', 'ADMIN']),
    ('reject-work-order', ARRAY['DIRECTOR', 'ADMIN']),
    ('approve-work-order-closure', ARRAY['DIRECTOR', 'ADMIN']),
    ('reject-work-order-completion', ARRAY['DIRECTOR', 'ADMIN']),
    ('create-activity', ARRAY['DIRECTOR', 'ADMIN', 'DRIVER']),
    ('record-movement-leg', ARRAY['DIRECTOR', 'ADMIN', 'DRIVER']),
    ('record-journey-sheet', ARRAY['DIRECTOR', 'ADMIN', 'DRIVER']),
    ('record-haulage-job-sheet', ARRAY['DIRECTOR', 'ADMIN', 'DRIVER']),
    ('substitute-asset', ARRAY['DIRECTOR', 'ADMIN', 'DRIVER']),
    ('close-activity', ARRAY['DIRECTOR', 'ADMIN', 'DRIVER']),
    ('reopen-activity', ARRAY['DIRECTOR', 'ADMIN']),
    ('record-expense', ARRAY['DIRECTOR', 'ADMIN', 'FINANCE', 'CASHIER', 'TECHNICIAN', 'DRIVER']),
    ('update-pending-entry', ARRAY['DIRECTOR', 'ADMIN', 'FINANCE', 'CASHIER', 'TECHNICIAN', 'DRIVER']),
    ('record-revenue', ARRAY['DIRECTOR', 'ADMIN', 'FINANCE', 'CASHIER']),
    ('attach-evidence', ARRAY['DIRECTOR', 'ADMIN', 'FINANCE', 'CASHIER', 'TECHNICIAN', 'DRIVER']),
    ('approve-entry', ARRAY['DIRECTOR', 'FINANCE']),
    ('reject-entry', ARRAY['DIRECTOR', 'FINANCE']),
    ('reverse-entry', ARRAY['DIRECTOR', 'FINANCE']),
    ('lock-period', ARRAY['DIRECTOR', 'FINANCE']),
    ('reopen-period', ARRAY['DIRECTOR']),
    ('register-person', ARRAY['DIRECTOR', 'ADMIN']),
    ('add-member', ARRAY['DIRECTOR', 'ADMIN']),
    ('update-member-role', ARRAY['DIRECTOR', 'ADMIN']),
    ('deactivate-member', ARRAY['DIRECTOR', 'ADMIN']),
    ('reactivate-member', ARRAY['DIRECTOR', 'ADMIN']),
    ('reset-member-pin', ARRAY['DIRECTOR', 'ADMIN']),
    ('create-branch', ARRAY['DIRECTOR']),
    ('rename-branch', ARRAY['DIRECTOR']),
    ('set-branch-status', ARRAY['DIRECTOR']),
    ('create-category', ARRAY['DIRECTOR']),
    ('relabel-category', ARRAY['DIRECTOR']),
    ('deactivate-category', ARRAY['DIRECTOR']),
    ('reactivate-category', ARRAY['DIRECTOR']),
    ('update-approval-threshold', ARRAY['DIRECTOR']),
    ('set-template-preset', ARRAY['DIRECTOR']),
    ('enable-module', ARRAY['DIRECTOR']),
    ('disable-module', ARRAY['DIRECTOR'])
) AS allowed(command_type, roles)
WHERE r.command_type = allowed.command_type
  AND NOT (r.required_role = ANY (allowed.roles))
  AND NOT EXISTS (
    SELECT 1 FROM commands c
    WHERE c.workspace_id = r.workspace_id AND c.approval_rule_id = r.id
  );
--> statement-breakpoint
DELETE FROM approval_rules r
WHERE EXISTS (
    SELECT 1
    FROM approval_rules older
    WHERE older.workspace_id = r.workspace_id
      AND older.command_type = r.command_type
      AND older.category_code IS NOT DISTINCT FROM r.category_code
      AND older.branch_id IS NOT DISTINCT FROM r.branch_id
      AND older.amount_min_minor IS NOT DISTINCT FROM r.amount_min_minor
      AND older.amount_max_minor IS NOT DISTINCT FROM r.amount_max_minor
      AND older.required_role = r.required_role
      AND (older.created_at, older.id) < (r.created_at, r.id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM commands c
    WHERE c.workspace_id = r.workspace_id AND c.approval_rule_id = r.id
  );
