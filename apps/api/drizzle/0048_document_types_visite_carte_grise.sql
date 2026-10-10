-- The vehicle papers every Cameroonian truck carries, as document types (#661):
-- the visite technique (roadworthiness inspection) and the carte grise
-- (registration certificate). A new workspace gets them from
-- provisioning/packs/core.ts; this gives them to workspaces provisioned
-- before. document-types.migration.test.ts holds the two copies together.
--
-- Config as data: the tenant relabels or deactivates them like any other
-- category. A workspace that already files one of them keeps its own row and
-- gets no second one: same code, or a document type it already named the same
-- in French under a code of its own (the demo seed's TECHNICAL_INSPECTION was
-- one). A second pass inserts nothing (migration-replay.test.ts).
INSERT INTO categories (workspace_id, kind, code, label_fr, label_en, active)
SELECT w.id, 'DOCUMENT_TYPE', c.code, c.label_fr, c.label_en, true
FROM workspaces w
CROSS JOIN (
  VALUES
    ('VISITE_TECHNIQUE', 'Visite technique', 'Visite technique'),
    ('CARTE_GRISE', 'Carte grise', 'Carte grise')
) AS c(code, label_fr, label_en)
WHERE NOT EXISTS (
  SELECT 1 FROM categories own
  WHERE own.workspace_id = w.id
    AND own.kind = 'DOCUMENT_TYPE'
    AND lower(btrim(own.label_fr)) = lower(c.label_fr)
)
ON CONFLICT (workspace_id, kind, code) DO NOTHING;
