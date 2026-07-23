# 05 — Evidence attachment field

**What to build:** One reusable `<AttachmentField>`: camera/photo pick → client-side downscale → presign → PUT → finalize → artifactId collected into the envelope's sourceArtifactIds. Register form gets it first; every future form reuses it.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Component drives the full presign → upload → finalize flow against `/v1/artifacts/*`; artifactIds accumulate into the owning form's envelope `sourceArtifactIds`
- [ ] Images downscaled client-side before upload (target ≤ ~1MB for 2G/3G) while staying legible as receipts
- [ ] Per-file states: uploading / finalized (hash shown short) / failed with retry; finalize retry is safe (409 duplicate handled as already-done)
- [ ] UNSUPPORTED_MEDIA_TYPE and ARTIFACT_UPLOAD_INCOMPLETE localized like all other codes
- [ ] Wired into the register-asset form; command success links artifacts (verify against dev API: command_source_artifacts row exists)
