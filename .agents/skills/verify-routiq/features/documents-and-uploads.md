# Documents and uploads

Vehicle documents (inspection, insurance, permit, registration) are tracked with expiry dates, and files (receipts, photos, document scans) go to S3-compatible object storage: the browser asks the API for a presigned URL, PUTs the file to storage, then the API finalizes it. Upload routes exist only when the API is started with storage, which `pnpm verify up` does.

## Sub-features

- `docs-list` lists a truck's current documents with expired, expiring and valid states.
- `docs-add` adds or renews a document ("Ajouter un document" / "Add document", "Renouveler" / "Renew").
- `upload-receipt` attaches a receipt to an entry recorded without proof ("Joindre le reçu" / "Attach receipt").
- `upload-other` uploads from the record-entry form, fuel log, problem photos and work-order completion lines.
- `download` opens an attached file through a presigned download URL.

## How to get to it (user POV)

- Truck → "Documents" tab.
- Truck → Now → To do → "Receipt missing" item → "Joindre le reçu" / "Attach receipt".
- Truck → Now → "Technical inspection expired" → "Renouveler" / "Renew".

## Driving it with pnpm verify

Preconditions:

- Slot up (storage healthy in doctor). Fresh seed: VH003's technical inspection expired 3 days ago, insurance expires in 12 days, permit valid, registration without expiry; several entries have no receipt (`pnpm verify api GET '/v1/finance/entries?evidence=MISSING' --role manager`). Uploaders: ADMIN, OPS_MANAGER, FIELD_SUBMITTER.

- **Documents tab.** `pnpm verify drive flow:vehicle-workspace --role manager --lang en` screenshots the Documents tab (`06-vh003-documents.png`). Cross-check: `pnpm verify api GET /v1/assets/<id>/documents --role manager`.
- **Upload a receipt.** Run `pnpm verify drive flow:attach-receipt --role manager --lang en`. It finds the To do item for an entry listed by `GET /v1/finance/entries?evidence=MISSING`, clicks its "Attach receipt", sets a PNG on the file input labelled "Drop files here or click to choose" inside the dialog "Attach a receipt", clicks "Attach", and waits for the dialog to close. The cross-check reads the entry's `evidence` as `SUPPLIED` with one file.
- **Storage side effect.** `pnpm verify db "select mime_type, size_bytes, storage_key is not null as stored, created_at from source_artifacts order by created_at desc limit 3"` shows the new `image/png` row.
- **Proof.** `01-receipt-chosen.png`, `02-receipt-attached.png`, the API line and the `source_artifacts` row.

## Gotchas

- The file input is hidden; use `setInputFiles` on the input by its label, not a click on the drop zone.
- Accepted types are JPEG, PNG, WebP and PDF up to 25 MB; the API strips EXIF and rejects files whose bytes don't match their type. A page screenshot makes a valid PNG.
- The browser PUTs straight to storage at `http://127.0.0.1:<slot storage port>`; a CORS or storage failure shows in `failed-requests.txt`, not in the API log.
- `pnpm --filter @routiq/api dev` runs `src/server.ts`, which never wires storage, so uploads 404 there. Verify uploads on a `pnpm verify` slot, which runs `src/boot.ts`.
- Two dialogs can be open at once (the record panel and the attach form); address the form by its name.
