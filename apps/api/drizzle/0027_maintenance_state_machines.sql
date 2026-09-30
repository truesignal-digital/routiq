-- The owner's maintenance state machines (#28), plus the approval defaults the
-- new commands and role rules need.
--
--   Operational issue: OPEN → RESOLVED | DISMISSED (new `status` column).
--   Work order: SUBMITTED, APPROVED, COMPLETION_SUBMITTED, COMPLETED, REJECTED,
--   CANCELLED — the pre-#28 values OPEN, PENDING_CLOSE and CLOSED are renamed
--   in place below. Audit events are NOT rewritten: they are append-only, and
--   the chronologie keeps labels for the old event names.
--
-- Every statement is idempotent, like 0025/0026: migration-replay.test.ts
-- re-applies this file against a database that already holds it and must find
-- no work to do.

ALTER TABLE "work_orders" ALTER COLUMN "status" SET DEFAULT 'APPROVED';--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "default_safety_critical" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD COLUMN IF NOT EXISTS "resolution_note" text;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operational_issues" ADD COLUMN IF NOT EXISTS "dismiss_reason" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "resolve_linked_issue" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "reject_reason" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "completion_reject_reason" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;

--> statement-breakpoint

-- Status renames. The meaning is unchanged — OPEN always was authorized open
-- work, PENDING_CLOSE a completion awaiting review, CLOSED a finished job — so
-- row_version is left alone: a client holding the row still quotes the right
-- version. A second pass matches nothing.
--
-- Existing issues all land OPEN, including those whose work order was already
-- closed: before #28 nobody could resolve an issue, and inventing a resolution
-- here would put a decision in the trail that no one took. A held completion
-- keeps resolve_linked_issue = false for the same reason.
UPDATE work_orders
SET status = CASE status
  WHEN 'OPEN' THEN 'APPROVED'
  WHEN 'PENDING_CLOSE' THEN 'COMPLETION_SUBMITTED'
  WHEN 'CLOSED' THEN 'COMPLETED'
END
WHERE status IN ('OPEN', 'PENDING_CLOSE', 'CLOSED');

--> statement-breakpoint

-- Resolving and dismissing move the status and stamp when and why — nothing
-- else. The report itself (what was seen, on which asset, how dangerous) stays
-- an append-only fact, so the grant is column-level, the way 0014 limits
-- financial_postings to posting_period_id.
GRANT UPDATE (status, resolved_at, resolution_note, dismissed_at, dismiss_reason, row_version)
  ON operational_issues TO routiq_app;

--> statement-breakpoint

-- Approval defaults for the new commands and role rules, for workspaces that
-- predate them (a new workspace gets the same rows from provisioning/packs/core.ts;
-- maintenance-state-machines.migration.test.ts holds the two copies together).
-- No matching rule means APPROVAL_REQUIRED, which would 403 every one of these.
--
--   resolve-issue: ADMIN, OPS_MANAGER, MAINTENANCE, FIELD_SUBMITTER
--   dismiss-issue: ADMIN, OPS_MANAGER, MAINTENANCE
--   reject-work-order, reject-work-order-completion: FINANCE_APPROVER, ADMIN
--   record-meter-reading: MAINTENANCE (the handler already allowed the role)
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
    ('resolve-issue', 'ADMIN'),
    ('resolve-issue', 'OPS_MANAGER'),
    ('resolve-issue', 'MAINTENANCE'),
    ('resolve-issue', 'FIELD_SUBMITTER'),
    ('dismiss-issue', 'ADMIN'),
    ('dismiss-issue', 'OPS_MANAGER'),
    ('dismiss-issue', 'MAINTENANCE'),
    ('reject-work-order', 'FINANCE_APPROVER'),
    ('reject-work-order', 'ADMIN'),
    ('reject-work-order-completion', 'FINANCE_APPROVER'),
    ('reject-work-order-completion', 'ADMIN'),
    ('record-meter-reading', 'MAINTENANCE')
) AS c(command_type, required_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = c.command_type
    AND r.required_role = c.required_role
);

--> statement-breakpoint

-- MAINTENANCE may record an expense only against a work order (the handler
-- enforces that), within the same auto-post band as FIELD_SUBMITTER. The band
-- is copied from the workspace's own FIELD_SUBMITTER rule, so a tenant that
-- already moved its threshold keeps one threshold rather than two; 100 000 XAF
-- (exponent 0 — minor units ARE francs) is the catalog default where none exists.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT
  w.id,
  'record-expense',
  NULL,
  NULL,
  NULL,
  COALESCE(
    (
      SELECT r.amount_max_minor
      FROM approval_rules r
      WHERE r.workspace_id = w.id
        AND r.command_type = 'record-expense'
        AND r.required_role = 'FIELD_SUBMITTER'
        AND r.category_code IS NULL
        AND r.branch_id IS NULL
        AND r.amount_min_minor IS NULL
        AND r.amount_max_minor IS NOT NULL
      ORDER BY r.created_at, r.id
      LIMIT 1
    ),
    100000
  ),
  'MAINTENANCE'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules r
  WHERE r.workspace_id = w.id
    AND r.command_type = 'record-expense'
    AND r.required_role = 'MAINTENANCE'
);

--> statement-breakpoint

-- The ISSUE_TYPE vocabulary the core pack now ships, with its safety-critical
-- defaults, for workspaces provisioned before it existed. Config as data: the
-- tenant relabels or deactivates these like any other category. A workspace
-- that already defined one of these codes keeps its own row.
INSERT INTO categories (
  workspace_id, kind, code, label_fr, label_en, default_safety_critical, active
)
SELECT w.id, 'ISSUE_TYPE', c.code, c.label_fr, c.label_en, c.default_safety_critical, true
FROM workspaces w
CROSS JOIN (
  VALUES
    ('BRAKES', 'Freins', 'Brakes', true),
    ('STEERING', 'Direction', 'Steering', true),
    ('TYRES', 'Pneumatiques', 'Tyres', true),
    ('LIGHTING', 'Éclairage', 'Lighting', false),
    ('ENGINE', 'Moteur', 'Engine', false),
    ('BODYWORK', 'Carrosserie', 'Bodywork', false),
    ('OTHER', 'Autre', 'Other', false)
) AS c(code, label_fr, label_en, default_safety_critical)
ON CONFLICT (workspace_id, kind, code) DO NOTHING;
