# Vehicle workspace v1: implementation contract

This reference defines the internal-fleet vehicle workspace. Delivery and review belong to [#43](https://github.com/truesignal-digital/routiq/issues/43) and [#44](https://github.com/truesignal-digital/routiq/issues/44).

**Status (2026-09-25).** Reads and commands marked **Served** are implemented on `feat/maintenance-on-develop`, which is not yet merged to `develop`. The web screens for the sections are being built for #44 and are not merged yet. Items marked **Planned** are not built.

## Product boundary

The first customer is a company managing its own vehicles in Cameroon. The first useful outcome is explainable recorded vehicle expenses: a manager can open a vehicle, see what was recorded, inspect the source and approval history, and act through existing permissions. Do not require trip revenue, passenger counts or freight jobs to obtain value.

The vehicle workspace is a view over existing records and commands, not a replacement asset schema, second ledger or new workflow engine. Company/branch overviews and cross-vehicle approval queues remain global. The workspace is their record-specific destination.

Preserve TRUCKING and PASSENGER_TRANSPORT. Use the existing shadcn Base UI/base-nova components and French/English catalogs. In the internal-fleet experience, the user-facing words are Vehicles / Véhicules; internal Asset identifiers and API routes do not need a wholesale rename.

This direction curates the owner's customer choice, the September 4 product/code review, and the team's branch/vehicle-workspace discussion. Broader research is distilled in [Internal-fleet product scope](../concepts/internal-fleet-product-scope.md). Research suggestions about payments, temporary authority and maintenance are not accepted v1 capabilities merely because they appeared in a mock-up.

## Header: source and meaning

| Visible field | Existing source | V1 behavior / required addition |
| --- | --- | --- |
| Fleet code | `assets.assetCode` | Required stable identifier; retain even when a plate exists. |
| Plate | `registrationNumber` | Optional; show “Not recorded,” not the fleet code masquerading as a plate. |
| Make / model | `manufacturer`, `model` | Optional readable description; no fabricated model or image. |
| Vehicle category | `assetClassCode` and category labels | Reuse existing classifications. No new per-customer entity model. |
| Home branch | `assets.branchId` and branch read | Administrative home, **not** physical location. Existing transfers remain governed by `assign-asset`. |
| Lifecycle | `lifecycleStatus` | Display existing status; do not treat IN_SERVICE as proof of readiness. |
| Current custodian | `assets.custodianMembershipId`, changed by `assign-asset` | **Served** as `custodian` on the detail read: the member's display name, whether the membership is still active, and `since` (when the latest `asset.assigned` event named this member; null if none did). A custodian is a member of the workspace, never a person without a login. `assign-asset` refuses a deactivated member, or one whose branch scope does not cover the vehicle's branch, with `CUSTODIAN_INELIGIBLE`. `GET /v1/assets/:assetId/custodian-candidates` lists exactly the members it accepts (DIRECTOR and ADMIN only). Label Custodian, not Driver or Manager. No assignment-history model: past custodians are the `asset.assigned` events in History. |
| Availability | `asset_availability_intervals` (MAINTENANCE module) | **Served** as `availability`. GROUNDED while an interval is open, with when it opened, the issue that opened it and that issue's work orders. AVAILABLE when no interval is open, with when the last one closed (null if the vehicle was never grounded). NOT_ASSESSED when MAINTENANCE is off. AVAILABLE means no open interval; it is never derived from the absence of a work order or from lifecycle. |
| Last reading | `meter_readings` (ACTIVITIES module) | **Served** as `lastReading`: the newest current ODOMETER reading, else HOURS, with who recorded it. Null when ACTIVITIES is off. The full list is `GET /v1/assets/:assetId/readings`. |
| Reported location | No authoritative last-location contract on this baseline | Show “No report.” Do not substitute home branch, a trip destination, or a browser GPS guess. Location reporting later needs observed time and source. |

Keep chassis number, year, acquisition data and other specifications in a details section, not a crowded header. Unknown, not recorded and unavailable-to-the-reader are distinct states. None grants extra authority. The header must not expose another tenant's member or a person outside the authorized record context.

## Sections and actions

Each section is a route under `/assets/$assetId`, so the selected section, period and list filters survive a shared link. Keep the vehicle identity visible. A section whose module is off, or that the role may not read, is hidden; a direct link to it shows the permission-denied state and fetches nothing. The reads behind every section are **Served**; the screens are in progress for #44. Do not show Assignments, Fuel analytics or Payments tabs as working features.

| Section | Shown when | Backed by |
| --- | --- | --- |
| Now (fr: “En ce moment”) | Always | Attention items, the selected month's money (ledger readers only) and the five latest history items. |
| Maintenance | MAINTENANCE is on | `GET /v1/work-orders` and `GET /v1/issues` filtered to the vehicle; `GET /v1/issues/:issueId` for a direct link to one issue. A work order's estimate, actual cost and cost lines follow `canReadWorkOrderCosts` (every role but DRIVER, #390): null for a driver, in the list, the detail and the record history's MONEY changes. |
| Money | FINANCE is on and the role reads the ledger | `GET /v1/assets/:assetId/finance` and `GET /v1/finance/entries` filtered to the vehicle. |
| Trips | ACTIVITIES is on | `GET /v1/activities` filtered to the vehicle; each row now carries origin, destination, total distance and the first driver. |
| Documents | DOCUMENTS is on | `GET /v1/assets/:assetId/documents`. |
| History | Always | `GET /v1/assets/:assetId/history`. |

- Now: the status of the vehicle in one sentence, what needs the reader next, what waits on others, and missing data made explicit.
- Maintenance: reported issues and work orders, with each work order's chronology and cost lines.
- Money: recorded vehicle expenses, pending review separately, category breakdown, contributing entries, evidence and history links, and permitted expense, review and correction actions.
- Documents: reuse existing vehicle document records, renewal and supersession commands. A renewal creates a new version; do not replace old evidence.
- History: authorized records and audit events, paginated on demand. Never a separate editable “timeline ledger.”

Phone: compact identity and section selector, readable record cards, full-screen capture. Desktop: line tabs, table and contextual drawer with full-detail escape. Load section records on demand rather than fetching every module on arrival. A long form must not lose a draft when a drawer closes or a route changes; #45 owns durable capture/recovery.

Hide actions the actor cannot perform. An executive can inspect but cannot record, approve, reverse, lock or reopen periods. The UI uses current membership/module context; server authorization remains decisive. Command capabilities do not implicitly define read permission. Do not import the entire identity-capabilities candidate just to obtain a read gate (#47).

## Money: precise meanings

| Label | Definition |
| --- | --- |
| Recorded vehicle expenses | Sum **signed vehicle-attributed postings** for EXPENSE entries in POSTED or REVERSED state, in the selected posting period and currency, within the actor's tenant/branch scope. Include all recorded category layers: DIRECT, MAINTENANCE, OWNERSHIP and SHARED, including the original and its negative reversal. State those included layers in the metric explanation. It is not narrowly defined operating contribution, complete ownership cost, cash paid or company profit. |
| Awaiting review | SUBMITTED expense postings attributed to this vehicle. With a month selector, use the entry's economic month and label that basis explicitly: these entries have no posting period yet. Do not add this amount to posted spend. |
| Rejected | Visible in a separate record filter/history, never included in posted or pending totals. |
| Evidence missing | An entry whose evidence state is NOT_SUPPLIED (see Evidence states below), reversals excluded. Counted by the finance read, filtered with `evidence=MISSING` on the entry list, and raised as ENTRY_EVIDENCE_MISSING. Unavailable to this reader stays distinct: a role outside the ledger readers receives no entry facts at all. Upload integrity checks protect bytes and provenance, not the truth of a receipt. Human verification is **not recorded** by the current model and is deferred; neither an uploaded file nor entry approval supplies a verified-receipt state. Receipt presence is never inferred from free text, and a payment reference is its own state, not a receipt. |
| Recorded payment method/reference | The supplied method/reference on the entry. It does not prove payment, settlement or reconciliation. Those workflows remain #46. |

XAF has exponent zero: 150,000 XAF is stored as 150,000 minor units. No division by 100. Calendar economic dates remain the same day across viewer time zones; posting/audit timestamps are instants. A late posting retains its economic date and shows the actual posting period. Do not silently make an economic-month chart and a posting-period card appear to have the same basis.

The company total uses the entry's complete signed postings; the vehicle total uses **only its matching posting lines**. For a 100,000 XAF entry allocated 60,000 to vehicle A and 40,000 to B, show 60,000 on A, not 100,000. Detail may show the complete entry with both allocations clearly labelled. Never repeat the complete entry amount for each vehicle.

Zero means “no qualifying recorded postings,” not free operation or complete records. An incomplete capture history cannot support a claim of savings, growth, profit, theft or idle capacity. Cost/km, fuel efficiency, budget variance, utilization and ownership cost are deferred until their inputs, coverage and denominators are specified.

## Worked scenario using existing authority

Fixture: one company, Douala branch, vehicle VEH-001, September open. A scoped DRIVER records a 150,000 XAF repair with one posting attributed to VEH-001, a receipt and economic date September 4. Under the existing default 100,000 XAF auto-post threshold for that role, this is submitted for review. Thresholds are configuration, not a new universal company policy.

1. Recording the expense creates one entry. Exact retry with the same command identity returns the same result; it does not create a second charge. The vehicle shows 150,000 awaiting review and 0 posted for this example.
2. A FINANCE member with the required branch scope reviews the entry/evidence and approves through the existing command. Pending becomes 0; posted expense becomes 150,000. Approval is not payment.
3. The executive opens the vehicle's 150,000 figure, sees the matching posting and original entry, and opens history/evidence without write controls. The company/branch, vehicle and period remain consistent through navigation.
4. Finance identifies a duplicate and reverses the posted entry with a reason and current record version. The original stays in history as REVERSED; a second POSTED entry carries -150,000. In the same open period the pair nets to 0. The receipt remains attached to its original record; it is not deleted or silently reassigned.
5. If the original period is locked, the existing late-posting/reversal rules use the current calendar month in the workspace timezone. If that month is also locked, refuse with PERIOD_LOCKED; do not search for an arbitrary open month. Otherwise show the negative amount there, not a rewritten closed-period total. Explain the link back to the original.

No destination-branch operating authority, cashier role, custody transfer, payment execution or maintenance release is introduced by this scenario.

## Evidence states

Every financial entry has one evidence state, computed on read from what is linked to it. There is no link table: the files are those of the command that recorded the entry plus those of every `attach-evidence` call on it, found through its audit event. The states are checked in this order:

| State | Meaning |
| --- | --- |
| SUPPLIED | At least one file is linked, at capture or later through `attach-evidence`. |
| NOT_EXPECTED | The category's evidence policy is NO_RECEIPT_EXPECTED (tolls, parking, driver allowance, loading). |
| PAYMENT_REFERENCE | Paid by MOMO, OM or BANK with a payment reference. The reference stands in for paper (ARCHITECTURE §5.4); it is not a receipt and proves no settlement. |
| NOT_SUPPLIED | Anything else. This is “evidence missing”. |

None of the four says a person checked the paper. A reversal never counts as missing, and a rejected entry or a reversal cannot take evidence. `attach-evidence` links up to ten already uploaded files to an existing entry without changing its amount, status or version; TECHNICIAN may attach only to entries whose every posting names a work order, and TECHNICIAN and DRIVER only to entries they recorded themselves (`OWN_RECORDS_ONLY`). The entry detail lists the files (`evidenceFiles`, each with how it arrived: RECORDED or ATTACHED), and `GET /v1/finance/entries/:entryId/evidence/:artifactId/download-url` hands out a short-lived link only after the FINANCE module and a ledger-reading role (or TECHNICIAN on a work-order-only entry), the entry's branch and the file's link to that entry all pass, each miss past the role answering the same 404. Known imprecision: a file attached to a composite sheet counts for every entry that sheet created.

## Attention

`GET /v1/assets/:assetId/attention` (**Served**, ASSETS module) lists what needs someone's next step on the vehicle, as facts. The server derives them on read; nothing is stored. Document expiry is judged against the business date, today in the workspace timezone, which the response returns. Items come most severe and oldest first, at most 50. Each names the principals who may not take the next step (maker and checker, self-release); which step is the reader's own stays the client's decision.

| Code | When | Severity |
| --- | --- | --- |
| ISSUE_UNPLANNED | An OPEN issue with no active work order | CRITICAL if safety-critical, else WARNING |
| ISSUE_OPEN_WHILE_AVAILABLE | In place of ISSUE_UNPLANNED: an OPEN safety-critical issue with a completed work order on a vehicle that is not grounded — released with the issue left open | INFO |
| WORK_ORDER_AWAITING_AUTHORIZATION | A work order SUBMITTED because a threshold rule held it | WARNING |
| WORK_ORDER_IN_PROGRESS | A work order APPROVED and not yet completed | INFO, or WARNING when its completion was sent back |
| WORK_ORDER_AWAITING_SIGN_OFF | A completion awaiting approval (COMPLETION_SUBMITTED) | WARNING |
| ASSET_AWAITING_RELEASE | The vehicle is grounded, either a completed work order answers the grounding issue or that issue is closed, and no other safety-critical issue on it is OPEN; with no completed work order, the release needs an override reason | CRITICAL |
| DOCUMENT_EXPIRED | A current document whose expiry date has passed | CRITICAL |
| DOCUMENT_EXPIRING | A current document expiring within 30 days | WARNING |
| ENTRY_AWAITING_REVIEW | A SUBMITTED entry with a posting on this vehicle | INFO |
| ENTRY_EVIDENCE_MISSING | A NOT_SUPPLIED entry that is SUBMITTED, or POSTED in an open period | WARNING |

Maintenance items need MAINTENANCE, document items need DOCUMENTS, and entry items need FINANCE and a ledger-reader role (LEDGER_READER_ROLES: Direction, Administrateur, Finance). A work order's amounts follow `canReadWorkOrderCosts` (every role but DRIVER, #390); without it the item carries no amount. Say “{type} expired on {date}”; never say the vehicle cannot legally run.

## History

`GET /v1/assets/:assetId/history` (**Served**, ASSETS module) is the vehicle's timeline: one query over the audit trail of every record that belongs to the vehicle, newest first, paginated with a cursor. It is a read of the trail, never a ledger of its own.

- **Kinds** (filter with `kind`, repeatable): MAINTENANCE (issues, work orders, availability intervals), MONEY (entries with a posting on the vehicle), TRIPS (activities, legs, segments), DOCUMENTS, READINGS, ASSIGNMENTS (`asset.assigned`), LIFECYCLE (the vehicle's other events) and NOTES.
- **Vocabulary.** `eventType` is the audit event's own code (`operational_issue.reported`, `work_order.completed`, `asset.assigned` and so on), an open vocabulary: an unknown code renders raw. Each item also carries the actor, the origin, the subject with its number, an allowlisted set of facts per subject (never the raw audit snapshot) and the event's own reason. A MONEY item carries this vehicle's signed share of the entry, so a reversal is negative. `occurredAt` is when the event was written.
- **Branch rule.** An activity, its legs and segments are read by the activity's branch; a financial entry by its own branch; a reading taken during a job by the job's branch. Everything the vehicle owns outright (its documents, issues, work orders, availability intervals, notes and its own events) follows the vehicle's current branch, so after a transfer it moves with the vehicle. This is the rule the record history applies (#58).
- **Gates.** Sources whose module is off are left out. MONEY entries follow the caller's money scope (`MONEY_READ_SCOPE`): the ledger readers and CASHIER see the entries of their branches, DRIVER only the entries they recorded, TECHNICIAN none (it sees work-order cost lines in the maintenance reads). A detail edit's purchase price is for the ledger readers. DOCUMENTS is not served to CASHIER.

## Notes

`add-note` (**Served**, CORE module) writes a free-text remark on a vehicle. Notes are append-only: never edited or deleted, a correction is another note. Every role may write one; notes on a sold, retired or written-off vehicle are refused. v1 annotates vehicles only: each new target will be a new nullable column on `notes` (an exclusive arc), so the tenant foreign key stays structural. Notes appear in History under NOTES.

## Contracts: served and planned

Served on `feat/maintenance-on-develop`:

| Endpoint | Module and roles | Period basis |
| --- | --- | --- |
| `GET /v1/assets/:assetId` | ASSETS; adds `custodian`, `availability`, `lastReading`; `finance` and `acquisitionAmountMinor` only for LEDGER_READER_ROLES with FINANCE on (`finance` absent and the price null otherwise) | The existing `finance` field stays lifetime data and must not be relabelled as a selected-period total. |
| `GET /v1/assets/:assetId/readings` | ACTIVITIES | None; newest observation first, superseded rows listed and flagged. |
| `GET /v1/assets/:assetId/finance?periodCode=YYYY-MM` | FINANCE; LEDGER_READER_ROLES only | Posted by POSTING_PERIOD; pending and rejected by ECONOMIC_MONTH; `periodStatus` OPEN, LOCKED or NOT_STARTED; six-period series ending at the period. Defaults to the current month in the workspace timezone. Only this vehicle's signed posting lines, entries read by their own branch. |
| `GET /v1/assets/:assetId/attention` | ASSETS; items gated as above | Business date in the workspace timezone. |
| `GET /v1/assets/:assetId/history` | ASSETS; MONEY for ledger readers only | None; newest first. |
| `GET /v1/assets/:assetId/custodian-candidates` | ASSETS; DIRECTOR and ADMIN | None. |
| `GET /v1/issues/:issueId` | MAINTENANCE | None. Lists the photos taken with the report (`artifacts`: `artifactId`, `mimeType`, `sizeBytes`, `originalFileName`). |
| `GET /v1/issues/:issueId/artifacts/:artifactId/download-url` | MAINTENANCE; the issue's vehicle in the caller's branches; the file linked by the report-issue call | None. |
| `GET /v1/assets/:assetId/documents` | Branch scope of the vehicle | None. Each document lists its scans (`artifacts`, same shape) beside `artifactCount`. |
| `GET /v1/assets/:assetId/documents/:documentId/artifacts/:artifactId/download-url` | DOCUMENTS; the vehicle in the caller's branches; the document on that vehicle; the file linked by the command that recorded it | None. |
| `GET /v1/artifacts/:id/download-url` | The caller's own upload, not yet linked to any command; anything else answers 404 | None. A linked file downloads only through its record's route. |
| `GET /v1/finance/entries` | FINANCE; ENTRY_READER_ROLES, rows by money scope (CASHIER their branches, DRIVER own) | `periodCode` is the posting period; `economicMonth` is the economic month. `status=LEDGER` means POSTED and REVERSED. Each item carries its evidence state and file count; `evidence=MISSING` filters to NOT_SUPPLIED. With `assetId`, each item also carries the vehicle's signed share (`assetShareMinor`). |
| `GET /v1/finance/entries/:entryId` | FINANCE; ENTRY_READER_ROLES; 404 outside the caller's money scope | Adds `evidenceFiles`. |
| `GET /v1/finance/approvals` | FINANCE; LEDGER_READER_ROLES only | None. |
| `GET /v1/finance/entries/:entryId/evidence/:artifactId/download-url` | FINANCE; any role that may read the entry: its branches, then its money scope (DRIVER own entries, TECHNICIAN entries whose every posting names a work order) | None. |

Commands served for the workspace: `add-note.v1`, `attach-evidence.v1`, `update-asset-details.v1` (the Details tab's edit mode, #84), custodian changes through `assign-asset` (`custodianMembershipId`), and the maintenance commands listed in ARCHITECTURE §5.1. Migrations 0025 to 0029 on the branch add the maintenance tables (issues, work orders, availability intervals and the work-order column on postings), their approval defaults, the state machines, notes and the attach-evidence defaults. No stored balance, monthly total, vehicle ledger, availability flag or location field was added.

Still **Planned**:

1. **Internal-fleet preset:** add `INTERNAL_FLEET` to the existing enabled-preset model, registration/provisioning validation and localized vocabulary. Its starter pack uses applicable existing vehicle/expense/document categories and existing approval rules; it requires no transport activity or revenue. Preserve existing preset bindings and grandfathering semantics. Do not relabel transport tenants or enable a new preset merely to change a sidebar word. No generic preset engine.
2. **Reported location:** stays “No report” until a location command with observed time and source exists.
3. **Cost per kilometre** and the other efficiency measures stay deferred until their inputs, coverage and denominators are specified (see Money above).
4. **Human receipt verification:** still “Not recorded”; a reviewed-receipt state would need its own audited command and data model.

Allocate migration numbers from the current integration baseline; never reserve a number here or copy another branch's migrations.

## Required tests for #44

- Real commands/read scenario above, with exact XAF and same-/later-period reversal totals. Exercise double submission and stale-version refusal.
- Multi-line allocation (60,000/40,000), shared-vehicle expense, rejected and pending exclusions, no double-counted acquisition/document/maintenance expense, and empty vs unknown coverage.
- Named date basis: calendar date in French/English across Douala/UTC/Chicago; month boundaries, locked-period late postings and pending entries without posting periods.
- Cross-company and restricted-branch list, aggregate, detail, history and attachment denial, including an asset visible in one branch whose historical expense belongs to another. Authorization must happen before data or signed URLs leave the server.
- Executive read-only from navigation and direct links; field capture and finance review use the existing command permissions and branch rules.
- Preset compatibility: old trucking/passenger records remain valid; internal fleet needs no invented trip/revenue; disabled presets are rejected; mixed-fleet vocabulary remains coherent.
- Browser phone/desktop and French/English: overview → vehicle → capture → review → total → entry/evidence → reversal → history; loading, errors, no data, recovery and return-filter preservation. No production prototype records.

See [the domain glossary](../../CONTEXT.md) and [architecture](../../ARCHITECTURE.md) for shared invariants. #46 owns new temporary authority, handovers and payments; #47 owns candidate integration and maintenance conflicts. Staging (#37), cold-start reliability (#42) and field recovery (#45) remain release gates, not reasons to delay every read-only workspace component.
