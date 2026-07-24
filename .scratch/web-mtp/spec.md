# Spec: Web MTP — screens on the spine

Status: ready-for-agent
Source: spine spec `.scratch/spine/` (all 10 tickets shipped); ARCHITECTURE.md §6 (offline direction), §8 (stack), §9 (reports later); backend session's UI recommendations (2026-07-23, session transcript)
Owner: UI session (branch `web-ui`, worktree `../routiq-web`) — per the UI session working agreement. Backend dependencies are called out per ticket and belong to the spine session on `main`.

## Problem Statement

The command write path is complete and proven (register → commission → assign → document, 85 integration tests), but an operator cannot use any of it: the web app has login, a shell, and an assets list. Every capability the backend guarantees — idempotent retries, optimistic concurrency, stable French errors, module gating, evidence attachments, append-only document chains — is invisible until a screen exercises it. The risk isn't missing screens; it's screens built AGAINST the grain (regenerated idempotency keys, hand-built fetches, English error text) that silently forfeit those guarantees.

## Solution

Build the MTP screens as thin skins over the spine's contracts, with the existing command client as the single write path in the browser — the exact mirror of the server's single write path. Harden the foundations first (client retry semantics, complete error map), then ship vertical slices: register form, lifecycle actions, attachments, documents. Everything speaks `@routiq/contracts`; nothing invents shapes.

## What already exists (do not rebuild)

- `src/commands/client.ts` + `store.ts` — command client and store (harden per ticket 01, don't replace)
- `src/auth/` + `LoginScreen` — PIN login, session-store token
- `src/shell/AppShell` + sections, `src/assets/` list with TanStack Query, i18n (fr/en, ICU)
- Backend read: `GET /v1/assets` (`apps/api/src/reads/assets.ts`)

## Implementation Decisions

- **One write path in the browser.** Every mutation goes through the command client: client-generated `commandId`/record UUIDs/`idempotencyKey` (crypto.randomUUID), `expectedVersion` on mutations, typed results discriminated on `@routiq/contracts` error codes. No screen ever fetches `/v1/commands` directly.
- **Retry = identical envelope.** Timeout/double-tap resubmits the same key + commandId; `idempotentReplay: true` renders as plain success. A key is generated once per user intent, never per attempt.
- **Errors are codes until the last moment.** One i18n map keyed by `ApiErrorCode`, fr-CM default + en, ICU for metadata interpolation. Unknown code → generic fallback + console log. `TEMPLATE_FIELD_INVALID` metadata marks the exact offending fields on the form.
- **`/v1/me` drives the shell.** Role gates every action button (EXECUTIVE_VIEWER sees zero submit affordances); branch scope pre-filters lists; `enabledModules` (backend adds to /v1/me) gates nav sections.
- **Conflict and approval are first-class states.** `VERSION_CONFLICT` → reload-and-reapply prompt, never silent overwrite. `APPROVAL_REQUIRED` → informative "requires approval" state visually distinct from errors (cross-branch transfer hits this by design until financial-core).
- **Money is XAF exponent 0.** `Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF' })` over minor units as-is. Never divide by 100 (guarded by shared helper, not per-screen discipline).
- **Target device is a low-end Android in sunlight.** 360px-first, one-column forms, big touch targets, PIN pad not text field, French strings tested at width (~20% longer than English).
- **Offline is a seam, not a feature yet.** The command client's queue-shaped interface is the future Dexie outbox; this spec ships online-only behavior behind that seam. No sync UI, no service-worker outbox yet (§6 lands in a later spec).
- **No migrations, no api internals** — per the working agreement: `apps/web/**`, `src/reads/**` (GET only), contracts additions only. Backend needs route through the spine session.

## Testing Decisions

- Unit/component level with Vitest: error-map completeness (every code in `@routiq/contracts` has fr AND en entries — a meta-test, same philosophy as the backend's registry guards), command-client retry semantics against a mocked fetch, form validation states.
- One happy-path flow per screen ticket against the real dev API (manual or scripted against compose Postgres on 5435) before merging its slice to main.
- Playwright e2e deferred to the offline spec (where it earns its cost).
