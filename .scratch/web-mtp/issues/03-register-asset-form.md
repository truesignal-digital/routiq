# 03 — Register-asset form

**What to build:** An asset manager registers a truck/trailer/bus/van from the phone: template-driven custom fields, category select from seeded presets, XAF money entry, evidence-ready. First real form; sets the pattern for all others.

**Blocked by:** 01, 02. (Backend dependency: `GET /v1/categories` read — request from spine session; reads/ is UI-owned so the UI session may build it itself, GET only.)

**Status:** ready-for-human

- [x] Form fields mirror `registerAssetPayload` from contracts (no local re-definition); assetId generated client-side at form open
- [x] Asset class select populated from categories (ASSET_CLASS kind, bilingual labels per active locale); template select TRUCKING/PASSENGER_TRANSPORT drives which custom-value fields render (axleCount/bodyType/tonnageCapacity vs seatCount/lineType, required markers honored)
- [x] Acquisition amount entered and displayed as XAF minor units via the shared money helper — no /100 anywhere
- [x] Submit via command client; success navigates to the assets list with the new row visible; TEMPLATE_FIELD_INVALID marks exact fields; DUPLICATE_ASSET_CODE shown on the code field
- [x] Double-tap/retry proven safe in a test (one asset row semantics via idempotentReplay handling)
- [x] Usable at 360px in French

## Comments

- Done (2026-07-23, web-ui). The web-foundation form already covered most criteria (shared-contract resolver, template-driven custom fields with required markers, replay-safe submit, field-level TEMPLATE_FIELD_INVALID); this ticket added the gaps: full payload mirror (chassisNumber, acquisitionDate, acquisitionAmountMinor — no local re-definition anywhere), XAF entry as integer minor units with a live `formatXAF` preview from `@asset/domain` ("45 000 000 FCFA", zero /100 anywhere), `DUPLICATE_ASSET_CODE` lands on the code field via setError.
- `GET /v1/categories?kind=` built in reads/ (UI-owned per the queue note): kind-validated, workspace-scoped, active-only, bilingual labels — the form keeps using the richer `/v1/reference/asset-registration`; `/v1/categories` serves ticket 06 (DOCUMENT_TYPE verified live: Assurance/Permis).
- Double-tap proven by test: two concurrent submits of one payload post byte-identical envelopes; the replay resolves as plain success (plus the earlier live kill-API-retry proof → one row).
- Verified e2e on :5435: registered DLA-T-011 with 45 000 000 XAF → stored `acquisition_amount_minor=45000000`. 57 web tests + full suite green, typecheck clean.
