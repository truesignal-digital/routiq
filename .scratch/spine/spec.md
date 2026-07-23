# Spec: The Spine — Command Write Path + Asset Register

Status: ready-for-agent
Source: ARCHITECTURE.md v0.2 (§3, §4, §5.3, §6a, §10, §11 steps 1–2); wayfinder map `.scratch/mtp-pilot/`; research `.scratch/mtp-pilot/research/buildable-now.md` (items B1–B6)

## Problem Statement

Transport operators in Cameroon (trucking + passenger transport) run their businesses on paper and memory. Nothing they record is trustworthy later: records get edited, nobody knows who changed what, money figures don't reconcile, and compliance documents expire unnoticed. The platform's entire value rests on one guarantee — every recorded fact is attributable, tamper-evident, and tenant-isolated — and that guarantee has no home until the command write path exists. Today the repo is a scaffold: there is no way to authenticate, no way to submit a command, and no business table beyond tenancy seeds. Nothing else (activities, finance, maintenance, reports, offline) can be built until this spine stands.

## Solution

Build the single write path end to end, and prove it with the first real module: the asset register.

Every mutation — from web form, offline replay, CSV import, or future AI agent — becomes a named, versioned command posted to one endpoint, flowing through one fixed pipeline: authenticate → authorize (role, branch) → module enabled → idempotency lookup → schema validation → optimistic concurrency → reference validation → state-transition checks → domain invariants → approval-rule evaluation → atomic commit of records + command receipt + append-only audit event in one transaction.

On top of that pipeline, ship the asset register: categories with the two template presets, asset registration/commissioning/assignment, compliance documents with supersede-on-renewal, and photo/artifact capture through S3-only storage. An operator's back office can then hold its fleet in the system with full provenance — and every later module rides the same rails without touching them.

## User Stories

1. As a workspace admin, I want every staff member to sign in with credentials I provision (username/PIN for field roles), so that clerks and drivers without email addresses can use the system on shared phones.
2. As a workspace admin, I want each member to hold exactly one of the fixed roles with a branch scope, so that a Douala clerk cannot touch Yaoundé records.
3. As a workspace admin, I want to enable or disable application modules for my workspace as an audited action, so that features can be turned on per client without deleting data or migrating schema.
4. As an operations manager, I want every change in the system to record who did it, when, from where (web, offline sync, import), and what it changed, so that I can trust records enough to base pay and disputes on them.
5. As an operations manager, I want submitting the same form twice (double-tap, flaky network retry) to produce exactly one record, so that duplicated trucks or documents never appear.
6. As a field clerk, I want a retried submission after a timeout to return the original result rather than an error, so that I never have to guess whether my entry went through.
7. As a field clerk, I want a clear, stable error in French when my submission is rejected, so that I know whether to fix the form or call the manager.
8. As an asset manager, I want to register a truck, trailer, bus, or van with its category, capacity, and template-specific extras, so that the fleet exists in the system with the fields that matter for my line of business.
9. As an asset manager, I want to commission a registered asset into service, so that lifecycle status reflects reality before any activity is recorded against it.
10. As an asset manager, I want to assign an asset to a branch or custodian, so that responsibility for each vehicle is always current.
11. As an asset manager, I want two people editing the same asset to be detected (the second save is rejected with a conflict), so that concurrent edits never silently overwrite each other.
12. As an asset manager, I want a disposed/retired/written-off asset to accept no new operational records, so that dead assets cannot accumulate ghost data.
13. As a compliance clerk, I want to record insurance, permits, and licenses per asset with expiry dates, so that the document expiry report (later) has real data.
14. As a compliance clerk, I want renewing a document to create a new version that supersedes the old, never editing the original, so that the paper trail of what was valid when is preserved.
15. As a field clerk, I want to attach photos and receipts to my submissions, so that evidence lives with the record; and I want those artifacts immutable and hashed, so that nobody can swap a receipt after the fact.
16. As an executive viewer, I want read access without any write permission, so that the owner can inspect without risk of accidental changes.
17. As a company owner, I want absolute certainty that no other tenant can ever see or reference my data — even through a bug — so that I can put real financials into a shared platform.
18. As a workspace admin, I want the audit history to be un-editable even by the system's own database user, so that the audit log is evidence, not opinion.
19. As an offline user (later phase), I want my client-generated record IDs and idempotency keys honored by the server, so that records I created offline keep their identity after sync.
20. As an operations manager, I want a cross-branch asset transfer to require an approval rather than take effect silently, so that vehicles do not move between agencies without oversight.
21. As a future AI integration, I want to act only as a restricted principal through the same commands and checks as humans, so that automation can never bypass the rules (build-time requirement: nothing in the pipeline assumes a human).
22. As a developer, I want adding a new command to require only a payload schema, a handler, and a registration — with the pipeline supplying auth, idempotency, audit, and transactions — so that every subsequent module (activities, finance, stock) is cheap and uniform.
23. As a developer, I want the API deployable from the same Docker Compose that runs dev, so that the on-prem appliance path (§6a) stays open at zero extra cost.

## Implementation Decisions

**Command pipeline (the core deliverable)**

- One HTTP surface for all mutations: a single versioned command endpoint taking the command name, envelope, and payload. The envelope schema already exists in the contracts package; tenant, actor, and branch are never read from the request — always derived from authentication.
- Pipeline order is fixed per §5.3 and identical for every command and caller. Handlers implement only reference validation, state-transition checks, domain invariants, and writes; everything before that is the dispatcher's job, written once.
- Idempotency: `(workspace_id, idempotency_key)` unique. Exact retry (same key, same payload hash) returns the stored original outcome with an idempotent-replay marker; same key with a different payload returns a conflict (409). The receipt row stores the outcome to make replay possible.
- Atomic commit: business rows, command receipt, and audit event(s) commit in one Postgres transaction, with `SET LOCAL app.workspace_id` applied at transaction start (pool-safe RLS). No partial states are observable.
- Audit events carry full before/after state JSONB, changed fields, actor membership, command id, and entity refs. Append-only.
- Optimistic concurrency: envelope's `expectedVersion` checked against `row_version` where supplied; mutating commands on existing rows require it.
- Command outcomes and all API errors are stable machine codes (never English sentences), with metadata for the client to localize. fr-CM is the default client locale.
- Every business row carries `created_by_command_id`; UUIDs are client-generatable.

**Auth & RBAC (thin interface — §6a guard 1)**

- Identity verification sits behind one narrow app-owned interface; Supabase Auth is the cloud implementation, and the username/PIN field-role path is app-owned from day one. No Supabase types or SDK calls leak past the interface (on-prem swaps the implementation, not the callers).
- Memberships link a principal to a workspace with exactly one of the ~6 fixed roles (admin, ops manager, field submitter, maintenance, finance approver, executive viewer) and a branch scope. Roles are a fixed code-level registry, not tenant-configurable.
- `principal_type` (HUMAN | AI_AGENT | INTEGRATION) is respected throughout; nothing in the pipeline may assume HUMAN.

**Tenant isolation (M1 migration — the three layers of §4.4)**

- Layer 1: pipeline derives workspace from auth and scopes every query.
- Layer 2: RLS on `workspace_id` with `FORCE ROW LEVEL SECURITY` on all tenant tables; runtime role without BYPASSRLS; `SET LOCAL app.workspace_id` per transaction.
- Layer 3: composite tenant FKs — `FOREIGN KEY (workspace_id, referenced_id)` — on every cross-table reference.
- Runtime DB role gets UPDATE/DELETE revoked on `audit_events` (and on posted financial/stock rows when those land in later specs).

**Module entitlements (§3.3a)**

- One `workspace_modules` table; module codes are a fixed registry in code, each declaring the commands it owns. The pipeline gains exactly one check (module enabled) after authorization; no per-feature conditionals in handlers.
- EnableModule / DisableModule commands, admin role, audited. Spine registers module codes at least for ASSETS and DOCUMENTS.

**Approval evaluation (step only — engine is a later spec)**

- One `approval_rules` table (command type, category, branch, amount range, required role) and a pipeline evaluation step. Safe default when no rule matches: require review.
- Spine seeds rules so its own commands run per catalog defaults (register/commission/assign auto; cross-branch assignment requires one approval). The pending-approval flow itself (submitted state, approve action, maker ≠ approver) ships with the financial-core spec; until then a command that evaluates to "requires approval" is rejected with a stable `APPROVAL_REQUIRED` code. Cross-branch transfer is therefore recorded-but-unusable until that spec — accepted.

**Asset register (§3.1, §3.3, catalog rows 1–3 + AddOrRenewDocument)**

- `categories` table (asset classes, activity types, revenue/expense categories, document types, issue types) with bilingual labels; TRUCKING and PASSENGER_TRANSPORT preset seed data defined in code.
- `assets` table: lifecycle status separate from availability; capacity + template extras in `custom_values` JSONB validated in the command layer against a typed per-template field list; `template_code` + version stamped on every record.
- Commands: RegisterAsset (contract exists already), CommissionAsset, AssignAsset (branch/custodian), AddOrRenewDocument. Renewal inserts a new row with a supersedes reference; originals are never edited.
- Lifecycle invariant enforced in the pipeline: SOLD / RETIRED / WRITTEN_OFF assets accept no new operational records.
- `source_artifacts` table: immutable, SHA-256 hashed, private object storage refs; linked many-to-many to commands via the envelope's artifact ids.

**Storage (§6a guard 2)**

- All object storage access through the S3 API only — presigned URLs via standard SigV4 (not Supabase `createSignedUrl`), MIME checked by content, EXIF location stripped for photos. One storage interface, cloud implementation now; the resumable-upload question (wayfinder ticket 14) affects only the on-prem implementation later and does not block this spec.

**Explicitly derived-not-stored**

- No lifecycle-event table: the asset timeline is a query over audit events + domain tables (§3.1).

## Testing Decisions

- **What a good test is here:** external behavior through the highest seam — a command posted to the HTTP endpoint against a real Postgres, asserting on the HTTP outcome, the resulting read state, and the audit trail. Never on handler internals, never mocking the database.
- **Primary seam:** the built server's inject interface (already used by the existing health test) over a Testcontainers Postgres with real migrations applied. Every pipeline property is proven here: unauthenticated → rejected; wrong role/branch → rejected; module disabled → rejected; duplicate idempotency key → original result; same key different payload → 409; stale `expectedVersion` → conflict; invalid payload → stable error code; success → record + receipt + audit event all present, all carrying provenance.
- **Secondary seam (structural backstops only):** a raw database connection as the runtime role, two seeded workspaces — proving RLS blocks cross-tenant reads even without app code, composite FKs reject cross-tenant references, and UPDATE/DELETE on audit is denied. Confirmed with user this session; kept narrow.
- **Retained pure-unit seams:** contracts schema tests (Zod parse/reject) and domain money tests — both patterns already exist in the repo; new command payload schemas follow the existing register-asset contract test as prior art.
- Asset-register behavior tested through the same primary seam: register → commission → assign happy path; document renewal supersedes; disposed asset rejects new records; `custom_values` invalid for template → rejected.
- Approval evaluation: no matching rule → `APPROVAL_REQUIRED` (safe default proven by test).

## Out of Scope

- Any web UI (web foundation is its own later spec; the PWA placeholder stays as-is).
- Composite sheet commands, activities, movement legs, meter readings (next spec in §11 order; also awaiting Phase 0 field-list observations for the composite forms).
- Financial entries/postings, the approval *flow* (submitted → approved), period locking (financial-core spec; spine ships only the evaluation step + safe default).
- Work orders, stock, notes, notifications, pg-boss jobs, reports/SQL views, CSV import.
- Offline capture layer (outbox, Dexie, PWA) — the spine only guarantees replay-compatibility (client UUIDs + idempotency).
- On-prem topology B implementation (only its two cheap guards — thin auth interface, S3-only storage — are honored here).
- WhatsApp/SMS/email delivery of anything.
- Seed data that awaits partners: approval thresholds (ticket 06), compensation categories (07), composite-sheet field lists (01).

## Further Notes

- Non-negotiables checklist (§11) covered by this spec: single write path with idempotency + audit; provenance columns; immutable hashed artifacts; XAF minor-unit money; client-generated IDs; stable error codes (French-first i18n on the client side later); append-only audit with revoked privileges; `principal_type`. Period locking is the one non-negotiable deliberately deferred to the financial-core spec — it has nothing to lock until entries exist.
- Partner feedback lands in ~2 weeks; nothing here depends on it (architecture sign-off ticket 02 was downgraded to post-build feedback by user decision, 2026-07-22).
- Wayfinder ticket 14 (on-prem storage shape) stays open; it gates only the on-prem storage implementation, not this spec's storage interface.
- Dependency pins per §8 are already locked at the baseline commit; do not bump during implementation.
