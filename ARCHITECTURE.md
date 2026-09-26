# ROUTIQ Architecture — Asset Lifecycle & Profitability Platform

**Version 0.2 — 22 July 2026 — for review before build**

Synthesized from a multi-agent architecture review (5 analysis passes: domain model, database schema, command layer, AI integration, stack & delivery; 3 adversarial critique passes: MTP scope, Cameroon operating reality, cross-analysis consistency). Companion to the product concept document (`asset-lifecycle-profitability-platform-concept.docx`).

v0.2 incorporates partner requirements from the 22 July meeting (Azalea/Ange): worker compensation reporting, document-expiry notifications, notes on records. Work orders, receipt verification flow, and full action logging were already covered by v0.1.

### Current product direction: internal company fleets

The historical v0.2 transport-first design remains context, not a requirement for every fleet to earn trip revenue. The first target is now companies managing their own internal fleets in Cameroon. Lead with vehicle-centered operating spend, traceable records and useful management decisions; preserve trucking/passenger presets and the existing command/tenant model.

The [vehicle workspace v1 contract](docs/reference/vehicle-workspace-v1.md) defines the initial header, Overview/Money/Documents/History sections, precise metric meanings, proposed additive contracts and required tests. Its Planned items are not existing capabilities. [Product scope](docs/concepts/internal-fleet-product-scope.md) curates the research rationale. Home branch, reported location, custodian, lifecycle and availability remain distinct; no GPS, payment reconciliation or visiting-branch authority is inferred from the UI.

---

## 1. Principles

1. **Vehicle-centered, manual-first.** No GPS, no ticketing, no general ledger. Staff enter operational records; the platform connects them into a vehicle workspace and explainable operating spend. Transport profitability applies only where revenue and cost coverage support it.
2. **AI-native, not AI-dependent.** The application works fully through forms. A future AI agent uses the *same* command layer as the forms — it never writes to the database and ships nothing user-visible in the first version.
3. **One command layer, one write path.** Human UI, offline sync, CSV import, and AI all invoke the same transactional command handlers. No adapter gets direct database access.
4. **Never manufacture missing values.** Reports show completeness warnings, calculation basis, and approval status instead of fake precision.
5. **Build for the pilot that exists.** Two known tenants, French-first users, intermittent connectivity, cash and mobile-money payments, paper source documents, low-end Android phones. Every piece of speculative generality was cut in review; the cuts are recorded in §13.

---

## 2. System overview

Modular monolith. One TypeScript codebase, one PostgreSQL database. No microservices, no event sourcing, no CRDTs.

```
Web/PWA forms ──────┐
Offline sync ───────┤
CSV import ─────────┼──► Command API (Fastify)
AI agent (Phase 2) ─┘        │
                             ├─ authenticate actor + workspace (server-derived)
                             ├─ authorize role + branch scope
                             ├─ idempotency lookup
                             ├─ validate schema + domain invariants
                             ├─ check period locks + record version
                             ├─ evaluate approval rules (where required)
                             └─ atomic commit: records + audit event (+ job enqueue)
                                          │
                        ┌─────────────────┼──────────────────┐
                   Domain tables    Approval records    Append-only audit
                        │
                        └──► Reports = direct SQL views (no projections at pilot scale)
```

Application modules (folders, not services): identity & tenancy, assets, activities & movements, finance, maintenance, inventory, documents, approvals & periods, audit & evidence, reporting, sync.

**API shape: command-oriented HTTP JSON for writes, REST for reads** (CQRS-lite).

```
POST /v1/commands/record-expense        GET /v1/assets/{id}
POST /v1/commands/close-activity        GET /v1/assets/{id}/timeline
POST /v1/commands/decide-approval       GET /v1/reports/asset-profitability
```

Named command endpoints (not `PATCH /expenses/{id}`, not a generic `/execute`) because "approve expense", "release asset", "issue stock" have different permissions, validations, and audit meanings — and each endpoint is independently permissioned, rate-limited, and documented. OpenAPI-generated TypeScript clients give the UI and the future AI tool definitions the same schemas.

---

## 3. Domain model

### 3.1 Core entities

| Entity | Purpose | Key points |
|---|---|---|
| **Workspace** | Tenant | Owns everything; `default_currency` XAF, `timezone` Africa/Douala, `default_locale` fr-CM |
| **Branch** | Agency/depot/workshop | Scope for people, activities, stock, approvals |
| **Principal / Membership** | Who acts | `principal_type: HUMAN \| AI_AGENT \| INTEGRATION`; membership carries one of ~6 fixed roles + branch scope |
| **Person** | Driver, mechanic, clerk | May exist without a login (`membership_id` nullable) |
| **Party** | Customer, vendor, supplier, buyer | Never conflated with Person |
| **Asset** | Truck, trailer, bus, van | `lifecycle_status` separate from availability; capacity + template extras in validated JSONB |
| **Activity** | Haulage job, scheduled journey, charter | The unit of work connecting movements, people, revenue, cost |
| **ActivityAssetSegment** | Which asset carried the activity, when | Roles: PRIMARY, TRAILER, SUBSTITUTE, RECOVERY. Substitution = end one segment, start another, meter readings at handover |
| **ActivityPerson** | Crew participation | Driver, conductor, assistant, relief |
| **MovementLeg** | Ordered leg of an activity | Origin/destination (place refs), departed/arrived, distance, load_state, passenger count. Points at its primary segment |
| **MeterReading** | Immutable odometer/hours observation | Correction via `superseded_by_id` + reason; decreases warn, never silently accepted |
| **AvailabilityInterval** | Downtime/availability history | One interval table; downtime is derived from it, never a hand-maintained total |
| **FinancialEntry** | One economic fact (revenue or expense) | Header: category, dates, counterparty, amount, payment method, evidence, status |
| **FinancialPosting** | Attribution of an entry's amount | Lines carrying `asset_id` / `activity_id` / `work_order_id` / `branch_id`; lines sum to the entry |
| **OperationalIssue** | Defect, breakdown, incident | Safety-critical report auto-creates an UNAVAILABLE interval on submission |
| **WorkOrder** | Maintenance work | Defect → work → verify → **release to service (separate human approval)** |
| **InventoryItem / Movement / StockPosting** | Basic parts stock | Immutable quantity+cost ledger; balance is derived. Issue-to-work-order generates the linked expense entry (single canonical cost posting) |
| **Document** | Compliance record (insurance, permit, license) | One table; renewal inserts a new row with `supersedes_document_id`; old versions never edited |
| **Note** | Free-text annotation on a business record | `(workspace_id, entity_type, entity_id, author_membership_id, body, created_at)`; append-only: a correction is another note, never an edit. v1 annotates assets only (on `feat/maintenance-on-develop`); each further target (activities, work orders, issues, financial entries, documents) is a new nullable FK column, an exclusive arc, so the composite tenant FK stays structural |
| **Notification** | In-app alert for a membership | Generated by scheduled scans (document expiry) and record events; `read_at` tracked; delivery beyond in-app deferred (§5.6) |
| **SourceArtifact** | Receipt, photo, voice note, CSV, instruction | Immutable, SHA-256 hashed, private object storage |
| **ReportingPeriod** | Monthly close | OPEN → LOCKED; the trust boundary for profitability |
| **Command / AuditEvent** | Provenance & permanent history | Every mutation traces to a command; audit is append-only |
| **Place / Route** | Reusable origins/destinations | Minimal `places` table so route profitability doesn't degrade to string matching; free-text fallback for ad-hoc stops |

The **asset timeline (Asset 360)** is a query over audit events + domain tables — there is no separate lifecycle-event table to keep in sync.

### 3.2 Relationships (essentials)

```
Workspace ─< Branch ─< (people, stock locations)
Workspace ─< Asset ─< MeterReading, AvailabilityInterval, Document
Activity ─< ActivityAssetSegment >─ Asset      (roles: PRIMARY/TRAILER/SUBSTITUTE/RECOVERY)
Activity ─< ActivityPerson >─ Person
Activity ─< MovementLeg ──► primary ActivityAssetSegment
FinancialEntry ─< FinancialPosting ──► (asset?, activity?, work_order?, branch)
OperationalIssue ─< WorkOrder ─< task/labor rows
InventoryMovement ─< StockPosting ──► (location, item) ──► linked FinancialEntry on issue
Command ─< AuditEvent; Command >─ SourceArtifact (many-to-many)
```

No overlapping PRIMARY segments per activity (Postgres `EXCLUDE USING gist` over the time range). Exactly one primary carrier at any moment; truck + trailer is two concurrent segments with different roles.

### 3.3 Template system: thin presets, not an engine

Two hardcoded presets (TRUCKING, PASSENGER_TRANSPORT) on one shared schema. Configuration is:

- a `categories` table (asset classes, activity types, revenue/expense categories, document types, issue types) with bilingual labels,
- label/i18n catalogs,
- a per-template required-field list in code,
- `custom_values` JSONB on assets/activities/legs, validated in the command layer against a typed field list per template.

Every record stamps `template_code` + a version integer, so a real configuration engine can be added later without reinterpreting history. **Deferred entirely:** FieldDefinition/MetricDefinition/WorkflowPolicy/EligibilityRule/ReportDefinition engines, versioned template inheritance, workflow designers.

What differs between the two presets is labels, categories, required fields, and metrics (empty-distance % vs. occupancy). What never differs: tables, command handlers, approval engine, audit model, profitability math.

### 3.3a Module entitlements (feature flags per workspace)

Application modules (§2) are also **entitlement units**. One `workspace_modules` table: `(workspace_id, module_code, enabled, enabled_at, enabled_by_command_id)`. Module codes are a fixed registry in code (`ASSETS`, `ACTIVITIES`, `FINANCE`, `MAINTENANCE`, `INVENTORY`, `DOCUMENTS`, `NOTIFICATIONS`, … future: `TICKETING`, `PAYROLL`, `GPS`), each declaring which commands, reports, and nav sections it owns.

- **Enforcement in one place:** the command pipeline (§5.3) gains one step after authorization — *module enabled for workspace* — and the read API filters reports/nav the same way. No per-feature `if` scattered through handlers.
- **Enabling is a command** (`EnableModule` / `DisableModule`, admin role, audited) — so "turn ticketing on for this client" is one auditable action, and disabling hides UI without deleting data.
- **Flags gate access, never schema.** Every workspace shares one schema; a disabled module's tables are simply empty. Turning a module on later requires no migration or backfill.
- **Future modules (ticketing, payroll, GPS) plug in as:** new tables + new commands + new module code. The command layer, audit, RBAC, and approval engine are already module-agnostic — this is the modularity the platform sells, and it is why ticketing stays *out of MTP* without being designed out of the product.

**Customization levers, summarized** (all data or thin config — none require code per client): template preset + required fields, categories with bilingual labels, `custom_values` typed per template, approval thresholds per category/branch, evidence policy per category, notification lead times, numbering format, module flags. A new client = pick preset, tune these — not a fork. The full configuration *engine* (custom workflows, field designers, report builders) stays deferred per decision #1; the levers above cover per-client variance the partners described (small front-end preferences, differing required fields), and every record's `template_code` + version stamp keeps history reinterpretable if a real engine lands later.

### 3.4 Key invariants

1. Tenant isolation is absolute — enforced three ways (§4.4).
2. An asset accepts no new operational records after SOLD / RETIRED / WRITTEN_OFF.
3. Lifecycle status ≠ availability. Maintenance changes availability; disposal changes lifecycle.
4. Approved/posted financial and stock records are never edited — corrections are reversal/superseding records that preserve the original.
5. Postings sum exactly to their entry. One canonical cost posting per economic fact (a part issue creates the expense entry; nobody types it twice).
6. Activity close **warns, not blocks**: missing readings or source summaries set completeness `COMPLETE_WITH_EXCEPTIONS` (with reason) instead of preventing close. Hard-block only the trivial minimum (actual dates, at least one asset segment). Period lock, by contrast, is strict.
7. Substitution keeps one customer-facing activity; each asset carries only the distance and cost it actually incurred. Recovery/repair costs stay direct to the failed asset.
8. Safety-critical defect reports make the asset unavailable immediately on submission; restoration is a separate release approval.
9. Posted totals sum signed postings from POSTED **and REVERSED** entries: a reversal preserves the original and adds its negative counterpart. Counting only POSTED after reversal leaves a false negative amount. Pending/rejected entries are excluded and shown separately; posted/approved does not establish payment. This corrects the original v0.2 wording to match the append-only ledger.
10. Reports never silently invent missing values.

---

## 4. Database

PostgreSQL. Conventional current-state tables + one append-only audit log. No event sourcing (reporting, offline sync, and onboarding all get harder), no per-table history clones, no EAV.

### 4.1 Conventions

- UUID primary keys, client-generatable (offline needs this).
- `workspace_id` on every tenant table; **composite tenant FKs** — `FOREIGN KEY (workspace_id, asset_id)` — so cross-tenant references are structurally impossible.
- Money: `bigint` minor units + `char(3)` currency. **XAF has exponent 0** — 1 XAF = 1 minor unit; never divide by 100. Single-currency behavior hardcoded for the pilot; the column pair makes a second currency additive later. No FX tables, no rate snapshotting.
- `timestamptz` UTC instants + explicit `date` business dates.
- `row_version` integer on every mutable business table (optimistic concurrency).
- `created_by_command_id` on every business row — the provenance hook everything else hangs off.

### 4.2 Financial core (the part that must be right)

```sql
financial_entries (
    id, workspace_id, entry_number,
    direction            CHECK (direction IN ('REVENUE','EXPENSE')),
    category_id,                             -- category carries the profitability layer
    economic_date        date NOT NULL,      -- when it economically happened
    posting_period_id,                       -- which period it posts to (may differ)
    is_late_posting      boolean DEFAULT false,
    branch_id, counterparty_id, description,
    amount_minor         bigint,  currency char(3) DEFAULT 'XAF',
    payment_method       CHECK (payment_method IN ('CASH','MOMO','OM','BANK','OTHER')),
    payment_reference    text,               -- MoMo/OM transaction ref counts as evidence
    source_reference     text,               -- ticket summary, invoice, cash-session ref
    estimate_status      CHECK (... IN ('ACTUAL','ESTIMATED')),
    status               CHECK (... IN ('DRAFT','SUBMITTED','POSTED','REJECTED','REVERSED')),
    reverses_entry_id, row_version, created_by_command_id, ...
)

financial_postings (
    id, workspace_id, financial_entry_id, line_no,
    economic_date, posting_period_id,        -- copied for indexing, trigger-checked
    direction, category_id, branch_id,
    asset_id, activity_id, work_order_id,
    person_id,                               -- nullable attribution dimensions
    amount_minor         bigint,             -- SIGNED: reversals subtract
    asset_attribution    CHECK (... IN ('DIRECT','ALLOCATED')),
    activity_attribution CHECK (... IN ('DIRECT','ALLOCATED')),
    ...
)
```

Resolved design decisions:

- **Postings model wins** over parallel per-dimension allocation sets. One posting row carries both asset and activity attribution; the sum-to-entry check is enforced once; per-dimension DIRECT/ALLOCATED flags express "direct to asset, allocated across activities."
- **Profitability layer lives on the category only** (DIRECT / MAINTENANCE / OWNERSHIP / SHARED). No second classification column to disagree with it.
- **`economic_date` ≠ posting period.** A late-arriving cost (offline sync after month close) keeps its true economic date but posts to the open period, flagged `is_late_posting`. Period P&L uses posting period; activity views use economic date. This is the only behavior compatible with offline sync.
- **Signed posting amounts** so reversals actually subtract and sums can't double-count reversed pairs.
- MTP allocation scope: nearly every line is DIRECT. Ownership costs are manually entered periodic expense lines. Allocation batches, formulas, and shared-cost distribution engines are deferred; the entry/posting split is the cheap hook that makes them additive later.
- **Worker compensation = expense entries with `person_id` attribution.** Trip allowances, per-journey driver pay, and work-order labor are ordinary expense entries in COMPENSATION-class categories, posted with `person_id` (and usually `activity_id` or `work_order_id`). "Pay due per worker per period" is then a posting query, and the same lines feed asset/activity cost — entered once. **Not a payroll system:** no salary contracts, tax, or net-pay computation; recurring monthly salaries are periodic expense lines like ownership costs. Pay *rates* (e.g. standard allowance per route) live as optional route-standard defaults that pre-fill the sheet forms — the recorded entry is always the authoritative fact.

The flagship asset-contribution query (correctly filtered):

```sql
SELECT p.asset_id,
       SUM(p.amount_minor * CASE p.direction WHEN 'REVENUE' THEN 1 ELSE -1 END)
FROM financial_postings p
JOIN financial_entries e ON e.id = p.financial_entry_id
JOIN categories c        ON c.id = p.category_id
WHERE p.workspace_id = :ws
  AND e.status IN ('POSTED', 'REVERSED')
  AND p.economic_date >= :from AND p.economic_date < :to
  AND p.asset_id IS NOT NULL
  AND c.profitability_layer IN ('DIRECT','MAINTENANCE')   -- per the measure requested
GROUP BY p.asset_id;
```

Each report exposes which layers it includes, matching the concept's measure ladder (activity contribution → asset operating contribution → fully loaded → TCO → lifecycle return).

### 4.3 Audit & period locking

- `audit_events`: append-only; full `before_state`/`after_state` JSONB + `changed_fields`; actor membership, command id, entity refs. Runtime DB role has **no UPDATE/DELETE privilege** on it. (Hash-chaining deferred — backups + revoked privileges cover tamper resistance for now.)
- Business-rule enforcement lives in the command layer (the sole write path). The database keeps only cheap structural backstops: FKs, CHECKs, RLS, revoked UPDATE/DELETE on audit and posted financial/stock rows, and **one** period-lock trigger on financial entries/postings. No trigger-based JSONB validation, no multi-table lock triggers.
- **Period lock applies to financial and inventory postings only.** Operational records (legs, readings, intervals) are governed by activity close, not period lock — so ending an ongoing breakdown interval after month close works. Reopening a period requires elevated approval + reason + audit event; there is no admin bypass flag in the runtime.

### 4.4 Tenant isolation (three layers)

1. Command-layer membership + permission checks (workspace derived from auth, never from the request body).
2. Postgres RLS on `workspace_id`, `FORCE ROW LEVEL SECURITY`, `SET LOCAL app.workspace_id` per transaction (pool-safe). Runtime role has no BYPASSRLS.
3. Composite tenant foreign keys.

---

## 5. Command layer

### 5.1 MTP command catalog (~16 commands)

| Command | Approval default |
|---|---|
| RegisterAsset / CommissionAsset | Auto (asset manager permission) |
| AssignAsset (branch/custodian) | Auto; cross-branch transfer → 1 approval. A custodian must be an active member whose branch scope covers the vehicle's branch (`CUSTODIAN_INELIGIBLE`) |
| **RecordJourneySheet** / **RecordHaulageJobSheet** | Auto — composite: one form emits activity + segments + crew + legs + readings atomically |
| CreateActivity / RecordMovementLeg / SubstituteAsset | Auto (granular fallbacks for corrections) |
| CloseActivity | Auto; sets completeness state, warnings not blocks |
| ReopenActivity | 1 approval |
| RecordRevenue / RecordExpense | **Auto-post below threshold; approval above** (thresholds per category/branch, tenant-editable) |
| ReportIssue | Auto (ADMIN, OPS_MANAGER, FIELD_SUBMITTER, MAINTENANCE); a fact, queueable offline. Safety-critical → asset grounded immediately (opens an availability interval; a second report on a grounded asset opens none) |
| ResolveIssue / DismissIssue | Auto. Resolve: the reporting roles; dismiss: ADMIN, OPS_MANAGER, MAINTENANCE. Neither ends a grounding |
| CreateWorkOrder | Rule read against the **expected** cost and the asset's branch: APPROVED (open, costs may attach) when a rule authorizes the actor, else SUBMITTED for ApproveWorkOrder / RejectWorkOrder. No DRAFT. The defaults (ADMIN, OPS_MANAGER, MAINTENANCE) carry no amount bounds, so orders land APPROVED until a tenant sets a threshold |
| CompleteWorkOrder | Rule read against the **actual** total (the larger of the declared cost and the ledger postings on the order): COMPLETED, or COMPLETION_SUBMITTED for ApproveWorkOrderClosure / RejectWorkOrderCompletion. Same unbounded defaults, so completions land COMPLETED. Resolves the linked issue unless the completer unchecks it |
| CancelWorkOrder | Auto (ADMIN, OPS_MANAGER, MAINTENANCE) from SUBMITTED, APPROVED or COMPLETION_SUBMITTED; posted costs stand |
| ApproveWorkOrder / RejectWorkOrder / ApproveWorkOrderClosure / RejectWorkOrderCompletion | FINANCE_APPROVER or ADMIN; the maker (creator, or completer) may not decide their own |
| ReleaseAssetToService | **The release is the human decision:** ADMIN or OPS_MANAGER, human principals only, never queued, never AI. Needs a COMPLETED work order answering the grounding issue, or an override reason once that issue is resolved or dismissed, and every other safety-critical issue on the asset closed (SAFETY_ISSUE_OPEN); a release that leaves the grounding issue OPEN warns GROUNDING_ISSUE_STILL_OPEN. After a safety-critical report the releaser may not be anyone who completed the work (or, on the override path, closed the issue) |
| ReceiveStock / IssueStock | Auto (issue requires authorized destination: work order/asset) |
| AdjustStock | **Always 1 approval, approver ≠ counter** |
| AddOrRenewDocument | Auto |
| AddNote | Auto; every role except EXECUTIVE_VIEWER, which records nothing. Append-only; v1 annotates assets only, refused on SOLD/RETIRED/WRITTEN_OFF |
| AttachEvidence | Auto; RecordExpense's roles without its amount band (a file changes no amount). Links uploaded files to an existing entry without editing it; refused on rejected entries and reversals; MAINTENANCE only on entries whose every posting names a work order |
| DisposeAsset | **Always approval (executive/finance role)** |
| LockPeriod / ReopenPeriod | Lock: finance role. Reopen: finance approval + mandatory reason |
| CorrectOrVoidRecord | Same or stricter than the original record |

Notes:

- The maintenance rows (ReportIssue to ReleaseAssetToService), AddNote, AttachEvidence and the custodian rule on AssignAsset describe the implementation on `feat/maintenance-on-develop` (#44), not yet merged to `develop`. MAINTENANCE records expenses only against a work order (every posting names one), inside the same default band as the field submitter, and may record meter readings at workshop intake.
- Dual-verb commands are split (Close ≠ Reopen, Lock ≠ Reopen) because they carry different risk.
- **The composite sheet commands are the pilot's make-or-break.** The command grain matches the paper trip sheet, not the entity graph — one form, pre-filled from route standards and the previous trip, targeting the <10-minute close criterion.
- CSV import = the same commands per row (staged, validated, previewed, confirmed), never direct inserts. A **backfill mode** (`IMPORTED_HISTORY` provenance class) lets finance approve a historical import batch by summary + sampling instead of row-by-row, and bypasses soft invariants (readings, legs, evidence) wholesale — records stay flagged incomplete in reports. Live data keeps per-record rules.
- "Produce profitability analysis" is a query, not a command.

### 5.2 Approval model (deliberately small)

The full R0–R4 / quorum / multi-step / policy-simulator engine from review is **deferred**. What ships:

- One `approval_rules` table: command type, category, branch, amount range, required role. Tenant-editable thresholds.
- Single-step approval. Maker ≠ approver enforced in code.
- Safe default when no rule matches: require review.
- Records that carry the DRAFT → SUBMITTED → APPROVED lifecycle: **revenue, expenses, stock adjustments, disposal, release-to-service, period operations.** Everything else (legs, readings, assignments, defect reports) saves directly with full audit and is corrected by superseding commands — no ceremony.

The pilot's stated purpose includes discovering "which approval steps are real versus imagined"; the architecture must not pre-impose enterprise workflow.

### 5.3 Validation pipeline (every command, every caller)

authenticate → authorize (role, branch) → module enabled (§3.3a) → idempotency lookup → schema validation → optimistic concurrency (`row_version`) → reference validation (same workspace, effective dates) → state-transition checks → domain invariants → evidence policy → approval rule evaluation → **atomic commit** (records + command receipt + audit event + any pg-boss job in one transaction).

Idempotency: workspace-scoped `(workspace_id, idempotency_key)` unique. Exact retry returns the original result; same key with different payload → 409. Fuzzy duplicate detection (two identical fuel purchases are legal) raises a warning, never blocks.

### 5.4 Evidence policy

Per-category, with an explicit `NO_RECEIPt_EXPECTED` class: loading labor, parking, informal tolls, cleaning produce no paper. Those become "declared cash expenses" (amount + payee text + clerk), flagged in completeness reporting rather than blocked. MoMo/OM transaction references count as evidence. Ticket-summary revenue references the branch's daily cash session identifier — the true source document in intercity operations.

### 5.5 Notifications (document expiry first)

- A daily pg-boss job scans `documents` per workspace against per-document-type lead times (defaults: 30/14/7/1 days; tenant-editable alongside approval thresholds) and inserts `notifications` rows for memberships holding the relevant role + branch scope. Idempotent per (document, threshold) — no duplicate alerts on rerun.
- MTP delivery is **in-app only**: a bell/list surface in the PWA showing unread counts, backed by the same `GET` read API as everything else. The Document Expiry report (§9.5) stays the authoritative pull view; notifications are the push complement.
- Same table serves event-driven alerts later (approval requested, safety-critical issue reported) — generated inside the command transaction, so no extra infrastructure.
- **Deferred:** SMS/WhatsApp/email channels. The `notifications` table carries a `channel` column from day one so adding a sender job later is additive. Field reality favors WhatsApp — decide with operators during the pilot (§12).

---

## 6. Offline & field reality

The promise is **"capture safely now, validate and commit later"** — not an offline-first replica of the whole app.

- **Client:** installable PWA; Dexie/IndexedDB stores drafts, an outbox of immutable command envelopes (client UUIDs + idempotency keys), queued photo blobs, and a cached branch snapshot (that branch's assets, people, categories, open activities — a few KB, refetched wholesale; no change-feed cursors or sync protocol at MTP).
- **Sync:** manual "Sync now" + auto on reconnect; upload blobs first (they're the bulk), then replay commands as independent idempotent calls; show pending/error counts; rejected commands stay local and exportable.
- **Facts vs. decisions.** Physical facts captured offline (movements, expenses, stock issues, meter readings) are **accepted with a discrepancy flag** and routed to reconciliation — a part already left the shelf; the server doesn't get to reject reality. Decisions (approvals, locks, release-to-service, disposal, activity close) always require a server round trip.
- **Auth:** admin-provisioned username/PIN (no email flows for field roles — clerks and drivers are phone-first, often on shared devices). Refresh-token validity ≥ 14 days (max plausible offline window). Server accepts command payloads in the previous schema version for at least that window.
- **Durability:** request `navigator.storage.persist()` and surface the result; hard-cap the local photo queue with visible pressure warnings; Chrome-on-Android is the supported field browser; draft autosave applies to desktop clerks too (power cuts hit branch PCs mid-form).
- **Numbering:** devices get pre-allocated branch-prefixed number ranges (e.g. `DLA-A-0001…0500`) so a clerk can write a job number on paper immediately, offline, without sync-time collisions.
- **Not a vault:** cache only the user's branch scope, never company-wide profitability; per-user stores; strong CSP.

---

## 6a. Deployment topologies & distribution

Two supported topologies, one codebase. A workspace has exactly one **home** — the single writable authority for it. No multi-master.

**Topology A — cloud SaaS (default; the pilot).** Multi-tenant, hosted per §8. Per-user offline capture (§6) already covers field connectivity gaps.

**Topology B — on-premise appliance (planned, not built at MTP).** Same Docker Compose stack (API + Postgres + served PWA + an S3-compatible store — **RustFS**; MinIO is unmaintained since 2026, repo archived) on a mini-PC/server in the company's office; staff use it over LAN with no internet dependency. Single-tenant: one workspace whose home is the local box. Fits operators with unreliable office internet or data-locality demands.

**Cloud sync for Topology B = the offline outbox pattern, one level up.** The local server is a "big offline client": it pushes its append-only command journal + source artifacts to the cloud (idempotency keys and client-generated UUIDs already make replay safe), and the cloud holds a **mirror** of that workspace — offsite backup + owner dashboards from anywhere. The cloud never commits domain state for a locally-homed workspace. This reuses §5/§6 foundations wholesale and avoids the conflict-resolution swamp that multi-master would open (CRDTs stayed cut for a reason).

**Remote decisions via command relay (required — owners must approve from anywhere).** The mirror is read + relay, not read-only. An authenticated owner/approver hits the cloud, reviews mirrored state, and submits a **decision command envelope** (approve, reject, lock period, release) — the same signed envelope format as every other adapter (`packages/contracts` envelope). The cloud does not execute it; it queues the envelope in a per-workspace **relay inbox**. The home server polls the inbox on every sync cycle (seconds when office internet is up, next reconnect otherwise), executes the envelope through the normal pipeline — auth, approval rules, maker ≠ approver, period locks, idempotency — and the outcome flows back to the mirror on the next journal push, closing the loop for the owner's UI ("pending → applied/rejected").

- Single-writer preserved: only the home server ever commits; the cloud stores intent.
- No inbound exposure: home server dials out for both push and poll — no tunnel, no port-forward, no static IP (none of which survive Cameroonian office ISPs anyway).
- **Staleness guard:** the envelope carries the `row_version` the owner saw; if the record changed on the home server since the mirror snapshot, the command is rejected with a conflict and the owner re-reviews — an approval never lands on data the approver didn't see.
- Relay scope is the decision command set only (§5.2 approval-lifecycle records); bulk data entry from the cloud into a locally-homed workspace stays out.

**What MTP must protect so Topology B stays cheap** (the actual work now — B itself is deferred):

1. **Auth behind a thin interface.** Supabase Auth is the cloud identity store, but RBAC, memberships, and the username/PIN field-role path are app-owned already — on-prem swaps in a local credential store without touching authorization.
2. **Storage behind the S3 API only.** Supabase buckets in cloud (its S3 API covers CRUD, multipart, and standard SigV4 presigned URLs — use S3 presigning, not `createSignedUrl`, for the portable code path), RustFS on-prem. No Supabase-specific storage features (RLS-on-storage session-token auth, edge transforms) in business code. One caveat researched 2026-07-22: TUS resumable upload is a Supabase storage-api feature, not an S3 one — either self-host storage-api in front of RustFS on-prem, or abstract resumable upload behind one interface (open decision, wayfinder ticket 14).
3. **No Supabase-only runtime features anywhere else** — no edge functions, no realtime channels in the write path. Postgres + Fastify + pg-boss all self-host as-is.
4. **The dev Docker Compose is the appliance seed.** Keep `docker-compose.yml` able to run the full stack cold — it is the distribution artifact, not just a dev convenience.
5. **Workspace export/import** (commands journal + artifacts + snapshot) — doubles as backup, migration cloud↔on-prem, and the sync bootstrap.

Deferred with Topology B: update/licensing channel for appliances, mirror UI, LAN device provisioning.

**Client strategy:** web PWA is the only frontend at MTP. A React Native driver app comes later as *another client of the same command API* — `packages/contracts` (Zod schemas + generated clients) is shared directly; nothing server-side changes. Trigger for native remains the GPS module (background tracking) per module registry §3.3a.

---

## 7. AI integration (Phase 2 — MTP ships none of it visibly)

### 7.1 The decided model

AI agent = a **principal with a restricted role**, going through the same command layer, RBAC, approval rules, and period locks as humans. For interactive use, effective access = intersection of the human's and the agent's permissions. Unattended intake uses a branch-scoped intake principal — never a global super-agent.

- **Tier 1 (auto):** read/explain via versioned queries. Cannot expose data the requesting user can't see.
- **Tier 2 (draft):** extraction and preparation. Output is a durable **CommandProposal** — the exact versioned command payload, in a proposals table, *never* a half-populated business record. Human review required in the initial release; auto-execution cap starts at zero.
- **Tier 3 (human):** everything consequential (financial approval, stock adjustment, release, allocation, disposal) inherits human approval automatically from the same rules. Risk tier is command metadata; the model never declares its own action low-risk.
- **Confidence gate:** field-level; low-confidence critical fields (asset, amount, date, category, meter) force review regardless of tier. Provider confidence is one input — calibrated against OCR/ASR quality, arithmetic consistency, and historical correction rates.
- **Blast-radius gate:** >25 proposed commands → mandatory batch review; a 200-row spreadsheet = 200 proposals under one batch, never a bulk-upsert; no batch approval for Tier 3 command types.
- **Review flow:** the reviewing human's accept = submission + first approval in one step; the AI principal is recorded as *preparer*, so review labor isn't doubled on exactly the flow meant to remove data-entry burden. Any edit creates a new proposal revision and reruns gates. Review UX is form-first (source on the left, populated form center, evidence/confidence right), not chat-first.

### 7.2 What MTP must contain so Phase 2 is a plug-in, not a rebuild

- Every mutation behind a versioned command with a JSON-Schema input (AI tools are generated from these).
- `principals.principal_type` supporting AI_AGENT; server-injected tenant/actor/branch (the model can never choose its identity).
- `created_by_command_id` on every row; commands table with actor, origin (`HUMAN_UI | CSV_IMPORT | OFFLINE_SYNC | API | AI_AGENT`), idempotency key, payload; immutable hashed `source_artifacts` linkable to commands; append-only audit.
- Draft/approval lifecycle on the record types that need it; period locks checked inside command execution.
- No business handler imports an AI provider SDK. Provenance ships as **columns, not a graph** — the proposal/extraction/field-evidence tables land with Phase 2A.

### 7.3 Phase 2 order

**2A** receipts: one provider behind one thin module, receipt/invoice extraction → RecordExpense proposals + review queue. **2B** voice notes (French/English — calibrate against real Cameroonian code-switched audio and handwritten-French receipts; *collect that corpus during the pilot*, it's the one cheap chance). **2C** Tier 1 queries, profitability narratives, activity/maintenance preparation tools. Provider abstraction stays one interface + one adapter until a second provider is actually needed. Measure extraction accuracy, correction rate, and time saved per record before any autonomy increase; Tier 3 stays human-approved indefinitely.

---

## 8. Tech stack

| Area | Choice | Why |
|---|---|---|
| Repo | pnpm workspace monorepo (`apps/web`, `apps/api`, `packages/contracts`, `packages/domain`) | One dependency graph; shared command schemas |
| Frontend | Vite + React + TypeScript strict | Owner default; SPA — Next.js adds nothing here |
| Routing / data | TanStack Router + TanStack Query | Typed routes; Query cache is not offline storage |
| Forms | React Hook Form + Zod (schemas shared with API) | Long field forms; invariants stay server-side |
| UI | Tailwind + shadcn (Base UI primitives) | Restrained internal design system; components only ever consumed through shadcn generation (decision #28) |
| Offline | vite-plugin-pwa/Workbox + Dexie | Drafts, outbox, blob queue (§6) |
| Backend | Node LTS + Fastify + TypeScript strict | One language; first-class schema validation |
| DB access | Drizzle ORM + explicit SQL views for reports | Type-safe CRUD without hiding Postgres |
| Jobs | pg-boss (in the API process initially) | Postgres-backed — it *is* the transactional outbox; no Redis |
| Auth | Supabase Auth as identity store; app-owned RBAC | But username/PIN provisioning for field roles — no email-dependent flows (§6); behind a thin interface for on-prem swap (§6a) |
| Storage | Supabase private buckets via **S3 API only**, signed URLs, resumable upload | Receipts legible (light compression), EXIF location stripped, MIME checked by content; RustFS-compatible for on-prem (§6a; MinIO unmaintained) |
| i18n | i18next + ICU; fr-CM default, en switchable | No sentence concatenation; API errors are stable codes, not English strings; test both languages at mobile widths |
| Testing | Vitest + Playwright + Testcontainers | Command handlers unit-tested; RLS and offline/reconnect integration-tested |
| Observability | Pino + Sentry | Command id + workspace + sync batch in every log line; no financial evidence in logs |
| Hosting | Cloudflare Pages (PWA) + Render Frankfurt (API) + Supabase Frankfurt (DB/auth/storage) | ~US$40–100/month pilot budget. **Measure real MTN/Orange latency from Douala/Yaoundé before committing; if Paris wins, move API + DB together — never split regions** |

Versions verified against the npm registry 2026-07-22 — pin at scaffold time: TypeScript 7.0 (native compiler), Vite 8.1, React 19.2, Fastify 5.10, TanStack Router 1.170 / Query 5.101, Drizzle ORM 0.45 (0.x — pin exact), pg-boss 12.26, Dexie 4.4, Tailwind 4.3 (CSS-first config, no tailwind.config.js), Zod 4.4, react-hook-form 7.82, i18next 26 / react-i18next 17, vite-plugin-pwa 1.3, pino 10, supabase-js 2.110, Vitest 4.1, Playwright 1.61, pnpm 11, Node 24 LTS.

---

## 9. Reports (MTP set)

Direct SQL views — at pilot volume (tens of assets, hundreds of transactions/month) there is nothing to project.

1. **Asset 360** — identity, documents, assignments, activities, income, costs, maintenance, downtime, timeline.
2. **Activity contribution** — per job/journey/charter, with completeness state.
3. **Asset-period profitability** — the layer ladder from concept §10, layers labelled.
4. **Maintenance & downtime** — defects, repeat repairs, downtime from availability intervals.
5. **Document expiry** — expiring/expired/missing by asset and branch.
6. **Data quality** — open activities, missing readings, unapproved lines, missing evidence, late postings.
7. **Stock on hand** — derived balances, issues by asset/work order.
8. **Worker compensation** — pay due/paid per person per period, from COMPENSATION-class postings with `person_id`; drill-down to the activities and work orders that earned it. Same approval-status disclosure as the profitability reports.

Every profitability figure discloses: layers included, approval statuses included, period basis, and completeness warnings.

---

## 10. Security summary

- Three-layer tenant isolation (§4.4); command layer is the only write path; runtime DB role can't touch audit or posted rows.
- RBAC: ~6 fixed roles (admin, ops manager, field submitter, maintenance, finance approver, executive viewer) + branch scope. `principal_type` distinguishes humans/AI/integrations.
- Evidence artifacts immutable + hashed; corrections attach, never replace.
- For release and legacy-data handling, follow the [finalized receipt rollout guide](docs/howto/artifact-integrity-rollout.md).
- Offline caches are branch-scoped and per-user; PINs re-auth on device; revoked users' unsynced drafts are recoverable by an admin (never silently destroyed — they may contain real business facts).
- Server clock and server-derived identity are authoritative; client `occurred_at` is preserved as user-reported data.

---

## 11. Delivery plan

**Phase 0 — Concierge pilot (now; ~3–4 weeks including prep).** No platform build. Lightweight forms/spreadsheets + a human playing the command layer, per concept §13: two operators, 5–10 assets each, 30–90 days backfilled, two weeks live. Outputs: validated form designs (they become the command schemas), real approval-step observations (they become the `approval_rules` defaults), a corpus of real receipts/trip sheets/voice notes (Phase 2's calibration set), and the go/no-go decision.

**Phase 1 — MTP (~8–12 weeks for a small team).** The spine in build order:

1. Workspace/branch/auth/roles + audit + commands infrastructure (the write path — everything else rides it)
2. Asset register + documents + photos
3. Composite sheet commands: haulage job + journey/charter forms, segments, legs, readings
4. Revenue/expense entries + postings + approval thresholds + period lock
5. Defect → work order → release; basic stock ledger
6. Reports (§9) + CSV import/backfill mode + exports
7. Offline capture layer (§6) — started early, hardened continuously on real devices (Transsion/Itel class)

**Phase 2 — AI (after MTP is trusted).** 2A receipts → 2B voice → 2C queries/preparation (§7.3).

**Non-negotiables that cannot be cut from Phase 1** (everything else in this doc can be trimmed): single command-layer write path with idempotency + audit; command/actor/origin provenance columns; immutable hashed artifacts; period locking; XAF minor-unit money; client-generated IDs; French-first i18n; append-only audit with revoked UPDATE/DELETE; `principal_type`.

---

## 12. Open questions (for owner/operator review)

1. **Approval thresholds:** what XAF amounts actually trigger review at each operator today (fuel, repairs, stock adjustment)? Pilot observation will answer; defaults needed for Phase 1 config.
2. **Cash sessions:** is the daily branch cash reconciliation (tickets + parcels) formal enough to reference as a source document, or does the pilot need a minimal cash-session record type?
3. **Trailer economics:** do the truck operators attribute cost/revenue to trailers separately, or is tractor-level attribution enough for launch? (Schema supports both; forms should show only what's used.)
4. **Number format:** confirm the human-readable numbering scheme (branch prefix + sequence) matches how staff reference jobs today.
5. **Hosting latency:** Frankfurt vs. Paris — needs the real MTN/Orange measurement before infrastructure is provisioned.
6. **Device fleet:** confirm the actual phone models in field use for the offline test matrix.
7. **Compensation basis:** how are drivers/crew actually paid per operator — flat per trip, per route, percentage of takings, monthly + allowances? Determines the COMPENSATION category set and which route-standard defaults are worth pre-filling.
8. **Notification channels:** is in-app enough for the document-expiry alerts at pilot, or do owners expect WhatsApp/SMS from day one? (Adds a sender job + cost per message.)
8a. **On-prem demand:** which of the partners' contacts actually need LAN deployment (§6a Topology B) vs. just reliable offline capture? *(Remote approval question resolved 22 Jul: owners must approve remotely → relay-inbox design in §6a.)*
9. ~~**Ticketing scope**~~ — resolved 22 Jul: ticketing stays out of MTP but is a planned optional module behind a workspace feature flag (§3.3a). Revenue at pilot still enters via daily cash-session summaries.

---

## 13. Decision log (what review changed)

| # | Decision | Replaced |
|---|---|---|
| 1 | Thin hardcoded presets + categories + JSONB | 13-definition-type versioned template engine |
| 2 | One approval_rules table, single step, maker≠approver | R0–R4 tiers, quorum, multi-step plans, policy simulator |
| 3 | Approval lifecycle only on financial/consequential records | Universal DRAFT→SUBMITTED→APPROVED on every record |
| 4 | Entry+postings attribution model, signed amounts, layer-on-category | Parallel per-dimension allocation sets; separate allocation_class column |
| 5 | Concrete participation tables (segments, activity_people) | Polymorphic 5-scope Assignment entity |
| 6 | Composite "record sheet" commands matching paper documents | Entity-by-entity entry ceremony (would miss the 10-minute criterion) |
| 7 | economic_date + posting period; late postings flagged; lock financial only | Lock triggers across 8 table families (broke open intervals, offline sync) |
| 8 | Close = warnings + completeness state | Hard close gates (contradicted pilot's messy-data reality) |
| 9 | Facts accepted-with-flag offline; decisions server-only | Server rejection of offline-captured physical facts |
| 10 | Username/PIN field auth, ≥14-day tokens, N−1 schema acceptance | Email-centric auth flows |
| 11 | Simple draft capture + outbox replay + wholesale snapshot refresh | Change-feed cursors, dependency-ordered sync protocol |
| 12 | XAF-only hardcoded (exponent 0), currency columns kept | FX rate tables, dual amounts, rate snapshotting |
| 13 | Minimal stock ledger; issue→expense link kept | Valuation methods, batch/serial, transfers, reservations |
| 14 | Timeline = query over audit + domain tables | Separate LifecycleEvent table (third overlapping history) |
| 15 | Direct SQL views; pg-boss as outbox | CQRS projections + dedicated outbox at pilot scale |
| 16 | 6 fixed roles | Effective-dated, versioned grant model for 9 roles |
| 17 | CommandProposal model decided now, tables land in Phase 2A | AI drafts as half-populated business records |
| 18 | One AI provider behind one thin module, one flow first | Six provider interfaces, prompt registry, hash-chained audit, calibration matrix — before any extraction existed |
| 19 | Backfill batch approval + IMPORTED_HISTORY class | Per-row approval of historical imports |
| 20 | NO_RECEIPT_EXPECTED categories, MoMo/OM refs as evidence, cash-session source type | Hard evidence gates assuming paper always exists |
| 21 (v0.2) | Compensation = expense postings with `person_id` + COMPENSATION categories + one report | Separate payroll module with contracts/rates engine |
| 22 (v0.2) | In-app notifications table + daily expiry scan; `channel` column reserved | Multi-channel notification service at MTP |
| 23 (v0.2) | Append-only `notes` on any record via AddNote | Per-entity comment tables / editing audit payloads |
| 24 (v0.2) | `workspace_modules` flags, checked once in command pipeline + read API; future ticketing/payroll/GPS as pluggable modules | Building ticketing now; per-feature ifs scattered in handlers; per-client forks |
| 25 (v0.2) | Workspace has one home; on-prem appliance syncs one-way command journal → cloud mirror | Multi-master local↔cloud replication, CRDTs |
| 25a (v0.2) | Remote approvals via cloud relay inbox: cloud queues decision envelopes, home server polls + executes, `row_version` staleness guard | Read-only mirror; exposing home server via tunnel/port-forward |
| 26 (v0.2) | Portability guards at MTP: auth interface, S3-API-only storage, cold-startable compose, workspace export | Building the on-prem appliance now — or coupling to Supabase-only runtime features |
| 27 (v0.2) | Web PWA only at MTP; React Native later as another API client sharing `packages/contracts` | Building native driver app before GPS module exists |
| 28 (2026-07-23) | shadcn on Base UI primitives (CLI's recommended default; owner expectation; consolidated `radix-ui` pkg shipped a missing-tslib packaging bug) | Radix primitives named at v0.2 review |
