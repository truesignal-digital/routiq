-- enable-module, disable-module and set-template-preset are platform-scope
-- commands a vendor operator runs (ADR-0005, #362). The platform pipeline reads
-- no approval rule, so the tenant rules provisioning used to give them are dead
-- rows; a new workspace no longer gets them (provisioning/packs/core.ts). A rule
-- an old receipt points at stays, because the receipt's foreign key needs it.
DELETE FROM approval_rules r
WHERE r.command_type IN ('enable-module', 'disable-module', 'set-template-preset')
  AND NOT EXISTS (
    SELECT 1 FROM commands c
    WHERE c.workspace_id = r.workspace_id AND c.approval_rule_id = r.id
  );
