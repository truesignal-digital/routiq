# 05 — File-upload component + wiring

Status: ready-for-agent
Blocked by: 01

Build `components/ui/file-upload.tsx` per spec § Design 6: shadcn-styled dropzone (click/drag), image capture pass-through, file list with thumbnail/name/size, per-file progress, remove, per-file error — wrapping the EXISTING artifacts/upload.ts presigned flow (do not change it). Replace/wrap AttachmentField in the documents screen; add the optional attachment slot to the record screen feeding envelope sourceArtifactIds.

Acceptance:
- [ ] upload.ts untouched; upload.test.ts still green
- [ ] jsdom tests: file select renders list entry; remove works; error state renders; record-screen payload carries sourceArtifactIds when files uploaded
- [ ] Web tests + typecheck green
