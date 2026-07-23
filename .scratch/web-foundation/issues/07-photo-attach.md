# 07 — Photo attach (upload on selection)

**What to build:** While filling the RegisterAsset form, the user adds photos from camera or gallery and each one starts uploading the moment it's picked: downscaled client-side, presign → PUT → finalize, per-photo progress, a retry chip on failure that never blocks the form. Submit references the finalized artifact ids in the envelope's `sourceArtifactIds`. Photos are optional — a missing or failed photo never blocks registration (warn-don't-block culture; mirrors §6 "blobs first" replay ordering).

**Blocked by:** 06 — RegisterAsset form; spine 09 — Source artifacts + S3 storage (`.scratch/spine/issues/09-source-artifacts-storage.md`).

**Implementation note:** run in a git worktree; touches `apps/web` only.

- [ ] Picker offers camera and gallery on mobile; file picker on desktop
- [ ] Client-side downscale before upload — receipts/plates stay legible, no full-resolution uploads
- [ ] Upload starts on selection: presign → PUT → finalize per photo, independent progress per chip
- [ ] Failed upload → retry chip; form remains fully submittable without the photo
- [ ] Submit includes only finalized artifact ids in `sourceArtifactIds`; in-flight uploads either complete before submit or are dropped with a visible warning, never block
- [ ] Registered asset's artifacts linked with full provenance (verified through the API)
