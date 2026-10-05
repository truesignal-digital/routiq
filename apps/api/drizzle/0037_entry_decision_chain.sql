-- The default approval chain for money entries (ADR-0009, owner decision
-- 2026-10-05): Finance decides a pending entry up to 1 000 000 XAF, Direction
-- above it and at any amount. 0036 left both roles unbounded on approve-entry
-- and reject-entry; this gives Finance its band. Direction moves it later with
-- update-approval-threshold.
--
-- Only Finance's catalog default changes: the unfiltered, unbounded rule that
-- either no command created (seeded before provisioning was a command) or
-- provision-workspace created. Rules any other command created are a tenant's
-- and are left alone. The row is updated in place, so a receipt that cites it
-- keeps its FK.
--
-- Direction then gets a copy of every workspace-wide band on these commands:
-- where a band matches it is the more specific rule, and only the roles on it
-- decide. Its unbounded rule decides above the band.
--
-- Work-order decisions and the cross-branch transfer already follow the chain
-- after 0036 (Administrateur and Direction; Finance and Direction).

UPDATE approval_rules r
SET amount_max_minor = 1000000,
  row_version = r.row_version + 1
WHERE r.command_type IN ('approve-entry', 'reject-entry')
  AND r.required_role = 'FINANCE'
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
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT DISTINCT
  r.workspace_id, r.command_type, NULL::text, NULL::uuid,
  NULL::bigint, r.amount_max_minor, 'DIRECTOR'
FROM approval_rules r
WHERE r.command_type IN ('approve-entry', 'reject-entry')
  AND r.category_code IS NULL
  AND r.branch_id IS NULL
  AND r.amount_min_minor IS NULL
  AND r.amount_max_minor IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM approval_rules d
    WHERE d.workspace_id = r.workspace_id
      AND d.command_type = r.command_type
      AND d.category_code IS NULL
      AND d.branch_id IS NULL
      AND d.amount_min_minor IS NULL
      AND d.amount_max_minor = r.amount_max_minor
      AND d.required_role = 'DIRECTOR'
  );
