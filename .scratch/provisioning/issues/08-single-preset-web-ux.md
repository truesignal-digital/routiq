# 08 — Single-preset web UX

Status: resolved
Blocked by: 07

Roadmap item 2, web half. ADR-0004: "a single-preset workspace gets single-preset UX with no template picker." Today the web shows both business types to every tenant.

## Requirements

- Source of truth: `enabledPresets` from `/v1/me` (issue 07), surfaced wherever the web already holds `enabledModules` (find the session/me store and mirror the pattern).
- Mapping: sheet template `journey` ↔ `PASSENGER_TRANSPORT`, `haulage` ↔ `TRUCKING`. Put the mapping in one exported place (likely `apps/web/src/activities/sheet-model.ts`), not inline in screens.
- `ActivitySheetScreen` (`apps/web/src/screens/ActivitySheetScreen.tsx`): when one preset is enabled, no template switcher — render the single template directly (default template = the enabled one, URL/template param outside the enabled set falls back to it). Two presets → current behavior.
- `AssetRegisterScreen`: `templateCode` picker hidden when one preset; the field auto-set to it. Two → current behavior.
- Sweep for other preset-choice surfaces (grep web src for TEMPLATE_CODES / templateCode / journey-haulage switches, non-test) and collapse them the same way; list what you found in Comments.
- Grandfathered tenants (both presets returned) keep today's UX — no special casing beyond what 07 returns.
- Tests: single-preset → no switcher, correct template preselected, asset register auto-set; dual-preset → switcher present. Mirror the existing screen-test style (the repo has extensive screen tests).
- i18n: no new user-facing strings expected; if any are needed, fr + en both.

## Caution

`ActivitySheetScreen.tsx`, `sheet-model.ts` and several activities files are uncommitted work from the activities workstream sitting in the tree. Build on them as they are; keep edits minimal and scoped so the diff stays reviewable.

## Acceptance

- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @routiq/web test` full green
- [ ] Manual check note: which screens collapse for a single-preset tenant

## Comments

2026-07-30 — Done. Sweep result: **exactly two surfaces let a user choose a
preset**, and both now collapse.

1. `ActivitySheetScreen` — the journey/haulage `Tabs` switcher. Hidden when one
   preset; the form renders that flavour's fields directly.
2. `AssetRegisterScreen` — the `templateCode` `Select`. Hidden when one preset;
   the field is auto-set to it (so the passenger template's required
   `seatCount` appears without the user picking anything).

Everything else that mentions `journey`/`haulage`/`templateCode` is a *rendering*
branch driven by the already-chosen template, not a choice offered to the user,
and was deliberately left alone:

- `sheet/form.ts`, `sheet/LegRows.tsx`, and the flavour-specific field blocks in
  `ActivitySheetScreen` (seats vs cargo, passenger count vs load state).
- `router.tsx:96` keeps `template: z.enum(["journey","haulage"]).optional()`.
  The URL vocabulary should not depend on tenant config; the screen falls back
  to an enabled flavour when the param names one the workspace does not run.
- No link anywhere passes `?template=`, so there is no nav entry to collapse.

Mapping lives once in `sheet-model.ts` (`SHEET_TEMPLATE_PRESET` +
`sheetTemplatesFor`); no screen re-states journey↔PASSENGER_TRANSPORT.

Late-`/v1/me` note: both screens correct themselves in an effect rather than
only at mount, because the form can mount before `/v1/me` answers. Until it
answers, both presets are offered — same as today's behaviour, and the server is
the enforcement point regardless.

No new i18n strings were needed.

2026-07-30 (review) — Approved. Verified the mount-race fix flagged during review: ActivitySheetScreen corrects via soleTemplate effect + tabs gated on templates.length > 1; AssetRegisterScreen corrects templateCode in an effect when /v1/me lands with the current value outside the enabled set (a PASSENGER-only tenant can no longer submit the frozen TRUCKING default and trip PRESET_DISABLED). SHEET_TEMPLATE_PRESET mapping declared once in sheet-model.ts. typecheck green; web suite 75 files / 758 tests pass (+5). Uncommitted — rides with the activities workstream tree.
