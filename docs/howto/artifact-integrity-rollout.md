# Roll out finalized receipt protection

Updated: 2026-09-05. Use this guide when releasing the artifact API change in
[#38](https://github.com/truesignal-digital/routiq/issues/38). It does not authorize
production changes; the release owner must approve the inventory, maintenance
window, backups and recovery procedure first.

## Rehearse before release

Use Node 24, Docker and the frozen workspace dependencies. From the repository root:

```sh
pnpm --filter @routiq/api test src/artifacts/artifacts.test.ts
```

The suite provisions disposable PostgreSQL and S3-compatible storage. It exercises
upload, finalize and download through the HTTP API, including reusable upload
URLs, duplicate/concurrent finalizations, sanitized images, verified legacy
copies and already-replaced legacy evidence. It does not inspect or repair live
receipts. Repeat acceptance against the intended staging storage provider before
production release; the disposable test store is not a claim of provider certification.

## Prepare a legacy inventory

1. Back up the database and objects together, including existing object versions
   where available. Confirm how to restore a specific object without changing
   its evidence row or recorded hash. Restrict access to receipts and inventory
   output; never publish signed URLs or receipt contents in a ticket.
2. Inventory every `source_artifacts` row, including its workspace, ID, storage
   key, MIME type and recorded SHA-256. Include unlinked artifacts: they may be
   referenced by offline commands that have not reached the server yet.
3. For each row, derive the protected key
   `ws/{workspaceId}/finalized-artifacts/{artifactId}/{sha256}`. Compare the actual
   bytes at that key, if present, with the recorded hash. For legacy rows without
   a protected copy, compare the bytes at the row's existing storage key instead.
4. Separate verified, missing and mismatched evidence. Never replace the recorded
   hash to make altered bytes appear valid. Missing/mismatched objects require
   owner review and, where possible, recovery of bytes matching the recorded hash
   from a trusted backup/version. Keep a restricted incident record.

New finalizations write server-controlled, content-addressed keys. Client upload
URLs still address `ws/{workspaceId}/artifacts/{artifactId}` for compatibility.
Duplicate finalizations retain their existing conflict response. Different bytes
cannot overwrite the winning finalized object through the application upload API.

## Cut over without trusting outstanding URLs

1. Pause artifact writes and drain all old API instances and their in-flight
   finalizations. Stop old instances from issuing upload or download URLs; do not
   run old and new artifact writers together during the cutover.
2. Allow existing signed URLs to expire before calling the legacy inventory
   stable: upload URLs last 900 seconds; download URLs last 300 seconds. Count from
   the last issuance by any old instance, plus the deployment's clock-skew margin.
   Already-issued legacy download URLs cannot be redirected by the new API and
   may still return replaced bytes during their validity window. Provider-level
   revocation, if needed, requires its own reviewed plan.
3. Recheck the legacy inventory after draining writers and expiring URLs. Preserve
   each verified legacy object at its derived protected key. The new authenticated
   download endpoint performs this copy lazily, verifying the bytes first. An
   approved bulk rehearsal may call that same endpoint once per legacy artifact
   using authorized workspace-scoped identities. There is no bulk repair script
   or live backfill in this change.
4. For each successful preservation, follow the returned download URL and compare
   the downloaded bytes with the original recorded SHA-256. Record counts of
   preserved, missing and mismatched artifacts without exposing receipt contents.
5. If a legacy object is missing or mismatched and no verified protected copy is
   available, the endpoint returns HTTP 409 `ARTIFACT_INTEGRITY_MISMATCH`, not a
   download URL. It logs `artifact.integrity_mismatch` with the artifact ID. Keep
   affected evidence flagged for owner review; the API does not restore lost bytes
   or provide an operator quarantine dashboard.
6. Resume writes only after the release owner accepts the inventory and recovery
   exceptions. Confirm fresh uploads, tenant isolation, image handling and old
   receipt downloads. Preserve the rollout record with the release PR.

Legacy database rows retain their original storage keys; they are not updated.
Once a verified protected copy exists, the new download endpoint uses that copy
even if the old upload key is replaced later. It verifies the protected copy's
hash on each legacy download request and fails closed if it no longer matches.

## Retain evidence during cleanup

No deletion or automatic cleanup ships with this change. Failed/repeated
finalizations can leave staging objects and unreferenced protected objects.

Before enabling any garbage collector:

- Keep both the stored key and the derived protected key for **every** artifact
  row, not just artifacts already linked to commands. Legacy protected copies
  would otherwise look unreferenced.
- Keep objects needed by pending upload/finalize retries and offline drafts. A
  15-minute URL expiry is not a safe draft-retention window: sessions can span at
  least 14 days, and a device may retry an older draft. Get an explicit retention
  and abandoned-draft policy approved before deleting staging objects.
- For other candidate orphans, produce a dry-run inventory and verify against
  fresh database references after a safety interval. Quiesce artifact writes for
  the final recheck/deletion, or introduce a reviewed coordination mechanism;
  otherwise an in-flight finalize can be deleted before its row commits.
- Archive recoverable candidates with an approved retention period before
  deletion. Never apply an age-only bucket rule to finalized evidence or remove a
  legacy object just because its replacement copy exists.

## Recover safely and understand the boundary

The protection covers ordinary authenticated clients and reusable application
upload URLs. It is not S3 Object Lock/WORM, nor protection against a storage
administrator, stolen server storage credentials, direct database changes or
bucket loss. Backup, privileged access controls and provider integrity controls
remain necessary. Newly finalized objects are not rehashed on every download.

Rolling back to the old binary restores unsafe handling of legacy keys. If a
rollback is necessary, keep artifact writes paused and artifact downloads disabled
until reviewed, or forward-fix the new release. Do not delete protected copies,
change recorded hashes, or rewrite rows to mutable keys to make a rollback work.
