# 03 — Workspace branding: fields + command + render points

Status: needs-triage

## What

- Schema: `workspaces.display_name`, `workspaces.logo_artifact_id`, `workspaces.brand_color` (single accent hex). Logo stored via S3 API like any artifact (on-prem portability, ARCHITECTURE.md §6a).
- Command: `update-workspace-branding.v1` (contracts payload + handler + test, per CLAUDE.md three-place rule).
- Render: PWA header, login screen once workspace known, report headers. Accent color as one CSS variable (Tailwind 4 CSS-first). Logo cached for offline.

## Why

Companies see their own brand in the tool from day one; collected during onboarding step 6.

## Out of scope

- Dynamic PWA manifest/splash per tenant.
- Any theming beyond one color + logo + name — full white-label theming is the config-engine trap.
