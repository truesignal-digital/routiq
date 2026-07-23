# Spec: Web Foundation — Shell, Auth, First Asset Flow

Status: ready-for-agent
Source: UI grilling session 2026-07-22 (this spec's decisions were resolved one-by-one with the user); ARCHITECTURE.md v0.2 (§3.3a, §6, §6a, §8, §10); ADR-0001; spine spec `.scratch/spine/spec.md` (the API this UI consumes)

## Problem Statement

The platform has (or is growing, in a parallel build) a trustworthy command API — but no way for a human to use it. The pilot operators' staff are French-first, phone-first, on low-end Android over MTN/Orange mobile data, and they currently run fleets on paper. Until a clerk can log in, see the fleet, and register a truck with a photo from the device in their pocket, the spine is invisible: partners can't react to it, pilots can't start, and every later module (activities, finance) has no surface to land on.

## Solution

Build the web foundation as one walking skeleton: an installable, mobile-first PWA shell — login, module-driven navigation, and the first real flow (asset list → register an asset with photos → see it appear). Every foundational layer is proven by that one path: routing, auth session, i18n (fr-CM first), the design system, the command client with its in-flight status store, workspace-scoped data fetching, and upload-on-selection photo capture. The remaining asset-register screens (commission, assign, documents) become mechanical follow-ups on an established foundation.

## User Stories

1. As a field clerk, I want to sign in with the username and PIN my admin gave me, so that I can use the system without owning an email address.
2. As a field clerk on a shared device, I want the login to remember usernames but always require my PIN, so that switching users is quick but never automatic.
3. As a clerk, I want my session to survive two weeks without re-login (PIN re-prompt on expiry only), so that spotty connectivity doesn't lock me out of my own tool.
4. As a clerk on a low-end Android phone, I want the app installable to my home screen and opening full-screen, so that it feels and launches like an app, not a bookmark.
5. As a French-speaking clerk, I want the entire interface in French by default, so that I never guess at a label; and as an English-speaking manager, I want to switch to English in my profile and have it stick on my device.
6. As an asset manager, I want to see my fleet as a list scoped to what my role and branch allow, so that I see my vehicles and nothing else.
7. As an asset manager, I want to register a truck, trailer, bus, or van from my phone — category from my company's presets, capacity, template-specific fields — so that the fleet record starts life in the system, not on paper.
8. As an asset manager, I want to attach photos while filling the form and watch each one upload as I pick it, so that a 3-photo registration doesn't end in one long spinner and a timeout that loses everything.
9. As an asset manager, I want a photo that fails to upload to show a retry chip without blocking the form, so that a network dip never costs me the registration.
10. As an asset manager, I want to see the submission's true state — sending, confirmed, or rejected with a reason in French — so that I never wonder whether a record actually exists.
11. As an asset manager, I want a resubmission after a network failure to be safe (never a duplicate asset), so that retrying is always the right move.
12. As a user whose command is rejected, I want a precise French message telling me whether to fix the form, get an approval, or call my admin, so that a stable error code never surfaces as jargon.
13. As a user of a workspace with modules disabled, I want the navigation to show only the sections my workspace has enabled, so that the app never advertises features I can't use.
14. As a multi-branch user, I want to see and switch my branch context from the header, so that I always know which agency I'm acting in.
15. As a desktop user (owner, back-office), I want the same app with a persistent sidebar instead of bottom tabs, so that the big screen is used well without a separate product.
16. As a clerk in sunlight with a cracked screen, I want high contrast and large touch targets, so that the app is usable in the field, not just in the demo.
17. As the developer, I want every form submission to go through one command client that owns envelopes, idempotency, and status, so that the offline outbox later swaps the transport without touching a single form.

## Implementation Decisions

All resolved in the grilling session; each was an explicit user decision.

**Layout & shell**

- Mobile-first everywhere; no desktop-only screens. Desktop is the responsive expansion of the same layouts.
- Shell navigation: bottom tab bar at mobile widths ↔ persistent left sidebar at desktop widths — same component contract, same data.
- Nav sections are server-driven from the workspace's enabled modules (§3.3a read API); the UI never hardcodes section lists. This slice renders Assets + a More/profile section from the real module list.
- Branch context lives in the header as a switcher for multi-branch users, not in navigation.

**Command client (the seam everything writes through)**

- One command client module; forms hand it a command name + payload and never see HTTP.
- Envelope generation helpers (command id, idempotency key, `expectedVersion` wiring) live in the contracts package — shared with the future React Native client.
- Idempotency key is created when the user starts a submission and reused across retries of that submission — the §5.3 replay guarantee surfaced to the UI.
- Per ADR-0001: no optimistic cache patches. The command client exposes an in-flight command store (`submitting → committed | rejected(code)`); UI renders server truth plus explicit pending indicators. The offline outbox later extends this store with a `queued` state — same vocabulary, new transport.

**Auth UX**

- One login screen: username + PIN. Numeric-friendly input triggering the number keyboard on mobile, behaving as a password field on desktop.
- Session persists via refresh token (≥ 14 days per §6); expiry re-prompts PIN only, username remembered per device.
- Sessions stored keyed by username (never one global blob) so shared-device fast-switching can land later without a redesign. Fast user switching itself is deferred to the offline spec.
- Logout under More/profile.

**i18n**

- i18next + ICU; fr-CM default, en switchable in More/profile, persisted per device; no locale auto-detect override.
- API error codes are translation keys in one `errors.*` namespace; the codes catalog lives in contracts so clients and API stay in sync. Unknown code → generic message + raw code displayed for support.
- Server-side bilingual data (category labels) renders from the data per active locale — never duplicated into translation files.
- ICU plurals/interpolation only; no sentence concatenation; both languages tested at mobile widths.

**Design system**

- Seeded via `pnpm dlx shadcn@latest apply --preset b0` (user-specified; verify the command against the current shadcn CLI at implementation time — it is the starting point, components are built on top). The preset wins on theme/fonts where it conflicts with the defaults below.
- Light mode only at MTP; high contrast for sunlight; touch targets ≥ 44px; generous text sizes.
- System font stack, zero webfont downloads.
- Components sized against French label lengths (fr runs ~20–30% longer than en).

**Read side**

- TanStack Query over plain REST GET views (asset list, asset detail, enabled modules); server shapes responses per view, no client-side joins.
- Query keys scoped by workspace id — the cache can never leak across a workspace switch.
- No query-cache persistence plugin; the Query cache is not offline storage (§8). Durable state arrives with Dexie in the offline spec.
- After a command commits: invalidate affected queries and refetch. No cache patching (ADR-0001).

**Photos**

- Upload on selection, not on submit: each picked photo immediately runs presign → PUT → finalize with per-photo progress and a retry chip on failure; submit references finalized artifact ids. Mirrors §6's "blobs first" replay ordering.
- Client-side downscale before upload (receipts must stay legible per §8; full-resolution photos are pointless weight).
- Camera and gallery both allowed; photos are optional on RegisterAsset — a missing or failed photo never blocks registration (warn-don't-block culture).

**PWA**

- Web app manifest + icons now: installable, standalone display. No service worker at this slice — Workbox arrives with the offline spec, avoiding stale-bundle traps during heavy iteration.

## Testing Decisions

- **What a good test is here:** proof through the highest seam that a user-visible flow works against the real stack — not assertions on component internals or mocked fetches.
- **Primary seam: Playwright end-to-end** — real browser, real API, real Postgres (the spine's Testcontainers harness proves the stack boots; the E2E suite runs against the same composed stack). One smoke path for this slice: login with username/PIN → asset list renders (fr) → register an asset with a photo → in-flight state visible → asset appears in the list. Failure-path variants: wrong PIN → French error; duplicate submission retry → single asset.
- **Pure unit seam: command client** — envelope generation, idempotency-key stability across retries of one submission, status-store transitions (`submitting → committed | rejected`). Pure functions, no DOM; prior art is the existing contracts package tests.
- **No component-test layer at this slice** — screens are proven by the E2E path; a component test appears later only where logic genuinely lives in a component. Confirmed with user this session.
- Both-language rendering at mobile widths is part of the E2E assertions (fr default, switch to en).

## Out of Scope

- Commission, assign, and document screens (mechanical follow-ups after this slice; the forms ride the same command client).
- Offline capture: service worker, Dexie outbox, branch snapshot, queued-state persistence, fast user switching on shared devices (all in the offline spec; this slice only keeps their seams open — command status store, per-username sessions, manifest).
- Notification bell (wayfinder ticket 11 pending; §5.5).
- Composite sheet forms (partner-gated field lists, ticket 01).
- Dark mode; webfonts; brand identity beyond the preset (neutral base + one accent decided at implementation).
- Cloudflare Pages deployment wiring (hosting decisions ride wayfinder ticket 03).
- Any AI surface.

## Further Notes

- ADR-0001 (`docs/adr/`) records the optimistic-updates rejection and the command-status-store decision — future readers start there.
- This spec depends on spine tickets 02 (auth), 03 (pipeline + RegisterAsset), and 09 (artifacts/storage) being implemented in the parallel session; UI tickets touching photos block on 09's API existing. The `/to-tickets` breakdown should declare those cross-spec blockers explicitly.
- The web package is currently a 10-line placeholder — greenfield; no migration concerns.
- Dependency pins per §8 are locked at the baseline commit (TanStack Router 1.170 / Query 5.101, i18next 26, vite-plugin-pwa 1.3); do not bump during implementation.
