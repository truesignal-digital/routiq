# 09 — Source artifacts + S3-only storage

**What to build:** A field clerk attaches photos or receipts to a submission: the client uploads via a presigned URL, the server finalizes the artifact as an immutable, SHA-256-hashed record in private storage, and the command that references it links to it permanently through the envelope's `sourceArtifactIds`. All storage access goes through the S3 API only — standard SigV4 presigning, no Supabase-specific calls — so the on-prem swap stays cheap (ARCHITECTURE.md §6a guard 2, §8 storage row; wayfinder ticket 14 affects only the future on-prem implementation, not this interface).

**Blocked by:** 03 — Command pipeline core.

**Status:** ready-for-agent

- [ ] `source_artifacts` table: immutable rows with SHA-256 hash, MIME type, size, storage key, uploader provenance
- [ ] One storage interface, S3-API-only implementation; presigned upload + download via standard SigV4 (not `createSignedUrl`); tests run against a local S3-compatible container
- [ ] MIME type verified by content on finalize, not by extension; EXIF location stripped from photos
- [ ] Commands link artifacts via the envelope's `sourceArtifactIds`; the many-to-many link rows carry workspace scoping
- [ ] Artifact rows have no update path through the command layer; corrections attach new artifacts, never replace
- [ ] Integration test: presign → upload → finalize → hash verified → RegisterAsset with `sourceArtifactIds` → link present with full provenance
