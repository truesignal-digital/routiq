# 06 — Offline photo queue: upload-first sync ordering

**What to build:** Photos captured offline are stored as blob rows in Dexie keyed by artifactId. Sync reorders: upload blobs first via presign→PUT→finalize, then replay commands. Commands referencing missing blobs park (not error into the server).

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Dexie schema in `apps/web/src/offline/db.ts`: `blobs` table with (artifactId, workspaceId, mimeType, size, data: Blob, uploadedAt)
- [ ] In `apps/web/src/artifacts/AttachmentField.tsx`, capture photo → save to blobs table with generated artifactId; show progress (uploading, queued, uploaded)
- [ ] Sync order in `apps/web/src/offline/sync.ts`: (1) drain blobs via presign+PUT+finalize flow (reuse upload.ts logic, idempotent on artifactId); (2) replay commands that reference sourceArtifactIds
- [ ] If a blob presign/PUT/finalize fails, park that blob; any command referencing that artifactId must also park (don't replay — server won't find the sourceArtifactId). Mark commands as awaiting the blob.
- [ ] Unit tests: blob → queue → finalize ordering, missing blob prevents command replay, duplicate finalize idempotent (409 → success)
