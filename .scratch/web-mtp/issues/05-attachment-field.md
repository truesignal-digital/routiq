# 05 — Evidence attachment field

**What to build:** One reusable `<AttachmentField>`: camera/photo pick → client-side downscale → presign → PUT → finalize → artifactId collected into the envelope's sourceArtifactIds. Register form gets it first; every future form reuses it.

**Blocked by:** 01.

**Status:** ready-for-human

- [x] Component drives the full presign → upload → finalize flow against `/v1/artifacts/*`; artifactIds accumulate into the owning form's envelope `sourceArtifactIds`
- [x] Images downscaled client-side before upload (target ≤ ~1MB for 2G/3G) while staying legible as receipts
- [x] Per-file states: uploading / finalized (hash shown short) / failed with retry; finalize retry is safe (409 duplicate handled as already-done)
- [x] UNSUPPORTED_MEDIA_TYPE and ARTIFACT_UPLOAD_INCOMPLETE localized like all other codes
- [x] Wired into the register-asset form; command success links artifacts (verify against dev API: command_source_artifacts row exists)

## Comments

- Done (2026-07-23, web-ui). `<AttachmentField>` (reusable, injectable upload impl) drives presign → PUT → finalize per file with per-file states: Téléversement… / ✓ shortsha (full hash in title) / localized failure + retry. Retry re-runs the whole flow with the SAME artifactId; a finalize retry that hits 409 UNIQUE_CONSTRAINT_VIOLATION is treated as already-done. Finalized ids flow into the form's envelope `sourceArtifactIds` via intent options (changing attachments = new envelope by fingerprint). Images downscaled client-side (canvas, max 1600px, stepped JPEG quality, ≤~1MB target); PDFs pass through. UNSUPPORTED_MEDIA_TYPE / ARTIFACT_UPLOAD_INCOMPLETE already covered by the complete error map (meta-test).
- Fixed during live verify: `Object.assign(File, {name})` throws (File.name is getter-only) — name now travels separately. Note: headless `upload` needed a manual change-event dispatch; real browsers fire it natively.
- Verified e2e (MinIO on :9100, storage-wired dev server): picked a PNG → presigned PUT to MinIO → finalized `✓ 1545db8f` → registered DLA-T-012 → `command_source_artifacts` row links the command to the artifact, DB sha256 matches the UI badge exactly.
- Relay to backend: `scripts/dev-with-storage.ts` added because server.ts's main block never wires ObjectStorage — consider env-driven storage there (S3_ENDPOINT/BUCKET/KEYS), then delete the script. Careful with the name: a script ending in "server.ts" triggers server.ts's isMain check and double-listens.
- 68 web tests + full suite green.
