-- Custom SQL migration file, put your code below! --
-- Backfill the branch-administration approval defaults for workspaces that
-- predate these command types.
--
-- The catalog defaults in provisioning/packs/core.ts only run when a workspace
-- is created, so without this every existing tenant would meet rename-branch and
-- set-branch-status with no matching approval rule — and no matching rule means
-- APPROVAL_REQUIRED (the safe default), which the dispatcher turns into 403 on
-- every call. Same reasoning, and same shape, as 0020 and 0021.
--
-- ADMIN only, matching each command's allowedRoles: these edit where the
-- workspace operates, which every other role then records against.
--
-- Idempotent: the NOT EXISTS is per workspace and command type, so re-running
-- after a partial application adds nothing, and a workspace that already has a
-- rule for a command type keeps whatever it has.

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
  'ADMIN'
FROM workspaces w
CROSS JOIN (
  VALUES
    ('rename-branch'),
    ('set-branch-status')
) AS c(command_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = c.command_type
);
