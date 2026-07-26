# Onboarding: new business setup without a config engine

Status: draft — captured from design discussion 2026-07-23 (Linus + Claude). Not scheduled; post-MTP except where noted.

## Philosophy

- **No config engine yet.** Variance stays config-as-data (categories, required-field lists, `custom_values`, approval thresholds, document lead times, `workspace_modules` flags). ARCHITECTURE.md §13 / decision 24 hold.
- **Concierge onboarding is the strategy at pilot scale**, not a gap. Each manual onboarding is market research: the knobs a business forces us to touch are the requirements list for a future config engine. Promote a knob to self-serve config only when a third business needs it (rule of three).
- **Escalation ladder:** config-as-data (now, 2 tenants) → promote repeated knobs to first-class tables (~5–10 tenants) → declarative rules interpreter only when data-shaped config stops covering variance. Never a visual builder before the variance is known.
- **Trigger signal to watch:** any `if (workspaceId === X)` or per-tenant fork in a handler means that axis must move into config data immediately.
- **Config mutations go through the command pipeline** like everything else (`enable-module.v1`, `update-approval-threshold.v1`, …). Config is then versioned, audited, has provenance, replays offline, and exports with the workspace. This is the one guard worth enforcing early so a future engine inherits clean history.

## Onboarding flow (all through the command layer, no special path)

1. **Create workspace** — defaults XAF / Africa/Douala / fr-CM.
2. **Enable modules** — `workspace_modules` rows for what the business needs.
3. **Create branches** — one per depot/office.
4. **Memberships + credentials** — five default roles, username/PIN users.
5. **Apply starter pack** — prebuilt per-business-type seed bundle (trucking ≠ passenger): asset categories, expense categories, document types + lead times, required-field lists, approval thresholds. Pack = versioned data file replayed as commands, not code.
6. **Collect branding** — logo file, accent color, display name (see Branding below).
7. **Import existing fleet** — CSV import adapter (already an architecture command origin): assets, opening meter readings, active documents (insurance, vignette dates).
8. **First-week accompaniment** — adjust categories/thresholds live via commands as reality hits; log every adjustment as future-config evidence.

Run by Linus/partners initially; checklist doc makes it runnable by partners alone (issue 02).

## Branding (tenant brand + our brand)

**Tenant brand — 3 fields, deliberately not a theming engine:**
- `workspaces.display_name`, `workspaces.logo_artifact_id` (stored via S3 API like any artifact — on-prem portability holds), `workspaces.brand_color` (one accent hex).
- Mutation via `update-workspace-branding.v1`.
- Render points: PWA header, login screen (once workspace known), report headers. Accent color = one CSS variable (Tailwind 4 CSS-first). Logo cached for offline.
- Out of scope at MTP: dynamic PWA manifest/splash per tenant (offline precache complexity, low payoff); any broader theming.

**Our brand — "powered by" marketing channel:**
- Best surface is artifacts that leave the app: PDF/printed reports get discreet footer "Généré par <brand>" + URL (audience: insurers, owners, banks, partners — exactly who Azalea & Ange want reached). CSV exports get a brand header line. Login screen gets a small mark.
- fr-CM first, like everything.
- **Monetization lever:** "powered by" is non-removable at standard tier; white-label (footer removal) reserved as a future paid tier. Zero code now — just never promise removability.

## Issues

- 01 — starter packs as versioned data files + replay script
- 02 — onboarding playbook/checklist for partners
- 03 — workspace branding fields + command + render points
- 04 — "powered by" marks on outbound artifacts
