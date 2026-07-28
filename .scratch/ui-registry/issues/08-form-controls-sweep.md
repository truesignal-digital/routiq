# 08 — Form-controls sweep and the second file-upload component

Status: ready-for-human
Phase: 1
Blocked by: 02

**What to build:** Every raw `<select>` becomes the Base UI `Select`, every raw `<textarea>` becomes the vendored `Textarea`, ad-hoc field wrappers become `FormItem`/`FormLabel`/`FormMessage`, and the duplicate upload component `artifacts/AttachmentField.tsx` is deleted in favour of `ui/file-upload.tsx`.

## Context

Audit §4.6 — **form controls are barely adopted.** The Base UI `Select` (`src/components/ui/select.tsx`) is used in exactly one screen (`FinanceRecordScreen`, three fields, pattern at `:302-324`). Six sites use a raw `<select>` with copy-pasted `min-h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm`: `AssetRegisterScreen.tsx:143,164,186,322`, `AssetDocumentsScreen.tsx:299`, `FinanceEntriesScreen.tsx:116`; `AssetActions.tsx:125` uses yet another size (`min-h-9 text-xs`). The vendored `Textarea` is used once (`FinanceRecordScreen.tsx:478`); four dialogs use a raw `<textarea>` with copy-pasted classes: `FinanceApprovalsScreen.tsx:341` and `:352`, `FinancePeriodsScreen.tsx:343`, `FinanceEntryDetailScreen.tsx:352`. The RHF field wrapper trio is used in two screens; five others use a plain `div.flex.flex-col.gap-2` + `Label`.

Audit §4.7 — **two file-upload components.** `src/components/ui/file-upload.tsx` (dropzone, previews, progress) and `src/artifacts/AttachmentField.tsx` (button + list, sha256, retry) are both live: `AttachmentField` at `AssetRegisterScreen.tsx:374`, `FileUpload` at `FinanceRecordScreen.tsx:527` and `AssetDocumentsScreen.tsx:354`. Their props are near-identical (`onChange`, `onUploadingChange`, `uploadImpl` — see `AttachmentField.tsx:19-28`) but they use different i18n namespaces: `attachments.*` (`fr.json:162-168`) versus `fileUpload.*` (`fr.json:169-180`). `AttachmentField` is the un-migrated predecessor.

Ticket 02 restored the `FormField` → `field` contract; this ticket is where the rest of the app starts using it.

## Tasks

- [ ] Convert the raw `<select>` sites to the Base UI `Select`, following `FinanceRecordScreen.tsx:302-324`: `AssetRegisterScreen.tsx:143,164,186,322`, `AssetDocumentsScreen.tsx:299`, `AssetActions.tsx:125`. Placeholders and option labels come from the locale files — no hardcoded strings, no size fork for `AssetActions` beyond the primitive's own size prop if one exists.
- [ ] Convert the four raw `<textarea>` dialogs to the vendored `Textarea`: `FinanceApprovalsScreen.tsx:341,352`, `FinancePeriodsScreen.tsx:343`, `FinanceEntryDetailScreen.tsx:352`.
- [ ] Replace ad-hoc `div` + `Label` field wrappers with `FormItem`/`FormLabel`/`FormMessage` in `AssetDocumentsScreen` and the dialog forms. Where a form is still `useState`-driven rather than RHF, either lift it to RHF (preferred, matching `AssetRegisterScreen`) or use the wrappers' non-RHF-safe subset — do not fake a form context.
- [ ] Delete `src/artifacts/AttachmentField.tsx` and migrate `AssetRegisterScreen.tsx:374` to `FileUpload`, preserving the current contract: `onChange` publishes finalized artifact ids in pick order, `onUploadingChange` blocks submit while uploads are in flight, `uploadImpl` stays injectable for tests. Keep `src/artifacts/upload.ts` (`downscaleImage`, `uploadArtifact`) and its tests untouched.
- [ ] Merge the `attachments.*` keys into `fileUpload.*` in both `fr.json` and `en.json` and delete the `attachments` namespace. Preserve any string only `AttachmentField` had (retry, add-photo). `src/i18n/locales.test.ts` enforces exact key parity.
- [ ] Extend `src/components/ui/file-upload.test.tsx` with the asset-registration path (uploading state blocks submit; finalized ids reach `onChange`).

## Acceptance

- [ ] `grep -rn "<select\|<textarea" apps/web/src` returns nothing outside `src/components/ui/`
- [ ] `src/artifacts/AttachmentField.tsx` is gone and no import of it remains; `grep -rn "attachments\." apps/web/src` returns nothing
- [ ] Asset registration still submits with evidence attached, and still refuses to submit mid-upload (covered by a test)
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green
- [ ] jsdom command-routing regression tests stay green (`apps/web/src/commands/client.test.ts`)

## Out of scope

`FinanceEntriesScreen.tsx:116` and the rest of that filter bar — ticket 11 replaces it with DataTable v2's declarative filter config, so do not convert it here. `LoginScreen` adopting `Form` (ticket 14). The file-storage upload failure seen in devtools (artifact `PUT` failing) — that is API-side and filed separately per the spec.

## Comments

- 2026-07-27 [codex] worker: committed (ui-registry 08). 6 selects + 4 textareas converted, AttachmentField deleted, namespaces merged. Deviation accepted: dialog div+Label wrappers kept (single-field useState dialogs — RHF lift not worth the churn); revisit only if dialogs grow fields. 532 tests.
