ALTER TABLE "branches" ADD COLUMN "created_by_command_id" uuid;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_created_by_command_id_commands_id_fk" FOREIGN KEY ("created_by_command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Catalog defaults are applied only while provisioning. Backfill the new
-- ADMIN-only command for workspaces that already exist, while preserving any
-- rule a workspace may already have received through an earlier deployment.
INSERT INTO approval_rules (
  workspace_id, command_type, category_code, branch_id,
  amount_min_minor, amount_max_minor, required_role
)
SELECT w.id, 'create-branch', NULL, NULL, NULL, NULL, 'ADMIN'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_rules existing
  WHERE existing.workspace_id = w.id
    AND existing.command_type = 'create-branch'
);
