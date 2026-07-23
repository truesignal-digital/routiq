# 09 — Source artifacts + S3-only storage

**What to build:** A field clerk attaches photos or receipts to a submission: the client uploads via a presigned URL, the server finalizes the artifact as an immutable, SHA-256-hashed record in private storage, and the command that references it links to it permanently through the envelope's `sourceArtifactIds`. All storage access goes through the S3 API only — standard SigV4 presigning, no Supabase-specific calls — so the on-prem swap stays cheap (ARCHITECTURE.md §6a guard 2, §8 storage row; wayfinder ticket 14 affects only the future on-prem implementation, not this interface).

**Blocked by:** 03 — Command pipeline core.

**Status:** ready-for-human

- [x] `source_artifacts` table: immutable rows with SHA-256 hash, MIME type, size, storage key, uploader provenance
- [x] One storage interface, S3-API-only implementation; presigned upload + download via standard SigV4 (not `createSignedUrl`); tests run against a local S3-compatible container
- [x] MIME type verified by content on finalize, not by extension; EXIF location stripped from photos
- [x] Commands link artifacts via the envelope's `sourceArtifactIds`; the many-to-many link rows carry workspace scoping
- [x] Artifact rows have no update path through the command layer; corrections attach new artifacts, never replace
- [x] Integration test: presign → upload → finalize → hash verified → RegisterAsset with `sourceArtifactIds` → link present with full provenance

## Comments

- Implemented (2026-07-23) by a codex worker, reviewed and corrected by Fable. `ObjectStorage` seam (S3 API + SigV4 presigning only) with `createS3Storage`; presign/finalize/download-url routes (auth-derived storage keys — client can never choose a key); MIME sniffed from bytes via file-type (jpeg/png/webp/pdf allowlist); images re-encoded with sharp (`rotate()` bakes orientation, re-encode drops EXIF/GPS); SHA-256 over final stored bytes; artifact rows immutable (runtime role has no UPDATE/DELETE on source_artifacts per migration 0005). Dispatcher validates and links `sourceArtifactIds` inside the command transaction.
- Fable corrections: worker had gated the whole test suite behind a manual `RUN_MINIO_TESTS` env (silently skipping 9 tests) — rewritten to boot a MinIO GenericContainer per file; Zod-3 `z.string().uuid()` spellings fixed; five ad-hoc error codes replaced with registered `STORAGE_FAILED` / `UNSUPPORTED_MEDIA_TYPE`.
- Deferred: resumable upload interface (wayfinder ticket 14, on-prem only); artifact GC for presigned-but-never-finalized objects.
