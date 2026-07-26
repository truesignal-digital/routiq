# 05 — File-upload component + wiring

Status: ready-for-human
Blocked by: 01

Build `components/ui/file-upload.tsx` per spec § Design 6: shadcn-styled dropzone (click/drag), image capture pass-through, file list with thumbnail/name/size, per-file progress, remove, per-file error — wrapping the EXISTING artifacts/upload.ts presigned flow (do not change it). Replace/wrap AttachmentField in the documents screen; add the optional attachment slot to the record screen feeding envelope sourceArtifactIds.

Acceptance:
- [x] upload.ts untouched; upload.test.ts still green
- [x] jsdom tests: file select renders list entry; remove works; error state renders; record-screen payload carries sourceArtifactIds when files uploaded
- [x] Web tests + typecheck green

## Comments

2026-07-26 [codex] clean pass. file-upload.tsx wraps the untouched presigned flow (upload.test.ts 4/4); documents screen migrated; record screen gains the Justificatif slot and passes sourceArtifactIds in envelope options only when uploads completed. 146 web tests + typecheck green, Fable-verified.
