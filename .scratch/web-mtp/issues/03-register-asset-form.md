# 03 — Register-asset form

**What to build:** An asset manager registers a truck/trailer/bus/van from the phone: template-driven custom fields, category select from seeded presets, XAF money entry, evidence-ready. First real form; sets the pattern for all others.

**Blocked by:** 01, 02. (Backend dependency: `GET /v1/categories` read — request from spine session; reads/ is UI-owned so the UI session may build it itself, GET only.)

**Status:** ready-for-agent

- [ ] Form fields mirror `registerAssetPayload` from contracts (no local re-definition); assetId generated client-side at form open
- [ ] Asset class select populated from categories (ASSET_CLASS kind, bilingual labels per active locale); template select TRUCKING/PASSENGER_TRANSPORT drives which custom-value fields render (axleCount/bodyType/tonnageCapacity vs seatCount/lineType, required markers honored)
- [ ] Acquisition amount entered and displayed as XAF minor units via the shared money helper — no /100 anywhere
- [ ] Submit via command client; success navigates to the assets list with the new row visible; TEMPLATE_FIELD_INVALID marks exact fields; DUPLICATE_ASSET_CODE shown on the code field
- [ ] Double-tap/retry proven safe in a test (one asset row semantics via idempotentReplay handling)
- [ ] Usable at 360px in French
