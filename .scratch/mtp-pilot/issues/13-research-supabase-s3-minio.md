# Research: Supabase Storage S3 compatibility vs MinIO

Type: research
Status: resolved

## Question

Does the ARCHITECTURE.md §6a portability guard hold in practice? Verify: Supabase Storage S3-protocol support (status, auth model, signed URLs, multipart uploads); whether resumable upload (TUS) has an S3/MinIO-compatible equivalent or needs its own abstraction; MinIO parity for every storage operation the stack list (§8) relies on. Output: confirmed-compatible operation list + any incompatibility requiring an abstraction tweak in §6a/§8.

## Answer

**Bottom line: the guard mostly holds, with one abstraction the app must build in (resumable upload), and one premise that has quietly broken (MinIO itself).**

### 0. Premise-breaking finding: MinIO is no longer a viable "future on-prem" target

MinIO Community (the AGPLv3 open-source edition) stopped publishing Docker images/binaries in Oct 2025, entered maintenance mode Dec 2025, and its GitHub repo was archived Apr 25 2026 — it now gets no new features, no compatibility updates, and no guaranteed security patches. Supabase's own self-hosting docs already reflect this: *"MinIO no longer publishes open source Docker images or maintains their open source repository... for new deployments, consider using RustFS instead."* RustFS (Apache 2.0, S3-compatible, positioned as a drop-in MinIO successor, explicit `docker-compose.rustfs.yml` override documented by Supabase) is the practical on-prem substitute today. Recommend the ticket/ARCHITECTURE.md portability language be updated from "MinIO" to "an S3-compatible on-prem store (RustFS recommended; MinIO deployments are now frozen/unmaintained)". This doesn't change the S3-API analysis below (RustFS and MinIO both speak the same S3 protocol), but it changes what "on-prem" concretely means.
Sources: https://www.minimus.io/post/minio-docker-image-changes-how-to-find-a-secure-minio-alternative , https://itsfoss.com/news/minio-moves-away-from-open-source/ , https://supabase.com/docs/guides/self-hosting/self-hosted-s3 , https://github.com/orgs/supabase/discussions/42362 , https://github.com/rustfs/rustfs

### 1. Supabase Storage S3-protocol compatibility

- **Status**: Shipped April 2024, iterated since; no explicit "GA" label in docs but it is documented as production functionality (not flagged alpha/beta as of this check, July 2026). Implements a defined subset of the S3 API, not the full surface.
- **Auth model — two distinct mechanisms**:
  - *S3 access keys* (Access Key ID + Secret Access Key), generated in project settings, server-side only: full access to all S3 operations across all buckets, **bypass RLS entirely**. This is the AWS-standard two-part credential.
  - *Session Token* mode: `accessKeyId` = project ref, `secretAccessKey` = anon key, `sessionToken` = a user's JWT access token. Operations are scoped to that authenticated user and **RLS policies on the storage schema are respected**. This three-credential shape looks like AWS STS temporary credentials but the scoping mechanism (Postgres RLS via JWT) is Supabase-specific — there is no equivalent on raw MinIO/RustFS, which scope access via bucket/IAM policies instead. If the app relies on session-token + RLS scoping for client-side uploads, that specific auth flow does **not** port to a raw S3-compatible backend and needs a different authorization mechanism there (e.g., app-issued short-lived presigned URLs, or IAM policy per tenant).
  - Both mechanisms require requests signed with **AWS Signature Version 4** — standard, portable.
- **Supported S3 operations** (per Supabase's compatibility doc): Object ops — HeadObject, GetObject, PutObject, CopyObject, DeleteObject, DeleteObjects, ListObjects, ListObjectsV2; Multipart — CreateMultipartUpload, UploadPart, UploadPartCopy, CompleteMultipartUpload, AbortMultipartUpload, ListParts, ListMultipartUploads; Bucket — ListBuckets, HeadBucket, CreateBucket, DeleteBucket, GetBucketLocation.
- **Known limitations (unsupported)**: S3 object versioning (deletes are permanent, no restore), SSE-C (customer-supplied encryption keys), ACLs, object tagging, bucket CORS config (Get/Put/DeleteBucketCors), bucket lifecycle configuration, object locking. Note the asymmetry: MinIO/RustFS *do* support several of these (versioning, lifecycle, CORS) — so the constraint runs the other direction: don't design around S3 versioning/lifecycle/CORS-on-bucket, because Supabase's layer won't honor it even though the on-prem target would.

Sources: https://supabase.com/docs/guides/storage/s3/compatibility , https://supabase.com/docs/guides/storage/s3/authentication , https://supabase.com/blog/s3-compatible-storage

### 2. Resumable uploads: TUS vs S3 multipart — needs an app-level abstraction

- Supabase Storage's TUS endpoint (`/storage/v1/upload/resumable`) is implemented by Supabase's own **storage-api application layer**, not by the underlying object store. This layer is open-source (`supabase/storage` on GitHub) and is what you'd self-host in front of an S3-compatible backend (MinIO/RustFS). So: *if the on-prem deployment runs Supabase's storage-api server in front of RustFS/MinIO, TUS is available on-prem too* — same protocol, same client libraries (tus-js-client, @uppy/tus, tus-py-client), because the resumability logic lives in Supabase's code, not in the S3 backend.
- However, TUS is **not part of the S3 API itself**. A raw S3-compatible endpoint (MinIO/RustFS accessed directly, without Supabase's storage-api layer in front) has no TUS support at all — resumability there has to be built on **S3 multipart upload** (CreateMultipartUpload/UploadPart/CompleteMultipartUpload), which both Supabase's S3 API and MinIO/RustFS support identically via the standard AWS SDK (`@aws-sdk/client-s3` + `@aws-sdk/lib-storage`'s `Upload` class).
- Critical distinction confirmed in Supabase's own docs: S3 multipart upload as exposed by the AWS SDK is **not automatically resumable across a dropped connection/app restart** the way TUS is — the docs frame it as "preferable for server-side uploads when you want throughput over resumability." Multipart upload gives you retry-per-part and parallelism, but the client/app must persist `{uploadId, ETag per completed part}` itself and re-drive `ListParts`/re-upload missing parts to resume after a real interruption (e.g., a mobile app backgrounded and killed mid-upload). TUS gives that resume bookkeeping for free via its resumable-upload-token URL.
- **What the app-level storage interface must abstract**: a single `resumableUpload()` interface with two backends —
  - **Supabase path**: thin wrapper over TUS (tus-js-client), relying on Supabase-hosted resume tokens/URLs.
  - **MinIO/RustFS path** (raw S3, no storage-api layer): S3 multipart upload + an app-owned resume-state store (uploadId + completed part ETags, keyed by file+session, persisted client-side e.g. IndexedDB on mobile/web, or server-side row if uploads are proxied) so the client can resume after a flaky-connection drop by listing already-completed parts and continuing from there.
  - Both paths should expose the same interface (`start/pause/resume/complete/abort`) to callers; only the resume-token storage and wire protocol differ underneath.
  - If the on-prem plan is instead "always run Supabase's storage-api service, backed by RustFS," this whole abstraction collapses — TUS works unmodified on both sides and no dual-path code is needed. **This is the key architecture decision to pin down**: whether "MinIO/on-prem" means (a) raw S3-compatible store only, or (b) Supabase's storage-api service self-hosted in front of an S3-compatible store. (a) requires the dual-path abstraction above; (b) does not.

Sources: https://supabase.com/docs/guides/storage/uploads/resumable-uploads , https://supabase.com/docs/guides/storage/uploads/s3-uploads , https://github.com/supabase/storage , https://supabase.com/docs/guides/self-hosting/self-hosted-s3

### 3. Signed URL generation: S3 presigned URLs vs `createSignedUrl`

- Supabase's S3 endpoint supports standard **AWS SigV4 query-string presigning** — the same `getSignedUrl`/presign flow from any AWS SDK (`@aws-sdk/s3-request-presigner`) works against Supabase's S3-compatible endpoint for the operations it implements (notably GetObject and PutObject, both in the supported-operations list above).
- This means the app **can** use S3 presigning against Supabase today instead of (or alongside) Supabase's proprietary `createSignedUrl` SDK method, and that exact same code path (same SDK, same call shape, only the endpoint/credentials differ) works unmodified against MinIO/RustFS. This is the strongest portability win in the whole surface: **standardize on AWS-SDK S3 presigning for both upload and download URLs**, and skip `createSignedUrl` entirely, to get one code path for both backends.
- Caveat: `createSignedUrl` has Supabase-specific conveniences (e.g., signed URLs for image transformation) that plain S3 presigning does not replicate — those would need a separate, Supabase-only fallback if used, and would not be portable to MinIO/RustFS regardless.

Sources: https://supabase.com/docs/guides/storage/s3/compatibility , https://supabase.com/docs/guides/storage/serving/downloads

### 4. MinIO/RustFS parity summary

| Capability | Supabase S3 API | MinIO/RustFS (raw S3) | Notes |
|---|---|---|---|
| PutObject/GetObject/DeleteObject/CopyObject | Yes | Yes | Portable as-is |
| Multipart upload (Create/UploadPart/Complete/Abort/ListParts) | Yes | Yes | Portable as-is; not auto-resumable on either side |
| SigV4 presigned URLs (PUT/GET) | Yes | Yes | Portable as-is — preferred over `createSignedUrl` |
| TUS resumable upload | Yes (storage-api layer) | Only if Supabase's storage-api service is self-hosted in front of it; **not** native to raw MinIO/RustFS | Needs the dual-path abstraction in §2 unless self-hosting storage-api |
| Session-token auth scoped by RLS | Yes (Supabase-specific) | No equivalent | Don't depend on this for the on-prem path |
| Bucket versioning / lifecycle / CORS / object lock / SSE-C / ACLs / tagging | **No** (Supabase doesn't implement) | Yes (native S3 feature) | Don't design around these — Supabase is the limiting side here |

### Recommended abstraction tweak for §6a/§8

Two changes to the portability guard:
1. **Storage backend**: replace "MinIO" with "an S3-compatible store (RustFS recommended; MinIO is unmaintained as of 2026)" in the on-prem target.
2. **Upload interface**: define the app's storage port as `{ putObject, getObject, deleteObject, presignUpload, presignDownload, resumableUpload }`, where `presign*` is implemented once via AWS-SDK SigV4 presigning (portable), and `resumableUpload` is the one method requiring a backend-specific implementation — TUS client on Supabase, S3-multipart-plus-app-owned-resume-state on a raw S3-compatible on-prem store (or TUS again if self-hosting Supabase's storage-api layer instead of talking to RustFS directly).
